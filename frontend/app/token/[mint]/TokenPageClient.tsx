"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { fmt } from "@/lib/format";
import { Stat } from "@/components/Primitives";
import { floorOf, priceAt, GRADUATION_THRESHOLD_SOL, STACSOL, YAL_PROGRAM_ID_STR, toUiToken } from "@/lib/yal-client";
import { fetchYalTokenByMint, registerTokenIx, yalTokenPda } from "@/lib/sdk";
import { Keypair, Transaction } from "@solana/web3.js";
import { getTokenMetadata } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM } from "@/lib/sdk";
import { buildSwapTx } from "@/lib/swap-tx";
import { appendTip, sendViaSender } from "@/lib/sender";
import { useDbcPoolState } from "@/lib/dbc-state";
import { useCreatedAt } from "@/lib/created-at";
import { useTreasuryStacsol } from "@/lib/treasury-balance";
import { buildMetadataUpdateTx } from "@/lib/metadata-update-tx";
import { buildRedeemTx } from "@/lib/redeem-tx";
import { useYal } from "../../providers";
import type { UiToken } from "@/lib/types";

export default function TokenPageClient({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = use(params);
  const { tokens, tokenLoading, wallet, nav, pushToast, applyLocalRedeem, connection } = useYal();
  const { publicKey, signTransaction } = useWallet();
  // First check the loaded list (fast path for tokens we've already seen).
  // Fall back to a direct PDA fetch for tokens not yet in the list — handles
  // freshly-launched mints + deep links from outside the home page.
  const cached = tokens.find((t) => t.mint === mint);
  const [direct, setDirect] = useState<UiToken | null>(null);
  const [directLoading, setDirectLoading] = useState(true);

  useEffect(() => {
    if (cached) {
      setDirect(cached);
      setDirectLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mintPk = new PublicKey(mint);
        const onchain = await fetchYalTokenByMint(connection, mintPk);
        if (cancelled) return;
        if (!onchain) {
          setDirect(null);
          setDirectLoading(false);
          return;
        }
        // Best-effort metadata fetch (Token-2022 + JSON URI).
        let meta: { name?: string; ticker?: string; desc?: string; img?: string } = {};
        try {
          const tokenMeta = await getTokenMetadata(connection, mintPk, "confirmed", TOKEN_2022_PROGRAM);
          if (tokenMeta) {
            meta.name = tokenMeta.name;
            meta.ticker = tokenMeta.symbol;
            if (tokenMeta.uri && /^https?:\/\//.test(tokenMeta.uri)) {
              try {
                const r = await fetch(tokenMeta.uri);
                if (r.ok) {
                  const j = (await r.json()) as { description?: string; image?: string };
                  meta.desc = j.description;
                  meta.img = j.image;
                }
              } catch {}
            }
          }
        } catch {}
        if (cancelled) return;
        setDirect(toUiToken(onchain, meta));
      } catch (e) {
        console.error("token direct fetch failed:", e);
      } finally {
        if (!cancelled) setDirectLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mint, cached, connection]);

  const token = cached || direct;

  if (!token) {
    if (directLoading || tokenLoading) {
      return (
        <div className="container">
          <div className="panel" style={{ padding: 48, textAlign: "center" }}>
            <pre className="ascii" style={{ color: "var(--text-3)" }}>{`  ┌──────────┐
  │ loading  │
  └──────────┘`}</pre>
            <p className="muted" style={{ marginTop: 12 }}>
              fetching on-chain state…
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="container">
        <div className="panel" style={{ padding: 48, textAlign: "center" }}>
          <pre className="ascii" style={{ color: "var(--text-3)" }}>{`  ┌──────────┐
  │ 404 mint │
  └──────────┘`}</pre>
          <p className="muted" style={{ marginTop: 12 }}>
            this mint has no yal_token PDA yet. If you launched it on Meteora
            but the YAL half failed, click below to register it now — only
            costs the register_token tx fee + treasury rent.
          </p>
          <div style={{ marginTop: 24 }}>
            <RescueRegisterButton mint={mint} />
          </div>
          <p style={{ marginTop: 16 }}>
            <Link href="/" className="accent">
              ← back to tokens
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const isGrad = token.status === "graduated";

  return (
    <div className="container">
      <TokenTop token={token} />
      <div className="grid-token">
        <div>
          {isGrad ? <TreasuryPanel token={token} nav={nav} /> : <BondingChartPanel token={token} />}
          <div style={{ height: 16 }} />
          <ActivityPanel token={token} />
          <div style={{ height: 16 }} />
          <AboutPanel />
        </div>
        <div>
          {isGrad ? (
            <RedeemPanel
              token={token}
              wallet={wallet}
              nav={nav}
              onRedeem={async (amt) => {
                if (!publicKey || !signTransaction) {
                  pushToast({ title: "connect a wallet first", kind: "danger" });
                  return null;
                }
                try {
                  // Tokens use 6 decimals — UI count → raw.
                  const memeAmount = BigInt(Math.floor(amt * 1_000_000));
                  const tx = await buildRedeemTx({
                    conn: connection,
                    user: publicKey,
                    memeMint: new PublicKey(token.mint),
                    treasuryAta: new PublicKey(token.treasury_ata),
                    memeAmount,
                  });
                  appendTip(tx, publicKey);
                  const signed = await signTransaction(tx);
                  const sig = await sendViaSender(signed.serialize());
                  const conf = await connection.confirmTransaction(sig, "confirmed");
                  if (conf.value.err) {
                    throw new Error(
                      `redeem errored: ${JSON.stringify(conf.value.err)} (sig ${sig})`,
                    );
                  }
                  // Optimistic local mirror so the UI shows the result. Real
                  // numbers will refresh on the next listTokens tick.
                  const r = applyLocalRedeem(token.mint, amt);
                  pushToast({
                    title: "redeemed " + fmt.num(amt) + " $" + token.ticker,
                    sub: sig.slice(0, 8) + "…",
                  });
                  return r;
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : "redeem failed";
                  console.error("redeem failed:", err);
                  pushToast({
                    title: "redeem failed",
                    sub: msg.slice(0, 280),
                    kind: "danger",
                  });
                  return null;
                }
              }}
            />
          ) : (
            <BuySellPanel token={token} wallet={wallet} />
          )}
          <div style={{ height: 16 }} />
          <TokenMetaPanel token={token} />
          <CreatorReconfigurePanel token={token} />
        </div>
      </div>
    </div>
  );
}

function TokenTop({ token }: { token: UiToken }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try {
      navigator.clipboard.writeText(token.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {}
  }
  return (
    <div className="token-top">
      {token.img ? (
        <img
          src={token.img}
          alt=""
          style={{
            width: 80,
            height: 80,
            objectFit: "cover",
            border: "1px solid var(--border-2)",
          }}
        />
      ) : (
        <div className="avatar xl">{token.ticker.slice(0, 2)}</div>
      )}
      <div className="meta">
        <div>
          <span className="name">${token.ticker}</span>
          <span className="ticker">· {token.name}</span>
          {token.status === "graduated" ? (
            <span className="badge grad" style={{ marginLeft: 10 }}>
              graduated
            </span>
          ) : (
            <span className="badge bond" style={{ marginLeft: 10 }}>
              bonding · {(token.progress * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <p className="desc">{token.desc}</p>
        <div className="addr" onClick={copy}>
          mint · {fmt.short(token.mint, 8, 8)}{" "}
          {copied ? <span className="accent">copied</span> : <span className="muted">copy</span>}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <a
          className="btn"
          href={"https://solscan.io/token/" + token.mint}
          target="_blank"
          rel="noopener noreferrer"
        >
          solscan
        </a>
        <Link className="btn" href="/leaderboard">
          leaderboard
        </Link>
      </div>
    </div>
  );
}

function BondingChartPanel({ token }: { token: UiToken }) {
  const { connection } = useYal();
  const { state: dbc } = useDbcPoolState(connection, token.mint);
  const createdAt = useCreatedAt(connection, token.pubkey);
  const ageTs = createdAt ?? (token.created_at || null);

  // Live values pulled straight from the Meteora pool. Fall back to the YAL
  // token's stored bonded only when the DBC reader is still warming up.
  const bondedSol = dbc?.bondedSol ?? token.bonded_sol;
  const thresholdSol = dbc?.thresholdSol ?? GRADUATION_THRESHOLD_SOL;
  const progress = dbc?.progress ?? token.progress;
  const price = bondedSol > 0 && progress > 0 ? bondedSol / Math.max(1, progress * 1_000_000_000) : priceAt(progress);

  const pts = useMemo(
    () => makeBondHistory(bondedSol),
    [token.mint, bondedSol],
  );
  // Chart axis ticks scale to the actual threshold for this tier.
  const tickMax = thresholdSol;
  const ticks = [0, tickMax * 0.25, tickMax * 0.5, tickMax * 0.75, tickMax];
  const W = 560,
    H = 240;
  const padL = 40,
    padR = 12,
    padT = 12,
    padB = 28;
  const xs = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const ys = (v: number) => H - padB - (v / tickMax) * (H - padT - padB);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + xs(i) + " " + ys(p.v)).join(" ");
  const area =
    path +
    " L " +
    xs(pts.length - 1) +
    " " +
    (H - padB) +
    " L " +
    xs(0) +
    " " +
    (H - padB) +
    " Z";
  const gradY = ys(tickMax);

  return (
    <div className="panel">
      <div className="panel-h">
        bonding curve
        <span className="badge live" style={{ marginLeft: "auto" }}>
          ● live
        </span>
      </div>
      <div className="panel-body" style={{ paddingBottom: 12 }}>
        <div
          className="grid-4"
          style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 12 }}
        >
          <Stat
            k="bonded"
            v={bondedSol.toFixed(3) + " sol"}
            sub={`/ ${thresholdSol.toFixed(0)} sol target`}
            accent
          />
          <Stat
            k="progress"
            v={(progress * 100).toFixed(1) + "%"}
            sub="to graduation"
          />
          <Stat
            k="price · sol"
            v={price.toExponential(3)}
            sub="live from curve"
          />
          <Stat
            k="age"
            v={ageTs ? fmt.agoTs(ageTs) : "—"}
            sub={ageTs ? "since launch" : "fetching…"}
          />
        </div>

        <div className="progress" style={{ height: 12, marginBottom: 18 }}>
          <div
            className="progress-fill"
            style={{ width: progress * 100 + "%" }}
          />
        </div>

        <div
          className="chart-wrap"
          style={{ aspectRatio: W + "/" + H, marginBottom: 12 }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {ticks.map((v) => (
              <g key={v}>
                <line
                  className="chart-grid"
                  x1={padL}
                  x2={W - padR}
                  y1={ys(v)}
                  y2={ys(v)}
                />
                <text
                  className="chart-axis"
                  x={padL - 6}
                  y={ys(v) + 3}
                  textAnchor="end"
                >
                  {v < 1 ? v.toFixed(1) : v.toFixed(0)}
                </text>
              </g>
            ))}
            <path className="chart-fill" d={area} />
            <path className="chart-line" d={path} />
            <line
              className="chart-grad"
              x1={padL}
              x2={W - padR}
              y1={gradY}
              y2={gradY}
            />
            <text
              className="chart-axis accent"
              x={W - padR - 4}
              y={gradY - 4}
              textAnchor="end"
              style={{ fill: "var(--accent)" }}
            >
              GRADUATE @ {thresholdSol.toFixed(0)} SOL
            </text>
            <text className="chart-axis" x={padL} y={H - 10}>
              {ageTs ? fmt.agoTs(ageTs) + " ago" : "—"}
            </text>
            <text
              className="chart-axis"
              x={W - padR}
              y={H - 10}
              textAnchor="end"
            >
              now
            </text>
          </svg>
        </div>

        <p className="muted" style={{ fontSize: 11 }}>
          when bonded SOL hits {GRADUATION_THRESHOLD_SOL}, curve closes. all bonded SOL routes to the YAL
          router and converts to <span className="accent">stacSOL</span> backing
          for the treasury.
        </p>
      </div>
    </div>
  );
}

function BuySellPanel({
  token,
  wallet,
}: {
  token: UiToken;
  wallet: { balance_sol: number } | null;
}) {
  const { connection, pushToast, refreshTokens } = useYal();
  const { publicKey, signTransaction } = useWallet();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const [working, setWorking] = useState(false);
  const [slip, setSlip] = useState(2);

  const price = priceAt(token.progress);
  const parsed = parseFloat(amt);
  const valid = amt !== "" && !isNaN(parsed) && parsed > 0;
  // Local approximation for the UI — actual fill comes from Meteora's
  // swapQuote at submit time.
  const expected = valid
    ? tab === "buy"
      ? parsed / price
      : parsed * price
    : 0;

  async function submit() {
    if (!valid || !publicKey || !signTransaction) return;
    setWorking(true);
    try {
      const swapBaseForQuote = tab === "sell";
      // Buy: parsed = SOL → lamports (1e9). Sell: parsed = meme UI units → raw (1e6).
      const amountIn = swapBaseForQuote
        ? BigInt(Math.floor(parsed * 1e6))
        : BigInt(Math.floor(parsed * 1e9));

      const { tx, expectedOut } = await buildSwapTx({
        conn: connection,
        user: publicKey,
        memeMint: new PublicKey(token.mint),
        amountIn,
        swapBaseForQuote,
        slippageBps: slip * 100,
      });
      appendTip(tx, publicKey);
      const signed = await signTransaction(tx);
      const sig = await sendViaSender(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      const outDisplay = swapBaseForQuote
        ? (Number(expectedOut) / 1e9).toFixed(6) + " SOL"
        : Math.floor(Number(expectedOut) / 1e6).toLocaleString() + " " + token.ticker;
      pushToast({
        title: (swapBaseForQuote ? "sold $" : "bought $") + token.ticker,
        sub: outDisplay + " · " + sig.slice(0, 8) + "…",
      });
      setAmt("");
      void refreshTokens();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "swap failed";
      pushToast({ title: "swap failed", sub: msg.slice(0, 200), kind: "danger" });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-h">
        trade
        <span className="badge bond" style={{ marginLeft: "auto" }}>
          bonding
        </span>
      </div>
      <div className="panel-body">
        <div className="btn-group" style={{ marginBottom: 16 }}>
          <button
            className={"btn " + (tab === "buy" ? "active" : "")}
            style={{ flex: 1 }}
            onClick={() => setTab("buy")}
          >
            buy
          </button>
          <button
            className={"btn " + (tab === "sell" ? "active" : "")}
            style={{ flex: 1 }}
            onClick={() => setTab("sell")}
          >
            sell
          </button>
        </div>

        <div className="field">
          <label className="label">
            {tab === "buy" ? "amount in sol" : "amount in $" + token.ticker}
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="number"
              placeholder="0.00"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
            />
            <span
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-3)",
                fontSize: 11,
              }}
            >
              {tab === "buy" ? "SOL" : token.ticker}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {(tab === "buy" ? [0.1, 0.5, 1, 5] : [25, 50, 75, 100]).map((v) => (
              <button
                key={v}
                className="btn"
                style={{ height: 26, padding: "0 8px", fontSize: 10, flex: 1 }}
                onClick={() => setAmt(String(v))}
              >
                {tab === "buy" ? v + " sol" : v + "%"}
              </button>
            ))}
          </div>
        </div>

        <div className="kv">
          <span className="k">price</span>
          <span className="v num">{price.toFixed(10)} sol</span>
        </div>
        <div className="kv">
          <span className="k">you receive ≈</span>
          <span className="v num accent">
            {valid
              ? tab === "buy"
                ? fmt.num(expected, 0) + " " + token.ticker
                : expected.toFixed(6) + " sol"
              : "—"}
          </span>
        </div>
        <div className="kv">
          <span className="k">slippage</span>
          <span className="v">
            {[1, 2, 5].map((s) => (
              <span
                key={s}
                onClick={() => setSlip(s)}
                style={{
                  marginLeft: 8,
                  cursor: "pointer",
                  color: slip === s ? "var(--accent)" : "var(--text-3)",
                  borderBottom:
                    slip === s ? "1px solid var(--accent)" : "none",
                }}
              >
                {s}%
              </span>
            ))}
          </span>
        </div>

        <hr className="hr" />

        <button
          className="btn primary xl"
          style={{ width: "100%" }}
          disabled={!wallet || working || !valid}
          onClick={submit}
        >
          {!wallet
            ? "connect wallet"
            : working
              ? "signing…"
              : tab === "buy"
                ? "buy " + token.ticker
                : "sell " + token.ticker}
        </button>

        <div className="hr-dashed" />
        <p className="muted" style={{ fontSize: 10, lineHeight: 1.5 }}>
          Routes through Meteora DBC. On graduation
          ({GRADUATION_THRESHOLD_SOL} sol bonded for full tier), bonded SOL
          gets minted into stacSOL and your bag becomes a pro-rata claim.
        </p>
      </div>
    </div>
  );
}

function TreasuryPanel({ token, nav }: { token: UiToken; nav: number }) {
  const backing_sol = token.treasury_stacsol * nav;
  const floor = floorOf(token, nav);

  return (
    <div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="big-num">
          <div className="k">treasury · stacSOL</div>
          <div className="v accent">{token.treasury_stacsol.toFixed(3)}</div>
          <div className="sub">
            ≈ {backing_sol.toFixed(3)} sol @ {nav.toFixed(5)} nav
          </div>
        </div>
        <div className="big-num">
          <div className="k">redemption floor · sol/meme</div>
          <div className="v">{floor > 0 ? floor.toExponential(3) : "—"}</div>
          <div className="sub">supply down · nav up · floor up</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">treasury composition</div>
        <div className="panel-body">
          <div className="kv">
            <span className="k">stacSOL balance</span>
            <span className="v num accent">{token.treasury_stacsol.toFixed(6)}</span>
          </div>
          <div className="kv">
            <span className="k">stacSOL → sol equiv</span>
            <span className="v num">{backing_sol.toFixed(6)} sol</span>
          </div>
          <div className="kv">
            <span className="k">stacSOL NAV (live)</span>
            <span className="v num">{nav.toFixed(6)}</span>
          </div>
          <div className="kv">
            <span className="k">total supply</span>
            <span className="v num">{fmt.num(token.total_supply)}</span>
          </div>
          <div className="kv">
            <span className="k">circulating supply</span>
            <span className="v num">{fmt.num(token.circulating_supply)}</span>
          </div>
          <div className="kv">
            <span className="k">burned via redeem</span>
            <span className="v num">{fmt.num(token.redeemed_meme)}</span>
          </div>
          <div className="kv">
            <span className="k">bonded at graduation</span>
            <span className="v num">{token.bonded_sol.toFixed(3)} sol</span>
          </div>
          <div className="kv">
            <span className="k">graduated</span>
            <span className="v">{fmt.agoTs(token.graduated_at)} ago</span>
          </div>
          <div className="kv">
            <span className="k">last redemption</span>
            <span className="v">
              {token.last_liquidation_ts
                ? fmt.agoTs(token.last_liquidation_ts) + " ago"
                : "—"}
            </span>
          </div>
          <hr className="hr" />
          <div className="mono-block">
            <span className="muted">// the math</span>
            <br />
            stacsol_received = (meme_amount / circulating_supply) ×
            treasury_stacsol
            <br />
            sol_equivalent &nbsp;&nbsp; = stacsol_received × NAV
            <br />
            <span className="accent">effective_floor</span> &nbsp; =
            sol_equivalent / meme_amount
            <br />
            <br />
            <span className="accent">
              {floor > 0 ? floor.toExponential(6) : "0"}
            </span>{" "}
            sol per ${token.ticker}
          </div>
        </div>
      </div>
    </div>
  );
}

function RedeemPanel({
  token,
  wallet,
  nav,
  onRedeem,
}: {
  token: UiToken;
  wallet: { holdings: Record<string, number> } | null;
  nav: number;
  onRedeem: (amt: number) => Promise<{ stacsol_received: number; sol_received: number } | null> | { stacsol_received: number; sol_received: number } | null;
}) {
  const { connection } = useYal();
  // Live treasury ATA balance — the on-chain truth. The stored token field
  // can lag if SOL was deposited via direct Sanctum CPI.
  const liveTreasuryStacsol = useTreasuryStacsol(connection, token.treasury_ata);
  const effectiveTreasury = Math.max(liveTreasuryStacsol, token.treasury_stacsol);
  const [amt, setAmt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ stacsol_received: number; sol_received: number } | null>(null);

  const userBal = wallet?.holdings[token.mint] || 0;
  const parsedAmt = parseFloat(amt) || 0;
  // YAL memes are 6 decimals — convert stored raw circulating supply to UI
  // units so the share math works against the UI-unit input.
  const MEME_DECIMALS = 1_000_000;
  const circulatingUi = token.circulating_supply / MEME_DECIMALS;
  const stacsol_received =
    circulatingUi > 0
      ? (parsedAmt / circulatingUi) * effectiveTreasury
      : 0;
  const sol_received = stacsol_received * nav;
  const effective_floor = parsedAmt > 0 ? sol_received / parsedAmt : 0;

  function pct(p: number) {
    setAmt(String(Math.floor(userBal * p)));
  }

  function review() {
    if (!parsedAmt || parsedAmt > userBal) return;
    setConfirming(true);
  }

  async function confirm() {
    setWorking(true);
    try {
      const r = await onRedeem(parsedAmt);
      setResult(r);
    } finally {
      setWorking(false);
    }
  }

  function reset() {
    setConfirming(false);
    setResult(null);
    setAmt("");
  }

  return (
    <div className="panel" style={{ borderColor: "var(--accent-dim)" }}>
      <div className="panel-h" style={{ background: "var(--accent-faint)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 700 }}>redeem</span>
        <span className="badge grad" style={{ marginLeft: "auto" }}>
          burn → claim
        </span>
      </div>
      <div className="panel-body">
        {!confirming && !result && (
          <>
            <div className="field">
              <label className="label">
                amount of ${token.ticker} to burn
                <span
                  style={{
                    float: "right",
                    color: "var(--text-3)",
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  balance · {wallet ? fmt.num(userBal) : "—"}
                </span>
              </label>
              <input
                type="number"
                placeholder="0"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {[0.25, 0.5, 0.75, 1].map((p) => (
                  <button
                    key={p}
                    className="btn"
                    style={{
                      height: 26,
                      padding: "0 8px",
                      fontSize: 10,
                      flex: 1,
                    }}
                    onClick={() => pct(p)}
                    disabled={!wallet}
                  >
                    {p === 1 ? "max" : p * 100 + "%"}
                  </button>
                ))}
              </div>
              {parsedAmt > userBal && wallet && (
                <div className="err">exceeds balance.</div>
              )}
            </div>

            <div className="kv">
              <span className="k">you burn</span>
              <span className="v num">
                {fmt.num(parsedAmt)} ${token.ticker}
              </span>
            </div>
            <div className="kv">
              <span className="k">share of supply</span>
              <span className="v num">
                {token.circulating_supply > 0
                  ? fmt.pct(parsedAmt / token.circulating_supply, 4)
                  : "—"}
              </span>
            </div>
            <div className="kv">
              <span className="k">stacsol received</span>
              <span className="v num accent">
                {stacsol_received.toFixed(6)}
              </span>
            </div>
            <div className="kv">
              <span className="k">≈ sol value</span>
              <span className="v num">{sol_received.toFixed(6)}</span>
            </div>
            <div className="kv">
              <span className="k">your effective floor</span>
              <span className="v num">
                {effective_floor > 0
                  ? effective_floor.toExponential(3) + " sol/meme"
                  : "—"}
              </span>
            </div>

            <hr className="hr" />

            <button
              className="btn primary xl"
              style={{ width: "100%" }}
              disabled={!wallet || !parsedAmt || parsedAmt > userBal}
              onClick={review}
            >
              {!wallet
                ? "connect wallet"
                : !parsedAmt
                  ? "enter amount"
                  : "review redemption →"}
            </button>
            <p className="muted" style={{ fontSize: 10, marginTop: 10, lineHeight: 1.5 }}>
              your meme bonded {token.bonded_sol.toFixed(2)} sol, which became{" "}
              {token.treasury_stacsol.toFixed(2)} stacSOL backing. burn your
              meme to claim your share.
            </p>
          </>
        )}

        {confirming && !result && (
          <>
            <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
              <pre className="ascii" style={{ color: "var(--accent)" }}>{`  ┌─────────────┐
  │   confirm   │
  │   redeem    │
  └─────────────┘`}</pre>
            </div>
            <div className="kv">
              <span className="k">burning</span>
              <span className="v num">
                {fmt.num(parsedAmt)} ${token.ticker}
              </span>
            </div>
            <div className="kv">
              <span className="k">receiving</span>
              <span className="v num accent">
                {stacsol_received.toFixed(6)} stacSOL
              </span>
            </div>
            <div className="kv">
              <span className="k">≈ sol</span>
              <span className="v num">{sol_received.toFixed(6)}</span>
            </div>
            <div className="kv">
              <span className="k">program</span>
              <span className="v">{fmt.short(YAL_PROGRAM_ID_STR, 6, 6)}</span>
            </div>
            <div className="kv">
              <span className="k">instruction</span>
              <span className="v">redeem(meme_amount)</span>
            </div>
            <hr className="hr" />
            <div className="mono-block" style={{ marginBottom: 12 }}>
              accounts:
              <br />
              {"  "}yal_token (PDA)
              <br />
              {"  "}meme_mint
              <br />
              {"  "}user_meme_ata
              <br />
              {"  "}treasury_stacsol_ata
              <br />
              {"  "}user_stacsol_ata
              <br />
              {"  "}stacsol_mint
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={reset}
                disabled={working}
              >
                cancel
              </button>
              <button
                className="btn primary"
                style={{ flex: 2 }}
                onClick={confirm}
                disabled={working}
              >
                {working ? "signing…" : "sign + send"}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
              <pre className="ascii" style={{ color: "var(--accent)" }}>{`  ╔═════════════╗
  ║  redeemed   ║
  ╚═════════════╝`}</pre>
            </div>
            <div className="kv">
              <span className="k">burned</span>
              <span className="v num">{fmt.num(parsedAmt)}</span>
            </div>
            <div className="kv">
              <span className="k">stacsol received</span>
              <span className="v num accent">
                {result.stacsol_received.toFixed(6)}
              </span>
            </div>
            <div className="kv">
              <span className="k">sol equivalent</span>
              <span className="v num">{result.sol_received.toFixed(6)}</span>
            </div>
            <button
              className="btn primary"
              style={{ width: "100%", marginTop: 14 }}
              onClick={reset}
            >
              redeem more
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ActivityPanel({ token: _token }: { token: UiToken }) {
  return (
    <div className="panel">
      <div className="panel-h">recent activity</div>
      <div className="panel-body" style={{ padding: "24px 16px", textAlign: "center" }}>
        <p className="muted" style={{ fontSize: 11 }}>
          indexer pending. on-chain signatures will populate here once the
          activity stream is wired up.
        </p>
      </div>
    </div>
  );
}

function TokenMetaPanel({ token }: { token: UiToken }) {
  return (
    <div className="panel">
      <div className="panel-h">on-chain</div>
      <div className="panel-body" style={{ fontSize: 11 }}>
        <div className="kv">
          <span className="k">mint</span>
          <span className="v">{fmt.short(token.mint, 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">authority</span>
          <span className="v">{fmt.short(token.authority, 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">treasury ATA</span>
          <span className="v">{fmt.short(token.treasury_ata, 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">yal_token PDA</span>
          <span className="v">{fmt.short(token.pubkey, 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">router program</span>
          <span className="v">{fmt.short(YAL_PROGRAM_ID_STR, 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">stacSOL mint</span>
          <span className="v">{fmt.short(STACSOL.MINT.toBase58(), 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">stacSOL pool</span>
          <span className="v">{fmt.short(STACSOL.POOL.toBase58(), 6, 6)}</span>
        </div>
        <div className="kv">
          <span className="k">token program</span>
          <span className="v">Token-2022</span>
        </div>
      </div>
    </div>
  );
}

function AboutPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <div
        className="panel-h"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        what is stacSOL?{" "}
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          {open ? "−" : "+"}
        </span>
      </div>
      {open && (
        <div
          className="panel-body"
          style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}
        >
          <p style={{ marginBottom: 10 }}>
            stacSOL is a Token-2022 LST backed by a single validator running
            a patched <span className="accent">agave</span> with native
            TowerSync multi-slot vote batching.
          </p>
          <p style={{ marginBottom: 10 }}>
            <strong>6.9% fee on every mint, burn, and transfer</strong> of
            stacSOL — all of it flows back to NAV. Every interaction with the
            token pumps the floor for everyone still holding. Validator
            commission is collected by the operator separately, not by NAV.
          </p>
          <p style={{ marginBottom: 10 }}>
            anyone can launch a meme; every graduation mints stacSOL (and
            funds NAV via the 6.9% mint fee in the process).
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <a
              className="btn"
              href="https://stacsol.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              stacsol.app
            </a>
            <a
              className="btn"
              href="https://github.com/kekloldyormarket/agave"
              target="_blank"
              rel="noopener noreferrer"
            >
              patched agave
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function makeBondHistory(bondedSol: number) {
  // Deterministic curve approximation purely from current bonded — no fake history.
  // The line shows the implied "accelerating-to-current" path, not real txns.
  const total = bondedSol || 0.01;
  const n = 36;
  const points: { t: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    points.push({ t, v: total * Math.pow(t, 1.6) });
  }
  return points;
}

// Creator-only panel. Shown when the connected wallet matches the
// yal_token.authority. Lets the launcher re-upload metadata (name / symbol /
// description / image) and flips the on-chain Token-2022 'uri' field to
// point at the new JSON.
// Standalone register-only rescue button. For Meteora pools where the user
// got charged for createPool but YAL register_token never landed. Anyone
// with a connected wallet can sign the register tx — first one to land wins
// the yal_token.authority slot.
function RescueRegisterButton({ mint }: { mint: string }) {
  const { connection, pushToast, refreshTokens } = useYal();
  const { publicKey, signTransaction } = useWallet();
  const [working, setWorking] = useState(false);

  async function submit() {
    if (!publicKey || !signTransaction) {
      pushToast({ title: "connect a wallet first", kind: "danger" });
      return;
    }
    setWorking(true);
    try {
      const memeMint = new PublicKey(mint);
      const [yalToken] = yalTokenPda(memeMint);
      const treasuryAta = Keypair.generate();

      const ix = registerTokenIx({
        yalToken,
        memeMint,
        treasuryAta: treasuryAta.publicKey,
        authority: publicKey,
        stacsolTokenProgram: TOKEN_2022_PROGRAM,
        totalSupply: 1_000_000_000n * 1_000_000n,
      });
      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      appendTip(tx, publicKey);
      tx.partialSign(treasuryAta);
      const signed = await signTransaction(tx);

      // Simulate first to surface failures pre-fee.
      const sim = await connection.simulateTransaction(signed);
      if (sim.value.err) {
        const logs = (sim.value.logs ?? []).slice(-4).join(" | ");
        throw new Error(
          `register_token sim failed: ${JSON.stringify(sim.value.err)} · ${logs}`,
        );
      }

      const sig = await sendViaSender(signed.serialize());
      const conf = await connection.confirmTransaction(sig, "confirmed");
      if (conf.value.err) {
        throw new Error(
          `register_token on-chain err: ${JSON.stringify(conf.value.err)} (sig ${sig})`,
        );
      }
      pushToast({
        title: "registered with YAL",
        sub: sig.slice(0, 8) + "…",
      });
      void refreshTokens();
      // Hard-reload the token page so all panels remount with the new state.
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "rescue failed";
      console.error("rescue failed:", err);
      pushToast({
        title: "rescue failed",
        sub: msg.slice(0, 280),
        kind: "danger",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <button
      className="btn primary lg"
      onClick={submit}
      disabled={working}
      style={{ minWidth: 280 }}
    >
      {working ? "signing…" : "rescue · register this mint"}
    </button>
  );
}

function CreatorReconfigurePanel({ token }: { token: UiToken }) {
  const { connection, pushToast } = useYal();
  const { publicKey, signTransaction } = useWallet();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(token.name);
  const [symbol, setSymbol] = useState(token.ticker);
  const [description, setDescription] = useState(token.desc);
  const [imgUrl, setImgUrl] = useState(token.img || "");
  const [uploading, setUploading] = useState(false);
  const [working, setWorking] = useState(false);

  const isCreator =
    !!publicKey && publicKey.toBase58() === token.authority;
  if (!isCreator) return null;

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/upload-image", { method: "POST", body: fd });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error || "upload failed");
      setImgUrl(j.url);
    } catch (err: unknown) {
      pushToast({
        title: "image upload failed",
        sub: err instanceof Error ? err.message : "",
        kind: "danger",
      });
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!publicKey || !signTransaction) return;
    setWorking(true);
    try {
      const metaResp = await fetch("/api/upload-metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          symbol: symbol.toUpperCase(),
          description,
          image: imgUrl,
          external_url: "https://yal.fun",
        }),
      });
      const j = (await metaResp.json()) as { url?: string; error?: string };
      if (!metaResp.ok || !j.url) throw new Error(j.error || "metadata upload failed");

      const tx = await buildMetadataUpdateTx({
        conn: connection,
        mint: new PublicKey(token.mint),
        updateAuthority: publicKey,
        newUri: j.url,
      });
      appendTip(tx, publicKey);
      const signed = await signTransaction(tx);
      const sig = await sendViaSender(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      pushToast({
        title: "metadata updated",
        sub: sig.slice(0, 8) + "…",
      });
      setOpen(false);
    } catch (err: unknown) {
      pushToast({
        title: "update failed",
        sub: err instanceof Error ? err.message.slice(0, 200) : "",
        kind: "danger",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div style={{ height: 16 }} />
      <div className="panel" style={{ borderColor: "var(--accent-dim)" }}>
        <div
          className="panel-h"
          style={{ cursor: "pointer" }}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ color: "var(--accent)", fontWeight: 700 }}>
            creator · reconfigure
          </span>
          <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
            {open ? "−" : "+"}
          </span>
        </div>
        {open && (
          <div className="panel-body">
            <p className="muted" style={{ fontSize: 11, marginBottom: 14 }}>
              You hold the update authority on this mint. Re-upload metadata
              JSON to Vercel Blob and flip the on-chain URI — wallets and
              explorers will fetch the new name / symbol / image immediately.
            </p>

            <div className="field">
              <label className="label">name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
              />
            </div>
            <div className="field">
              <label className="label">symbol</label>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                maxLength={10}
              />
            </div>
            <div className="field">
              <label className="label">description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={240}
              />
            </div>
            <div className="field">
              <label className="label">image</label>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <label className="btn" style={{ cursor: "pointer" }}>
                  {uploading ? "uploading…" : "choose new"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImage}
                    style={{ display: "none" }}
                  />
                </label>
                {imgUrl && (
                  <img
                    src={imgUrl}
                    alt=""
                    style={{
                      width: 48,
                      height: 48,
                      objectFit: "cover",
                      border: "1px solid var(--border-2)",
                    }}
                  />
                )}
              </div>
            </div>

            <hr className="hr" />

            <button
              className="btn primary lg"
              style={{ width: "100%" }}
              onClick={submit}
              disabled={working || uploading || !name || !symbol}
            >
              {working ? "signing…" : "update metadata · 1 tx"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
