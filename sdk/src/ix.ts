import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "node:crypto";
import {
  YAL_PROGRAM_ID,
  STACSOL,
  TOKEN_2022_PROGRAM,
} from "./constants.js";

// Anchor discriminator = sha256("global:<ix_name>")[:8]
function disc(name: string): Buffer {
  return crypto.createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8) as Buffer;
}

export function registerTokenIx(args: {
  yalToken: PublicKey;
  memeMint: PublicKey;
  treasuryAta: PublicKey;            // freshly generated keypair, signer
  authority: PublicKey;              // payer + signer
  stacsolTokenProgram?: PublicKey;   // defaults to Token-2022
  totalSupply: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("register_token").copy(data, 0);
  data.writeBigUInt64LE(args.totalSupply, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM_ID,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.memeMint, isSigner: false, isWritable: false },
      { pubkey: args.treasuryAta, isSigner: true, isWritable: true },
      { pubkey: STACSOL.MINT, isSigner: false, isWritable: false },
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: args.stacsolTokenProgram ?? TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function fundTreasuryIx(args: {
  yalToken: PublicKey;
  funder: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("fund_treasury").copy(data, 0);
  data.writeBigUInt64LE(args.lamports, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM_ID,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.funder, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function depositToStacsolIx(args: {
  yalToken: PublicKey;
  treasuryAta: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("deposit_to_stacsol").copy(data, 0);
  data.writeBigUInt64LE(args.lamports, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM_ID,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: STACSOL.POOL, isSigner: false, isWritable: true },
      { pubkey: STACSOL.WITHDRAW_AUTH, isSigner: false, isWritable: false },
      { pubkey: STACSOL.RESERVE, isSigner: false, isWritable: true },
      { pubkey: STACSOL.MANAGER_FEE, isSigner: false, isWritable: true },
      { pubkey: STACSOL.MINT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function redeemIx(args: {
  yalToken: PublicKey;
  memeMint: PublicKey;
  userMemeAta: PublicKey;
  treasuryAta: PublicKey;
  userStacsolAta: PublicKey;
  user: PublicKey;
  memeTokenProgram: PublicKey;
  memeAmount: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(16);
  disc("redeem").copy(data, 0);
  data.writeBigUInt64LE(args.memeAmount, 8);
  return new TransactionInstruction({
    programId: YAL_PROGRAM_ID,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.memeMint, isSigner: false, isWritable: true },
      { pubkey: args.userMemeAta, isSigner: false, isWritable: true },
      { pubkey: args.treasuryAta, isSigner: false, isWritable: true },
      { pubkey: args.userStacsolAta, isSigner: false, isWritable: true },
      { pubkey: STACSOL.MINT, isSigner: false, isWritable: false },
      { pubkey: args.user, isSigner: true, isWritable: true },
      { pubkey: args.memeTokenProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  });
}
