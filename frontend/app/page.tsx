"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/format";
import { floorOf } from "@/lib/yal-client";
import { isLegacyToken } from "@/lib/launch-tx";
import { Stat, TokenAvatar, SortBtn } from "@/components/Primitives";
import { useYal } from "./providers";
import type { UiToken } from "@/lib/types";

type SortKey = "recent" | "bonded" | "floor" | "progress";

const PAGE_SIZE = 20;

export default function HomePage() {
  const { tokens, tokenLoading, stats, nav } = useYal();
  const [tab, setTab] = useState<"all" | "bonding" | "graduated">("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  // Bump-detection: when a token's bonded_sol changes between refreshes,
  // record the activity ts (drives the "recent" sort — most-recently-traded
  // floats to the top) AND mark the row for a 1.4s shake/highlight class.
  // prevBondedRef holds last-seen bonded values for cheap diffing.
  const prevBondedRef = useRef<Record<string, number>>({});
  const [lastActivityTs, setLastActivityTs] = useState<Record<string, number>>({});
  const [recentlyBumped, setRecentlyBumped] = useState<Set<string>>(new Set());
  useEffect(() => {
    const newlyBumped = new Set<string>();
    for (const t of tokens) {
      const prev = prevBondedRef.current[t.mint];
      if (prev !== undefined && Math.abs(prev - t.bonded_sol) > 1e-9) {
        newlyBumped.add(t.mint);
      }
      prevBondedRef.current[t.mint] = t.bonded_sol;
    }
    if (newlyBumped.size === 0) return;
    const now = Date.now();
    setLastActivityTs((prev) => {
      const next = { ...prev };
      for (const m of newlyBumped) next[m] = now;
      return next;
    });
    setRecentlyBumped((prev) => new Set([...prev, ...newlyBumped]));
    const handle = setTimeout(() => {
      setRecentlyBumped((prev) => {
        const next = new Set(prev);
        for (const m of newlyBumped) next.delete(m);
        return next;
      });
    }, 1400);
    return () => clearTimeout(handle);
  }, [tokens]);

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
    // "recent" sort: live-traded floats to the top. lastActivityTs (set when
    // bonded_sol changed this session) takes precedence; tokens with no live
    // activity yet fall back to created_at so brand-new tokens still surface.
    // Multiplier scales ms → seconds so it dominates the seconds-based
    // created_at column.
    const recentKey = (t: UiToken) =>
      Math.max(t.created_at, (lastActivityTs[t.mint] ?? 0) / 1000);
    const sorters: Record<SortKey, (a: UiToken, b: UiToken) => number> = {
      recent: (a, b) => recentKey(b) - recentKey(a),
      bonded: (a, b) => b.bonded_sol - a.bonded_sol,
      floor: (a, b) => floorOf(b, nav) - floorOf(a, nav),
      progress: (a, b) => b.progress - a.progress,
    };
    out.sort(sorters[sort]);
    return out;
  }, [tokens, tab, sort, q, nav, lastActivityTs]);

  // Reset to page 0 whenever the filter set changes (tab/search/sort change).
  useEffect(() => {
    setPage(0);
  }, [tab, sort, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page],
  );

  return (
    <div className="container">
      <div className="hero">
        <h1>
          Yet Another Launchpad.
          <br />
          any given meme is dead;
          <br />
          long live <span className="accent">stacSOL.</span>
        </h1>
        <p className="sub">
          <strong>Launch a throwaway meme.</strong> Same DBC curve as
          pump.fun, three tiers — <strong>5, 20, or 80 SOL</strong> to bond.
          Pick the one you&apos;re comfy with. Once it hits, a 24-hour
          countdown starts; at one random moment inside that window{" "}
          <strong>the AMM gets pulled, the meme dies, and every holder&apos;s
          bag becomes a pro-rata claim on stacSOL</strong> — our Token-2022
          LST that compounds NAV via a 6.9% fee on every mint, burn, and
          transfer. After the music stops the only exit is burn → claim. No
          more buying. No more selling. <strong>If you want long-term AMM
          holds, you&apos;re in the wrong place.</strong> Bond too low and
          you&apos;ll never get to play with the curve. Bond too high and you
          might never graduate. Pick your tier. Pick your fate. The marketing
          is the math.
        </p>
        <p className="sub" style={{ marginTop: 14, fontSize: 13 }}>
          if you&apos;re tired of gambling then{" "}
          <a
            className="accent"
            href="https://stacsol.app"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            stacsol.app
          </a>
          .
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
            {pageItems.map((t, i) => (
              <TokenRow
                key={t.mint}
                t={t}
                idx={page * PAGE_SIZE + i + 1}
                nav={nav}
                bumped={recentlyBumped.has(t.mint)}
              />
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

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 12,
            fontSize: 11,
            color: "var(--text-3)",
          }}
        >
          <span>
            page {page + 1} / {totalPages} · {filtered.length} total
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn"
              style={{ height: 26, padding: "0 10px", fontSize: 10 }}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← prev
            </button>
            <button
              className="btn"
              style={{ height: 26, padding: "0 10px", fontSize: 10 }}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              next →
            </button>
          </div>
        </div>
      )}

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
  bumped,
}: {
  t: UiToken;
  idx: number;
  nav: number;
  bumped: boolean;
}) {
  const router = useRouter();
  const floor = floorOf(t, nav);
  return (
    <tr
      className={"row-link" + (bumped ? " row-bump" : "")}
      onClick={() => router.push("/token/" + t.mint)}
    >
      <td className="muted">{idx}</td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TokenAvatar ticker={t.ticker} img={t.img} />
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
        {isLegacyToken(t.pool_config) && (
          <span
            className="badge"
            title="Legacy config (or no resolvable Meteora pool) — only ~40% of LP is drainable into stacSOL. Tokens launched against newer configs drain 90%."
            style={{
              marginLeft: 6,
              color: "var(--danger)",
              borderColor: "var(--danger-dim)",
            }}
          >
            legacy
          </span>
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
          ? fmt.dec(floor, 4)
          : "—"}
      </td>
      <td className="r num muted">
        {fmt.num(t.circulating_supply / 1e6, 1)}M
      </td>
      <td className="r muted">{fmt.agoTs(t.created_at)}</td>
    </tr>
  );
}
