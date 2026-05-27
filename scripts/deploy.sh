#!/usr/bin/env bash
# Deploy YAL router program.
#
# Usage: scripts/deploy.sh [devnet|mainnet]
#
# Costs ~2.5 SOL (rent-exempt data account ~2.25 SOL + tx fees).
# Payer = solana config default keypair. Make sure it has enough SOL.

set -euo pipefail

CLUSTER="${1:-devnet}"

case "$CLUSTER" in
  devnet)
    URL="https://api.devnet.solana.com"
    ;;
  mainnet)
    URL="https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY"
    ;;
  *)
    echo "usage: $0 [devnet|mainnet]"
    exit 1
    ;;
esac

cd "$(dirname "$0")/.."

if [ ! -f target/deploy/yal.so ]; then
  echo "yal.so not built. running cargo build-sbf..."
  cargo build-sbf --manifest-path programs/yal/Cargo.toml
fi

echo "=== pre-deploy ==="
solana config set --url "$URL" 2>&1 | tail -3
echo "payer:  $(solana address)"
echo "balance: $(solana balance)"
echo "program: $(solana-keygen pubkey target/deploy/yal-keypair.json)"
echo "cluster: $CLUSTER  ($URL)"
echo

read -p "deploy YAL to $CLUSTER? (y/N) " ans
if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
  echo "aborted"
  exit 1
fi

echo "=== deploying ==="
solana program deploy \
  target/deploy/yal.so \
  --program-id target/deploy/yal-keypair.json \
  --url "$URL"

echo
echo "✓ deployed. program: $(solana-keygen pubkey target/deploy/yal-keypair.json)"
