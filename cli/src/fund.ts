// yal-cli fund <meme_mint> <lamports>
//
// Pushes SOL into a YAL token's treasury PDA.

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  RPC, loadKey, defaultPayerPath, yalTokenPda, fundTreasuryIx,
} from "./util.js";

const [memeMintArg, lamportsArg] = process.argv.slice(2);
if (!memeMintArg || !lamportsArg) {
  console.error("usage: yal fund <meme_mint> <lamports>");
  process.exit(1);
}

const conn = new Connection(RPC, "confirmed");
const payer = loadKey(defaultPayerPath());
const memeMint = new PublicKey(memeMintArg);
const [yalToken] = yalTokenPda(memeMint);
const lamports = BigInt(lamportsArg);

const ix = fundTreasuryIx(yalToken, payer.publicKey, lamports);
const { blockhash } = await conn.getLatestBlockhash();
const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix);
tx.sign(payer);
const sig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction(sig, "confirmed");
console.log(`✓ funded ${Number(lamports) / 1e9} SOL  sig=${sig}`);
