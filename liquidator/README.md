# yal-liquidator

Daily sweep daemon. Once per UTC dayBucket at `sha256(dayBucket) % 86400`
seconds past midnight, drains every graduated YAL token's accumulated
treasury SOL into stacSOL via the router's `deposit_to_stacsol`
instruction.

## How it's NOT cron

The trigger time changes every day (deterministic given dayBucket, but
random-looking ahead of time). Cron is fixed-schedule — it can't react
to a per-day trigger window without re-arming. So the daemon polls every
60s, computes today's trigger time, and fires the batch when wall-clock
crosses it.

## Deploy on the validator box

```bash
# one-time runtime
curl -fsSL https://bun.sh/install | bash
sudo ln -s /home/sol/.bun/bin/bun /usr/local/bin/bun

# repo + deps
sudo -iu sol git clone https://github.com/kekloldyormarket/yal /home/sol/yal
cd /home/sol/yal/liquidator
sudo -iu sol bun install

# keypair — fund with ~0.1 SOL for tx fees
solana-keygen new --no-bip39-passphrase -o /home/sol/yal-liquidator.json
solana transfer <pubkey> 0.1 --allow-unfunded-recipient

# systemd unit
sudo cp systemd/yal-liquidator.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yal-liquidator
sudo journalctl -u yal-liquidator -f
```

Use the local validator RPC at `127.0.0.1:8899` since the daemon runs on
the validator box anyway — no public RPC rate-limit pressure.

## Tunables

| env var | default | meaning |
|---|---|---|
| `RPC_URL` | Ironforge mainnet | RPC endpoint |
| `YAL_LIQUIDATOR_KEYPAIR` | `~/.config/solana/id.json` | signer for sweep txs |
| `YAL_PROGRAM_ID` | `9zMMi7n…` | router program id |

`MIN_LIQ_LAMPORTS` (constant in `src/index.ts`) gates which tokens are
included in the sweep — currently 0.1 SOL, so dust accumulations don't
burn tx fees.
