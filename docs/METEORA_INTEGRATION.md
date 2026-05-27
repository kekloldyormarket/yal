# Meteora DBC ↔ YAL Integration

How memecoins launched via Meteora's Dynamic Bonding Curve get their bonded SOL
routed into stacSOL through the YAL router.

## The integration boundary

```
[memecoin launches on Meteora DBC]
       │
       ▼  bonded SOL accumulates as buyers ape
[bond threshold hit: graduates]
       │
       ▼  Meteora calls custom migrator
[YAL Router.graduate (= fund_treasury wrapper)]
       │
       ▼  treasury PDA holds SOL
[Liquidator daemon, daily random jitter]
       │
       ▼  CPI to Sanctum SVP
[stacSOL minted into YAL treasury]
       │
       ▼  available for memecoin holders to redeem
```

## Meteora DBC migration model

Meteora's DBC supports a configurable "migrator" — a program that receives the
graduated SOL + LP tokens when the bonding curve hits its threshold. Default
migrator routes to a Raydium pool. To redirect to YAL:

1. **Custom migrator program ID**: we register YAL Router (`9zMMi7n…NDKL`) as
   the migrator authority when creating the DBC config
2. **Graduation hook**: on graduation, DBC sends SOL + remaining curve tokens
   to a PDA derived from the migrator config. We need to write a YAL ix that
   accepts this transfer and calls `fund_treasury` internally.

### Required additions to YAL Router

A new instruction:

```rust
pub fn graduate_from_dbc(
    ctx: Context<GraduateFromDbc>,
    bonded_sol: u64,
    leftover_meme: u64,
) -> Result<()> {
    // Verify caller is the registered Meteora DBC migrator authority
    // Transfer bonded_sol from DBC vault → yal_token PDA
    // Bonded SOL counts into treasury_sol_lamports
    // Leftover meme tokens are added to YAL's treasury (sold later by liquidator)
    // graduated_at = now
}
```

Account constraints:
- DBC vault account (source of SOL)
- DBC config account (proves this is a legit graduation)
- YAL token PDA (destination)
- DBC program ID (must invoke this ix from inside their CPI flow)

### Two paths forward

**Path A — Native migrator hook** (cleanest if Meteora supports it):
- We write `graduate_from_dbc` as above
- Register YAL's program ID as the migrator authority on every YAL-launched curve
- Meteora's program CPIs into ours on graduation
- Single atomic graduation tx

**Path B — Permissionless polling** (fallback):
- DBC graduates normally to Raydium pool
- Off-chain agent monitors graduation events
- Agent pulls SOL from Raydium pool (or uses LP claim flow)
- Calls `fund_treasury` separately
- Not atomic; introduces sandwich window

We prefer **Path A** if Meteora's spec allows. Need to verify by reading their
program source.

## Open questions to resolve before MVP

1. **Does DBC's migrator hook expose the bonded SOL atomically, or does it
   migrate LP to a Raydium pool first?** If the latter, we need Path B.
2. **What account constraints does the migrator have access to?** We need to
   pass the right PDA seeds to derive the YAL token account.
3. **Is the migrator a single program ID or a Pubkey owned by ANY program?**
   If the latter, we can set it to a YAL-owned PDA and unlock atomic flow.

## Memecoin SPL setup (per launch)

Each YAL-launched memecoin:
- Token-2022 mint (so we can add transfer fee extension later if desired)
- Standard 9-decimals, fixed total_supply
- Mint authority transferred to a "burnt" address post-launch (no further mint)
- Metadata via Metaplex Token Metadata extension OR Token-2022 Metadata Pointer

The YAL router doesn't care which token program — `register_token` accepts any
mint, and the `redeem` ix routes burn through the right program.

## Testing path

Once integrated:
1. **Devnet smoke test**: launch a fake memecoin, fund treasury manually,
   call `deposit_to_stacsol` against a devnet stacSOL pool (would need to
   spin up a copy of the Sanctum SVP on devnet for this to actually work)
2. **Mainnet beta**: launch the first real YAL memecoin with 100 SOL bond
   threshold (low ceiling, low blast radius). Watch every step on chain
3. **Production**: ratchet up bond threshold, add memecoin templates
