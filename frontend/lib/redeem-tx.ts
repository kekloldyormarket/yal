// Build a real on-chain redeem tx — burns meme via Token-2022, transfers
// pro-rata stacSOL out of the treasury ATA. Includes an idempotent
// createAssociatedTokenAccount for the user's stacSOL ATA in case they've
// never held stacSOL before.

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { redeemIx, yalTokenPda, STACSOL } from "./sdk";

export interface BuildRedeemArgs {
  conn: Connection;
  user: PublicKey;
  memeMint: PublicKey;
  /** Token-2022 (1) or SPL Token classic (default). Most YAL launches are 2022. */
  memeTokenProgram?: PublicKey;
  /** Raw meme amount (UI count × 10^decimals). */
  memeAmount: bigint;
  /** Treasury ATA pubkey from the yal_token state. */
  treasuryAta: PublicKey;
}

export async function buildRedeemTx(
  args: BuildRedeemArgs,
): Promise<Transaction> {
  const memeTokenProgram = args.memeTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  const [yalToken] = yalTokenPda(args.memeMint);

  // User's meme ATA (where the meme tokens live before burn).
  const userMemeAta = getAssociatedTokenAddressSync(
    args.memeMint,
    args.user,
    false,
    memeTokenProgram,
  );

  // User's stacSOL ATA — destination of the redeem payout. Token-2022 mint.
  const userStacsolAta = getAssociatedTokenAddressSync(
    STACSOL.MINT,
    args.user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const tx = new Transaction();

  // Idempotent create — no-op if it already exists.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      args.user,
      userStacsolAta,
      args.user,
      STACSOL.MINT,
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  tx.add(
    redeemIx({
      yalToken,
      memeMint: args.memeMint,
      userMemeAta,
      treasuryAta: args.treasuryAta,
      userStacsolAta,
      user: args.user,
      memeTokenProgram,
      memeAmount: args.memeAmount,
    }),
  );

  const { blockhash } = await args.conn.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.user;
  return tx;
}
