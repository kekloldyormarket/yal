import { Connection, PublicKey } from "@solana/web3.js";
import { getTokenMetadata } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { fetchAllYalTokens, type YalToken, STACSOL, YAL_PROGRAM_ID, TOKEN_2022_PROGRAM } from "./sdk";
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
  // DataView u64 read — browser's polyfilled Buffer lacks readBigUInt64LE.
  const u8 = new Uint8Array(acct.data);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const totalLamports = dv.getBigUint64(POOL_TOTAL_LAMPORTS_OFFSET, true);
  const poolTokenSupply = dv.getBigUint64(POOL_TOKEN_SUPPLY_OFFSET, true);
  if (poolTokenSupply === 0n) return 1;
  return Number(totalLamports) / Number(poolTokenSupply);
}

interface PoolView {
  bondedSol: number;
  thresholdSol: number;
  isMigrated: boolean;
}

/** Convert on-chain YalToken bigint fields to plain numbers + derive status/progress. */
export function toUiToken(
  t: YalToken,
  meta?: { name?: string; ticker?: string; desc?: string; img?: string },
  pool?: PoolView,
): UiToken {
  const totalSupply = Number(t.totalSupply);
  const circulatingSupply = Number(t.circulatingSupply);
  const treasuryStacsol = Number(t.treasuryStacsol) / 1e9;
  const treasurySolLamports = Number(t.treasurySolLamports);
  // Prefer the live Meteora pool's quoteReserve over YAL's stored value —
  // YAL only fills bonded_sol_lamports at graduation, but the curve is
  // already accumulating SOL on the Meteora side.
  const bondedSolLamports = Number(t.bondedSolLamports);
  const bondedSol = pool?.bondedSol ?? bondedSolLamports / 1e9;
  const thresholdSol = pool?.thresholdSol ?? GRADUATION_THRESHOLD_SOL;
  const graduatedAt = Number(t.graduatedAt);
  const lastLiquidationTs = Number(t.lastLiquidationTs);

  const status: "bonding" | "graduated" =
    graduatedAt > 0 || pool?.isMigrated ? "graduated" : "bonding";
  const progress = status === "graduated"
    ? 1
    : Math.min(1, bondedSol / thresholdSol);

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

// Per-session metadata cache keyed by mint. Avoids refetching name/symbol/uri
// + the JSON body on every refresh cycle.
const META_CACHE = new Map<string, { name?: string; ticker?: string; desc?: string; img?: string }>();

async function fetchMintMeta(
  conn: Connection,
  mint: PublicKey,
): Promise<{ name?: string; ticker?: string; desc?: string; img?: string }> {
  const key = mint.toBase58();
  const cached = META_CACHE.get(key);
  if (cached) return cached;
  const meta: { name?: string; ticker?: string; desc?: string; img?: string } = {};
  try {
    // Token-2022 metadata extension (embedded in mint account).
    const tokenMeta = await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM);
    if (tokenMeta) {
      meta.name = tokenMeta.name;
      meta.ticker = tokenMeta.symbol;
      // Follow the URI to the Vercel-Blob Metaplex JSON for description + image.
      if (tokenMeta.uri && /^https?:\/\//.test(tokenMeta.uri)) {
        try {
          const r = await fetch(tokenMeta.uri);
          if (r.ok) {
            const j = (await r.json()) as { description?: string; image?: string };
            meta.desc = j.description;
            meta.img = j.image;
          }
        } catch {}
      }
    }
  } catch {}
  META_CACHE.set(key, meta);
  return meta;
}

/** Invalidate the metadata cache for a specific mint (e.g. after a creator
 *  re-uploads metadata via the reconfigure flow). */
export function invalidateMintMeta(mint: string): void {
  META_CACHE.delete(mint);
}

async function fetchPoolView(
  dbc: DynamicBondingCurveClient,
  mint: PublicKey,
): Promise<PoolView | undefined> {
  try {
    const poolState = await dbc.state.getPoolByBaseMint(mint);
    if (!poolState) return undefined;
    const cfg = await dbc.state.getPoolConfig(poolState.account.config);
    if (!cfg) return undefined;
    return {
      bondedSol: Number(poolState.account.quoteReserve.toString()) / 1e9,
      thresholdSol: Number(cfg.migrationQuoteThreshold.toString()) / 1e9,
      isMigrated: poolState.account.isMigrated === 1,
    };
  } catch {
    return undefined;
  }
}

/** Fetch all YAL tokens from mainnet and convert to UI shape — enriches each
 *  token with its Token-2022 metadata + the JSON description/image + live
 *  Meteora pool state (bonded sol, threshold, migration flag). */
export async function listTokens(conn: Connection): Promise<UiToken[]> {
  const onchain = await fetchAllYalTokens(conn);
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  // Parallel: metadata + pool view per token.
  const enriched = await Promise.all(
    onchain.map(async (t) => {
      const [meta, pool] = await Promise.all([
        fetchMintMeta(conn, t.memeMint),
        fetchPoolView(dbc, t.memeMint),
      ]);
      return toUiToken(t, meta, pool);
    }),
  );
  return enriched;
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
