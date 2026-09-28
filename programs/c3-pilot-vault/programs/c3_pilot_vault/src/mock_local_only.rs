//! MOCK_LOCAL_ONLY: deterministic local-validator settlement, never Jupiter or a production route.
use crate::{
    arithmetic::{add, portion},
    constants::{AUTHORITY_SEED, BTC_BPS, ETH_BPS, ONE_USDC, SOL_BPS},
    errors::VaultError,
    instructions::{MockDeposit, MockRedemption},
    state::{deposit_status, redemption_status},
    transitions::{at, live},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo};

pub fn deposit(ctx: Context<MockDeposit>, settlement_id: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts.accounts;
    let d = &mut ctx.accounts.intent;
    require_keys_eq!(a.keeper.key(), a.config.keeper, VaultError::Unauthorized);
    require_eq!(
        d.config_version,
        a.config.config_version,
        VaultError::InvalidConfig
    );
    at(d.status, deposit_status::SETTLEMENT_PENDING)?;
    live(d.expires_at)?;
    require!(
        settlement_id != [0; 32] && d.settlement_id == [0; 32],
        VaultError::Settlement
    );
    require_eq!(a.vault_usdc.amount, 1_000_000, VaultError::Settlement);
    for m in [&a.usdc_mint, &a.btc_mint, &a.eth_mint, &a.wsol_mint] {
        require!(
            m.mint_authority
                == anchor_lang::solana_program::program_option::COption::Some(
                    a.vault_authority.key()
                ),
            VaultError::MockOnly
        );
    }
    for b in [a.vault_btc.amount, a.vault_eth.amount, a.vault_wsol.amount] {
        require_eq!(b, 0, VaultError::Settlement);
    }
    let bump = [a.config.authority_bump];
    let signer: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::burn(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            Burn {
                mint: a.usdc_mint.to_account_info(),
                from: a.vault_usdc.to_account_info(),
                authority: a.vault_authority.to_account_info(),
            },
            &[signer],
        ),
        1_000_000,
    )?;
    for (mint, to, amount) in [
        (&a.btc_mint, &a.vault_btc, 40_000u64),
        (&a.eth_mint, &a.vault_eth, 30_000u64),
        (&a.wsol_mint, &a.vault_wsol, 30_000u64),
    ] {
        token::mint_to(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                MintTo {
                    mint: mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: a.vault_authority.to_account_info(),
                },
                &[signer],
            ),
            amount,
        )?;
    }
    d.btc_input_usdc = portion(ONE_USDC, BTC_BPS)?;
    d.eth_input_usdc = portion(ONE_USDC, ETH_BPS)?;
    d.wsol_input_usdc = portion(ONE_USDC, SOL_BPS)?;
    require_eq!(
        add(add(d.btc_input_usdc, d.eth_input_usdc)?, d.wsol_input_usdc)?,
        ONE_USDC,
        VaultError::Settlement
    );
    d.settlement_id = settlement_id;
    Ok(())
}

pub fn redemption(ctx: Context<MockRedemption>, settlement_id: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts.accounts;
    let r = &mut ctx.accounts.intent;
    require_keys_eq!(a.keeper.key(), a.config.keeper, VaultError::Unauthorized);
    require_eq!(
        r.config_version,
        a.config.config_version,
        VaultError::InvalidConfig
    );
    at(r.status, redemption_status::LIQUIDATION_PENDING)?;
    require!(
        settlement_id != [0; 32] && r.settlement_id == [0; 32],
        VaultError::Settlement
    );
    require_eq!(a.vault_usdc.amount, 0, VaultError::Settlement);
    require_eq!(a.vault_btc.amount, 40_000, VaultError::Settlement);
    require_eq!(a.vault_eth.amount, 30_000, VaultError::Settlement);
    require_eq!(a.vault_wsol.amount, 30_000, VaultError::Settlement);
    for m in [&a.usdc_mint, &a.btc_mint, &a.eth_mint, &a.wsol_mint] {
        require!(
            m.mint_authority
                == anchor_lang::solana_program::program_option::COption::Some(
                    a.vault_authority.key()
                ),
            VaultError::MockOnly
        );
    }
    let bump = [a.config.authority_bump];
    let signer: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    for (mint, from, amount) in [
        (&a.btc_mint, &a.vault_btc, 40_000u64),
        (&a.eth_mint, &a.vault_eth, 30_000u64),
        (&a.wsol_mint, &a.vault_wsol, 30_000u64),
    ] {
        token::burn(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                Burn {
                    mint: mint.to_account_info(),
                    from: from.to_account_info(),
                    authority: a.vault_authority.to_account_info(),
                },
                &[signer],
            ),
            amount,
        )?;
    }
    token::mint_to(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            MintTo {
                mint: a.usdc_mint.to_account_info(),
                to: a.vault_usdc.to_account_info(),
                authority: a.vault_authority.to_account_info(),
            },
            &[signer],
        ),
        990_000,
    )?;
    r.settlement_id = settlement_id;
    Ok(())
}
