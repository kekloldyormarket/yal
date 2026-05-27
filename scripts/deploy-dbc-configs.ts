// Deploys the three YAL graduation-tier Meteora DBC configs to mainnet.
//
// One-time setup. Outputs three pubkeys ready to paste into the frontend's
// .env.local as NEXT_PUBLIC_YAL_DBC_CONFIG_{5,20,80}SOL.
//
// Run:
//   YAL_DEPLOYER_KEYPAIR=~/manager.json bun run scripts/deploy-dbc-configs.ts

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  buildCurve,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import * as fs from "node:fs";
import * as os from "node:os";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = (process.env.YAL_DEPLOYER_KEYPAIR ||
  `${os.homedir()}/manager.json`).replace(/^~/, os.homedir());

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const TIERS: Array<{
  label: "5SOL" | "20SOL" | "80SOL";
  threshold: number;
  pctOnMigration: number;
}> = [
  { label: "5SOL", threshold: 5, pctOnMigration: 20 },
  { label: "20SOL", threshold: 20, pctOnMigration: 20 },
  { label: "80SOL", threshold: 80, pctOnMigration: 20 },
];

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))),
  );
}

function buildConfig(tier: typeof TIERS[number]) {
  return buildCurve({
    token: {
      tokenType: 1 as any,                   // Token2022
      tokenBaseDecimal: 6 as any,            // TokenDecimal.SIX
      tokenQuoteDecimal: 9 as any,           // TokenDecimal.NINE (SOL)
      tokenUpdateAuthority: 1 as any,        // Immutable
      totalTokenSupply: 1_000_000_000,
      leftover: 10_000,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: 0 as any,               // FeeSchedulerLinear (flat schedule = constant fee)
        feeSchedulerParam: {
          startingFeeBps: 100,               // 1% trading fee while bonding
          endingFeeBps: 100,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: 0 as any,              // QuoteToken
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: 1 as any,             // MET_DAMM_V2
      migrationFeeOption: 0 as any,          // FixedBps25 (lowest DAMM v2 fee tier)
      migrationFee: {
        // % of LP taken as migration fee at graduation. 0 = no migration cut.
        // Set to 0 — YAL collects revenue via the 6.9% stacSOL mint fee
        // downstream, not at the DBC layer.
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
    },
    liquidityDistribution: {
      // Meteora requires ≥10% LP locked at day 1. We lock the minimum on
      // partner side so the daily sweep can still drain ~90% of post-bond
      // LP. The 10% permanent-locked stake stays as a dust pool forever
      // per meme (acceptable cost — partner side = YAL operator).
      partnerPermanentLockedLiquidityPercentage: 10,
      partnerLiquidityPercentage: 40,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 50,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: 1 as any,                // Timestamp
    percentageSupplyOnMigration: tier.pctOnMigration,
    migrationQuoteThreshold: tier.threshold,
  });
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");

  console.log(`deployer: ${payer.publicKey.toBase58()}`);
  const balance = await conn.getBalance(payer.publicKey);
  console.log(`balance:  ${(balance / 1e9).toFixed(4)} SOL`);

  const results: Record<string, string> = {};

  for (const tier of TIERS) {
    console.log(`\n=== ${tier.label} tier (${tier.threshold} SOL graduation) ===`);

    const curveConfig = buildConfig(tier);
    const configKeypair = Keypair.generate();

    const tx = await dbc.partner.createConfig({
      config: configKeypair.publicKey,
      quoteMint: SOL_MINT,
      feeClaimer: payer.publicKey,
      leftoverReceiver: payer.publicKey,
      payer: payer.publicKey,
      ...curveConfig,
    });

    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.partialSign(payer, configKeypair);

    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    await conn.confirmTransaction(sig, "confirmed");

    const pubkey = configKeypair.publicKey.toBase58();
    console.log(`config: ${pubkey}`);
    console.log(`tx:     ${sig}`);
    results[`NEXT_PUBLIC_YAL_DBC_CONFIG_${tier.label}`] = pubkey;
  }

  console.log("\n=== paste into frontend/.env.local ===");
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}=${v}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
