// Real launch flow — builds the on-chain transactions for "launch a meme on
// YAL.fun". Currently NOT wired into the launch page (the page still uses a
// 1.8s mock timer + localStorage). Wire this in once a wallet adapter is
// available (signTransaction + sendTransaction).
//
// The launch flow is two txns, in order:
//
//   1. Meteora DBC createPool against the shared YAL config
//      → mints the bonding curve, base mint keypair signs
//   2. YAL register_token against the router
//      → creates the yal_token PDA + treasury ATA, signed by the user
//
// Prereq (one-time, NOT per-launch): a shared Meteora DBC config must exist
// on-chain with:
//   - quoteMint = SOL (or wSOL)
//   - migrationQuoteThreshold = 80 SOL
//   - feeClaimer / creator = YAL router-controlled pubkey
//   - leftoverReceiver = YAL router-controlled pubkey
//
// Pass the config pubkey via NEXT_PUBLIC_YAL_DBC_CONFIG.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { registerTokenIx, yalTokenPda, TOKEN_2022_PROGRAM } from "./sdk";

/** Graduation tiers — three pre-deployed Meteora DBC configs, each with a
 *  different `migrationQuoteThreshold` (bonded SOL needed to graduate). Pick
 *  one per launch. Lower thresholds = easier graduation, faster stacSOL
 *  conversion, smaller final pool. Higher = more skin-in-the-game and a
 *  bigger stacSOL bag for holders. */
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
  imageUri: string | null;
  tier: GraduationTier;
  user: PublicKey;
}

export interface BuiltLaunchTx {
  /** Generated base-mint keypair. Must co-sign all txns + be persisted by caller. */
  baseMint: Keypair;
  /** Generated treasury-ATA keypair. Must co-sign register_token tx. */
  treasuryAta: Keypair;
  /** Step 1: createPool — needs Meteora SDK to fill ix list. Currently empty. */
  meteoraTx: Transaction;
  /** Step 2: register_token. Ready to sign. */
  registerTx: Transaction;
  /** Convenience: derived yal_token PDA so the caller can route the user to
   *  /token/<mint> on success. */
  yalToken: PublicKey;
}

/**
 * Build the two-tx launch flow. The Meteora createPool tx is a placeholder
 * until `@meteora-ag/dynamic-bonding-curve-sdk` is added to the frontend
 * bundle — keeping the module side-effect-free for now so the frontend
 * doesn't pull the SDK into its bundle unless launch is attempted.
 *
 * The register_token tx is fully wired and works against the deployed YAL
 * router today — useful for testing the YAL half without DBC.
 */
export async function buildLaunchTx(
  conn: Connection,
  input: LaunchInput,
): Promise<BuiltLaunchTx> {
  const baseMint = Keypair.generate();
  const treasuryAta = Keypair.generate();
  const [yalToken] = yalTokenPda(baseMint.publicKey);

  const dbcConfig = YAL_DBC_CONFIGS[input.tier];
  if (!dbcConfig) {
    throw new Error(
      `Tier ${input.tier} SOL DBC config not deployed (NEXT_PUBLIC_YAL_DBC_CONFIG_${input.tier}SOL).`,
    );
  }

  // Step 1: Meteora DBC createPool against the tier's pre-deployed config.
  const meteoraTx = new Transaction();
  // TODO when @meteora-ag/dynamic-bonding-curve-sdk lands in the frontend:
  //
  //   import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
  //   const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  //   const createPoolTx = await dbc.pool.createPool({
  //     baseMint: baseMint.publicKey,
  //     config: dbcConfig,              // ← tier picker resolves which config
  //     name: input.name,
  //     symbol: input.ticker,
  //     uri: input.imageUri ?? "",
  //     payer: input.user,
  //     poolCreator: input.user,
  //   });
  //   meteoraTx.add(...createPoolTx.instructions);
  //
  // Until then this tx is empty — callers that need a full launch can detect
  // the empty ix list and skip submission.

  // Step 2: YAL register_token — fully wired.
  const registerIx: TransactionInstruction = registerTokenIx({
    yalToken,
    memeMint: baseMint.publicKey,
    treasuryAta: treasuryAta.publicKey,
    authority: input.user,
    stacsolTokenProgram: TOKEN_2022_PROGRAM,
    totalSupply: FIXED_TOTAL_SUPPLY_RAW,
  });
  const registerTx = new Transaction().add(registerIx);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  meteoraTx.recentBlockhash = blockhash;
  meteoraTx.feePayer = input.user;
  registerTx.recentBlockhash = blockhash;
  registerTx.feePayer = input.user;

  return { baseMint, treasuryAta, meteoraTx, registerTx, yalToken };
}

/** Convenience: report which prerequisites a real launch is currently
 *  missing. The launch page can use this to guide the user. */
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
  missing.push("@meteora-ag/dynamic-bonding-curve-sdk integration in frontend bundle");
  return { ready: missing.length === 0, missing };
}

export function availableTiers(): GraduationTier[] {
  return ([5, 20, 80] as const).filter((t) => YAL_DBC_CONFIGS[t] !== null);
}
