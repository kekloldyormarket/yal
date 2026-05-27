// yal-cli register <meme_mint> <total_supply>
//
// Registers a memecoin with YAL: opens YalToken PDA + treasury stacSOL ATA.

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
} from "@solana/web3.js";
import {
  PROGRAM_ID, RPC, STACSOL, TOKEN_2022, loadKey, defaultPayerPath,
  yalTokenPda, registerTokenIx,
} from "./util.js";

const [memeMintArg, totalSupplyArg] = process.argv.slice(2);
if (!memeMintArg || !totalSupplyArg) {
  console.error("usage: yal register <meme_mint> <total_supply>");
  process.exit(1);
}

const conn = new Connection(RPC, "confirmed");
const payer = loadKey(defaultPayerPath());
const memeMint = new PublicKey(memeMintArg);
const [yalToken, bump] = yalTokenPda(memeMint);

// Treasury ATA — new keypair (Anchor `init` creates the account at this addr)
const treasuryAta = Keypair.generate();

console.log(`payer        : ${payer.publicKey.toBase58()}`);
console.log(`meme_mint    : ${memeMint.toBase58()}`);
console.log(`yal_token PDA: ${yalToken.toBase58()} (bump ${bump})`);
console.log(`treasury_ata : ${treasuryAta.publicKey.toBase58()}`);

const ix = registerTokenIx(
  yalToken,
  memeMint,
  treasuryAta.publicKey,
  payer.publicKey,
  TOKEN_2022,
  BigInt(totalSupplyArg),
);

const { blockhash } = await conn.getLatestBlockhash();
const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix);
tx.sign(payer, treasuryAta);
const sig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction(sig, "confirmed");
console.log(`✓ registered  sig=${sig}`);
