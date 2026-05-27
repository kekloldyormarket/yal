"use client";

import { fmt } from "@/lib/format";
import { Stat } from "@/components/Primitives";
import { RPC, STACSOL, YAL_PROGRAM_ID_STR } from "@/lib/yal-client";
import { useYal } from "../providers";

export default function StatsPage() {
  const { tokens, stats, nav } = useYal();
  const grads = tokens.filter((t) => t.status === "graduated");
  const bonding = tokens.filter((t) => t.status === "bonding");

  const totalSupply = grads.reduce((a, t) => a + t.total_supply, 0);
  const totalCirc = grads.reduce((a, t) => a + t.circulating_supply, 0);
  const burnedPct = totalSupply > 0 ? 1 - totalCirc / totalSupply : 0;

  const rpcDisplay = RPC.replace(/apiKey=.*/, "apiKey=•••");

  return (
    <div className="container">
      <div className="hero">
        <h1>system stats.</h1>
        <p className="sub">
          numbers don&apos;t sleep. the only marketing here is the math.
        </p>
      </div>

      <div className="grid-4" style={{ marginBottom: 24 }}>
        <Stat
          k="tokens · total"
          v={fmt.num(stats.total_tokens)}
          sub={bonding.length + " bonding · " + grads.length + " graduated"}
        />
        <Stat
          k="bonded · sol"
          v={fmt.sol(stats.total_bonded_sol)}
          sub="lifetime, all tokens"
        />
        <Stat
          k="stacsol backing"
          v={fmt.sol(stats.total_stacsol)}
          sub={"≈ " + fmt.sol(stats.total_backing_sol) + " sol"}
          accent
        />
        <Stat
          k="redeemed · meme"
          v={fmt.sol(stats.total_redeemed)}
          sub={fmt.pct(burnedPct, 2) + " of grad supply"}
        />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-h">stacSOL · live</div>
          <div className="panel-body">
            <div className="kv">
              <span className="k">NAV (sol per stacsol)</span>
              <span className="v num accent">{nav.toFixed(6)}</span>
            </div>
            <div className="kv">
              <span className="k">pool</span>
              <span className="v">
                {fmt.short(STACSOL.POOL.toBase58(), 8, 8)}
              </span>
            </div>
            <div className="kv">
              <span className="k">mint</span>
              <span className="v">
                {fmt.short(STACSOL.MINT.toBase58(), 8, 8)}
              </span>
            </div>
            <div className="kv">
              <span className="k">withdraw auth</span>
              <span className="v">
                {fmt.short(STACSOL.WITHDRAW_AUTH.toBase58(), 8, 8)}
              </span>
            </div>
            <div className="kv">
              <span className="k">manager fee</span>
              <span className="v">
                {fmt.short(STACSOL.MANAGER_FEE.toBase58(), 8, 8)}
              </span>
            </div>
            <div className="kv">
              <span className="k">mint/burn/xfer fee → NAV</span>
              <span className="v accent">6.9%</span>
            </div>
            <div className="kv">
              <span className="k">validator commission → operator</span>
              <span className="v">100%</span>
            </div>
            <div className="kv">
              <span className="k">token program</span>
              <span className="v">Token-2022</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">YAL router · live</div>
          <div className="panel-body">
            <div className="kv">
              <span className="k">program id</span>
              <span className="v">{fmt.short(YAL_PROGRAM_ID_STR, 8, 8)}</span>
            </div>
            <div className="kv">
              <span className="k">cluster</span>
              <span className="v">mainnet-beta</span>
            </div>
            <div className="kv">
              <span className="k">total tokens registered</span>
              <span className="v num">{fmt.num(stats.total_tokens)}</span>
            </div>
            <div className="kv">
              <span className="k">treasuries opened</span>
              <span className="v num">{fmt.num(grads.length)}</span>
            </div>
            <div className="kv">
              <span className="k">lifetime bonded sol</span>
              <span className="v num">{fmt.sol(stats.total_bonded_sol)}</span>
            </div>
            <div className="kv">
              <span className="k">lifetime sol → stacsol</span>
              <span className="v num accent">
                {fmt.sol(stats.total_stacsol)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 24 }} />

      <div className="panel">
        <div className="panel-h">instructions · YAL router IDL</div>
        <div className="panel-body" style={{ padding: 0 }}>
          <Instr
            name="register_token"
            args="total_supply: u64"
            desc="create yal_token PDA + treasury_stacsol_ata. called once per meme at launch."
          />
          <Instr
            name="fund_treasury"
            args="lamports: u64"
            desc="deposit raw SOL into the treasury (pre-conversion)."
          />
          <Instr
            name="deposit_to_stacsol"
            args="lamports: u64"
            desc="convert treasury SOL into stacSOL via the stake pool. runs on graduation + on demand."
            accent
          />
          <Instr
            name="redeem"
            args="meme_amount: u64"
            desc="burn user's meme, send proportional stacSOL to user. the only instruction users ever call directly."
            accent
          />
        </div>
      </div>

      <div style={{ height: 24 }} />

      <div className="manifesto">
        <p>
          <span className="num">01.</span> the marketing is the math.
        </p>
        <p>
          <span className="num">02.</span> no DAO. no governance. no roadmap.
        </p>
        <p>
          <span className="num">03.</span> every graduation grows stacSOL
          backing forever.
        </p>
        <p>
          <span className="num">04.</span> the validator was the
          proof-of-concept. YAL is the distribution layer.
        </p>
        <p>
          <span className="num">05.</span> 6.9% mint/burn/xfer fee on stacSOL,
          all to NAV. validator commission goes to the operator.
        </p>
        <p>
          <span className="num">06.</span> burn your meme. claim your share.
          that&apos;s it.
        </p>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>
        all numbers above are read from the YAL router program on mainnet-beta.
        RPC: <code>{rpcDisplay}</code>
      </p>
    </div>
  );
}

function Instr({
  name,
  args,
  desc,
  accent,
}: {
  name: string;
  args: string;
  desc: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        padding: "14px 16px",
        borderBottom: "1px solid var(--border)",
        gap: 16,
      }}
    >
      <div>
        <div
          className={accent ? "accent" : ""}
          style={{ fontWeight: 700, fontSize: 12 }}
        >
          {name}
        </div>
        <div className="muted" style={{ fontSize: 10 }}>
          ({args})
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
        {desc}
      </div>
    </div>
  );
}
