"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { UnifiedWalletProvider } from "@jup-ag/wallet-adapter";
import {
  RPC,
  fetchNav,
  listTokens,
  systemStats,
} from "@/lib/yal-client";
import type { SystemStats, Toast, UiToken } from "@/lib/types";

interface ConnectedWallet {
  addr: string;
  balance_sol: number;
  holdings: Record<string, number>;
}

interface YalContextValue {
  tokens: UiToken[];
  refreshTokens: () => Promise<void>;
  tokenLoading: boolean;
  nav: number;
  navLastFetched: number;
  stats: SystemStats;
  /** UI-shape wallet snapshot — derived from the real wallet adapter. null
   *  while disconnected; the address + balance + holdings are auto-refreshed
   *  whenever the user connects/changes wallet. */
  wallet: ConnectedWallet | null;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  /** Local optimistic updates after the real on-chain tx confirms. Keeps the
   *  UI snappy between RPC refreshes. */
  applyLocalRedeem: (
    mint: string,
    memeAmount: number,
  ) => { stacsol_received: number; sol_received: number } | null;
  applyLocalBuy: (mint: string, solAmount: number, expectedMeme: number) => void;
  applyLocalSell: (mint: string, memeAmount: number, expectedSol: number) => void;
  registerPendingLaunch: (token: UiToken) => void;
  connection: Connection;
}

const YalContext = createContext<YalContextValue | null>(null);

const NAV_FALLBACK = 1.0387;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={[]} autoConnect>
        <UnifiedWalletProvider
          wallets={[]}
          config={{
            autoConnect: true,
            env: "mainnet-beta",
            metadata: {
              name: "YAL.fun",
              description: "permissionless meme → stake-bag conversion",
              url: "https://yal.fun",
              iconUrls: [],
            },
            theme: "dark",
          }}
        >
          <YalInnerProvider>{children}</YalInnerProvider>
        </UnifiedWalletProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function YalInnerProvider({ children }: { children: React.ReactNode }) {
  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);
  const { publicKey } = useWallet();

  const [tokens, setTokens] = useState<UiToken[]>([]);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [nav, setNav] = useState<number>(NAV_FALLBACK);
  const [navLastFetched, setNavLastFetched] = useState<number>(0);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
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

  useEffect(() => {
    void refreshTokens();
    fetchNav(connection)
      .then((v) => {
        setNav(v);
        setNavLastFetched(Date.now());
      })
      .catch((e) => console.error("fetchNav failed:", e));
  }, [connection, refreshTokens]);

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

  useEffect(() => {
    const id = setInterval(() => {
      void refreshTokens();
    }, 45_000);
    return () => clearInterval(id);
  }, [refreshTokens]);

  // Sync the UI-shape wallet snapshot with the real wallet adapter.
  // When the user connects, fetch SOL balance + meme-token holdings for every
  // YAL-registered mint they hold.
  useEffect(() => {
    if (!publicKey) {
      setWallet(null);
      return;
    }
    let cancelled = false;
    async function refresh(owner: PublicKey) {
      try {
        const [lamports, parsed] = await Promise.all([
          connection.getBalance(owner),
          connection.getParsedTokenAccountsByOwner(owner, {
            programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
          }),
        ]);
        if (cancelled) return;
        const holdings: Record<string, number> = {};
        for (const { account } of parsed.value) {
          const info = account.data.parsed?.info;
          if (!info) continue;
          const mint = info.mint as string;
          const amount = Number(info.tokenAmount?.uiAmount ?? 0);
          if (amount > 0) holdings[mint] = amount;
        }
        setWallet({ addr: owner.toBase58(), balance_sol: lamports / 1e9, holdings });
      } catch (e) {
        console.error("wallet refresh failed:", e);
      }
    }
    void refresh(publicKey);
    const id = setInterval(() => void refresh(publicKey), 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey, connection]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, ...t }]);
    setTimeout(
      () => setToasts((ts) => ts.filter((x) => x.id !== id)),
      3800,
    );
  }, []);

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
        setWallet((w) =>
          w
            ? {
                ...w,
                holdings: {
                  ...w.holdings,
                  [mint]: Math.max(0, (w.holdings[mint] || 0) - memeAmount),
                },
              }
            : w,
        );
      }
      return { stacsol_received, sol_received };
    },
    [tokens, nav, wallet],
  );

  const applyLocalBuy = useCallback(
    (mint: string, solAmount: number, expectedMeme: number) => {
      setWallet((w) =>
        w
          ? {
              ...w,
              balance_sol: Math.max(0, w.balance_sol - solAmount),
              holdings: {
                ...w.holdings,
                [mint]: (w.holdings[mint] || 0) + expectedMeme,
              },
            }
          : w,
      );
    },
    [],
  );

  const applyLocalSell = useCallback(
    (mint: string, memeAmount: number, expectedSol: number) => {
      setWallet((w) =>
        w
          ? {
              ...w,
              balance_sol: w.balance_sol + expectedSol,
              holdings: {
                ...w.holdings,
                [mint]: Math.max(0, (w.holdings[mint] || 0) - memeAmount),
              },
            }
          : w,
      );
    },
    [],
  );

  const registerPendingLaunch = useCallback((token: UiToken) => {
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
