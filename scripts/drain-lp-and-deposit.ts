// Drain every DAMM v2 LP position owned by the deployer wallet → recover
// SOL → fund_treasury on the matching yal_token → deposit_to_stacsol.
//
// One-shot backfill for tokens that bonded + migrated but never had their
// treasury_stacsol populated. Future automation belongs in dbc-bridge.

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
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import BN from "bn.js";
import * as fs from "node:fs";
import * as os from "node:os";

const RPC = "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = (process.env.YAL_DEPLOYER_KEYPAIR || `${os.homedir()}/manager.json`).replace(/^~/, os.homedir());

const YAL_PROGRAM = new PublicKey("9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL");
const STACSOL_POOL = new PublicKey("E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb");
const STACSOL_MINT = new PublicKey("6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f");
const STACSOL_RESERVE = new PublicKey("67ZvAvjKVX9ns8YFnMnAxyhPFibxsHJXQZcX3YeViyTP");
const STACSOL_MANAGER_FEE = new PublicKey("8NX7sYj8HY4ghrcaVmXY3eXpUXiNdtYhLHjVprjEJzQT");
const STACSOL_WITHDRAW_AUTH = new PublicKey("8x17uKn1xE7djGP1z3BNvqcn8qk84A8RjrxPi8o55no5");
const SANCTUM_SPL_STAKE_POOL = new PublicKey("SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const FILTER_MINT = process.argv[2] ? new PublicKey(process.argv[2]) : null;

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}
function disc(name: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8));
}
function yalTokenPda(memeMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("yal"), memeMint.toBuffer()], YAL_PROGRAM)[0];
}

function fundTreasuryIx(args: { yalToken: PublicKey; funder: PublicKey; lamports: bigint }): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("fund_treasury").copy(data, 0);
  data.writeBigUInt64LE(args.lamports, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.funder, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function depositToStacsolIx(args: { yalToken: PublicKey; treasuryAta: PublicKey; lamports: bigint }): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("deposit_to_stacsol").copy(data, 0);
  data.writeBigUInt64LE(args.lamports, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: STACSOL_POOL, isSigner: false, isWritable: true },
      { pubkey: STACSOL_WITHDRAW_AUTH, isSigner: false, isWritable: false },
      { pubkey: STACSOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: STACSOL_MANAGER_FEE, isSigner: false, isWritable: true },
      { pubkey: STACSOL_MINT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Sanctum SPL stake-pool program — required in the tx's account list
      // so the runtime can resolve the CPI from YAL into it.
      { pubkey: SANCTUM_SPL_STAKE_POOL, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  const cpamm = new CpAmm(conn);

  console.log(`deployer: ${payer.publicKey.toBase58()}`);
  const startSol = (await conn.getBalance(payer.publicKey)) / 1e9;
  console.log(`balance:  ${startSol.toFixed(4)} SOL`);

  // 1. Pull every LP position owned by the deployer.
  const positions = await cpamm.getPositionsByUser(payer.publicKey);
  console.log(`\nfound ${positions.length} LP positions on the deployer wallet`);
  if (FILTER_MINT) console.log(`filter: only drain positions whose pool baseMint === ${FILTER_MINT.toBase58()}`);

  for (const p of positions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = p as any;
    const positionPubkey: PublicKey = pos.position;
    const positionNftAccount: PublicKey = pos.positionNftAccount;
    const positionState = pos.positionState;
    const poolPubkey: PublicKey = positionState.pool;

    let poolState;
    try {
      poolState = await cpamm._program.account.pool.fetch(poolPubkey);
    } catch {
      console.warn(`  skip ${positionPubkey.toBase58()}: pool fetch failed`);
      continue;
    }
    const baseMint = poolState.tokenAMint as PublicKey;
    const quoteMint = poolState.tokenBMint as PublicKey;

    // Only drain pools where the quote side is SOL (WSOL). Filters out
    // unrelated LP the deployer might hold elsewhere.
    if (!quoteMint.equals(SOL_MINT)) {
      console.log(`  skip ${baseMint.toBase58()}: quote isn't SOL`);
      continue;
    }
    if (FILTER_MINT && !baseMint.equals(FILTER_MINT)) {
      console.log(`  skip ${baseMint.toBase58()}: not the requested mint`);
      continue;
    }
    if (positionState.unlockedLiquidity.isZero()) {
      console.log(`  skip ${baseMint.toBase58()}: 0 unlocked liquidity`);
      continue;
    }

    console.log(`\nDRAIN ${baseMint.toBase58()}  position=${positionPubkey.toBase58()}`);
    try {
      // Pre-balance to compute exactly how much SOL was extracted by the
      // remove-liquidity. The position stays open (with dust) — closing it
      // hits PositionIsNotEmpty in some configs and the dust isn't worth
      // chasing.
      const balBefore = await conn.getBalance(payer.publicKey);
      const removeTx = (await cpamm.removeAllLiquidity({
        owner: payer.publicKey,
        position: positionPubkey,
        pool: poolPubkey,
        positionNftAccount,
        tokenAAmountThreshold: new BN(0),
        tokenBAmountThreshold: new BN(0),
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram: poolState.tokenAFlag === 1 ? TOKEN_2022 : new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        tokenBProgram: poolState.tokenBFlag === 1 ? TOKEN_2022 : new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        vestings: [],
      } as never)) as Transaction;
      const sig = await sendAndConfirmTransaction(conn, removeTx, [payer], {
        commitment: "confirmed",
        maxRetries: 5,
      });
      console.log(`  removed liquidity, sig=${sig}`);
      const balAfter = await conn.getBalance(payer.publicKey);
      const recovered = balAfter - balBefore;
      console.log(`  recovered ${recovered / 1e9} SOL`);

      // Locate the yal_token treasury ATA.
      const yalToken = yalTokenPda(baseMint);
      const info = await conn.getAccountInfo(yalToken);
      if (!info) {
        console.warn(`  no yal_token PDA — skipping deposit`);
        continue;
      }
      const treasuryAta = new PublicKey(info.data.subarray(104, 136));

      // Deposit: fund_treasury (transfers SOL → yal_token PDA) +
      // deposit_to_stacsol (stake into Sanctum SVP, mint stacSOL to
      // treasury ATA). Same tx, atomic.
      const reserve = 5_000_000;
      const fundAmt = BigInt(Math.max(0, recovered - reserve));
      if (fundAmt < 1_000_000n) {
        console.warn(`  recovered too little (${recovered}) — skipping`);
        continue;
      }
      console.log(`  fund + deposit ${Number(fundAmt) / 1e9} SOL`);
      const fundTx = new Transaction()
        .add(fundTreasuryIx({ yalToken, funder: payer.publicKey, lamports: fundAmt }))
        .add(depositToStacsolIx({ yalToken, treasuryAta, lamports: fundAmt }));
      const sig2 = await sendAndConfirmTransaction(conn, fundTx, [payer], {
        commitment: "confirmed",
        maxRetries: 5,
      });
      console.log(`  sig=${sig2}`);
    } catch (e: any) {
      console.warn(`  failed:`, e?.message?.slice(0, 400) ?? e);
    }
  }

  const endSol = (await conn.getBalance(payer.publicKey)) / 1e9;
  console.log(`\nend balance: ${endSol.toFixed(4)} SOL (delta ${(endSol - startSol).toFixed(4)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
