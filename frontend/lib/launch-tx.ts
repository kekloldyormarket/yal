// Real launch flow — builds the on-chain transactions to launch a meme on
// YAL.fun. Wired against the deployed YAL router + Meteora DBC SDK.
//
// Two transactions, in order:
//   1. Meteora DBC createPool against the tier's pre-deployed config
//      → mints the bonding curve; base mint keypair signs
//   2. YAL register_token against the router
//      → creates the yal_token PDA + treasury ATA
//
// Prereq (one-time, per tier): a Meteora DBC config exists on-chain with
//   - quoteMint = SOL (or wSOL)
//   - migrationQuoteThreshold = {5, 20, 80} SOL per tier
//   - creator / feeClaimer / leftoverReceiver = YAL-controlled
// The config pubkey for each tier goes into NEXT_PUBLIC_YAL_DBC_CONFIG_*.
//
// See scripts/deploy-dbc-configs.ts for one-shot deployment of all three.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { registerTokenIx, yalTokenPda, TOKEN_2022_PROGRAM } from "./sdk";

/** Graduation tiers — three pre-deployed Meteora DBC configs. */
export type GraduationTier = 5 | 20 | 80;

// Mainnet-deployed DBC configs (one per tier). Env vars override for devnet
// / staging. Once these are set on chain they're effectively immutable
// constants for the protocol — same status as YAL_PROGRAM_ID + STACSOL pool.
const DEFAULT_CONFIGS: Record<GraduationTier, string> = {
  5: "DFiDinu6UmzdYUWJf38C5acXgWoBMjP9junzkFFcSCU9",
  20: "A7SdTVNsiC5Dmw2KMxcDBKSU9fv5gjCUcsXeJBHNPbu1",
  80: "BWrQzmtbw5nrE4ratP5fJtV7HPiP48vbjWT8t7HgPqto",
};

function configPubkey(tier: GraduationTier, envVar: string): PublicKey {
  return new PublicKey(process.env[envVar] || DEFAULT_CONFIGS[tier]);
}

export const YAL_DBC_CONFIGS: Record<GraduationTier, PublicKey> = {
  5: configPubkey(5, "NEXT_PUBLIC_YAL_DBC_CONFIG_5SOL"),
  20: configPubkey(20, "NEXT_PUBLIC_YAL_DBC_CONFIG_20SOL"),
  80: configPubkey(80, "NEXT_PUBLIC_YAL_DBC_CONFIG_80SOL"),
};

export const TIER_LABELS: Record<GraduationTier, string> = {
  5: "lite",
  20: "mid",
  80: "full",
};

export const FIXED_TOTAL_SUPPLY_RAW = 1_000_000_000n * 1_000_000n; // 1B × 1e6 decimals
export const FIXED_DECIMALS = 6;

export interface LaunchInput {
  name: string;
  ticker: string;
  description: string;
  metadataUri: string;
  tier: GraduationTier;
  user: PublicKey;
}

export interface BuiltLaunchTx {
  /** Generated base-mint keypair. Must co-sign the Meteora tx + be persisted
   *  so the caller can route the user to /token/<mint> on success. */
  baseMint: Keypair;
  /** Generated treasury-ATA keypair. Must co-sign the register_token tx. */
  treasuryAta: Keypair;
  /** Step 1: Meteora DBC createPool. Co-signer: baseMint. */
  meteoraTx: Transaction;
  /** Step 2: YAL register_token. Co-signer: treasuryAta. */
  registerTx: Transaction;
  /** Derived yal_token PDA. */
  yalToken: PublicKey;
}

export async function buildLaunchTx(
  conn: Connection,
  input: LaunchInput,
): Promise<BuiltLaunchTx> {
  const dbcConfig = YAL_DBC_CONFIGS[input.tier];

  const baseMint = Keypair.generate();
  const treasuryAta = Keypair.generate();
  const [yalToken] = yalTokenPda(baseMint.publicKey);

  // Step 1: Meteora DBC createPool — uses the tier's pre-deployed config.
  // baseMint must sign this tx (it's a new mint authority being established).
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  const meteoraTx = await dbc.pool.createPool({
    baseMint: baseMint.publicKey,
    config: dbcConfig,
    name: input.name,
    symbol: input.ticker,
    uri: input.metadataUri,
    payer: input.user,
    poolCreator: input.user,
  });

  // Step 2: register_token on the YAL router.
  const ix = registerTokenIx({
    yalToken,
    memeMint: baseMint.publicKey,
    treasuryAta: treasuryAta.publicKey,
    authority: input.user,
    stacsolTokenProgram: TOKEN_2022_PROGRAM,
    totalSupply: FIXED_TOTAL_SUPPLY_RAW,
  });
  const registerTx = new Transaction().add(ix);

  // Use `finalized` commitment so Helius Sender's Jito/Staked Connection
  // nodes have all seen this blockhash by the time they receive the tx.
  // `confirmed` blockhashes can be too fresh for downstream nodes still
  // catching up and trigger BlockhashNotFound.
  const { blockhash } = await conn.getLatestBlockhash("finalized");
  meteoraTx.recentBlockhash = blockhash;
  meteoraTx.feePayer = input.user;
  registerTx.recentBlockhash = blockhash;
  registerTx.feePayer = input.user;

  return { baseMint, treasuryAta, meteoraTx, registerTx, yalToken };
}

/** Refresh the recentBlockhash on both launch txs right before signing.
 *  Call this AFTER metadata upload + AFTER any prep step that took >1s. */
export async function refreshBlockhash(
  conn: Connection,
  built: BuiltLaunchTx,
): Promise<void> {
  const { blockhash } = await conn.getLatestBlockhash("finalized");
  built.meteoraTx.recentBlockhash = blockhash;
  built.registerTx.recentBlockhash = blockhash;
}

export function launchReadiness(_tier: GraduationTier): {
  ready: boolean;
  missing: string[];
} {
  // All three tiers are live on mainnet. Kept for parity in case devnet
  // overrides ever surface gaps.
  return { ready: true, missing: [] };
}

export function availableTiers(): GraduationTier[] {
  return [5, 20, 80];
}
