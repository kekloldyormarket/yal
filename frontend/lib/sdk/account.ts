import { Connection, PublicKey } from "@solana/web3.js";
import { YAL_PROGRAM_ID } from "./constants";
import { yalTokenPda } from "./pda";

export interface YalToken {
  pubkey: PublicKey;
  memeMint: PublicKey;
  authority: PublicKey;
  totalSupply: bigint;
  circulatingSupply: bigint;
  treasuryStacsol: bigint;
  treasurySolLamports: bigint;
  treasuryTokenAccount: PublicKey;
  graduatedAt: bigint;
  lastLiquidationTs: bigint;
  bondedSolLamports: bigint;
  bump: number;
}

const YAL_TOKEN_SIZE = 161;

export function decodeYalToken(
  pubkey: PublicKey,
  data: Uint8Array,
): YalToken {
  // Use DataView for the u64/i64 reads — Next.js's polyfilled Buffer in the
  // client bundle doesn't expose readBigUInt64LE / readBigInt64LE.
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 8; // discriminator
  const memeMint = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const authority = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const totalSupply = dv.getBigUint64(off, true); off += 8;
  const circulatingSupply = dv.getBigUint64(off, true); off += 8;
  const treasuryStacsol = dv.getBigUint64(off, true); off += 8;
  const treasurySolLamports = dv.getBigUint64(off, true); off += 8;
  const treasuryTokenAccount = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const graduatedAt = dv.getBigInt64(off, true); off += 8;
  const lastLiquidationTs = dv.getBigInt64(off, true); off += 8;
  const bondedSolLamports = dv.getBigUint64(off, true); off += 8;
  const bump = data[off]!;
  return {
    pubkey, memeMint, authority, totalSupply, circulatingSupply,
    treasuryStacsol, treasurySolLamports, treasuryTokenAccount,
    graduatedAt, lastLiquidationTs, bondedSolLamports, bump,
  };
}

/** Fetch all YAL tokens registered with the router. */
export async function fetchAllYalTokens(conn: Connection): Promise<YalToken[]> {
  const accounts = await conn.getProgramAccounts(YAL_PROGRAM_ID, {
    filters: [{ dataSize: YAL_TOKEN_SIZE }],
  });
  return accounts.map(({ pubkey, account }) =>
    decodeYalToken(pubkey, new Uint8Array(account.data)),
  );
}

/** Fetch a single YAL token by its memecoin mint. Returns null if not registered. */
export async function fetchYalTokenByMint(
  conn: Connection,
  memeMint: PublicKey,
): Promise<YalToken | null> {
  const [pubkey] = yalTokenPda(memeMint);
  const acct = await conn.getAccountInfo(pubkey);
  if (!acct) return null;
  return decodeYalToken(pubkey, new Uint8Array(acct.data));
}

/**
 * Compute the stacSOL payout a user would receive if they redeem `memeAmount`.
 * Returns 0 if circulating_supply or treasury_stacsol is 0.
 */
export function previewRedeem(t: YalToken, memeAmount: bigint): bigint {
  if (t.circulatingSupply === 0n || t.treasuryStacsol === 0n) return 0n;
  return (memeAmount * t.treasuryStacsol) / t.circulatingSupply;
}
