#!/usr/bin/env bash
# YAL mainnet smoke test
#
# 1. Mint a throwaway Token-2022 token with a tiny supply
# 2. Register it with YAL (creates per-token PDA + treasury ATA)
# 3. Push 0.01 SOL into the treasury via fund_treasury
# 4. Call deposit_to_stacsol to convert that 0.01 SOL into stacSOL
# 5. Verify the YAL treasury holds the minted stacSOL
#
# Cost: ~0.025 SOL (one-time mint rent + token PDA rent + treasury ATA rent
# + 0.01 SOL deposit). Recoverable: close the test mint + close the token
# accounts after to recover most of it.
#
# Prereq: ~/manager.json funded with at least 0.05 SOL.

set -euo pipefail

RPC='https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY'
PAYER="${YAL_PAYER:-$HOME/manager.json}"
CLI_DIR="$(cd "$(dirname "$0")/../cli" && pwd)"

echo "=== preflight ==="
solana balance "$PAYER" --url "$RPC"

echo "=== mint throwaway memecoin (Token-2022, 9 decimals, 1,000,000 supply) ==="
MEME_MINT_KEYPAIR="$(mktemp /tmp/yal-smoke-meme.XXXX).json"
solana-keygen new --no-bip39-passphrase --silent -o "$MEME_MINT_KEYPAIR"
MEME_MINT="$(solana-keygen pubkey "$MEME_MINT_KEYPAIR")"
echo "  meme mint: $MEME_MINT"

spl-token create-token \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --decimals 9 \
  --fee-payer "$PAYER" \
  --mint-authority "$PAYER" \
  --url "$RPC" \
  "$MEME_MINT_KEYPAIR"

echo "=== mint 1M tokens to ourselves ==="
spl-token create-account "$MEME_MINT" --fee-payer "$PAYER" --owner "$PAYER" --url "$RPC"
spl-token mint "$MEME_MINT" 1000000 --mint-authority "$PAYER" --fee-payer "$PAYER" --url "$RPC"

echo "=== YAL register_token ==="
export YAL_KEYPAIR="$PAYER"
export RPC_URL="$RPC"
cd "$CLI_DIR"
bun install --silent 2>&1 | tail -1
bun run register "$MEME_MINT" 1000000000000000   # 1M tokens × 1e9 decimals

echo "=== fund_treasury 0.01 SOL ==="
bun run fund "$MEME_MINT" 10000000

echo "=== deposit_to_stacsol 0.01 SOL ==="
bun run deposit "$MEME_MINT" 10000000

echo "=== status ==="
bun run status "$MEME_MINT"

echo "=== DONE — YAL treasury should now hold stacSOL ==="
echo "to inspect: solana account <treasury_ata> --url $RPC"
