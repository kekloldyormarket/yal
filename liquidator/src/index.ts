// YAL Daily Liquidator
//
// Loops every 60s. ONE random time-of-day per dayBucket sweeps EVERY graduated
// token in a single pass — not per-token jitter. The daily trigger time is
// `sha256(dayBucket) % 86400`: deterministic given the day, but unpredictable
// before that day starts (anyone watching the chain knows when "today's sweep"
// will fire ~ahead of time, but they can't sandwich a specific token because
// every graduated token drains in the same batch window).
//
// Action per ready token in the daily sweep:
//   1. Push any SOL sitting in the yal_token treasury PDA → deposit_to_stacsol
//   2. (future, via DBC bridge) Withdraw LP position from Meteora DAMM v2,
//      swap SOL side, then deposit that SOL too. Same single trigger window.

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = process.env.YAL_LIQUIDATOR_KEYPAIR ||
  `${process.env.HOME}/.config/solana/id.json`;
const PROGRAM_ID = new PublicKey(
  process.env.YAL_PROGRAM_ID || "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

// stacSOL pool constants (mirrored from on-chain program).
const STACSOL = {
  POOL: new PublicKey("E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb"),
  MINT: new PublicKey("6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f"),
  RESERVE: new PublicKey("67ZvAvjKVX9ns8YFnMnAxyhPFibxsHJXQZcX3YeViyTP"),
  MANAGER_FEE: new PublicKey("8NX7sYj8HY4ghrcaVmXY3eXpUXiNdtYhLHjVprjEJzQT"),
  WITHDRAW_AUTH: new PublicKey("8x17uKn1xE7djGP1z3BNvqcn8qk84A8RjrxPi8o55no5"),
  PROGRAM: new PublicKey("SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"),
};
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const SLEEP_BETWEEN_CYCLES_MS = 60_000;
const MIN_LIQ_LAMPORTS = 100_000_000; // 0.1 SOL — don't burn fees on dust
const ARGV_ONCE = process.argv.includes("--once");

interface YalToken {
  pubkey: PublicKey;
  memeMint: PublicKey;
  authority: PublicKey;
  totalSupply: bigint;
  circulatingSupply: bigint;
  treasuryStacsol: bigint;
  treasurySolLamports: bigint;
  treasuryTokenAccount: PublicKey;
  graduatedAt: bigint;
  lastLiquidationTs: bigint;
  bondedSolLamports: bigint;
  bump: number;
}

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// Single daily trigger time-of-day, deterministic per dayBucket. Same value
// for every token — when the wall clock crosses it, the whole graduated set
// drains in one sweep.
function dailyOffset(dayBucket: number): number {
  const h = crypto.createHash("sha256");
  h.update(Buffer.from(String(dayBucket)));
  return h.digest().readUInt32BE(0) % 86400;
}

function todayTriggerTs(now: number): number {
  const dayBucket = Math.floor(now / 86400);
  return dayBucket * 86400 + dailyOffset(dayBucket);
}

function shouldLiquidate(t: YalToken, triggerTs: number, now: number): boolean {
  if (now < triggerTs) return false;                                // not the moment yet
  if (Number(t.lastLiquidationTs) >= triggerTs) return false;       // already swept this window
  if (t.treasurySolLamports < BigInt(MIN_LIQ_LAMPORTS)) return false;
  return true;
}

async function fetchAllTokens(conn: Connection): Promise<YalToken[]> {
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 8 + 32 + 32 + 8 + 8 + 8 + 8 + 32 + 8 + 8 + 8 + 1 }],
  });
  return accounts.map(({ pubkey, account }) => {
    const d = account.data;
    let off = 8; // skip discriminator
    const memeMint = new PublicKey(d.subarray(off, off + 32)); off += 32;
    const authority = new PublicKey(d.subarray(off, off + 32)); off += 32;
    const totalSupply = d.readBigUInt64LE(off); off += 8;
    const circulatingSupply = d.readBigUInt64LE(off); off += 8;
    const treasuryStacsol = d.readBigUInt64LE(off); off += 8;
    const treasurySolLamports = d.readBigUInt64LE(off); off += 8;
    const treasuryTokenAccount = new PublicKey(d.subarray(off, off + 32)); off += 32;
    const graduatedAt = d.readBigInt64LE(off); off += 8;
    const lastLiquidationTs = d.readBigInt64LE(off); off += 8;
    const bondedSolLamports = d.readBigUInt64LE(off); off += 8;
    const bump = d.readUInt8(off);
    return {
      pubkey, memeMint, authority, totalSupply, circulatingSupply,
      treasuryStacsol, treasurySolLamports, treasuryTokenAccount,
      graduatedAt, lastLiquidationTs, bondedSolLamports, bump,
    };
  });
}

// Build a deposit_to_stacsol ix manually (avoids needing the IDL in liquidator)
function depositToStacsolIx(
  yalToken: PublicKey,
  treasuryAta: PublicKey,
  lamports: bigint,
): TransactionInstruction {
  // anchor discriminator = sha256("global:deposit_to_stacsol")[:8]
  const disc = crypto.createHash("sha256")
    .update("global:deposit_to_stacsol")
    .digest()
    .subarray(0, 8);
  const data = Buffer.alloc(8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(lamports, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: yalToken, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: STACSOL.POOL, isSigner: false, isWritable: true },
      { pubkey: STACSOL.WITHDRAW_AUTH, isSigner: false, isWritable: false },
      { pubkey: STACSOL.RESERVE, isSigner: false, isWritable: true },
      { pubkey: STACSOL.MANAGER_FEE, isSigner: false, isWritable: true },
      { pubkey: STACSOL.MINT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function liquidate(
  conn: Connection,
  payer: Keypair,
  token: YalToken,
): Promise<string | null> {
  if (token.treasurySolLamports < BigInt(MIN_LIQ_LAMPORTS)) return null;
  const ix = depositToStacsolIx(
    token.pubkey,
    token.treasuryTokenAccount,
    token.treasurySolLamports,
  );
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix);
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function cycle(conn: Connection, payer: Keypair) {
  const tokens = await fetchAllTokens(conn);
  const now = nowSec();
  const triggerTs = todayTriggerTs(now);
  const ts = new Date().toISOString().slice(11, 19);
  const triggerDate = new Date(triggerTs * 1000).toISOString().slice(11, 19);
  console.log(
    `[${ts}] ${tokens.length} YAL tokens registered · today's sweep trigger ${triggerDate} UTC` +
      (now < triggerTs ? ` (in ${triggerTs - now}s)` : ` (passed)`),
  );

  if (now < triggerTs) return; // wait for the daily moment

  const ready = tokens.filter((t) => shouldLiquidate(t, triggerTs, now));
  if (ready.length === 0) return;

  console.log(`[${ts}] daily sweep firing — ${ready.length} tokens to drain`);
  for (const t of ready) {
    try {
      const sig = await liquidate(conn, payer, t);
      if (sig) {
        console.log(
          `[${ts}] LIQ ${t.memeMint.toBase58()}: ${
            Number(t.treasurySolLamports) / 1e9
          } SOL → stacSOL  sig=${sig}`,
        );
      }
    } catch (err: any) {
      console.warn(`[${ts}] liq failed for ${t.memeMint.toBase58()}: ${err.message?.slice(0, 200)}`);
    }
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  console.log(`yal-liquidator: payer=${payer.publicKey.toBase58()} program=${PROGRAM_ID.toBase58()}`);

  if (ARGV_ONCE) {
    await cycle(conn, payer);
    return 0;
  }

  while (true) {
    try {
      await cycle(conn, payer);
    } catch (err: any) {
      console.error(`cycle error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, SLEEP_BETWEEN_CYCLES_MS));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
