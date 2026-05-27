// One-shot backfill of Meteora DBC trading fees for every YAL token's pool.
//
// Claims:
//   - Partner side (feeClaimer = YAL deployer per config) — always
//   - Creator side  — only when pool.creator == deployer (legacy / house
//     launches; user-launched pools have user as creator and need their sig)
//
// SOL receiver = deployer wallet. The follow-up step (convert → stacSOL →
// deposit per-meme into treasury_ata) lives in the daemon's main cycle and
// the drain-lp-and-deposit script.
//
// Run:
//   YAL_DEPLOYER_KEYPAIR=~/manager.json bun run scripts/backfill-dbc-fee-claims.ts

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import * as fs from "node:fs";
import * as os from "node:os";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = (process.env.YAL_DEPLOYER_KEYPAIR ||
  `${os.homedir()}/manager.json`).replace(/^~/, os.homedir());
const YAL_PROGRAM = new PublicKey(
  process.env.YAL_PROGRAM_ID || "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

const U64_MAX = new BN("18446744073709551615");
const DUST_LAMPORTS = new BN(10_000); // <0.00001 SOL — tx fee would dominate

interface YalToken {
  pubkey: PublicKey;
  memeMint: PublicKey;
}

async function fetchAllYalTokens(conn: Connection): Promise<YalToken[]> {
  const accounts = await conn.getProgramAccounts(YAL_PROGRAM, {
    filters: [{ dataSize: 161 }],
  });
  return accounts.map(({ pubkey, account }) => {
    const d = account.data;
    const memeMint = new PublicKey(d.subarray(8, 40));
    return { pubkey, memeMint };
  });
}

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))),
  );
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  const dbc = new DynamicBondingCurveClient(conn, "confirmed");

  console.log(`deployer:   ${payer.publicKey.toBase58()}`);
  const startBal = await conn.getBalance(payer.publicKey);
  console.log(`start bal:  ${(startBal / 1e9).toFixed(6)} SOL`);

  const tokens = await fetchAllYalTokens(conn);
  console.log(`yal tokens: ${tokens.length}\n`);

  let partnerClaimed = 0;
  let creatorClaimed = 0;
  let txCount = 0;
  let skippedDust = 0;
  let noPool = 0;

  for (const t of tokens) {
    const short = t.memeMint.toBase58().slice(0, 8) + "…";
    let poolState;
    try {
      poolState = await dbc.state.getPoolByBaseMint(t.memeMint);
    } catch {
      noPool++;
      continue;
    }
    if (!poolState) {
      noPool++;
      continue;
    }

    let breakdown;
    try {
      breakdown = await dbc.state.getPoolFeeBreakdown(poolState.publicKey);
    } catch (e: any) {
      console.log(`${short}  feeBreakdown failed: ${e.message?.slice(0, 100)}`);
      continue;
    }

    const partnerSol = Number(breakdown.partner.unclaimedQuoteFee.toString()) / 1e9;
    const creatorSol = Number(breakdown.creator.unclaimedQuoteFee.toString()) / 1e9;
    const creatorMatchesPayer = poolState.account.creator.equals(payer.publicKey);

    if (
      breakdown.partner.unclaimedQuoteFee.lte(DUST_LAMPORTS) &&
      (!creatorMatchesPayer || breakdown.creator.unclaimedQuoteFee.lte(DUST_LAMPORTS))
    ) {
      skippedDust++;
      continue;
    }

    console.log(
      `${short}  partner=${partnerSol.toFixed(6)} creator=${creatorSol.toFixed(6)}${
        creatorMatchesPayer ? "" : " (creator≠payer, skip)"
      }`,
    );

    if (breakdown.partner.unclaimedQuoteFee.gt(DUST_LAMPORTS)) {
      try {
        const tx = await dbc.partner.claimPartnerTradingFee({
          feeClaimer: payer.publicKey,
          payer: payer.publicKey,
          pool: poolState.publicKey,
          maxBaseAmount: U64_MAX,
          maxQuoteAmount: U64_MAX,
          receiver: payer.publicKey,
        });
        const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
          commitment: "confirmed",
          maxRetries: 5,
        });
        partnerClaimed += partnerSol;
        txCount++;
        console.log(`           PARTNER claimed ${partnerSol.toFixed(6)} SOL · ${sig.slice(0, 16)}…`);
      } catch (err: any) {
        console.log(`           partner claim failed: ${err.message?.slice(0, 200)}`);
      }
    }

    if (
      creatorMatchesPayer &&
      breakdown.creator.unclaimedQuoteFee.gt(DUST_LAMPORTS)
    ) {
      try {
        const tx = await dbc.creator.claimCreatorTradingFee({
          creator: payer.publicKey,
          payer: payer.publicKey,
          pool: poolState.publicKey,
          maxBaseAmount: U64_MAX,
          maxQuoteAmount: U64_MAX,
          receiver: payer.publicKey,
        });
        const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
          commitment: "confirmed",
          maxRetries: 5,
        });
        creatorClaimed += creatorSol;
        txCount++;
        console.log(`           CREATOR claimed ${creatorSol.toFixed(6)} SOL · ${sig.slice(0, 16)}…`);
      } catch (err: any) {
        console.log(`           creator claim failed: ${err.message?.slice(0, 200)}`);
      }
    }
  }

  const endBal = await conn.getBalance(payer.publicKey);
  console.log(`\n=== summary ===`);
  console.log(`pools w/o curve:   ${noPool}`);
  console.log(`dust-skipped:      ${skippedDust}`);
  console.log(`txs sent:          ${txCount}`);
  console.log(`partner SOL claim: ${partnerClaimed.toFixed(6)}`);
  console.log(`creator SOL claim: ${creatorClaimed.toFixed(6)}`);
  console.log(`wallet Δ:          ${((endBal - startBal) / 1e9).toFixed(6)} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
