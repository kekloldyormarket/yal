"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { fmt } from "@/lib/format";
import { floorOf } from "@/lib/yal-client";
import { TokenAvatar } from "@/components/Primitives";
import { useYal } from "../providers";

export default function LeaderboardPage() {
  const router = useRouter();
  const { tokens, nav, tokenLoading } = useYal();

  const ranked = useMemo(() => {
    return tokens
      .filter((t) => t.status === "graduated")
      .map((t) => ({ ...t, floor: floorOf(t, nav) }))
      .sort((a, b) => b.floor - a.floor);
  }, [tokens, nav]);

  const topFloor = ranked[0]?.floor || 0;

  return (
    <div className="container">
      <div className="hero">
        <h1>
          leaderboard.
          <br />
          <span className="accent">redemption floor</span>
        </h1>
        <p className="sub">
          rank by (treasury_stacsol / circulating_supply) × NAV — i.e. sol per
          meme if you burned. floor only rises: every redemption shrinks supply
          faster than treasury.
        </p>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 56 }}>rank</th>
              <th>token</th>
              <th className="r">treasury · stsol</th>
              <th className="r">backing · sol</th>
              <th className="r">circ supply</th>
              <th className="r">redeemed</th>
              <th className="r">floor · sol/meme</th>
              <th className="r" style={{ width: 200 }}>
                relative
              </th>
              <th className="r">graduated</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => (
              <tr
                key={t.mint}
                className="row-link"
                onClick={() => router.push("/token/" + t.mint)}
              >
                <td>
                  <span
                    className={
                      "rank" +
                      (i === 0 ? " top1" : i < 3 ? " top3" : "")
                    }
                  >
                    {"#" + (i + 1)}
                  </span>
                </td>
                <td>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <TokenAvatar ticker={t.ticker} img={t.img} />
                    <div>
                      <div style={{ fontWeight: 600 }}>${t.ticker}</div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {t.name}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="r num">{t.treasury_stacsol.toFixed(3)}</td>
                <td className="r num">
                  {(t.treasury_stacsol * nav).toFixed(3)}
                </td>
                <td className="r num muted">
                  {fmt.num(t.circulating_supply / 1e6, 1)}M
                </td>
                <td className="r num muted">
                  {fmt.num(t.redeemed_meme / 1e6, 1)}M
                </td>
                <td
                  className="r num accent"
                  style={{ fontWeight: 700 }}
                >
                  {t.floor.toExponential(3)}
                </td>
                <td className="r">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    <div className="progress sm" style={{ width: 110 }}>
                      <div
                        className="progress-fill"
                        style={{
                          width:
                            (topFloor > 0
                              ? (t.floor / topFloor) * 100
                              : 0) + "%",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 10 }} className="muted">
                      {topFloor > 0
                        ? ((t.floor / topFloor) * 100).toFixed(0) + "%"
                        : "—"}
                    </span>
                  </div>
                </td>
                <td className="r muted">{fmt.agoTs(t.graduated_at)}</td>
              </tr>
            ))}
            {ranked.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    textAlign: "center",
                    color: "var(--text-3)",
                    height: 80,
                  }}
                >
                  {tokenLoading ? "loading…" : "nothing has graduated yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>
        higher floor = more sol per meme on redemption. the top of this list is
        the most &ldquo;redeemed-into-irrelevance&rdquo; — small circulating
        supply, fat treasury.
      </p>
    </div>
  );
}
