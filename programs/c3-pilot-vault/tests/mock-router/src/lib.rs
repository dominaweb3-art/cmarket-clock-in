//! Test-only separate program. Never copy into the C3 production workspace.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("7dfvugVLSaDFrXF6i2SbNji5vJmCvKP9grj4Nh8EysfZ");

#[program]
pub mod c3_local_router {
    use super::*;

    pub fn swap(ctx: Context<Swap>, input: u64, output: u64, fail: bool) -> Result<()> {
        require!(
            !fail && input > 0 && output > 0,
            LocalRouterError::ControlledFailure
        );
        require_keys_eq!(
            ctx.accounts.source.owner,
            ctx.accounts.vault_authority.key(),
            LocalRouterError::WrongAuthority
        );
        require_keys_eq!(
            ctx.accounts.destination.owner,
            ctx.accounts.vault_authority.key(),
            LocalRouterError::WrongAuthority
        );
        require_keys_eq!(
            ctx.accounts.input_pool.owner,
            ctx.accounts.pool_authority.key(),
            LocalRouterError::WrongPool
        );
        require_keys_eq!(
            ctx.accounts.output_pool.owner,
            ctx.accounts.pool_authority.key(),
            LocalRouterError::WrongPool
        );
        require_keys_eq!(
            ctx.accounts.source.mint,
            ctx.accounts.input_mint.key(),
            LocalRouterError::WrongMint
        );
        require_keys_eq!(
            ctx.accounts.input_pool.mint,
            ctx.accounts.input_mint.key(),
            LocalRouterError::WrongMint
        );
        require_keys_eq!(
            ctx.accounts.destination.mint,
            ctx.accounts.output_mint.key(),
            LocalRouterError::WrongMint
        );
        require_keys_eq!(
            ctx.accounts.output_pool.mint,
            ctx.accounts.output_mint.key(),
            LocalRouterError::WrongMint
        );
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.input_pool.to_account_info(),
                    mint: ctx.accounts.input_mint.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
            ),
            input,
            ctx.accounts.input_mint.decimals,
        )?;
        let bump = [ctx.bumps.pool_authority];
        let seeds: &[&[u8]] = &[b"liquidity", &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.output_pool.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    mint: ctx.accounts.output_mint.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[seeds],
            ),
            output,
            ctx.accounts.output_mint.decimals,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub vault_authority: Signer<'info>,
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut)]
    pub input_pool: Account<'info, TokenAccount>,
    #[account(mut)]
    pub output_pool: Account<'info, TokenAccount>,
    /// CHECK: Seed-derived authority controls only the test liquidity pools.
    #[account(seeds = [b"liquidity"], bump)]
    pub pool_authority: UncheckedAccount<'info>,
    pub input_mint: Account<'info, Mint>,
    pub output_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum LocalRouterError {
    ControlledFailure,
    WrongAuthority,
    WrongPool,
    WrongMint,
}
