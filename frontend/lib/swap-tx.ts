// Builds a Meteora DBC swap tx for a YAL-launched meme. Single tx, single
// signature. Caller adds a Jito tip + ships through Helius Sender.

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

export interface BuildSwapArgs {
  conn: Connection;
  user: PublicKey;
  memeMint: PublicKey;
  /** raw amount — for buy: SOL lamports. For sell: meme raw (× decimals). */
  amountIn: bigint;
  /** true = sell base (meme) → quote (SOL). false = buy base. */
  swapBaseForQuote: boolean;
  /** basis points off the quoted output. default 200 = 2%. */
  slippageBps?: number;
}

export interface BuiltSwap {
  tx: Transaction;
  expectedOut: bigint;
  minOut: bigint;
  poolAddress: PublicKey;
}

export async function buildSwapTx(args: BuildSwapArgs): Promise<BuiltSwap> {
  const dbc = new DynamicBondingCurveClient(args.conn, "confirmed");
  const poolState = await dbc.state.getPoolByBaseMint(args.memeMint);
  if (!poolState) throw new Error("no DBC pool for this mint yet");
  const poolConfig = await dbc.state.getPoolConfig(poolState.account.config);
  if (!poolConfig) throw new Error("pool config missing");

  // activationType 1 = Timestamp; 0 = Slot. Our YAL configs use Timestamp.
  let currentPoint: BN;
  if (poolConfig.activationType === 0) {
    currentPoint = new BN(await args.conn.getSlot());
  } else {
    const slot = await args.conn.getSlot();
    const blockTime = await args.conn.getBlockTime(slot);
    if (blockTime === null) throw new Error("getBlockTime returned null");
    currentPoint = new BN(blockTime);
  }

  const quote = await dbc.pool.swapQuote({
    virtualPool: poolState.account,
    config: poolConfig,
    swapBaseForQuote: args.swapBaseForQuote,
    amountIn: new BN(args.amountIn.toString()),
    hasReferral: false,
    currentPoint,
    eligibleForFirstSwapWithMinFee: false,
  });

  const slipBps = BigInt(args.slippageBps ?? 200);
  const expectedOut = BigInt(quote.outputAmount.toString());
  const minOut = (expectedOut * (10_000n - slipBps)) / 10_000n;

  const tx = await dbc.pool.swap({
    amountIn: new BN(args.amountIn.toString()),
    minimumAmountOut: new BN(minOut.toString()),
    owner: args.user,
    pool: poolState.publicKey,
    swapBaseForQuote: args.swapBaseForQuote,
    referralTokenAccount: null,
  });

  const { blockhash } = await args.conn.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;
  tx.feePayer = args.user;

  return { tx, expectedOut, minOut, poolAddress: poolState.publicKey };
}
