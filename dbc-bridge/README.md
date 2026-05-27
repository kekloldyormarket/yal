# yal-dbc-bridge

Daemon that watches Meteora DBC pools whose base mint is a registered YAL
token. When a pool's `quoteReserve >= migrationQuoteThreshold` (the
"80 SOL bonded" line), the daemon calls Meteora's `migrateToDammV2` so the
post-bond LP becomes a DAMM v2 position owned by the YAL-controlled
addresses configured at launch.

The daily liquidator picks up SOL accumulated in the matching `yal_token`
treasury and pushes it through `deposit_to_stacsol`.

## Architecture

Real on-chain reads via `@meteora-ag/dynamic-bonding-curve-sdk@^1.5.3`:

- `getPoolByBaseMint(memeMint)` — finds the DBC pool for a YAL base mint
- `getPoolConfig(config)` — reads `migrationQuoteThreshold` + fee opts
- `pool.account.quoteReserve` / `isMigrated` — graduation state
- `migration.migrateToDammV2({...})` — flips the curve to DAMM v2

```
┌─ DBC pool (Meteora) ────────────────────────────────┐
│  baseMint: $YOURMEME                                │
│  config: {                                          │
│    creator:          YAL-controlled                 │
│    feeClaimer:       YAL-controlled                 │
│    leftoverReceiver: YAL-controlled                 │
│    migrationQuoteThreshold: 80 SOL                  │
│  }                                                  │
│  quoteReserve: $$$ (grows as buyers ape)            │
│  isMigrated: 0                                      │
└────────────────────────┬────────────────────────────┘
                         │  daemon detects: reserve ≥ threshold
                         ▼
                  migrateToDammV2
                         │
                         ▼
┌─ DAMM v2 LP (Meteora) ──────────────────────────────┐
│  Owned by config.creator / feeClaimer (YAL)         │
│  Trading fees accumulate in pool                    │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
                  Daily 24h sweep:
                  · claim DAMM v2 trading fees
                  · transfer SOL → yal_token via fund_treasury
                  · liquidator drains → deposit_to_stacsol
                         │
                         ▼
                  Treasury_stacsol grows
                  Floor ratchets up
                  Holders can redeem any time
```

## Status

The migrate-trigger half is wired. The post-migration claim half is open
on one design call:

**Option A — new YAL router `mark_graduated` ix.** Permissionless. Reads
the DBC pool state, sets `yal_token.graduated_at = now` and
`bonded_sol_lamports`. Clean — no admin step.

**Option B — admin tx + claim-fees daemon.** This daemon also calls
`claimCreatorTradingFee` on a schedule and transfers proceeds via the
existing `fund_treasury` ix. `graduated_at` set by a one-time admin tx.

Both work. Option A is preferred.

## Deploy

```bash
cd dbc-bridge && bun install
# keypair must match the DBC config's creator / feeClaimer
bun run src/index.ts
# or systemd alongside the liquidator on the validator box
```

## Tunables

| env | default | meaning |
|---|---|---|
| `RPC_URL` | Ironforge mainnet | RPC endpoint |
| `YAL_BRIDGE_KEYPAIR` | `~/.config/solana/id.json` | tx signer (must match DBC config's creator/partner) |
| `YAL_PROGRAM_ID` | `9zMMi7n…` | YAL router program |
