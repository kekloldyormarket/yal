import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import {
  YAL_PROGRAM_ID,
  STACSOL,
  TOKEN_2022_PROGRAM,
} from "./constants";

// Anchor discriminator = sha256("global:<ix_name>")[:8]
// @noble/hashes is isomorphic so this works in both Node and browser bundles.
function disc(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8);
}

// Build the instruction data buffer = [8-byte discriminator, u64 arg LE].
// Uses DataView for the u64 write — Next.js's polyfilled Buffer doesn't
// expose writeBigUInt64LE in the client bundle. Buffer.from(uint8arr) just
// wraps the same backing buffer so web3.js's `data: Buffer` type stays happy.
function buildData(name: string, arg: bigint): Buffer {
  const data = new Uint8Array(16);
  data.set(disc(name), 0);
  new DataView(data.buffer).setBigUint64(8, arg, true);
  return Buffer.from(data);
}

export function registerTokenIx(args: {
  yalToken: PublicKey;
  memeMint: PublicKey;
  treasuryAta: PublicKey;
  authority: PublicKey;
  stacsolTokenProgram?: PublicKey;
  totalSupply: bigint;
}): TransactionInstruction {
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
    data: buildData("register_token", args.totalSupply),
  });
}

export function fundTreasuryIx(args: {
  yalToken: PublicKey;
  funder: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: YAL_PROGRAM_ID,
    keys: [
      { pubkey: args.yalToken, isSigner: false, isWritable: true },
      { pubkey: args.funder, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildData("fund_treasury", args.lamports),
  });
}

export function depositToStacsolIx(args: {
  yalToken: PublicKey;
  treasuryAta: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
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
    data: buildData("deposit_to_stacsol", args.lamports),
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
    data: buildData("redeem", args.memeAmount),
  });
}
