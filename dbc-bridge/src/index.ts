// YAL ↔ Meteora DBC Bridge
//
// Polls Meteora DBC pools whose base mint is a registered YAL token. Detects
// the bonding → migrated transition by reading the pool's quoteReserve vs the
// config's migrationQuoteThreshold (the "80 SOL bonded" line). When a pool is
// ready to migrate but not yet migrated, this daemon calls Meteora's
// `migrateToDammV2` so the resulting DAMM v2 LP belongs to addresses we
// configured at launch (YAL-controlled creator + feeClaimer + leftoverReceiver).
//
// After migration the post-bond LP is on Meteora DAMM v2. The daily liquidator
// will (in a follow-up patch) call `claimCreatorTradingFee` /
// `claimPartnerTradingFee` to siphon accumulated SOL fees into the matching
// yal_token treasury via the router's `fund_treasury` ix, then drain via
// `deposit_to_stacsol` like normal.
//
// What's still scaffolded vs. wired:
//   ✓ Real DBC SDK (`@meteora-ag/dynamic-bonding-curve-sdk`) — pool reads,
//     state decode, migration call
//   ✓ Per-YAL-token DBC pool lookup via getPoolByBaseMint
//   ✓ Graduation trigger condition (quoteReserve >= migrationQuoteThreshold)
//   ⚠ Fee/LP claim flow → fund_treasury → liquidator: open design choice
//     (whether the YAL router gets a new claim CPI ix vs. relying on this
//     daemon's wallet being set as the DBC creator). Marked TODO below.

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import * as fs from "node:fs";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = process.env.YAL_BRIDGE_KEYPAIR ||
  `${process.env.HOME}/.config/solana/id.json`;
const YAL_PROGRAM = new PublicKey(
  process.env.YAL_PROGRAM_ID || "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

const SLEEP_MS = 30_000;
const ARGV_ONCE = process.argv.includes("--once");

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

interface YalToken {
  pubkey: PublicKey;
  memeMint: PublicKey;
  graduatedAt: bigint;
  bondedSolLamports: bigint;
}

// 161-byte yal_token PDA layout — kept in sync with programs/yal/src/lib.rs.
async function fetchAllYalTokens(conn: Connection): Promise<YalToken[]> {
  const accounts = await conn.getProgramAccounts(YAL_PROGRAM, {
    filters: [{ dataSize: 161 }],
  });
  return accounts.map(({ pubkey, account }) => {
    const d = account.data;
    let off = 8; // discriminator
    const memeMint = new PublicKey(d.subarray(off, off + 32)); off += 32;
    // authority(32) + total_supply(8) + circulating_supply(8) +
    // treasury_stacsol(8) + treasury_sol_lamports(8) + treasury_token_account(32)
    off += 32 + 8 + 8 + 8 + 8 + 32;
    const graduatedAt = d.readBigInt64LE(off); off += 8;
    off += 8; // last_liquidation_ts
    const bondedSolLamports = d.readBigUInt64LE(off);
    return { pubkey, memeMint, graduatedAt, bondedSolLamports };
  });
}

async function cycle(conn: Connection, dbc: DynamicBondingCurveClient, payer: Keypair) {
  const ts = new Date().toISOString().slice(11, 19);
  const tokens = await fetchAllYalTokens(conn);
  const pending = tokens.filter((t) => t.graduatedAt === 0n);
  console.log(
    `[${ts}] tracking ${tokens.length} YAL tokens · ${pending.length} pre-migration`,
  );

  for (const t of pending) {
    let poolState;
    try {
      poolState = await dbc.state.getPoolByBaseMint(t.memeMint);
    } catch (e: any) {
      console.warn(`[${ts}] getPoolByBaseMint failed ${t.memeMint.toBase58()}: ${e.message?.slice(0, 120)}`);
      continue;
    }
    if (!poolState) {
      // No DBC pool exists for this YAL token yet. Launch flow probably hasn't
      // wired up the bonding curve, or this is a manually-registered token.
      continue;
    }

    const poolConfig = await dbc.state.getPoolConfig(poolState.account.config);
    if (!poolConfig) {
      console.warn(`[${ts}] no pool config for ${t.memeMint.toBase58()}`);
      continue;
    }

    const quoteReserve = poolState.account.quoteReserve;
    const threshold = poolConfig.migrationQuoteThreshold;
    const isMigrated = poolState.account.isMigrated === 1;
    const ready = quoteReserve.gte(threshold);

    if (!ready) {
      // Still bonding — log progress and move on.
      const bondedSol = Number(quoteReserve.toString()) / 1e9;
      const targetSol = Number(threshold.toString()) / 1e9;
      console.log(
        `[${ts}]   ${t.memeMint.toBase58().slice(0, 8)}… bonding · ${bondedSol.toFixed(2)} / ${targetSol.toFixed(2)} SOL (${((bondedSol / targetSol) * 100).toFixed(1)}%)`,
      );
      continue;
    }

    if (isMigrated) {
      // DBC says migrated but yal_token still shows graduated_at = 0. Needs
      // a YAL router ix to mark graduation post-hoc — TODO below.
      console.log(`[${ts}]   ${t.memeMint.toBase58().slice(0, 8)}… DBC migrated, yal_token graduation pending`);
      continue;
    }

    // Ready to migrate. Permissionless — any payer works; LP ends up owned
    // by addresses configured at launch (creator/feeClaimer/leftoverReceiver).
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[poolConfig.migrationFeeOption];
    if (!dammConfig) {
      console.warn(
        `[${ts}]   no DAMM v2 fee address for option ${poolConfig.migrationFeeOption} — skipping`,
      );
      continue;
    }
    try {
      console.log(
        `[${ts}] MIGRATE ${t.memeMint.toBase58()} · reserve ${Number(quoteReserve.toString()) / 1e9} SOL`,
      );
      // v2 migration returns the tx plus two position-NFT keypairs that must
      // co-sign — the LP is held as two NFT positions (range-bound concentrated
      // liquidity) so the migrator hands us their secrets.
      const {
        transaction,
        firstPositionNftKeypair,
        secondPositionNftKeypair,
      } = await dbc.migration.migrateToDammV2({
        payer: payer.publicKey,
        virtualPool: poolState.publicKey,
        dammConfig,
      });
      const sig = await sendAndConfirmTransaction(
        conn,
        transaction,
        [payer, firstPositionNftKeypair, secondPositionNftKeypair],
        { commitment: "confirmed", maxRetries: 5 },
      );
      console.log(`[${ts}]   migration tx ${sig}`);
    } catch (err: any) {
      console.warn(`[${ts}]   migrate failed: ${err.message?.slice(0, 200)}`);
    }

    // TODO: post-migration yal_token sync.
    //
    // Option A — new YAL router ix `mark_graduated(yal_token, bonded_sol)`:
    //   Permissionless. Reads the DBC pool state (which is now in
    //   migrated/closed state), pulls bonded_sol from quoteReserve at
    //   migration time, sets yal_token.graduated_at = now,
    //   yal_token.bonded_sol_lamports = read value.
    //
    // Option B — fold into the existing fund_treasury / deposit flow:
    //   This daemon calls claimCreatorTradingFee/claimPartnerTradingFee on a
    //   schedule, transfers proceeds into yal_token treasury via existing
    //   fund_treasury, and the daily liquidator's deposit_to_stacsol picks
    //   up the SOL like any other source. graduated_at gets set by a
    //   one-time admin tx at migration time.
    //
    // Option A is cleaner (no admin step). Open until the user picks.
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");
  console.log(
    `yal-dbc-bridge: payer=${payer.publicKey.toBase58()} yal=${YAL_PROGRAM.toBase58()}`,
  );

  if (ARGV_ONCE) {
    await cycle(conn, dbc, payer);
    return;
  }
  while (true) {
    try {
      await cycle(conn, dbc, payer);
    } catch (err: any) {
      console.error(`cycle error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
