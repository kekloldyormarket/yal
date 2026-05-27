// YAL — Yet Another Launchpad
//
// Routes memecoin bonded SOL into stacSOL via Sanctum SPL stake pool.
// Each registered memecoin gets a treasury PDA holding stacSOL,
// redeemable pro-rata by memecoin burners.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{
    self as ti, Mint, TokenAccount, TokenInterface,
};

declare_id!("9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL");

/// Sanctum SPL stake pool program id (mainnet fork backing stacSOL).
pub const SANCTUM_SPL_STAKE_POOL_PROGRAM: Pubkey =
    pubkey!("SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY");

/// stacSOL pool address on mainnet.
pub const STACSOL_POOL: Pubkey = pubkey!("E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb");

/// stacSOL mint.
pub const STACSOL_MINT: Pubkey = pubkey!("6K4xdfEk5rvySM496rxm4x8AgC9wVt7N4C7mFFpNAj5f");

/// Pool reserve stake account.
pub const STACSOL_RESERVE: Pubkey = pubkey!("67ZvAvjKVX9ns8YFnMnAxyhPFibxsHJXQZcX3YeViyTP");

/// Pool manager fee account.
pub const STACSOL_MANAGER_FEE: Pubkey = pubkey!("8NX7sYj8HY4ghrcaVmXY3eXpUXiNdtYhLHjVprjEJzQT");

/// Pool withdraw authority PDA on the Sanctum program.
pub const STACSOL_WITHDRAW_AUTH: Pubkey = pubkey!("8x17uKn1xE7djGP1z3BNvqcn8qk84A8RjrxPi8o55no5");

#[program]
pub mod yal {
    use super::*;

    /// Register a new memecoin with YAL. Opens a YalToken PDA + a treasury
    /// stacSOL ATA owned by the PDA. Permissionless — anyone can register
    /// any mint they control / care about.
    pub fn register_token(
        ctx: Context<RegisterToken>,
        total_supply: u64,
    ) -> Result<()> {
        require!(total_supply > 0, YalError::InvalidSupply);
        let token = &mut ctx.accounts.yal_token;
        token.meme_mint = ctx.accounts.meme_mint.key();
        token.authority = ctx.accounts.authority.key();
        token.total_supply = total_supply;
        token.circulating_supply = total_supply;
        token.treasury_stacsol = 0;
        token.treasury_sol_lamports = 0;
        token.treasury_token_account = ctx.accounts.treasury_stacsol_ata.key();
        token.graduated_at = 0;
        token.last_liquidation_ts = 0;
        token.bonded_sol_lamports = 0;
        token.bump = ctx.bumps.yal_token;
        msg!(
            "yal: registered mint={} supply={} authority={}",
            token.meme_mint,
            total_supply,
            token.authority,
        );
        Ok(())
    }

    /// Anyone sends SOL into a token's treasury PDA. This is the funnel from
    /// graduation / liquidator / arbitrary deposits.
    pub fn fund_treasury(ctx: Context<FundTreasury>, lamports: u64) -> Result<()> {
        require!(lamports > 0, YalError::InvalidAmount);
        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.yal_token.to_account_info(),
            },
        );
        system_program::transfer(cpi, lamports)?;

        let token = &mut ctx.accounts.yal_token;
        token.treasury_sol_lamports = token
            .treasury_sol_lamports
            .checked_add(lamports)
            .ok_or(YalError::AccountingDelta)?;
        token.bonded_sol_lamports = token
            .bonded_sol_lamports
            .checked_add(lamports)
            .ok_or(YalError::AccountingDelta)?;
        msg!("yal: funded treasury +{} lamports", lamports);
        Ok(())
    }

    /// Move accumulated SOL from the treasury PDA into the stacSOL pool via
    /// Sanctum SVP deposit_sol. Captures the minted stacSOL into the treasury
    /// token account. YAL is its own referrer, capturing half the 6.9% mint fee.
    pub fn deposit_to_stacsol(
        ctx: Context<DepositToStacsol>,
        lamports: u64,
    ) -> Result<()> {
        let token = &mut ctx.accounts.yal_token;
        require!(lamports > 0, YalError::InvalidAmount);
        require!(
            lamports <= token.treasury_sol_lamports,
            YalError::InsufficientTreasurySol
        );

        let pre_balance = ctx.accounts.treasury_stacsol_ata.amount;

        // DepositSol instruction in SPL stake pool program. Variant index 14.
        // accounts:
        //   0. [w]   stake_pool
        //   1. []    pool_withdraw_authority
        //   2. [w]   reserve_stake
        //   3. [w,s] from (lamports source; signs via PDA seeds)
        //   4. [w]   pool_tokens_receiver (treasury stacsol ATA)
        //   5. [w]   manager_fee_account
        //   6. [w]   referral_fee_account (== treasury_ata; YAL is its own referrer)
        //   7. [w]   pool_mint
        //   8. []    system_program
        //   9. []    token_program
        let mut ix_data = Vec::with_capacity(1 + 8);
        ix_data.push(14u8);
        ix_data.extend_from_slice(&lamports.to_le_bytes());

        let meme_mint_key = token.meme_mint;
        let bump = [token.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"yal", meme_mint_key.as_ref(), &bump]];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::instruction::Instruction {
                program_id: SANCTUM_SPL_STAKE_POOL_PROGRAM,
                accounts: vec![
                    AccountMeta::new(STACSOL_POOL, false),
                    AccountMeta::new_readonly(STACSOL_WITHDRAW_AUTH, false),
                    AccountMeta::new(STACSOL_RESERVE, false),
                    AccountMeta::new(token.key(), true),
                    AccountMeta::new(ctx.accounts.treasury_stacsol_ata.key(), false),
                    AccountMeta::new(STACSOL_MANAGER_FEE, false),
                    AccountMeta::new(ctx.accounts.treasury_stacsol_ata.key(), false),
                    AccountMeta::new(STACSOL_MINT, false),
                    AccountMeta::new_readonly(system_program::ID, false),
                    AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
                ],
                data: ix_data,
            },
            &[
                ctx.accounts.stacsol_pool.to_account_info(),
                ctx.accounts.stacsol_withdraw_auth.to_account_info(),
                ctx.accounts.stacsol_reserve.to_account_info(),
                token.to_account_info(),
                ctx.accounts.treasury_stacsol_ata.to_account_info(),
                ctx.accounts.stacsol_manager_fee.to_account_info(),
                ctx.accounts.treasury_stacsol_ata.to_account_info(),
                ctx.accounts.stacsol_mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        ctx.accounts.treasury_stacsol_ata.reload()?;
        let post_balance = ctx.accounts.treasury_stacsol_ata.amount;
        let minted = post_balance
            .checked_sub(pre_balance)
            .ok_or(YalError::AccountingDelta)?;

        token.treasury_sol_lamports = token
            .treasury_sol_lamports
            .checked_sub(lamports)
            .ok_or(YalError::AccountingDelta)?;
        token.treasury_stacsol = token
            .treasury_stacsol
            .checked_add(minted)
            .ok_or(YalError::AccountingDelta)?;

        if token.graduated_at == 0 {
            token.graduated_at = Clock::get()?.unix_timestamp;
        }
        token.last_liquidation_ts = Clock::get()?.unix_timestamp;

        msg!(
            "yal: deposited {} lamports → +{} stacSOL (treasury now {} stacSOL)",
            lamports,
            minted,
            token.treasury_stacsol,
        );
        Ok(())
    }

    /// Holder burns memecoin, receives pro-rata stacSOL.
    /// payout = (meme_amount / circulating_supply) × treasury_stacsol
    pub fn redeem(ctx: Context<Redeem>, meme_amount: u64) -> Result<()> {
        require!(meme_amount > 0, YalError::InvalidAmount);
        let token = &mut ctx.accounts.yal_token;
        require!(
            meme_amount <= ctx.accounts.user_meme_ata.amount,
            YalError::InsufficientMeme
        );
        require!(token.circulating_supply > 0, YalError::NothingCirculating);
        require!(token.treasury_stacsol > 0, YalError::EmptyTreasury);

        let numerator = (meme_amount as u128)
            .checked_mul(token.treasury_stacsol as u128)
            .ok_or(YalError::AccountingDelta)?;
        let payout = (numerator / token.circulating_supply as u128) as u64;
        require!(payout > 0, YalError::PayoutTooSmall);

        // Burn meme tokens via the appropriate token program.
        ti::burn(
            CpiContext::new(
                ctx.accounts.meme_token_program.to_account_info(),
                ti::Burn {
                    mint: ctx.accounts.meme_mint.to_account_info(),
                    from: ctx.accounts.user_meme_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            meme_amount,
        )?;

        // Transfer stacSOL out of treasury → user.
        let meme_mint_key = token.meme_mint;
        let bump = [token.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"yal", meme_mint_key.as_ref(), &bump]];
        ti::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.stacsol_token_program.to_account_info(),
                ti::TransferChecked {
                    from: ctx.accounts.treasury_stacsol_ata.to_account_info(),
                    to: ctx.accounts.user_stacsol_ata.to_account_info(),
                    authority: token.to_account_info(),
                    mint: ctx.accounts.stacsol_mint.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
            ctx.accounts.stacsol_mint.decimals,
        )?;

        token.circulating_supply = token
            .circulating_supply
            .checked_sub(meme_amount)
            .ok_or(YalError::AccountingDelta)?;
        token.treasury_stacsol = token
            .treasury_stacsol
            .checked_sub(payout)
            .ok_or(YalError::AccountingDelta)?;

        msg!(
            "yal: burned {} meme, paid {} stacSOL (circulating now {}, treasury {})",
            meme_amount,
            payout,
            token.circulating_supply,
            token.treasury_stacsol,
        );
        Ok(())
    }
}

#[account]
pub struct YalToken {
    pub meme_mint: Pubkey,
    pub authority: Pubkey,
    pub total_supply: u64,
    pub circulating_supply: u64,
    pub treasury_stacsol: u64,
    pub treasury_sol_lamports: u64,
    pub treasury_token_account: Pubkey,
    pub graduated_at: i64,
    pub last_liquidation_ts: i64,
    pub bonded_sol_lamports: u64,
    pub bump: u8,
}

impl YalToken {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 32 + 8 + 8 + 8 + 1;
}

#[derive(Accounts)]
pub struct RegisterToken<'info> {
    #[account(
        init,
        payer = authority,
        space = YalToken::SIZE,
        seeds = [b"yal", meme_mint.key().as_ref()],
        bump,
    )]
    pub yal_token: Account<'info, YalToken>,

    pub meme_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = stacsol_mint,
        token::authority = yal_token,
        token::token_program = stacsol_token_program,
    )]
    pub treasury_stacsol_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = STACSOL_MINT)]
    pub stacsol_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub stacsol_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(
        mut,
        seeds = [b"yal", yal_token.meme_mint.as_ref()],
        bump = yal_token.bump,
    )]
    pub yal_token: Account<'info, YalToken>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositToStacsol<'info> {
    #[account(
        mut,
        seeds = [b"yal", yal_token.meme_mint.as_ref()],
        bump = yal_token.bump,
    )]
    pub yal_token: Account<'info, YalToken>,

    #[account(
        mut,
        constraint = treasury_stacsol_ata.key() == yal_token.treasury_token_account
            @ YalError::WrongTreasury
    )]
    pub treasury_stacsol_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: validated by address constant
    #[account(mut, address = STACSOL_POOL)]
    pub stacsol_pool: UncheckedAccount<'info>,

    /// CHECK: validated by address constant
    #[account(address = STACSOL_WITHDRAW_AUTH)]
    pub stacsol_withdraw_auth: UncheckedAccount<'info>,

    /// CHECK: validated by address constant
    #[account(mut, address = STACSOL_RESERVE)]
    pub stacsol_reserve: UncheckedAccount<'info>,

    /// CHECK: validated by address constant
    #[account(mut, address = STACSOL_MANAGER_FEE)]
    pub stacsol_manager_fee: UncheckedAccount<'info>,

    /// CHECK: validated by address constant
    #[account(mut, address = STACSOL_MINT)]
    pub stacsol_mint: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(
        mut,
        seeds = [b"yal", yal_token.meme_mint.as_ref()],
        bump = yal_token.bump,
    )]
    pub yal_token: Account<'info, YalToken>,

    #[account(mut, address = yal_token.meme_mint)]
    pub meme_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = meme_mint,
        token::authority = user,
        token::token_program = meme_token_program,
    )]
    pub user_meme_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_stacsol_ata.key() == yal_token.treasury_token_account
            @ YalError::WrongTreasury
    )]
    pub treasury_stacsol_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = stacsol_mint,
        token::authority = user,
        token::token_program = stacsol_token_program,
    )]
    pub user_stacsol_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = STACSOL_MINT)]
    pub stacsol_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub meme_token_program: Interface<'info, TokenInterface>,
    pub stacsol_token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum YalError {
    #[msg("supply must be > 0")]
    InvalidSupply,
    #[msg("amount must be > 0")]
    InvalidAmount,
    #[msg("not enough sol in treasury")]
    InsufficientTreasurySol,
    #[msg("not enough meme in user ata")]
    InsufficientMeme,
    #[msg("no meme tokens circulating")]
    NothingCirculating,
    #[msg("treasury holds zero stacSOL")]
    EmptyTreasury,
    #[msg("computed payout is zero")]
    PayoutTooSmall,
    #[msg("wrong treasury account")]
    WrongTreasury,
    #[msg("accounting underflow / overflow")]
    AccountingDelta,
}
