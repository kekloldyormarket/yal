// yal-cli deposit <meme_mint> <lamports>
//
// Moves SOL from treasury PDA → stacSOL via CPI. Mints stacSOL into treasury ATA.

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  RPC, loadKey, defaultPayerPath, yalTokenPda, depositToStacsolIx,
} from "./util.js";

const [memeMintArg, lamportsArg] = process.argv.slice(2);
if (!memeMintArg || !lamportsArg) {
  console.error("usage: yal deposit <meme_mint> <lamports>");
  process.exit(1);
}

const conn = new Connection(RPC, "confirmed");
const payer = loadKey(defaultPayerPath());
const memeMint = new PublicKey(memeMintArg);
const [yalToken] = yalTokenPda(memeMint);

const acct = await conn.getAccountInfo(yalToken);
if (!acct) {
  console.error(`yal token not registered for ${memeMintArg}`);
  process.exit(1);
}
// treasury_token_account starts at offset 8 + 32 + 32 + 8*4 = 104
const treasuryAta = new PublicKey(acct.data.subarray(104, 136));

const lamports = BigInt(lamportsArg);
const ix = depositToStacsolIx(yalToken, treasuryAta, lamports);
const { blockhash } = await conn.getLatestBlockhash();
const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix);
tx.sign(payer);
const sig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction(sig, "confirmed");
console.log(`✓ deposited ${Number(lamports) / 1e9} SOL → stacSOL  sig=${sig}`);
