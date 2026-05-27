"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Connection } from "@solana/web3.js";
import {
  RPC,
  fetchNav,
  listTokens,
  systemStats,
} from "@/lib/yal-client";
import type { MockWallet, SystemStats, Toast, UiToken } from "@/lib/types";

interface YalContextValue {
  tokens: UiToken[];
  refreshTokens: () => Promise<void>;
  tokenLoading: boolean;
  nav: number;
  navLastFetched: number;
  stats: SystemStats;
  wallet: MockWallet | null;
  connect: () => void;
  disconnect: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  // Local-only mutation hooks for mock flows (no on-chain submit yet).
  applyLocalRedeem: (mint: string, memeAmount: number) => { stacsol_received: number; sol_received: number } | null;
  applyLocalBuy: (mint: string, solAmount: number, expectedMeme: number) => void;
  applyLocalSell: (mint: string, memeAmount: number, expectedSol: number) => void;
  registerPendingLaunch: (token: UiToken) => void;
  connection: Connection;
}

const YalContext = createContext<YalContextValue | null>(null);

const FAKE_WALLET_KEY = "yal.wallet.v1";
const NAV_FALLBACK = 1.0387;

function fakeAddr(seed: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789";
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  let out = "";
  for (let i = 0; i < 44; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out += chars[Math.floor(((s & 0x7fffffff) / 0x7fffffff) * chars.length)];
  }
  return out;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);
  const [tokens, setTokens] = useState<UiToken[]>([]);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [nav, setNav] = useState<number>(NAV_FALLBACK);
  const [navLastFetched, setNavLastFetched] = useState<number>(0);
  const [wallet, setWallet] = useState<MockWallet | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshTokens = useCallback(async () => {
    try {
      const list = await listTokens(connection);
      setTokens(list);
    } catch (e) {
      console.error("listTokens failed:", e);
    } finally {
      setTokenLoading(false);
    }
  }, [connection]);

  // initial token + nav fetch
  useEffect(() => {
    void refreshTokens();
    fetchNav(connection)
      .then((v) => {
        setNav(v);
        setNavLastFetched(Date.now());
      })
      .catch((e) => console.error("fetchNav failed:", e));
  }, [connection, refreshTokens]);

  // periodic NAV refresh (every 30s)
  useEffect(() => {
    const id = setInterval(() => {
      fetchNav(connection)
        .then((v) => {
          setNav(v);
          setNavLastFetched(Date.now());
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [connection]);

  // periodic token refresh (every 45s)
  useEffect(() => {
    const id = setInterval(() => {
      void refreshTokens();
    }, 45_000);
    return () => clearInterval(id);
  }, [refreshTokens]);

  // restore mock wallet from localStorage on mount (only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAKE_WALLET_KEY);
      if (raw) setWallet(JSON.parse(raw));
    } catch {}
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, ...t }]);
    setTimeout(
      () => setToasts((ts) => ts.filter((x) => x.id !== id)),
      3800,
    );
  }, []);

  const connect = useCallback(() => {
    // Mock connect — real wallet adapter wiring is a follow-up.
    const addr = fakeAddr("user-" + Date.now());
    const w: MockWallet = { addr, balance_sol: 4.231, holdings: {} };
    setWallet(w);
    try {
      localStorage.setItem(FAKE_WALLET_KEY, JSON.stringify(w));
    } catch {}
    pushToast({ title: "wallet connected", sub: addr.slice(0, 6) + "…" + addr.slice(-6) });
  }, [pushToast]);

  const disconnect = useCallback(() => {
    setWallet(null);
    try {
      localStorage.removeItem(FAKE_WALLET_KEY);
    } catch {}
    pushToast({ title: "disconnected" });
  }, [pushToast]);

  const applyLocalRedeem = useCallback(
    (mint: string, memeAmount: number) => {
      const t = tokens.find((x) => x.mint === mint);
      if (!t || t.circulating_supply <= 0) return null;
      const stacsol_received =
        (memeAmount / t.circulating_supply) * t.treasury_stacsol;
      const sol_received = stacsol_received * nav;
      setTokens((prev) =>
        prev.map((x) =>
          x.mint === mint
            ? {
                ...x,
                treasury_stacsol: Math.max(0, x.treasury_stacsol - stacsol_received),
                circulating_supply: Math.max(0, x.circulating_supply - memeAmount),
                redeemed_meme: x.redeemed_meme + memeAmount,
                last_liquidation_ts: Math.floor(Date.now() / 1000),
              }
            : x,
        ),
      );
      if (wallet) {
        const next = {
          ...wallet,
          holdings: {
            ...wallet.holdings,
            [mint]: Math.max(0, (wallet.holdings[mint] || 0) - memeAmount),
          },
        };
        setWallet(next);
        try {
          localStorage.setItem(FAKE_WALLET_KEY, JSON.stringify(next));
        } catch {}
      }
      return { stacsol_received, sol_received };
    },
    [tokens, nav, wallet],
  );

  const applyLocalBuy = useCallback(
    (mint: string, solAmount: number, expectedMeme: number) => {
      if (!wallet) return;
      const next: MockWallet = {
        ...wallet,
        balance_sol: Math.max(0, wallet.balance_sol - solAmount),
        holdings: {
          ...wallet.holdings,
          [mint]: (wallet.holdings[mint] || 0) + expectedMeme,
        },
      };
      setWallet(next);
      try {
        localStorage.setItem(FAKE_WALLET_KEY, JSON.stringify(next));
      } catch {}
    },
    [wallet],
  );

  const applyLocalSell = useCallback(
    (mint: string, memeAmount: number, expectedSol: number) => {
      if (!wallet) return;
      const next: MockWallet = {
        ...wallet,
        balance_sol: wallet.balance_sol + expectedSol,
        holdings: {
          ...wallet.holdings,
          [mint]: Math.max(0, (wallet.holdings[mint] || 0) - memeAmount),
        },
      };
      setWallet(next);
      try {
        localStorage.setItem(FAKE_WALLET_KEY, JSON.stringify(next));
      } catch {}
    },
    [wallet],
  );

  const registerPendingLaunch = useCallback((token: UiToken) => {
    // Optimistic insert at top of list; real launch flow will overwrite on next refresh.
    setTokens((prev) => [token, ...prev.filter((p) => p.mint !== token.mint)]);
  }, []);

  const stats = useMemo(() => systemStats(tokens, nav), [tokens, nav]);

  const value: YalContextValue = {
    tokens,
    refreshTokens,
    tokenLoading,
    nav,
    navLastFetched,
    stats,
    wallet,
    connect,
    disconnect,
    toasts,
    pushToast,
    applyLocalRedeem,
    applyLocalBuy,
    applyLocalSell,
    registerPendingLaunch,
    connection,
  };

  return <YalContext.Provider value={value}>{children}</YalContext.Provider>;
}

export function useYal(): YalContextValue {
  const ctx = useContext(YalContext);
  if (!ctx) throw new Error("useYal must be used inside <Providers>");
  return ctx;
}
