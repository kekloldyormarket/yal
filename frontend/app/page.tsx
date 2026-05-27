"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/format";
import { floorOf } from "@/lib/yal-client";
import { Stat, TokenAvatar, SortBtn } from "@/components/Primitives";
import { useYal } from "./providers";
import type { UiToken } from "@/lib/types";

type SortKey = "recent" | "bonded" | "floor" | "progress";

export default function HomePage() {
  const { tokens, tokenLoading, stats, nav } = useYal();
  const [tab, setTab] = useState<"all" | "bonding" | "graduated">("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    let out = tokens.slice();
    if (tab === "bonding") out = out.filter((t) => t.status === "bonding");
    if (tab === "graduated") out = out.filter((t) => t.status === "graduated");
    if (q) {
      const qq = q.toLowerCase();
      out = out.filter(
        (t) =>
          t.ticker.toLowerCase().includes(qq) ||
          t.name.toLowerCase().includes(qq) ||
          t.mint.toLowerCase().includes(qq),
      );
    }
    const sorters: Record<SortKey, (a: UiToken, b: UiToken) => number> = {
      recent: (a, b) => b.created_at - a.created_at,
      bonded: (a, b) => b.bonded_sol - a.bonded_sol,
      floor: (a, b) => floorOf(b, nav) - floorOf(a, nav),
      progress: (a, b) => b.progress - a.progress,
    };
    out.sort(sorters[sort]);
    return out;
  }, [tokens, tab, sort, q, nav]);

  return (
    <div className="container">
      <div className="hero">
        <h1>
          launch a meme.
          <br />
          feed the <span className="accent">stacSOL flywheel.</span>
        </h1>
        <p className="sub">
          every meme that graduates on YAL routes its bonded SOL into{" "}
          <strong>stacSOL</strong> — a single-validator LST we run on patched
          agave with native vote batching, <strong>100% commission, every
          lamport of yield compounds into NAV forever.</strong> Your launch is
          an inflation tap into the LST: more memes bond → more SOL staked →
          NAV doubles faster → every $YOURMEME&apos;s redemption floor ratchets
          up on its own. Holders burn their meme to claim a pro-rata slice of
          stacSOL backing. Supply only shrinks. Treasury only grows. The
          marketing is the math.
        </p>
      </div>

      <div className="grid-4" style={{ marginBottom: 18 }}>
        <Stat
          k="tokens"
          v={fmt.num(stats.total_tokens)}
          sub={stats.total_graduated + " graduated"}
        />
        <Stat
          k="bonded · sol"
          v={fmt.sol(stats.total_bonded_sol)}
          sub="lifetime, all tokens"
        />
        <Stat
          k="backing · sol"
          v={fmt.sol(stats.total_backing_sol)}
          sub={fmt.sol(stats.total_stacsol) + " stacsol"}
          accent
        />
        <Stat
          k="redeemed · meme"
          v={fmt.sol(stats.total_redeemed)}
          sub="burned for stacsol"
        />
      </div>

      <div className="section-head">
        <h2>tokens</h2>
        <span className="desc">{filtered.length} match</span>
        <div className="right">
          <input
            placeholder="search ticker, name, mint…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 220, height: 32, padding: "6px 10px", fontSize: 12 }}
          />
        </div>
      </div>

      <div className="tabs">
        <div
          className={"tab " + (tab === "all" ? "active" : "")}
          onClick={() => setTab("all")}
        >
          all
        </div>
        <div
          className={"tab " + (tab === "bonding" ? "active" : "")}
          onClick={() => setTab("bonding")}
        >
          bonding
        </div>
        <div
          className={"tab " + (tab === "graduated" ? "active" : "")}
          onClick={() => setTab("graduated")}
        >
          graduated
        </div>
        <div
          className="right"
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 10,
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          sort
          <SortBtn val="recent" sort={sort} setSort={setSort} label="recent" />
          <SortBtn val="bonded" sort={sort} setSort={setSort} label="bonded" />
          <SortBtn val="progress" sort={sort} setSort={setSort} label="progress" />
          <SortBtn val="floor" sort={sort} setSort={setSort} label="floor" />
        </div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>token</th>
              <th>status</th>
              <th className="r">bonded</th>
              <th className="r">progress</th>
              <th className="r">treasury</th>
              <th className="r">floor</th>
              <th className="r">circ supply</th>
              <th className="r">age</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => (
              <TokenRow key={t.mint} t={t} idx={i + 1} nav={nav} />
            ))}
            {filtered.length === 0 && !tokenLoading && (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign: "center",
                    color: "var(--text-3)",
                    height: 80,
                  }}
                >
                  no tokens.{" "}
                  <Link href="/launch" className="accent">
                    launch one.
                  </Link>
                </td>
              </tr>
            )}
            {tokenLoading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign: "center",
                    color: "var(--text-3)",
                    height: 80,
                  }}
                >
                  loading on-chain tokens…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
        click a row for detail. graduation target is the{" "}
        <strong className="accent">YAL router</strong>, not Raydium. bonded SOL
        → stacSOL → forever-yield → redeemable backing.
      </p>
    </div>
  );
}

function TokenRow({
  t,
  idx,
  nav,
}: {
  t: UiToken;
  idx: number;
  nav: number;
}) {
  const router = useRouter();
  const floor = floorOf(t, nav);
  return (
    <tr className="row-link" onClick={() => router.push("/token/" + t.mint)}>
      <td className="muted">{idx}</td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TokenAvatar ticker={t.ticker} />
          <div>
            <div style={{ fontWeight: 600 }}>${t.ticker}</div>
            <div className="muted" style={{ fontSize: 10 }}>
              {t.name}
            </div>
          </div>
        </div>
      </td>
      <td>
        {t.status === "graduated" ? (
          <span className="badge grad">graduated</span>
        ) : (
          <span className="badge bond">bonding</span>
        )}
      </td>
      <td className="r num">{t.bonded_sol.toFixed(2)} sol</td>
      <td className="r" style={{ minWidth: 110 }}>
        {t.status === "bonding" ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "flex-end",
            }}
          >
            <div className="progress sm" style={{ width: 60 }}>
              <div
                className="progress-fill"
                style={{ width: t.progress * 100 + "%" }}
              />
            </div>
            <span className="num" style={{ fontSize: 11 }}>
              {(t.progress * 100).toFixed(0)}%
            </span>
          </div>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="r num">
        {t.status === "graduated"
          ? t.treasury_stacsol.toFixed(2) + " stsol"
          : "—"}
      </td>
      <td className="r num accent">
        {t.status === "graduated" && floor > 0
          ? floor.toExponential(3)
          : "—"}
      </td>
      <td className="r num muted">
        {fmt.num(t.circulating_supply / 1e6, 1)}M
      </td>
      <td className="r muted">{fmt.agoTs(t.created_at)}</td>
    </tr>
  );
}
