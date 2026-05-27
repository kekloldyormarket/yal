import { Connection, PublicKey } from "@solana/web3.js";
import { fetchAllYalTokens, type YalToken, STACSOL, YAL_PROGRAM_ID } from "./sdk";
import type { UiToken } from "./types";

export const RPC =
  process.env.NEXT_PUBLIC_RPC ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";

export const GRADUATION_THRESHOLD_SOL = 80;

// Sanctum SPL stake-pool offsets (matches sanctum-spl-stake-pool layout).
// AccountType(1) + 8 Pubkeys (32 each) + stake_withdraw_bump_seed(1) = 258 bytes
// before total_lamports, then pool_token_supply.
const POOL_TOTAL_LAMPORTS_OFFSET = 258;
const POOL_TOKEN_SUPPLY_OFFSET = 266;

/** Read live NAV (SOL per stacSOL) from the Sanctum pool account. */
export async function fetchNav(conn: Connection): Promise<number> {
  const acct = await conn.getAccountInfo(STACSOL.POOL);
  if (!acct) throw new Error("stacSOL pool account not found");
  const data = acct.data;
  const totalLamports = data.readBigUInt64LE(POOL_TOTAL_LAMPORTS_OFFSET);
  const poolTokenSupply = data.readBigUInt64LE(POOL_TOKEN_SUPPLY_OFFSET);
  if (poolTokenSupply === 0n) return 1;
  // Use float math — supply is bounded and we just need NAV display precision.
  return Number(totalLamports) / Number(poolTokenSupply);
}

/** Convert on-chain YalToken bigint fields to plain numbers + derive status/progress. */
export function toUiToken(t: YalToken, meta?: { name?: string; ticker?: string; desc?: string; img?: string }): UiToken {
  const totalSupply = Number(t.totalSupply);
  const circulatingSupply = Number(t.circulatingSupply);
  const treasuryStacsol = Number(t.treasuryStacsol) / 1e9;
  const treasurySolLamports = Number(t.treasurySolLamports);
  const bondedSolLamports = Number(t.bondedSolLamports);
  const bondedSol = bondedSolLamports / 1e9;
  const graduatedAt = Number(t.graduatedAt);
  const lastLiquidationTs = Number(t.lastLiquidationTs);

  const status: "bonding" | "graduated" = graduatedAt > 0 ? "graduated" : "bonding";
  const progress = status === "graduated"
    ? 1
    : Math.min(1, bondedSol / GRADUATION_THRESHOLD_SOL);

  // Without an indexer we have no creation timestamp; use last_liquidation_ts as fallback
  // for graduated tokens, or 0 (unknown) for bonding.
  const createdAt = graduatedAt > 0 ? graduatedAt : 0;

  return {
    mint: t.memeMint.toBase58(),
    pubkey: t.pubkey.toBase58(),
    ticker: meta?.ticker || t.memeMint.toBase58().slice(0, 4).toUpperCase(),
    name: meta?.name || meta?.ticker || t.memeMint.toBase58().slice(0, 6),
    desc: meta?.desc || "",
    img: meta?.img || null,
    authority: t.authority.toBase58(),
    treasury_ata: t.treasuryTokenAccount.toBase58(),
    total_supply: totalSupply,
    circulating_supply: circulatingSupply,
    treasury_stacsol: treasuryStacsol,
    treasury_sol_lamports: treasurySolLamports,
    bonded_sol_lamports: bondedSolLamports,
    bonded_sol: bondedSol,
    redeemed_meme: Math.max(0, totalSupply - circulatingSupply),
    graduated_at: graduatedAt,
    last_liquidation_ts: lastLiquidationTs,
    created_at: createdAt,
    status,
    progress,
  };
}

/** Fetch all YAL tokens from mainnet and convert to UI shape. */
export async function listTokens(conn: Connection): Promise<UiToken[]> {
  const onchain = await fetchAllYalTokens(conn);
  return onchain.map((t) => toUiToken(t));
}

export function floorOf(t: UiToken, nav: number): number {
  if (t.status !== "graduated") return 0;
  if (!t.circulating_supply) return 0;
  return (t.treasury_stacsol * nav) / t.circulating_supply;
}

export function priceAt(progress: number): number {
  const p = progress || 0.001;
  return 0.00000003 + p * p * 0.00000095;
}

export function systemStats(tokens: UiToken[], nav: number) {
  const grads = tokens.filter((t) => t.status === "graduated");
  const total_bonded_sol = tokens.reduce((a, t) => a + t.bonded_sol, 0);
  const total_stacsol = grads.reduce((a, t) => a + t.treasury_stacsol, 0);
  const total_redeemed = grads.reduce((a, t) => a + t.redeemed_meme, 0);
  return {
    total_tokens: tokens.length,
    total_graduated: grads.length,
    total_bonded_sol,
    total_stacsol,
    total_backing_sol: total_stacsol * nav,
    total_redeemed,
  };
}

export { YAL_PROGRAM_ID, STACSOL };
export const YAL_PROGRAM_ID_STR = YAL_PROGRAM_ID.toBase58();
