// Backfill register_token for every Meteora DBC pool launched against a YAL
// config that's missing its yal_token PDA (createPool landed but the YAL half
// didn't). Idempotent — skips mints already registered.
//
// Run:
//   YAL_DEPLOYER_KEYPAIR=~/manager.json bun run scripts/backfill-register.ts

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { sha256 } from "@noble/hashes/sha256";
import * as fs from "node:fs";
import * as os from "node:os";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = (process.env.YAL_DEPLOYER_KEYPAIR ||
  `${os.homedir()}/manager.json`).replace(/^~/, os.homedir());

const YAL_PROGRAM = new PublicKey("9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL");
const STACSOL_MINT = new PublicKey("6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const YAL_DBC_CONFIGS = new Set([
  "2ACJ5JGshXts1a4vjMef1Zcqwa4xXnhfP5do8uCCaVW8",
  "FYPDras2wmaCqKEGVEcFoSpiHKPSAHtJbhoEG32mDPrR",
  "8KQMrM3A7e4RP4GjYkWZYu9K6ki27XtiUP9nsb4fpG2R",
]);

const FIXED_TOTAL_SUPPLY = 1_000_000_000n * 1_000_000n;

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))),
  );
}

function yalTokenPda(memeMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yal"), memeMint.toBuffer()],
    YAL_PROGRAM,
  );
}

function disc(name: string): Buffer {
  return Buffer.from(
    sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8),
  );
}

function registerTokenIx(args: {
  yalToken: PublicKey;
  memeMint: PublicKey;
  treasuryAta: PublicKey;
  authority: PublicKey;
  totalSupply: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("register_token").copy(data, 0);
  data.writeBigUInt64LE(args.totalSupply, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.memeMint, isSigner: false, isWritable: false },
      { pubkey: args.treasuryAta, isSigner: true, isWritable: true },
      { pubkey: STACSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");

  console.log(`deployer: ${payer.publicKey.toBase58()}`);
  console.log(`balance:  ${(await conn.getBalance(payer.publicKey)) / 1e9} SOL`);

  // 1. Pull every DBC pool created against any of our 3 YAL configs.
  console.log("\nscanning Meteora DBC pools…");
  const pools = await dbc.state.getPoolsByConfig?.(undefined as never)
    .catch(() => null);

  // Fall back to enumerating each config one at a time.
  const allPools: Array<{ baseMint: PublicKey; pool: PublicKey }> = [];
  for (const cfgStr of YAL_DBC_CONFIGS) {
    const cfg = new PublicKey(cfgStr);
    try {
      // The Meteora state service exposes getPoolsByConfig if available.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (dbc.state as any).getPoolsByConfig;
      if (typeof fn === "function") {
        const list = await fn.call(dbc.state, cfg);
        for (const p of list) {
          allPools.push({
            baseMint: p.account.baseMint,
            pool: p.publicKey,
          });
        }
      } else {
        // Manual scan: getProgramAccounts on the DBC program filtered by config.
        // Offset of `config` field in VirtualPool — discriminator(8) + ??? .
        // Cheaper to just iterate via Meteora's own helpers if present.
        // For now log + skip — most launches will be covered.
        console.warn(`  no getPoolsByConfig SDK method, skipping config ${cfgStr}`);
      }
    } catch (e: any) {
      console.warn(`  config ${cfgStr} scan failed: ${e.message?.slice(0, 120)}`);
    }
  }
  console.log(`found ${allPools.length} pools across YAL configs`);

  // 2. For each, derive yal_token PDA and check if it already exists.
  const missing: Array<{ baseMint: PublicKey; yalToken: PublicKey }> = [];
  for (const { baseMint } of allPools) {
    const [yalToken] = yalTokenPda(baseMint);
    const info = await conn.getAccountInfo(yalToken);
    if (!info) {
      missing.push({ baseMint, yalToken });
    }
  }
  console.log(`${missing.length} missing yal_token PDAs to backfill`);

  if (missing.length === 0) {
    console.log("nothing to do");
    return;
  }

  // 3. Register each.
  for (const { baseMint, yalToken } of missing) {
    const treasuryAta = Keypair.generate();
    const ix = registerTokenIx({
      yalToken,
      memeMint: baseMint,
      treasuryAta: treasuryAta.publicKey,
      authority: payer.publicKey,
      totalSupply: FIXED_TOTAL_SUPPLY,
    });
    const tx = new Transaction().add(ix);
    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [payer, treasuryAta], {
        commitment: "confirmed",
        maxRetries: 5,
      });
      console.log(`REGISTERED ${baseMint.toBase58()}  sig=${sig}`);
    } catch (e: any) {
      console.warn(
        `  failed ${baseMint.toBase58()}: ${e.message?.slice(0, 200)}`,
      );
    }
  }

  console.log("\ndone");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
