// Live Meteora DBC pool state for a given YAL meme mint.
// Reads quoteReserve (real bonded SOL) + migrationQuoteThreshold (real
// graduation target for the tier this pool was launched against). Polls
// every 10s so the token page progress bar / bonded number stay current.

import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

export interface DbcPoolView {
  bondedSol: number;
  thresholdSol: number;
  /** 0..1 */
  progress: number;
  isMigrated: boolean;
  poolAddress: string;
  configAddress: string;
}

export function useDbcPoolState(
  conn: Connection,
  memeMint: string | null,
): { state: DbcPoolView | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<DbcPoolView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memeMint) {
      setState(null);
      return;
    }
    let cancelled = false;
    let pk: PublicKey;
    try {
      pk = new PublicKey(memeMint);
    } catch {
      setError("invalid mint");
      return;
    }
    setLoading(true);

    async function load() {
      try {
        const dbc = new DynamicBondingCurveClient(conn, "confirmed");
        const pool = await dbc.state.getPoolByBaseMint(pk);
        if (!pool) {
          if (!cancelled) {
            setState(null);
            setError("no DBC pool yet");
            setLoading(false);
          }
          return;
        }
        const cfg = await dbc.state.getPoolConfig(pool.account.config);
        if (!cfg) {
          if (!cancelled) setError("pool config missing");
          return;
        }
        if (cancelled) return;

        const bondedSol = Number(pool.account.quoteReserve.toString()) / 1e9;
        const thresholdSol =
          Number(cfg.migrationQuoteThreshold.toString()) / 1e9;
        setState({
          bondedSol,
          thresholdSol,
          progress: thresholdSol > 0 ? Math.min(1, bondedSol / thresholdSol) : 0,
          isMigrated: pool.account.isMigrated === 1,
          poolAddress: pool.publicKey.toBase58(),
          configAddress: pool.account.config.toBase58(),
        });
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "fetch failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [conn, memeMint]);

  return { state, loading, error };
}
