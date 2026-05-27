// Helius Sender — ultra-low-latency Solana tx submission. Fan-outs to
// Jito's block engine + Helius's staked connections simultaneously.
// Each tx needs a transfer ix to a Jito tip account (≥0.0002 SOL).
//
// Docs: https://docs.helius.dev/sender

import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export const HELIUS_SENDER_URL = "https://sender.helius-rpc.com/fast";

// Per Helius docs: spread tips across these accounts to avoid contention.
const JITO_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
];

/** 0.0005 SOL — above the 0.0002 minimum, leaves headroom for priority. */
export const TIP_LAMPORTS = 500_000;

function pickTipAccount(): PublicKey {
  const i = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[i]!);
}

/** Append a Jito-tip transfer to an existing transaction. */
export function appendTip(tx: Transaction, from: PublicKey): void {
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: pickTipAccount(),
      lamports: TIP_LAMPORTS,
    }),
  );
}

/** Submit a signed raw tx to Helius Sender. Returns the signature. */
export async function sendViaSender(rawTx: Uint8Array | Buffer): Promise<string> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendTransaction",
    params: [
      Buffer.from(rawTx).toString("base64"),
      { encoding: "base64", skipPreflight: false, maxRetries: 0 },
    ],
  };
  const r = await fetch(HELIUS_SENDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { result?: string; error?: { message: string } };
  if (j.error) throw new Error(`sender: ${j.error.message}`);
  if (!j.result) throw new Error("sender: empty result");
  return j.result;
}
