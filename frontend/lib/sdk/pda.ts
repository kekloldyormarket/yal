import { PublicKey } from "@solana/web3.js";
import { YAL_PROGRAM_ID } from "./constants";

/** Derive the YalToken PDA for a given memecoin mint. */
export function yalTokenPda(memeMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yal"), memeMint.toBuffer()],
    YAL_PROGRAM_ID,
  );
}
