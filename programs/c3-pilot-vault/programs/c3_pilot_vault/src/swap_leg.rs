//! Fail-closed vault-authorized CPI boundary. Production capability is an
//! immutable false constant; only a separately compiled local mock can run it.
use crate::{
    constants::*,
    errors::VaultError,
    events::{RouteRegistryEvent, SettlementLegEvent},
    state::*,
};
use anchor_lang::{
    prelude::*,
    solana_program::{
        hash::hashv,
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
        program_pack::Pack,
    },
};
use anchor_spl::token::spl_token;
use std::{collections::BTreeMap, str::FromStr};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AuthorizeSwapArgs {
    pub leg: u8,
    pub expected_revision: u64,
    pub input_amount: u64,
    pub quoted_output: u64,
    pub minimum_output: u64,
    pub max_slippage_bps: u16,
    pub quote_created_at: i64,
    pub expires_at: i64,
    pub quote_fingerprint: [u8; 32],
    pub route_fingerprint: [u8; 32],
    pub instruction_hash: [u8; 32],
    pub account_metas_hash: [u8; 32],
    pub idempotency: [u8; 32],
}

pub(crate) fn reviewed_router() -> Result<Pubkey> {
    Pubkey::from_str(REVIEWED_ROUTER_ID).map_err(|_| VaultError::InvalidConfig.into())
}

fn commitment(auth_key: Pubkey, a: &SwapLegAuthorization) -> [u8; 32] {
    hashv(&[
        b"c3-swap-authorization-v1",
        auth_key.as_ref(),
        a.plan.as_ref(),
        a.router_program.as_ref(),
        &a.route_registry_version.to_le_bytes(),
        &a.route_registry_hash,
        &a.expected_revision.to_le_bytes(),
        &a.input_amount.to_le_bytes(),
        &a.quoted_output.to_le_bytes(),
        &a.minimum_output.to_le_bytes(),
        &a.max_slippage_bps.to_le_bytes(),
        &a.expires_at.to_le_bytes(),
        &a.route_fingerprint,
        &a.instruction_hash,
        &a.account_metas_hash,
        &a.idempotency,
    ])
    .to_bytes()
}

fn active_registry(
    r: &RouteProgramRegistry,
    c: &VaultConfig,
    vault: Pubkey,
    slot: u64,
    router: Pubkey,
) -> Result<()> {
    require!(
        r.schema_version == 1
            && r.vault == vault
            && r.governance == c.governance
            && r.config_version == c.config_version
            && r.enabled
            && r.revision > 0
            && r.config_hash != [0; 32]
            && r.activation_slot <= slot
            && slot < r.expiry_slot
            && usize::from(r.program_count) <= MAX_ROUTE_PROGRAMS
            && r.program_count > 0
            && r.programs[..usize::from(r.program_count)].contains(&router),
        VaultError::RouteRegistry
    );
    Ok(())
}

fn assert_vault_token(
    account: &anchor_spl::token::TokenAccount,
    expected_mint: Pubkey,
    authority: Pubkey,
) -> Result<()> {
    require_keys_eq!(account.mint, expected_mint, VaultError::TokenMismatch);
    require_keys_eq!(account.owner, authority, VaultError::TokenMismatch);
    require!(account.delegate.is_none(), VaultError::SwapAccount);
    require!(account.close_authority.is_none(), VaultError::SwapAccount);
    Ok(())
}

pub fn authorize(
    ctx: Context<crate::instructions::AuthorizeSwapLeg>,
    args: AuthorizeSwapArgs,
) -> Result<()> {
    require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
    let c = &ctx.accounts.config;
    let p = &mut ctx.accounts.plan;
    let now = Clock::get()?.unix_timestamp;
    require!(!c.paused, VaultError::Paused);
    require_eq!(
        p.config_version,
        c.config_version,
        VaultError::InvalidConfig
    );
    require_eq!(p.wallet, c.allowlisted_owner, VaultError::Unauthorized);
    require!(args.leg < 3, VaultError::InvalidLeg);
    let leg = usize::from(args.leg);
    require_eq!(p.revision, args.expected_revision, VaultError::InvalidState);
    require_eq!(
        p.executed_bitmap,
        (1u8 << args.leg) - 1,
        VaultError::InvalidLeg
    );
    require!(
        p.active_swap_authorization == [0; 32] || p.active_swap_expires_at <= now,
        VaultError::InvalidState
    );
    require!(
        p.lifecycle == plan_lifecycle::FUNDED
            || p.lifecycle == plan_lifecycle::BUYING
            || p.lifecycle == plan_lifecycle::REDEMPTION_REQUESTED
            || p.lifecycle == plan_lifecycle::SELLING,
        VaultError::InvalidState
    );
    require!(
        args.quote_created_at <= now && now - args.quote_created_at <= MAX_QUOTE_AGE_SECONDS,
        VaultError::Expired
    );
    require!(
        args.expires_at > now
            && args.expires_at <= p.expires_at
            && args.expires_at - args.quote_created_at <= MAX_QUOTE_AGE_SECONDS,
        VaultError::Expired
    );
    require!(
        args.max_slippage_bps > 0
            && args.max_slippage_bps <= p.max_slippage_bps
            && args.max_slippage_bps <= MAX_SLIPPAGE_BPS,
        VaultError::InvalidPlan
    );
    require!(
        args.input_amount > 0 && args.quoted_output > 0,
        VaultError::InvalidAmount
    );
    let derived_minimum = u128::from(args.quoted_output)
        .checked_mul(u128::from(TOTAL_BPS - args.max_slippage_bps))
        .ok_or(VaultError::Math)?
        / u128::from(TOTAL_BPS);
    require!(
        derived_minimum > 0 && derived_minimum <= u128::from(u64::MAX),
        VaultError::MinimumOutput
    );
    require_eq!(
        args.minimum_output,
        derived_minimum as u64,
        VaultError::MinimumOutput
    );
    require!(
        args.minimum_output >= p.minimum_outputs[leg],
        VaultError::MinimumOutput
    );
    require!(
        args.idempotency != [0; 32]
            && args.quote_fingerprint != [0; 32]
            && args.route_fingerprint != [0; 32]
            && args.instruction_hash != [0; 32]
            && args.account_metas_hash != [0; 32],
        VaultError::SwapAuthorization
    );
    let router = reviewed_router()?;
    active_registry(
        &ctx.accounts.registry,
        c,
        c.key(),
        Clock::get()?.slot,
        router,
    )?;
    require_keys_eq!(
        ctx.accounts.router_program.key(),
        router,
        VaultError::SwapAccount
    );
    require_keys_eq!(
        ctx.accounts.source.key(),
        p.source_accounts[leg],
        VaultError::SwapAccount
    );
    require_keys_eq!(
        ctx.accounts.destination.key(),
        p.destination_accounts[leg],
        VaultError::SwapAccount
    );
    require_keys_neq!(
        ctx.accounts.source.key(),
        ctx.accounts.destination.key(),
        VaultError::SwapAccount
    );
    assert_vault_token(
        &ctx.accounts.source,
        p.input_mints[leg],
        ctx.accounts.vault_authority.key(),
    )?;
    assert_vault_token(
        &ctx.accounts.destination,
        p.output_mints[leg],
        ctx.accounts.vault_authority.key(),
    )?;
    if p.direction == plan_direction::DEPOSIT {
        let expected = u64::from(p.weights[leg])
            .checked_mul(p.amount)
            .ok_or(VaultError::Math)?
            / u64::from(TOTAL_BPS);
        require_eq!(args.input_amount, expected, VaultError::InvalidAmount);
    } else {
        require_eq!(
            p.direction,
            plan_direction::REDEMPTION,
            VaultError::InvalidPlan
        );
        require_eq!(
            args.input_amount,
            ctx.accounts.source.amount,
            VaultError::InvalidAmount
        );
    }
    require!(
        ctx.accounts.source.amount >= args.input_amount,
        VaultError::InvalidAmount
    );

    let auth = &mut ctx.accounts.authorization;
    auth.schema_version = 1;
    auth.plan = p.key();
    auth.config_version = c.config_version;
    auth.direction = p.direction;
    auth.leg = args.leg;
    auth.expected_revision = args.expected_revision;
    auth.router_program = router;
    auth.route_registry_version = ctx.accounts.registry.revision;
    auth.route_registry_hash = ctx.accounts.registry.config_hash;
    auth.source = ctx.accounts.source.key();
    auth.destination = ctx.accounts.destination.key();
    auth.input_mint = p.input_mints[leg];
    auth.output_mint = p.output_mints[leg];
    auth.input_amount = args.input_amount;
    auth.quoted_output = args.quoted_output;
    auth.minimum_output = args.minimum_output;
    auth.max_slippage_bps = args.max_slippage_bps;
    auth.quote_created_at = args.quote_created_at;
    auth.quote_fingerprint = args.quote_fingerprint;
    auth.route_fingerprint = args.route_fingerprint;
    auth.instruction_hash = args.instruction_hash;
    auth.account_metas_hash = args.account_metas_hash;
    auth.expires_at = args.expires_at;
    auth.idempotency = args.idempotency;
    auth.consumed = false;
    auth.bump = ctx.bumps.authorization;

    p.router_program = router;
    p.route_hashes[leg] = args.route_fingerprint;
    p.minimum_outputs[leg] = args.minimum_output;
    p.active_swap_authorization = commitment(auth.key(), auth);
    p.active_swap_expires_at = args.expires_at;
    emit!(RouteRegistryEvent {
        vault: c.key(),
        revision: ctx.accounts.registry.revision,
        config_hash: ctx.accounts.registry.config_hash,
        action: 4,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

fn account_metas_hash<'info>(
    accounts: &[AccountInfo<'info>],
    registry: &RouteProgramRegistry,
    authority: Pubkey,
    source: Pubkey,
    destination: Pubkey,
    router: Pubkey,
) -> Result<([u8; 32], Vec<AccountMeta>)> {
    require!(
        accounts.len() >= 3 && accounts.len() <= 128,
        VaultError::SwapAccount
    );
    let mut bytes = Vec::with_capacity(2 + accounts.len() * 39);
    bytes.extend_from_slice(&(accounts.len() as u16).to_le_bytes());
    let mut metas = Vec::with_capacity(accounts.len());
    let mut seen = BTreeMap::new();
    let (mut found_authority, mut found_source, mut found_destination) = (false, false, false);
    require!(
        authority != source && authority != destination && source != destination,
        VaultError::SwapAccount
    );
    for (index, account) in accounts.iter().enumerate() {
        let key = account.key();
        require!(key != router, VaultError::SwapAccount);
        let signer = key == authority;
        require!(!account.is_signer || signer, VaultError::SwapAccount);
        if let Some(previous) = seen.insert(key, (signer, account.is_writable, account.executable))
        {
            require!(
                previous == (signer, account.is_writable, account.executable),
                VaultError::SwapAccount
            );
        }
        if account.executable {
            require!(
                registry.programs[..usize::from(registry.program_count)].contains(&key),
                VaultError::RouteRegistry
            );
            require!(!account.is_writable && !signer, VaultError::SwapAccount);
        }
        if signer {
            require!(!account.is_writable, VaultError::SwapAccount);
            found_authority = true;
        }
        if key == source {
            require!(account.is_writable, VaultError::SwapAccount);
            found_source = true;
        }
        if key == destination {
            require!(account.is_writable, VaultError::SwapAccount);
            found_destination = true;
        }
        if account.owner == &spl_token::ID && account.data_len() == spl_token::state::Account::LEN {
            let parsed = spl_token::state::Account::unpack(&account.try_borrow_data()?)
                .map_err(|_| VaultError::SwapAccount)?;
            require!(
                parsed.owner != authority || key == source || key == destination,
                VaultError::SwapAccount
            );
            if account.is_writable && key != source && key != destination {
                let (pool_authority, _) = Pubkey::find_program_address(&[b"liquidity"], &router);
                require_keys_eq!(parsed.owner, pool_authority, VaultError::SwapAccount);
            }
        }
        // The governed route registry bounds writable DEX accounts as well as
        // executable programs. This is NOT a substitute for signed quote or
        // post-CPI effect validation; production stays immutable-disabled.
        if account.is_writable && key != source && key != destination {
            require!(
                *account.owner == spl_token::ID
                    || registry.programs[..usize::from(registry.program_count)]
                        .contains(account.owner),
                VaultError::SwapAccount
            );
            if *account.owner == spl_token::ID {
                require_eq!(
                    account.data_len(),
                    spl_token::state::Account::LEN,
                    VaultError::SwapAccount
                );
            }
            require!(
                key != authority && key != registry.governance && key != registry.vault,
                VaultError::SwapAccount
            );
        }
        bytes.extend_from_slice(&(index as u16).to_le_bytes());
        bytes.extend_from_slice(key.as_ref());
        bytes.push(u8::from(signer));
        bytes.push(u8::from(account.is_writable));
        bytes.push(u8::from(account.executable));
        metas.push(if account.is_writable {
            AccountMeta::new(key, signer)
        } else {
            AccountMeta::new_readonly(key, signer)
        });
    }
    require!(
        found_authority && found_source && found_destination,
        VaultError::SwapAccount
    );
    Ok((
        hashv(&[
            b"c3-ordered-metas-v2",
            &registry.revision.to_le_bytes(),
            &registry.config_hash,
            &bytes,
        ])
        .to_bytes(),
        metas,
    ))
}

pub fn execute<'info>(
    ctx: Context<'_, '_, '_, 'info, crate::instructions::ExecuteSwapLeg<'info>>,
    instruction_data: Vec<u8>,
) -> Result<()> {
    require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
    require!(!ctx.accounts.config.paused, VaultError::Paused);
    require_keys_eq!(
        ctx.accounts.keeper.key(),
        ctx.accounts.config.keeper,
        VaultError::Unauthorized
    );
    require!(
        instruction_data.len() >= 8 && instruction_data.len() <= 1024,
        VaultError::SwapAccount
    );
    let a = &mut ctx.accounts.authorization;
    let p = &mut ctx.accounts.plan;
    let now = Clock::get()?.unix_timestamp;
    require!(
        !a.consumed && now < a.expires_at && now < p.expires_at,
        VaultError::Expired
    );
    require!(
        a.quote_created_at <= now
            && now - a.quote_created_at <= MAX_QUOTE_AGE_SECONDS
            && p.active_swap_expires_at == a.expires_at,
        VaultError::Expired
    );
    require!(a.schema_version == 1, VaultError::InvalidConfig);
    active_registry(
        &ctx.accounts.registry,
        &ctx.accounts.config,
        ctx.accounts.config.key(),
        Clock::get()?.slot,
        a.router_program,
    )?;
    require!(
        a.route_registry_version == ctx.accounts.registry.revision
            && a.route_registry_hash == ctx.accounts.registry.config_hash,
        VaultError::RouteRegistry
    );
    require_eq!(
        a.config_version,
        ctx.accounts.config.config_version,
        VaultError::InvalidConfig
    );
    require_eq!(
        p.config_version,
        ctx.accounts.config.config_version,
        VaultError::InvalidConfig
    );
    require_keys_eq!(
        p.wallet,
        ctx.accounts.config.allowlisted_owner,
        VaultError::Unauthorized
    );
    require_keys_eq!(
        a.router_program,
        reviewed_router()?,
        VaultError::SwapAccount
    );
    require_keys_eq!(p.router_program, a.router_program, VaultError::SwapAccount);
    require_eq!(a.direction, p.direction, VaultError::InvalidPlan);
    require_eq!(a.expected_revision, p.revision, VaultError::InvalidState);
    require!(a.leg < 3, VaultError::InvalidLeg);
    let leg = usize::from(a.leg);
    require_eq!(
        p.executed_bitmap,
        (1u8 << a.leg) - 1,
        VaultError::InvalidLeg
    );
    require!(
        p.active_swap_authorization == commitment(a.key(), a),
        VaultError::SwapAuthorization
    );
    require!(
        p.route_hashes[leg] == a.route_fingerprint,
        VaultError::SwapAuthorization
    );
    require_eq!(
        p.minimum_outputs[leg],
        a.minimum_output,
        VaultError::SwapAuthorization
    );
    require_keys_eq!(a.source, p.source_accounts[leg], VaultError::SwapAccount);
    require_keys_eq!(
        a.destination,
        p.destination_accounts[leg],
        VaultError::SwapAccount
    );
    require_keys_eq!(a.input_mint, p.input_mints[leg], VaultError::TokenMismatch);
    require_keys_eq!(
        a.output_mint,
        p.output_mints[leg],
        VaultError::TokenMismatch
    );
    require!(
        a.instruction_hash == hashv(&[b"c3-router-data-v1", &instruction_data]).to_bytes(),
        VaultError::SwapAuthorization
    );
    let (meta_hash, metas) = account_metas_hash(
        ctx.remaining_accounts,
        &ctx.accounts.registry,
        ctx.accounts.vault_authority.key(),
        a.source,
        a.destination,
        a.router_program,
    )?;
    require!(
        a.account_metas_hash == meta_hash,
        VaultError::SwapAuthorization
    );
    assert_vault_token(
        &ctx.accounts.source,
        a.input_mint,
        ctx.accounts.vault_authority.key(),
    )?;
    assert_vault_token(
        &ctx.accounts.destination,
        a.output_mint,
        ctx.accounts.vault_authority.key(),
    )?;
    let before_source = ctx.accounts.source.amount;
    let before_dest = ctx.accounts.destination.amount;
    require!(before_source >= a.input_amount, VaultError::InvalidAmount);
    let ix = Instruction {
        program_id: a.router_program,
        accounts: metas,
        data: instruction_data,
    };
    let bump = [ctx.accounts.config.authority_bump];
    let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    let mut infos = ctx.remaining_accounts.to_vec();
    infos.push(ctx.accounts.router_program.to_account_info());
    invoke_signed(&ix, &infos, &[seeds])?;
    ctx.accounts.source.reload()?;
    ctx.accounts.destination.reload()?;
    assert_vault_token(
        &ctx.accounts.source,
        a.input_mint,
        ctx.accounts.vault_authority.key(),
    )?;
    assert_vault_token(
        &ctx.accounts.destination,
        a.output_mint,
        ctx.accounts.vault_authority.key(),
    )?;
    let debit = before_source
        .checked_sub(ctx.accounts.source.amount)
        .ok_or(VaultError::SwapEffects)?;
    let credit = ctx
        .accounts
        .destination
        .amount
        .checked_sub(before_dest)
        .ok_or(VaultError::SwapEffects)?;
    require_eq!(debit, a.input_amount, VaultError::SwapEffects);
    require!(credit >= a.minimum_output, VaultError::MinimumOutput);
    crate::settlement_plan::record_leg(p, a.leg, debit, credit)?;
    p.active_swap_authorization = [0; 32];
    p.active_swap_expires_at = 0;
    a.consumed = true;
    emit!(SettlementLegEvent {
        version: 1,
        vault: p.vault,
        intent: p.intent,
        direction: p.direction,
        leg: a.leg,
        input: debit,
        output: credit,
        executed_bitmap: p.executed_bitmap,
        slot: Clock::get()?.slot
    });
    Ok(())
}
