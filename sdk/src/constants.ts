import { PublicKey } from "@solana/web3.js";

// YAL router program — mainnet deploy 2026-05-27, slot 422501957
export const YAL_PROGRAM_ID = new PublicKey(
  "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

// Sanctum SPL stake pool program — backs stacSOL
export const SANCTUM_SPL_STAKE_POOL_PROGRAM = new PublicKey(
  "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY",
);

// stacSOL pool + accounts on mainnet
export const STACSOL = {
  POOL: new PublicKey("E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb"),
  MINT: new PublicKey("6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f"),
  RESERVE: new PublicKey("67ZvAvjKVX9ns8YFnMnAxyhPFibxsHJXQZcX3YeViyTP"),
  MANAGER_FEE: new PublicKey("8NX7sYj8HY4ghrcaVmXY3eXpUXiNdtYhLHjVprjEJzQT"),
  WITHDRAW_AUTH: new PublicKey("8x17uKn1xE7djGP1z3BNvqcn8qk84A8RjrxPi8o55no5"),
} as const;

export const TOKEN_2022_PROGRAM = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

// Default Ironforge RPC (override via NEXT_PUBLIC_RPC).
export const DEFAULT_RPC =
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
