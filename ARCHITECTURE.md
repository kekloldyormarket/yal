# YAL — Yet Another Launchpad

Permissionless memecoin launchpad that routes 100% of bonded value into stacSOL,
turning every meme into a stake-yielding bag.

## TL;DR Flow

```
1. Anyone launches $MEME on YAL (Meteora DBC fork or direct integration)
2. $MEME trades on a bonding curve, accumulating SOL
3. Daily 24hr-random liquidation: YAL pulls all pre-bond + post-bond reserves,
   sells the team/treasury memecoin supply into the curve, deposits the resulting
   SOL into stacSOL pool via Sanctum SVP deposit_sol
4. YAL treasury PDA accumulates stacSOL (per memecoin)
5. $MEME holders redeem: burn meme tokens, receive
   (their_meme / circulating_meme) × treasury_stacSOL
6. Memecoin can still be freely traded (speculation layer); redemption is optional
7. The 6.9% mint/burn/transfer fee on stacSOL itself flows back to NAV →
   every interaction with the token grows the per-share floor
8. Validator commission is 100% → all staking yield goes to the operator
   directly (NOT to NAV — operator income, separate stream)
```

## Why this composes

- **stacSOL is the universal sink**. Every meme launch mints stacSOL.
  No new pools, no new validators, no new infrastructure per launch.
- **The 6.9% flywheel compounds with launchpad volume**.
  Each graduation = a fresh `deposit_sol` mint = 6.9% of bonded SOL → NAV.
  Each redemption = a burn = another 6.9% to NAV. Speculative transfers
  while users hold stacSOL also pay 6.9% to NAV. Pure usage growth.
- **Validator commission is the operator's income line**, not NAV's. The
  validator pays for the infrastructure that makes stacSOL credible (one
  node, patched agave, native vote batching); the NAV-growth engine is
  the Token-2022 fee, which is independent.
- **Memecoin is just a distribution layer**. The bonding curve is the user-facing
  speculation venue; the redemption is the productive yield path.

## On-Chain Programs

### YAL Router Program (new)

Per-memecoin PDA: `seeds = ["yal", meme_mint]`

State:
```rust
pub struct YalToken {
    pub meme_mint: Pubkey,           // SPL token mint
    pub authority: Pubkey,           // launcher (for now; later: bonding curve)
    pub total_supply: u64,           // initial mint
    pub circulating_supply: u64,     // total_supply - burned via redemption
    pub treasury_stacsol: u64,       // stacSOL held by treasury PDA
    pub treasury_token_account: Pubkey,
    pub graduated_at: i64,           // 0 if not graduated yet
    pub last_liquidation_ts: i64,    // unix ts of last daily liq
    pub bonded_sol_lamports: u64,    // accumulated by curve
    pub bump: u8,
}
```

Instructions:
- `register_token(meme_mint, total_supply)` — opens a YalToken PDA. Permissionless.
- `graduate(meme_mint)` — called when bond threshold hit:
  - Pulls all bonded SOL from the curve
  - Liquidates team/reserves into curve
  - `deposit_sol` CPI → Sanctum SVP → stacSOL → treasury PDA
  - Records graduated_at
- `liquidate_reserves(meme_mint)` — daily, called by off-chain daemon
  with proof-of-time (last_liquidation_ts + 24h <= now):
  - Sells any post-bond residual into curve OR external venue
  - Deposits SOL → stacSOL → treasury
- `redeem(meme_amount)` — burns meme tokens, transfers stacSOL out:
  ```
  payout = (meme_amount / circulating_supply) × treasury_stacsol
  ```
  Decrements circulating_supply; decrements treasury_stacsol.

### Memecoin Token (standard SPL Token-2022)

Standard mint, optionally with metadata. No special hooks needed for v1.
Future: add transfer fee extension (1% transfer fee → 0.5% to YAL treasury
which gets recycled into stacSOL on next liquidation).

## Off-Chain Components

### Daily Liquidator Daemon (`yal-liquidator`)

- Loops every minute, queries on-chain for all registered tokens
- For each token where `now > last_liquidation_ts + jitter(0..86400s)`:
  - Sends `liquidate_reserves` ix
- Random jitter prevents MEV: nobody knows exactly when each token will liquidate
- Run as systemd on the validator box (same as `stacsol-balancer`)

### Frontend (`yal.fun`)

Next.js app deployed to Vercel.
- `/` — Launch new meme. Form: name, ticker, image, total_supply.
  Calls `register_token` + bonding curve init.
- `/token/[mint]` — Detail page. Trade panel (DBC), Redeem button, stats.
- `/portfolio` — User's bags + their redeemable stacSOL.

## Integration with Meteora DBC

Meteora's DBC supports migration to custom destinations via a migrator authority.
We use the existing DBC bonding curve for trading and price discovery, but set
the migrator to our YAL Router program. On graduation, our `graduate` ix is
invoked which pulls the SOL and skips the normal Raydium migration.

If DBC's migrator hook doesn't fit, fallback path: fork DBC, hardwire YAL as the
destination, and run our own permissionless curve.

## Revenue Model

Per memecoin launched:
- Launch fee: 0.1 SOL → YAL treasury
- Graduation fee: 1% of bonded SOL → YAL treasury

Per stacSOL deposit (each graduation + daily liq):
- 6.9% mint fee on the deposit → 3.45% to stacSOL protocol, 3.45% referrer
  - If YAL is the referrer ATA: 3.45% to YAL treasury too

Per redemption:
- Burn fee on stacSOL withdrawn: 6.9% → 3.45% to stacSOL protocol

Plus the validator income at 100% commission, all of which accrues to stacSOL
NAV (not split with YAL token holders directly — but YAL treasury holds stacSOL
so it benefits from NAV growth too).

## Math: 1 graduation/day × 500 SOL avg

- Bonded SOL → stacSOL deposits: 500 SOL/day = 182,500 SOL/yr
- Mint fees (6.9%, half to YAL as referrer):
  - YAL retains: 500 × 0.0345 × 365 = 6,296 SOL/yr referrer fees
  - stacSOL protocol retains: 6,296 SOL/yr protocol fees
- Validator income (after 100% comm, retention scales with N):
  - At 10k stacSOL aggregate stake @ N=5: ~270 SOL/yr → NAV ↑
- Redemption flow: pure internal token swap, no fees per redemption beyond
  what's already in stacSOL's burn fee

## File Layout

```
yal/
├── ARCHITECTURE.md              ← this file
├── programs/
│   └── yal-router/
│       ├── Cargo.toml
│       └── src/lib.rs           ← Anchor program
├── liquidator/
│   ├── package.json
│   └── src/index.ts             ← Bun-runnable daemon
├── frontend/
│   ├── package.json
│   └── app/                     ← Next.js 16 app router
└── tests/
    └── yal-router.ts
```
