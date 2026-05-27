// Build a Token-2022 metadata update tx for a YAL-launched meme. Only the
// pool creator (who holds the update authority since our DBC configs use
// CreatorUpdateAuthority) can sign this.
//
// We update the URI field — wallets / explorers fetch the JSON at that URI
// for name / symbol / image / description. Re-uploading metadata JSON and
// flipping the URI atomically rewrites everything users see.

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { createUpdateFieldInstruction } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM } from "./sdk";

export interface BuildUpdateMetaArgs {
  conn: Connection;
  mint: PublicKey;
  updateAuthority: PublicKey;
  newUri: string;
}

export async function buildMetadataUpdateTx(
  args: BuildUpdateMetaArgs,
): Promise<Transaction> {
  const ix = createUpdateFieldInstruction({
    programId: TOKEN_2022_PROGRAM,
    metadata: args.mint,
    updateAuthority: args.updateAuthority,
    field: "uri",
    value: args.newUri,
  });
  const tx = new Transaction().add(ix);
  const { blockhash } = await args.conn.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.updateAuthority;
  return tx;
}
