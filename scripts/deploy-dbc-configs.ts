// Deploys the three YAL graduation-tier Meteora DBC configs to mainnet.
//
// One-time setup. Outputs three pubkeys ready to paste into the frontend's
// .env.local as NEXT_PUBLIC_YAL_DBC_CONFIG_{5,20,80}SOL.
//
// Each config differs only in:
//   · migrationQuoteThreshold (5, 20, or 80 SOL)
//   · the implied percentageSupplyOnMigration (% of meme supply that lives
//     in the post-bond LP — smaller threshold means less supply needed to
//     migrate, but also less LP for post-grad trading)
//
// Run:
//   cd scripts/
//   bun install   # if not done already
//   YAL_DEPLOYER_KEYPAIR=~/manager.json bun run deploy-dbc-configs.ts
//
// Cost: ~3× rent for 3 config accounts + 3 createConfig fees. ~0.03 SOL total.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import {
  DynamicBondingCurveClient,
  buildCurve,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import * as fs from "node:fs";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = process.env.YAL_DEPLOYER_KEYPAIR ||
  `${process.env.HOME}/manager.json`;

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Tier-specific overrides. Threshold = bonded SOL needed to graduate. */
const TIERS: Array<{
  label: "5SOL" | "20SOL" | "80SOL";
  migrationQuoteThreshold: number;
  percentageSupplyOnMigration: number;
}> = [
  { label: "5SOL", migrationQuoteThreshold: 5, percentageSupplyOnMigration: 20 },
  { label: "20SOL", migrationQuoteThreshold: 20, percentageSupplyOnMigration: 20 },
  { label: "80SOL", migrationQuoteThreshold: 80, percentageSupplyOnMigration: 20 },
];

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))),
  );
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  const wallet = new Wallet(payer);
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");

  console.log(`deployer: ${payer.publicKey.toBase58()}`);
  const balance = await conn.getBalance(payer.publicKey);
  console.log(`balance:  ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.05 * 1e9) {
    console.warn("warning: balance < 0.05 SOL, may not cover all three deploys");
  }

  const results: Record<string, string> = {};

  for (const tier of TIERS) {
    console.log(`\n=== ${tier.label} tier (${tier.migrationQuoteThreshold} SOL graduation) ===`);

    // buildCurve(0) — standard mode, parametrized by threshold + supply%.
    // Token defaults: 1B supply, 6 decimals, Token-2022.
    const curveConfig = buildCurve({
      totalTokenSupply: 1_000_000_000,
      percentageSupplyOnMigration: tier.percentageSupplyOnMigration,
      migrationQuoteThreshold: tier.migrationQuoteThreshold,
      migrationOption: 1, // 1 = DAMM v2 (concentrated)
      tokenBaseDecimal: 6,
      tokenQuoteDecimal: 9,
      lockedVestingParam: {
        totalLockedVestingAmount: 0,
        numberOfVestingPeriod: 0,
        cliffUnlockAmount: 0,
        totalVestingDuration: 0,
        cliffDurationFromMigrationTime: 0,
      },
      baseFeeParams: {
        baseFeeMode: 0,
        feeSchedulerParam: {
          startingFeeBps: 100, // 1% trading fee while bonding
          endingFeeBps: 100,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      activationType: 1, // 1 = timestamp
      collectFeeMode: 0, // 0 = quote token only
      migrationFeeOption: 0, // 0 = lowest DAMM v2 fee tier
      tokenType: 1, // 1 = Token-2022
      partnerLpPercentage: 50,
      creatorLpPercentage: 50,
      partnerLockedLpPercentage: 0,
      creatorLockedLpPercentage: 0,
      creatorTradingFeePercentage: 50,
      leftover: 10_000,
    } as any);

    const configKeypair = Keypair.generate();
    const createConfigTx = await dbc.partner.createConfig({
      config: configKeypair.publicKey,
      quoteMint: SOL_MINT,
      feeClaimer: payer.publicKey,        // YAL operator collects trading fees
      leftoverReceiver: payer.publicKey,  // unbonded meme tokens come here
      payer: payer.publicKey,
      ...curveConfig,
    });

    createConfigTx.feePayer = payer.publicKey;
    createConfigTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    createConfigTx.partialSign(payer, configKeypair);

    const sig = await conn.sendRawTransaction(createConfigTx.serialize(), {
      maxRetries: 5,
    });
    await conn.confirmTransaction(sig, "confirmed");

    const configPubkey = configKeypair.publicKey.toBase58();
    console.log(`config pubkey: ${configPubkey}`);
    console.log(`tx: ${sig}`);
    results[`NEXT_PUBLIC_YAL_DBC_CONFIG_${tier.label}`] = configPubkey;
  }

  console.log("\n=== DONE — paste into frontend/.env.local ===");
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}=${v}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
