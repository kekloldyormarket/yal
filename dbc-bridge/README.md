# yal-dbc-bridge

Monitors Meteora DBC pools where YAL is configured as the migrator. On
graduation transition, claims the resulting DAMM v2 LP position on behalf
of the matching `yal_token` PDA so the daily liquidator can later withdraw,
swap the SOL side, and call `deposit_to_stacsol`.

## Status

**Scaffolded, not yet wired against the Meteora SDK.** Two TODO sites:

1. `checkDbcGraduation` — needs `@meteora-ag/dynamic-bonding-curve` to
   decode pool state and detect the bonding → migrated transition
2. `claimMigrationForYal` — needs a new `claim_dbc_migration` instruction
   on the YAL router that accepts the LP position transfer and updates
   `yal_token.graduated_at` + `bonded_sol_lamports`

The shell loop, RPC plumbing, account fetching, and YAL state decoding are
correct and tested against the deployed program. What's blocked is the
specific decode/claim logic — those need the Meteora program layout
verified before coding.

## Open architectural questions

1. **Does Meteora DBC's migrator hook expose bonded SOL atomically?** If
   yes: we can pull SOL + LP in one tx. If no: we accept the position
   first and unwind it later in the liquidator's daily sweep.
2. **Migrator authority model.** DBC config takes a Pubkey for the
   migrator — does that need to be a program ID, or can it be a YAL
   router PDA? PDA gives us atomic CPI; program ID forces an off-chain
   relay step (this daemon).
3. **What happens to leftover meme tokens** in the DBC vault at
   graduation? Likely some unbonded supply stays with the LP. The
   liquidator should sell those into the AMM during the daily sweep.

## Run

```bash
bun install
RPC_URL=http://127.0.0.1:8899 bun run src/index.ts
```

Same systemd-on-validator-box deploy pattern as `liquidator/`.
