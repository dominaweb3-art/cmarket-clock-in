//! MOCK_LOCAL_ONLY: deterministic local-validator settlement, never Jupiter or a production route.
use crate::{
    arithmetic::{add, portion},
    constants::{AUTHORITY_SEED, BTC_BPS, ETH_BPS, ONE_USDC, SOL_BPS},
    errors::VaultError,
    events::SettlementLegEvent,
    instructions::{MockDeposit, MockDepositLeg, MockRedemption, MockRedemptionLeg},
    settlement_plan::{check_next_leg, record_leg},
    state::{deposit_status, plan_direction, redemption_status},
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

/// Deterministic test adapter: burn mock input and mint mock output one leg at a time.
/// This is not a liquidity venue or evidence of an executable Jupiter CPI.
pub fn deposit_leg(
    ctx: Context<MockDepositLeg>,
    leg: u8,
    expected_revision: u64,
    route_hash: [u8; 32],
) -> Result<()> {
    let a = &mut ctx.accounts.accounts;
    let d = &mut ctx.accounts.intent;
    let p = &mut ctx.accounts.plan;
    require!(!a.config.paused, VaultError::Paused);
    require_keys_eq!(a.keeper.key(), a.config.keeper, VaultError::Unauthorized);
    require_keys_eq!(p.vault, a.config.key(), VaultError::InvalidPlan);
    require_keys_eq!(p.intent, d.key(), VaultError::InvalidPlan);
    require_keys_eq!(p.wallet, d.wallet, VaultError::InvalidPlan);
    require_keys_eq!(p.share_mint, a.config.share_mint, VaultError::InvalidPlan);
    require_keys_eq!(p.router_program, crate::ID, VaultError::InvalidPlan);
    require_eq!(
        p.config_version,
        a.config.config_version,
        VaultError::InvalidConfig
    );
    at(d.status, deposit_status::SETTLEMENT_PENDING)?;
    check_next_leg(
        p,
        plan_direction::DEPOSIT,
        leg,
        expected_revision,
        route_hash,
    )?;
    let index = usize::from(leg);
    let (mint, destination, output, input) = match leg {
        0 => (&a.btc_mint, &a.vault_btc, 40_000u64, 400_000u64),
        1 => (&a.eth_mint, &a.vault_eth, 30_000u64, 300_000u64),
        2 => (&a.wsol_mint, &a.vault_wsol, 30_000u64, 300_000u64),
        _ => return err!(VaultError::InvalidLeg),
    };
    require_keys_eq!(
        p.input_mints[index],
        a.usdc_mint.key(),
        VaultError::InvalidPlan
    );
    require_keys_eq!(p.output_mints[index], mint.key(), VaultError::InvalidPlan);
    require_keys_eq!(
        p.source_accounts[index],
        a.vault_usdc.key(),
        VaultError::InvalidPlan
    );
    require_keys_eq!(
        p.destination_accounts[index],
        destination.key(),
        VaultError::InvalidPlan
    );
    require!(
        p.minimum_outputs[index] <= output,
        VaultError::MinimumOutput
    );
    require!(
        a.usdc_mint.mint_authority
            == anchor_lang::solana_program::program_option::COption::Some(a.vault_authority.key())
            && mint.mint_authority
                == anchor_lang::solana_program::program_option::COption::Some(
                    a.vault_authority.key()
                ),
        VaultError::MockOnly
    );
    let before = [
        a.vault_usdc.amount,
        a.vault_btc.amount,
        a.vault_eth.amount,
        a.vault_wsol.amount,
    ];
    require!(before[0] >= input, VaultError::Settlement);
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
        input,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            MintTo {
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: a.vault_authority.to_account_info(),
            },
            &[signer],
        ),
        output,
    )?;
    a.vault_usdc.reload()?;
    a.vault_btc.reload()?;
    a.vault_eth.reload()?;
    a.vault_wsol.reload()?;
    let after = [
        a.vault_usdc.amount,
        a.vault_btc.amount,
        a.vault_eth.amount,
        a.vault_wsol.amount,
    ];
    require_eq!(after[0], before[0] - input, VaultError::Settlement);
    for asset in 0..3 {
        let expected = add(before[asset + 1], if asset == index { output } else { 0 })?;
        require_eq!(after[asset + 1], expected, VaultError::Settlement);
    }
    record_leg(p, leg, input, output)?;
    if p.executed_bitmap == 0b111 {
        d.btc_input_usdc = portion(ONE_USDC, BTC_BPS)?;
        d.eth_input_usdc = portion(ONE_USDC, ETH_BPS)?;
        d.wsol_input_usdc = portion(ONE_USDC, SOL_BPS)?;
        require_eq!(
            add(add(d.btc_input_usdc, d.eth_input_usdc)?, d.wsol_input_usdc)?,
            ONE_USDC,
            VaultError::Settlement
        );
        d.settlement_id = p.idempotency;
    }
    emit!(SettlementLegEvent {
        version: 1,
        vault: a.config.key(),
        intent: d.key(),
        direction: p.direction,
        leg,
        input,
        output,
        executed_bitmap: p.executed_bitmap,
        slot: Clock::get()?.slot
    });
    Ok(())
}

pub fn redemption_leg(
    ctx: Context<MockRedemptionLeg>,
    leg: u8,
    expected_revision: u64,
    route_hash: [u8; 32],
) -> Result<()> {
    let a = &mut ctx.accounts.accounts;
    let r = &mut ctx.accounts.intent;
    let p = &mut ctx.accounts.plan;
    require!(!a.config.paused, VaultError::Paused);
    require_keys_eq!(a.keeper.key(), a.config.keeper, VaultError::Unauthorized);
    require_keys_eq!(p.vault, a.config.key(), VaultError::InvalidPlan);
    require_keys_eq!(p.intent, r.key(), VaultError::InvalidPlan);
    require_keys_eq!(p.wallet, r.wallet, VaultError::InvalidPlan);
    require_keys_eq!(p.share_mint, a.config.share_mint, VaultError::InvalidPlan);
    require_keys_eq!(p.router_program, crate::ID, VaultError::InvalidPlan);
    require_eq!(
        p.config_version,
        a.config.config_version,
        VaultError::InvalidConfig
    );
    at(r.status, redemption_status::LIQUIDATION_PENDING)?;
    check_next_leg(
        p,
        plan_direction::REDEMPTION,
        leg,
        expected_revision,
        route_hash,
    )?;
    let index = usize::from(leg);
    let (mint, source, input, output) = match leg {
        0 => (&a.btc_mint, &a.vault_btc, r.btc_before, 396_000u64),
        1 => (&a.eth_mint, &a.vault_eth, r.eth_before, 297_000u64),
        2 => (&a.wsol_mint, &a.vault_wsol, r.wsol_before, 297_000u64),
        _ => return err!(VaultError::InvalidLeg),
    };
    require!(input > 0, VaultError::Settlement);
    require_keys_eq!(p.input_mints[index], mint.key(), VaultError::InvalidPlan);
    require_keys_eq!(
        p.output_mints[index],
        a.usdc_mint.key(),
        VaultError::InvalidPlan
    );
    require_keys_eq!(
        p.source_accounts[index],
        source.key(),
        VaultError::InvalidPlan
    );
    require_keys_eq!(
        p.destination_accounts[index],
        a.vault_usdc.key(),
        VaultError::InvalidPlan
    );
    require!(
        p.minimum_outputs[index] <= output,
        VaultError::MinimumOutput
    );
    require!(
        a.usdc_mint.mint_authority
            == anchor_lang::solana_program::program_option::COption::Some(a.vault_authority.key())
            && mint.mint_authority
                == anchor_lang::solana_program::program_option::COption::Some(
                    a.vault_authority.key()
                ),
        VaultError::MockOnly
    );
    let before = [
        a.vault_usdc.amount,
        a.vault_btc.amount,
        a.vault_eth.amount,
        a.vault_wsol.amount,
    ];
    require_eq!(before[index + 1], input, VaultError::Settlement);
    let bump = [a.config.authority_bump];
    let signer: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    token::burn(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            Burn {
                mint: mint.to_account_info(),
                from: source.to_account_info(),
                authority: a.vault_authority.to_account_info(),
            },
            &[signer],
        ),
        input,
    )?;
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
        output,
    )?;
    a.vault_usdc.reload()?;
    a.vault_btc.reload()?;
    a.vault_eth.reload()?;
    a.vault_wsol.reload()?;
    let after = [
        a.vault_usdc.amount,
        a.vault_btc.amount,
        a.vault_eth.amount,
        a.vault_wsol.amount,
    ];
    require_eq!(
        after[0],
        before[0].checked_add(output).ok_or(VaultError::Math)?,
        VaultError::Settlement
    );
    for asset in 0..3 {
        let expected = if asset == index { 0 } else { before[asset + 1] };
        require_eq!(after[asset + 1], expected, VaultError::Settlement);
    }
    record_leg(p, leg, input, output)?;
    if p.executed_bitmap == 0b111 {
        r.settlement_id = p.idempotency;
    }
    emit!(SettlementLegEvent {
        version: 1,
        vault: a.config.key(),
        intent: r.key(),
        direction: p.direction,
        leg,
        input,
        output,
        executed_bitmap: p.executed_bitmap,
        slot: Clock::get()?.slot
    });
    Ok(())
}
