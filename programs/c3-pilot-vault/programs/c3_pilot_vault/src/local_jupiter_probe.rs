//! ONLY for an isolated validator with cloned public programs/accounts.
//! This experiment is NOT a fund-authorizing production boundary.
use crate::{
    constants::*,
    errors::VaultError,
    state::RouteProgramRegistry,
    swap_leg::{account_metas_hash, verified_ed25519_message, QuoteAuthorizationV1},
};
use anchor_lang::{
    prelude::*,
    solana_program::{hash::hashv, instruction::Instruction, program::invoke_signed},
};
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
pub struct Probe<'info> {
    pub payer: Signer<'info>,
    /// CHECK: ephemeral test public key; only present in excluded probe.
    pub quote_authority: UncheckedAccount<'info>,
    /// CHECK: exact program-derived signer, never a wallet key.
    #[account(seeds=[AUTHORITY_SEED],bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, constraint=source.owner==authority.key())]
    pub source: Account<'info, TokenAccount>,
    #[account(mut, constraint=destination.owner==authority.key())]
    pub destination: Account<'info, TokenAccount>,
    /// CHECK: exact executable Jupiter program, not a label.
    #[account(executable,address=pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"))]
    pub router: UncheckedAccount<'info>,
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: runtime instruction sysvar checked by address.
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn run<'info>(
    ctx: Context<'_, '_, '_, 'info, Probe<'info>>,
    data: Vec<u8>,
    flags: Vec<u8>,
) -> Result<()> {
    let message = verified_ed25519_message(
        &ctx.accounts.instructions.to_account_info(),
        ctx.accounts.quote_authority.key(),
    )?;
    let seal =
        QuoteAuthorizationV1::try_from_slice(&message).map_err(|_| VaultError::QuoteSignature)?;
    let clock = Clock::get()?;
    require!(
        seal.domain == QUOTE_DOMAIN
            && seal.schema_version == 1
            && seal.builder_timestamp <= clock.unix_timestamp
            && clock.unix_timestamp < seal.expires_at
            && clock.slot < seal.expires_slot,
        VaultError::Expired
    );
    require!(
        data.len() >= 8 && data.len() <= 1024 && flags.len() >= 3 && flags.len() <= 128,
        VaultError::SwapAccount
    );
    let split = ctx
        .remaining_accounts
        .len()
        .checked_sub(usize::from(seal.alt_count))
        .ok_or(VaultError::SwapAccount)?;
    let (accounts, alts) = ctx.remaining_accounts.split_at(split);
    require!(accounts.len() == flags.len(), VaultError::SwapAccount);
    require!(
        seal.alt_contents_hash == crate::quote_alt::contents_hash(alts, clock.slot)?,
        VaultError::QuoteSignature
    );
    let expected = hashv(&[
        b"c3-jupiter-fork-context",
        crate::ID.as_ref(),
        ctx.accounts.authority.key().as_ref(),
        ctx.accounts.source.key().as_ref(),
        ctx.accounts.destination.key().as_ref(),
        ctx.accounts.source.mint.as_ref(),
        ctx.accounts.destination.mint.as_ref(),
        ctx.accounts.router.key().as_ref(),
    ])
    .to_bytes();
    require!(
        seal.context_hash == expected
            && seal.instruction_hash == hashv(&[b"c3-router-data-v1", &data]).to_bytes(),
        VaultError::SwapAuthorization
    );
    // Explicit diagnostic-only policy, not a deployed/governance-approved
    // registry. Reuse the exact canonical role/meta validator, not a weaker
    // copy of its account checks. Unknown DEXes fail here before invocation.
    let mut programs = [Pubkey::default(); 16];
    programs[..4].copy_from_slice(&[
        ctx.accounts.router.key(),
        crate::whirlpool_roles::PROGRAM,
        anchor_spl::token::ID,
        anchor_lang::solana_program::pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    ]);
    let registry = RouteProgramRegistry {
        schema_version: 1,
        vault: ctx.accounts.quote_authority.key(),
        governance: ctx.accounts.payer.key(),
        config_version: 1,
        revision: 1,
        config_hash: hashv(&[b"c3-isolated-registry-v1"]).to_bytes(),
        enabled: true,
        activation_slot: 0,
        expiry_slot: u64::MAX,
        program_count: 4,
        programs,
        bump: 0,
    };
    let (actual_metas_hash, metas) = account_metas_hash(
        accounts,
        &flags,
        &registry,
        ctx.accounts.authority.key(),
        ctx.accounts.source.key(),
        ctx.accounts.destination.key(),
        ctx.accounts.router.key(),
    )?;
    require!(
        seal.account_metas_hash == actual_metas_hash,
        VaultError::SwapAuthorization
    );
    require!(
        seal.input_amount > 0
            && seal.quoted_output > 0
            && seal.slippage_bps > 0
            && seal.slippage_bps <= MAX_SLIPPAGE_BPS
            && seal.minimum_output
                >= ((u128::from(seal.quoted_output) * u128::from(TOTAL_BPS - seal.slippage_bps))
                    / u128::from(TOTAL_BPS)) as u64
            && seal.minimum_output <= seal.quoted_output,
        VaultError::MinimumOutput
    );
    require!(
        ctx.accounts.source.delegate.is_none()
            && ctx.accounts.source.close_authority.is_none()
            && ctx.accounts.destination.delegate.is_none()
            && ctx.accounts.destination.close_authority.is_none(),
        VaultError::SwapAccount
    );
    let (before_source, before_dest) =
        (ctx.accounts.source.amount, ctx.accounts.destination.amount);
    let bump = [ctx.bumps.authority];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    let mut infos = accounts.to_vec();
    infos.push(ctx.accounts.router.to_account_info());
    invoke_signed(
        &Instruction {
            program_id: ctx.accounts.router.key(),
            accounts: metas,
            data,
        },
        &infos,
        &[seeds],
    )?;
    ctx.accounts.source.reload()?;
    ctx.accounts.destination.reload()?;
    require!(
        ctx.accounts.source.owner == ctx.accounts.authority.key()
            && ctx.accounts.destination.owner == ctx.accounts.authority.key()
            && ctx.accounts.source.delegate.is_none()
            && ctx.accounts.source.close_authority.is_none()
            && ctx.accounts.destination.delegate.is_none()
            && ctx.accounts.destination.close_authority.is_none(),
        VaultError::SwapEffects
    );
    let debit = before_source
        .checked_sub(ctx.accounts.source.amount)
        .ok_or(VaultError::SwapEffects)?;
    let credit = ctx
        .accounts
        .destination
        .amount
        .checked_sub(before_dest)
        .ok_or(VaultError::SwapEffects)?;
    require!(
        debit == seal.input_amount && credit >= seal.minimum_output,
        VaultError::SwapEffects
    );
    msg!(
        "ISOLATED_JUPITER_CPI debit={} credit={}; NOT_MAINNET_SETTLEMENT",
        debit,
        credit
    );
    Ok(())
}
