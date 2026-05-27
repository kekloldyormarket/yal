# YAL — Yet Another Launchpad

Routes memecoin bonded SOL into stacSOL. Every meme that graduates becomes a
stake-yielding bag forever.

```
memecoin  =  speculation / distribution layer
stacSOL   =  backing layer (Token-2022 LST, 6.9% mint/burn/xfer fee → NAV;
             validator commission goes to the operator separately)
24hr liq  =  pre + post bond reserves → stacSOL deposit
payout    =  burn meme tokens → receive (your_meme / circulating_meme)
             × treasury_stacsol
flywheel  =  every meme launch mints stacSOL (6.9% to NAV at mint).
             every redemption burns stacSOL (6.9% to NAV on burn).
             every speculative transfer pays 6.9% to NAV.
             NAV only goes up → every meme's floor only goes up.
```

## Architecture

See [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Components

```
programs/yal/      Anchor program — router (state + 4 instructions)
liquidator/        Bun daemon — runs every 60s, deposits queued SOL
cli/               Bun CLI — manual ops (register, fund, deposit, redeem, status)
frontend/          Next.js stub — /yal.fun
```

## Program

Program ID: `9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL`

Instructions:
- `register_token(total_supply)` — opens YalToken PDA + treasury stacSOL ATA
- `fund_treasury(lamports)` — pushes SOL into treasury PDA (called by graduation)
- `deposit_to_stacsol(lamports)` — CPI to Sanctum SVP `deposit_sol`, captures stacSOL
- `redeem(meme_amount)` — burns memecoin, pays pro-rata stacSOL

## Build

```bash
cd yal/
cargo build-sbf --manifest-path programs/yal/Cargo.toml
# produces target/deploy/yal.so
```

## Test (devnet)

```bash
solana config set --url devnet
solana airdrop 5
solana program deploy target/deploy/yal.so

cd cli/
bun install
bun run register <meme_mint> <total_supply>
bun run fund <meme_mint> <lamports>
# deposit_to_stacsol requires mainnet (stacSOL pool doesn't exist on devnet)
```

## Mainnet integration

stacSOL constants are hardcoded in `programs/yal/src/lib.rs`:
- Pool: `E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb`
- Mint: `6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f`

Single validator (100% commission, operator income): `35GSjBdKG49hTh5xA9HViwQNEmZMzDigNvBpKJXjKKAv`
Patched agave with native TowerSync batching:
https://github.com/kekloldyormarket/agave (branch `feat/vote-batching`)
