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

function configPubkey(envVar: string): PublicKey | null {
  const v = process.env[envVar];
  return v ? new PublicKey(v) : null;
}

export const YAL_DBC_CONFIGS: Record<GraduationTier, PublicKey | null> = {
  5: configPubkey("NEXT_PUBLIC_YAL_DBC_CONFIG_5SOL"),
  20: configPubkey("NEXT_PUBLIC_YAL_DBC_CONFIG_20SOL"),
  80: configPubkey("NEXT_PUBLIC_YAL_DBC_CONFIG_80SOL"),
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
  if (!dbcConfig) {
    throw new Error(
      `Tier ${input.tier} SOL DBC config not deployed (NEXT_PUBLIC_YAL_DBC_CONFIG_${input.tier}SOL). Run scripts/deploy-dbc-configs.ts to seed all three tiers.`,
    );
  }

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

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  meteoraTx.recentBlockhash = blockhash;
  meteoraTx.feePayer = input.user;
  registerTx.recentBlockhash = blockhash;
  registerTx.feePayer = input.user;

  return { baseMint, treasuryAta, meteoraTx, registerTx, yalToken };
}

export function launchReadiness(tier: GraduationTier): {
  ready: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!YAL_DBC_CONFIGS[tier]) {
    missing.push(
      `NEXT_PUBLIC_YAL_DBC_CONFIG_${tier}SOL — ${tier} SOL tier DBC config not yet deployed`,
    );
  }
  return { ready: missing.length === 0, missing };
}

export function availableTiers(): GraduationTier[] {
  return ([5, 20, 80] as const).filter((t) => YAL_DBC_CONFIGS[t] !== null);
}
