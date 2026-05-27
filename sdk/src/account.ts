import { Connection, PublicKey } from "@solana/web3.js";
import { YAL_PROGRAM_ID } from "./constants.js";
import { yalTokenPda } from "./pda.js";

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

const YAL_TOKEN_SIZE = 153;

export function decodeYalToken(pubkey: PublicKey, data: Buffer): YalToken {
  let off = 8; // discriminator
  const memeMint = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const authority = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const totalSupply = data.readBigUInt64LE(off); off += 8;
  const circulatingSupply = data.readBigUInt64LE(off); off += 8;
  const treasuryStacsol = data.readBigUInt64LE(off); off += 8;
  const treasurySolLamports = data.readBigUInt64LE(off); off += 8;
  const treasuryTokenAccount = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const graduatedAt = data.readBigInt64LE(off); off += 8;
  const lastLiquidationTs = data.readBigInt64LE(off); off += 8;
  const bondedSolLamports = data.readBigUInt64LE(off); off += 8;
  const bump = data.readUInt8(off);
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
    decodeYalToken(pubkey, Buffer.from(account.data))
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
  return decodeYalToken(pubkey, Buffer.from(acct.data));
}

/**
 * Compute the stacSOL payout a user would receive if they redeem `memeAmount`.
 * Returns 0 if circulating_supply or treasury_stacsol is 0.
 */
export function previewRedeem(t: YalToken, memeAmount: bigint): bigint {
  if (t.circulatingSupply === 0n || t.treasuryStacsol === 0n) return 0n;
  return (memeAmount * t.treasuryStacsol) / t.circulatingSupply;
}
