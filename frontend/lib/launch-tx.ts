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

export const YAL_DBC_CONFIG = process.env.NEXT_PUBLIC_YAL_DBC_CONFIG
  ? new PublicKey(process.env.NEXT_PUBLIC_YAL_DBC_CONFIG)
  : null;

export const FIXED_TOTAL_SUPPLY_RAW = 1_000_000_000n * 1_000_000n; // 1B × 1e6 decimals
export const FIXED_DECIMALS = 6;

export interface LaunchInput {
  name: string;
  ticker: string;
  description: string;
  imageUri: string | null;
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

  // Step 1: Meteora DBC createPool — placeholder, see TODO below.
  const meteoraTx = new Transaction();
  // TODO when @meteora-ag/dynamic-bonding-curve-sdk lands in the frontend:
  //
  //   import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
  //   const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  //   const createPoolTx = await dbc.pool.createPool({
  //     baseMint: baseMint.publicKey,
  //     config: YAL_DBC_CONFIG!,
  //     name: input.name,
  //     symbol: input.ticker,
  //     uri: input.imageUri ?? "",
  //     payer: input.user,
  //     poolCreator: input.user,   // OR a YAL-controlled PDA
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
export function launchReadiness(): {
  ready: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!YAL_DBC_CONFIG) {
    missing.push(
      "NEXT_PUBLIC_YAL_DBC_CONFIG — shared Meteora DBC config not yet deployed",
    );
  }
  // Meteora SDK isn't bundled yet — flagged so the page can show "preview only"
  missing.push("@meteora-ag/dynamic-bonding-curve-sdk integration in frontend bundle");
  return { ready: missing.length === 0, missing };
}
