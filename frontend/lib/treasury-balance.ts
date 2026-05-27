// Live stacSOL balance on a yal_token's treasury ATA. The actual on-chain
// backing — supersedes the stored `treasury_stacsol` field which was set up
// to be incremented only by deposit_to_stacsol (a broken path) but isn't
// authoritative anymore.

import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

export function useTreasuryStacsol(
  conn: Connection,
  treasuryAta: string | null,
): number {
  const [bal, setBal] = useState<number>(0);
  useEffect(() => {
    if (!treasuryAta) {
      setBal(0);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const r = await conn.getTokenAccountBalance(new PublicKey(treasuryAta!));
        if (!cancelled) setBal(r.value.uiAmount ?? 0);
      } catch {
        // ATA doesn't exist yet → 0
        if (!cancelled) setBal(0);
      }
    }
    void poll();
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [conn, treasuryAta]);
  return bal;
}
