// Shared YAL CLI helpers — program ids, ixs, key loading.

import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

export const PROGRAM_ID = new PublicKey(
  process.env.YAL_PROGRAM_ID || "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

export const STACSOL = {
  POOL: new PublicKey("E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb"),
  MINT: new PublicKey("6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f"),
  RESERVE: new PublicKey("67ZvAvjKVX9ns8YFnMnAxyhPFibxsHJXQZcX3YeViyTP"),
  MANAGER_FEE: new PublicKey("8NX7sYj8HY4ghrcaVmXY3eXpUXiNdtYhLHjVprjEJzQT"),
  WITHDRAW_AUTH: new PublicKey("8x17uKn1xE7djGP1z3BNvqcn8qk84A8RjrxPi8o55no5"),
  PROGRAM: new PublicKey("SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY"),
};
export const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";

export function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

export function defaultPayerPath(): string {
  return process.env.YAL_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
}

export function yalTokenPda(memeMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yal"), memeMint.toBuffer()],
    PROGRAM_ID,
  );
}

// Anchor instruction discriminator: sha256("global:<name>")[:8]
function discriminator(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8) as Buffer;
}

export function registerTokenIx(
  yalToken: PublicKey,
  memeMint: PublicKey,
  treasuryAta: PublicKey,
  authority: PublicKey,
  stacsolTokenProgram: PublicKey,
  totalSupply: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(8 + 8);
  discriminator("register_token").copy(data, 0);
  data.writeBigUInt64LE(totalSupply, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: yalToken, isSigner: false, isWritable: true },
      { pubkey: memeMint, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: true, isWritable: true },
      { pubkey: STACSOL.MINT, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: stacsolTokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function fundTreasuryIx(
  yalToken: PublicKey,
  funder: PublicKey,
  lamports: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(8 + 8);
  discriminator("fund_treasury").copy(data, 0);
  data.writeBigUInt64LE(lamports, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: yalToken, isSigner: false, isWritable: true },
      { pubkey: funder, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function depositToStacsolIx(
  yalToken: PublicKey,
  treasuryAta: PublicKey,
  lamports: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(8 + 8);
  discriminator("deposit_to_stacsol").copy(data, 0);
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

export function redeemIx(
  yalToken: PublicKey,
  memeMint: PublicKey,
  userMemeAta: PublicKey,
  treasuryAta: PublicKey,
  userStacsolAta: PublicKey,
  user: PublicKey,
  memeTokenProgram: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(8 + 8);
  discriminator("redeem").copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: yalToken, isSigner: false, isWritable: true },
      { pubkey: memeMint, isSigner: false, isWritable: true },
      { pubkey: userMemeAta, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: userStacsolAta, isSigner: false, isWritable: true },
      { pubkey: STACSOL.MINT, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: memeTokenProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    ],
    data,
  });
}
