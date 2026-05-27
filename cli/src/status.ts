// yal-cli status [meme_mint]
//
// Either dumps all registered YAL tokens, or details for a specific meme mint.

import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, RPC, yalTokenPda } from "./util.js";

const ARG = process.argv[2];

function parseToken(data: Buffer) {
  let off = 8;
  const memeMint = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const authority = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const totalSupply = data.readBigUInt64LE(off); off += 8;
  const circulatingSupply = data.readBigUInt64LE(off); off += 8;
  const treasuryStacsol = data.readBigUInt64LE(off); off += 8;
  const treasurySolLamports = data.readBigUInt64LE(off); off += 8;
  const treasuryTokenAccount = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const graduatedAt = data.readBigInt64LE(off); off += 8;
  const lastLiquidationTs = data.readBigInt64LE(off); off += 8;
  const bondedSolLamports = data.readBigUInt64LE(off); off += 8;
  const bump = data.readUInt8(off);
  return {
    memeMint, authority, totalSupply, circulatingSupply,
    treasuryStacsol, treasurySolLamports, treasuryTokenAccount,
    graduatedAt, lastLiquidationTs, bondedSolLamports, bump,
  };
}

const conn = new Connection(RPC, "confirmed");

if (ARG) {
  // Single-token detail.
  const memeMint = new PublicKey(ARG);
  const [yalToken] = yalTokenPda(memeMint);
  const acct = await conn.getAccountInfo(yalToken);
  if (!acct) {
    console.log(`no YAL token registered for ${ARG}`);
    process.exit(1);
  }
  const t = parseToken(Buffer.from(acct.data));
  console.log(`yal_token  : ${yalToken.toBase58()}`);
  console.log(`meme_mint  : ${t.memeMint.toBase58()}`);
  console.log(`authority  : ${t.authority.toBase58()}`);
  console.log(`treasury_ata: ${t.treasuryTokenAccount.toBase58()}`);
  console.log(`total_supply       : ${t.totalSupply.toString()}`);
  console.log(`circulating_supply : ${t.circulatingSupply.toString()}`);
  console.log(`treasury_stacsol   : ${t.treasuryStacsol.toString()} (${Number(t.treasuryStacsol) / 1e9} stacSOL)`);
  console.log(`treasury_sol       : ${t.treasurySolLamports.toString()} lamports (${Number(t.treasurySolLamports) / 1e9} SOL)`);
  console.log(`bonded_sol         : ${t.bondedSolLamports.toString()} lamports (${Number(t.bondedSolLamports) / 1e9} SOL)`);
  console.log(`graduated_at       : ${t.graduatedAt.toString()} ${t.graduatedAt > 0n ? `(${new Date(Number(t.graduatedAt) * 1000).toISOString()})` : "(not yet)"}`);
  console.log(`last_liquidation_ts: ${t.lastLiquidationTs.toString()}`);
} else {
  // List all.
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 153 }],
  });
  console.log(`${accounts.length} YAL tokens registered`);
  console.log(`${"meme_mint".padEnd(46)} ${"circ".padStart(15)} ${"stacSOL".padStart(12)} ${"SOL".padStart(10)} status`);
  for (const { pubkey, account } of accounts) {
    const t = parseToken(Buffer.from(account.data));
    console.log(
      `${t.memeMint.toBase58().padEnd(46)} ` +
      `${t.circulatingSupply.toString().padStart(15)} ` +
      `${(Number(t.treasuryStacsol)/1e9).toFixed(4).padStart(12)} ` +
      `${(Number(t.treasurySolLamports)/1e9).toFixed(4).padStart(10)} ` +
      `${t.graduatedAt > 0n ? "graduated" : "bonding"}`
    );
  }
}
