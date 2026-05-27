// Resolve a yal_token's creation timestamp by looking up the oldest signature
// on its PDA — the register_token tx that opened it. Used to fill the "age"
// stat on the token detail page since the YAL program doesn't store created_at.
//
// Cached per pubkey for the session.

import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

const CACHE = new Map<string, number>();

export function useCreatedAt(
  conn: Connection,
  yalTokenPubkey: string | null,
): number | null {
  const [ts, setTs] = useState<number | null>(
    yalTokenPubkey ? CACHE.get(yalTokenPubkey) ?? null : null,
  );

  useEffect(() => {
    if (!yalTokenPubkey) return;
    const cached = CACHE.get(yalTokenPubkey);
    if (cached) {
      setTs(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Page back until we find the oldest signature. Most yal_tokens will
        // have one signature (register_token) — register, optional rescue.
        // Cap at 1000 to avoid runaway pagination for high-activity accounts.
        let before: string | undefined = undefined;
        let oldest: { signature: string; blockTime: number | null } | null = null;
        for (let i = 0; i < 10; i++) {
          const batch: Array<{
            signature: string;
            blockTime?: number | null;
          }> = await conn.getSignaturesForAddress(
            new PublicKey(yalTokenPubkey),
            { limit: 100, before },
          );
          if (batch.length === 0) break;
          const last = batch[batch.length - 1]!;
          oldest = { signature: last.signature, blockTime: last.blockTime ?? null };
          if (batch.length < 100) break;
          before = last.signature;
        }
        if (cancelled) return;
        if (oldest?.blockTime) {
          CACHE.set(yalTokenPubkey, oldest.blockTime);
          setTs(oldest.blockTime);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [conn, yalTokenPubkey]);

  return ts;
}
