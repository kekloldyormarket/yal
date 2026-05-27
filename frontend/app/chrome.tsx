"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UnifiedWalletButton } from "@jup-ag/wallet-adapter";
import { fmt } from "@/lib/format";
import { useYal } from "./providers";
import { YAL_PROGRAM_ID_STR } from "@/lib/yal-client";

export function Chrome({ children }: { children: React.ReactNode }) {
  const { toasts } = useYal();
  return (
    <div className="app">
      <Header />
      <Ticker />
      <main className="main">{children}</main>
      <Footer />
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={"toast" + (t.kind === "danger" ? " danger" : "")}
          >
            <div className="t-title">{t.title}</div>
            {t.sub && <div className="t-sub">{t.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Header() {
  const pathname = usePathname();
  const { wallet } = useYal();
  const [navOpen, setNavOpen] = useState(false);
  const links: { to: string; label: string }[] = [
    { to: "/", label: "tokens" },
    { to: "/leaderboard", label: "leaderboard" },
    { to: "/stats", label: "stats" },
  ];

  return (
    <header className="header">
      <div className="container">
        <div className="header-row">
          <Link href="/" className="brand">
            <span className="dot"></span>
            <span>
              <span className="brand-mark">YAL</span>.fun
            </span>
          </Link>
          <nav
            className={"nav" + (navOpen ? " open" : "")}
            onClick={() => setNavOpen(false)}
          >
            {links.map((l) => (
              <Link
                key={l.to}
                href={l.to}
                className={
                  "nav-link" +
                  (pathname === l.to || (l.to !== "/" && pathname?.startsWith(l.to))
                    ? " active"
                    : "")
                }
              >
                {l.label}
              </Link>
            ))}
            {wallet && (
              <span className="nav-link" style={{ pointerEvents: "none" }}>
                {fmt.short(wallet.addr, 4, 4)} · {wallet.balance_sol.toFixed(3)} sol
              </span>
            )}
            <span
              className="nav-link"
              style={{ padding: 0, display: "flex", alignItems: "center" }}
              onClick={(e) => e.stopPropagation()}
            >
              <UnifiedWalletButton
                buttonClassName="yal-wallet-button"
                overrideContent={wallet ? "disconnect" : "connect"}
              />
            </span>
            <Link href="/launch" className="nav-link cta">
              + launch
            </Link>
          </nav>
          <button
            className="mobile-toggle"
            onClick={() => setNavOpen(!navOpen)}
          >
            {navOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>
    </header>
  );
}

function Ticker() {
  const { nav, stats, connection } = useYal();
  const [tick, setTick] = useState(0);
  const [slot, setSlot] = useState<number>(0);
  const [epoch, setEpoch] = useState<number>(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1200);
    return () => clearInterval(id);
  }, []);

  // poll slot + epoch every 8s
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const s = await connection.getSlot();
        if (stopped) return;
        setSlot(s);
        const info = await connection.getEpochInfo();
        if (stopped) return;
        setEpoch(info.epoch);
      } catch {}
    }
    void poll();
    const id = setInterval(poll, 8_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [connection]);

  // local interpolation between server slots so the digit ticks visibly
  const liveSlot = slot + tick * 2;

  return (
    <div className="ticker">
      <div className="container">
        <div className="ticker-row">
          <div className="ticker-cell">
            <span className="ticker-pulse"></span>
            <span className="k">stacSOL/NAV</span>
            <span className="v up">{nav.toFixed(6)} sol</span>
          </div>
          <div className="ticker-cell">
            <span className="k">bonded</span>
            <span className="v">{fmt.sol(stats.total_bonded_sol)} sol</span>
          </div>
          <div className="ticker-cell">
            <span className="k">backing</span>
            <span className="v">{fmt.sol(stats.total_backing_sol)} sol</span>
          </div>
          <div className="ticker-cell">
            <span className="k">graduated</span>
            <span className="v">
              {stats.total_graduated}/{stats.total_tokens}
            </span>
          </div>
          <div className="ticker-cell">
            <span className="k">epoch</span>
            <span className="v">{epoch || "—"}</span>
          </div>
          <div className="ticker-cell">
            <span className="k">slot</span>
            <span className="v">{slot ? liveSlot.toLocaleString() : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-row">
          <div>
            YAL.fun — permissionless meme → stake-bag conversion.{" "}
            <span className="accent">v0.1.0</span>
          </div>
          <Link href="/stats">system stats</Link>
          <a
            href="https://github.com/kekloldyormarket/yal"
            target="_blank"
            rel="noopener noreferrer"
          >
            yal program
          </a>
          <a
            href="https://github.com/kekloldyormarket/agave"
            target="_blank"
            rel="noopener noreferrer"
          >
            patched agave
          </a>
          <a
            href="https://stacsol.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            stacsol.app
          </a>
          <span style={{ marginLeft: "auto" }} className="muted">
            program · {fmt.short(YAL_PROGRAM_ID_STR, 6, 6)}
          </span>
        </div>
      </div>
    </footer>
  );
}
