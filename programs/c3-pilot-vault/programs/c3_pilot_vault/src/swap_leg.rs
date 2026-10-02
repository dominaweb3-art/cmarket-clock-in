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
        ed25519_program,
        hash::hashv,
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
        program_pack::Pack,
        sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
    },
};
use anchor_spl::token::spl_token;
use std::{collections::BTreeMap, str::FromStr};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AuthorizeSwapArgs {
    pub idempotency: [u8; 32],
    pub quote_id: [u8; 32],
}

/// Borsh/Anchor fixed-order bytes are the only signed message. No JSON or
/// caller-supplied digest is accepted as an authorization substitute.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct QuoteAuthorizationV1 {
    pub domain: [u8; 16],
    pub schema_version: u8,
    pub context_hash: [u8; 32],
    pub quote_id: [u8; 32],
    pub nonce: [u8; 32],
    pub input_amount: u64,
    pub quoted_output: u64,
    pub slippage_bps: u16,
    pub minimum_output: u64,
    pub route_hash: [u8; 32],
    pub instruction_hash: [u8; 32],
    pub account_metas_hash: [u8; 32],
    pub alt_count: u8,
    pub alt_contents_hash: [u8; 32],
    pub builder_timestamp: i64,
    pub builder_slot: u64,
    pub expires_at: i64,
    pub expires_slot: u64,
}

fn quote_context_hash(
    c: &VaultConfig,
    c_key: Pubkey,
    registry: &RouteProgramRegistry,
    registry_key: Pubkey,
    policy: &QuoteAuthorityPolicy,
    p: &SettlementPlan,
    p_key: Pubkey,
    leg: usize,
    source: Pubkey,
    destination: Pubkey,
    router: Pubkey,
) -> [u8; 32] {
    hashv(&[
        b"c3-quote-context-v1",
        &QUOTE_DOMAIN,
        &policy.genesis_hash,
        c_key.as_ref(),
        &c.config_version.to_le_bytes(),
        registry_key.as_ref(),
        &registry.revision.to_le_bytes(),
        &registry.config_hash,
        p_key.as_ref(),
        &p.revision.to_le_bytes(),
        p.intent.as_ref(),
        p.wallet.as_ref(),
        &[leg as u8],
        &[p.direction],
        p.input_mints[leg].as_ref(),
        p.output_mints[leg].as_ref(),
        source.as_ref(),
        destination.as_ref(),
        router.as_ref(),
        &policy.revision.to_le_bytes(),
    ])
    .to_bytes()
}

pub(crate) fn verified_ed25519_message(
    sysvar_account: &AccountInfo,
    expected_key: Pubkey,
) -> Result<Vec<u8>> {
    let current = usize::from(load_current_index_checked(sysvar_account)?);
    require!(current > 0, VaultError::QuoteSignature);
    let ix = load_instruction_at_checked(current - 1, sysvar_account)?;
    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        VaultError::QuoteSignature
    );
    require!(ix.accounts.is_empty(), VaultError::QuoteSignature);
    let data = ix.data;
    // One signature; signature, public key and message are contiguous and
    // wholly local to this instruction. u16::MAX is Solana's local index.
    require!(
        data.len() >= 112 && data[0] == 1 && data[1] == 0,
        VaultError::QuoteSignature
    );
    let read = |offset: usize| -> u16 { u16::from_le_bytes([data[offset], data[offset + 1]]) };
    let signature_offset = usize::from(read(2));
    let signature_ix = read(4);
    let key_offset = usize::from(read(6));
    let key_ix = read(8);
    let message_offset = usize::from(read(10));
    let message_size = usize::from(read(12));
    let message_ix = read(14);
    require!(
        signature_ix == u16::MAX && key_ix == u16::MAX && message_ix == u16::MAX,
        VaultError::QuoteSignature
    );
    require!(
        signature_offset == 48 && key_offset == 16 && message_offset == 112,
        VaultError::QuoteSignature
    );
    let end = message_offset
        .checked_add(message_size)
        .ok_or(VaultError::QuoteSignature)?;
    require!(
        end == data.len() && message_size > 0 && message_size <= 900,
        VaultError::QuoteSignature
    );
    require!(
        data[16..48] == expected_key.to_bytes(),
        VaultError::QuoteSignature
    );
    Ok(data[112..end].to_vec())
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
        &a.quote_policy_revision.to_le_bytes(),
        &a.quote_payload_hash,
        a.quote_receipt.as_ref(),
        &a.quote_expires_slot.to_le_bytes(),
        &a.expected_revision.to_le_bytes(),
        &a.input_amount.to_le_bytes(),
        &a.quoted_output.to_le_bytes(),
        &a.minimum_output.to_le_bytes(),
        &a.max_slippage_bps.to_le_bytes(),
        &a.expires_at.to_le_bytes(),
        &a.route_fingerprint,
        &a.instruction_hash,
        &a.account_metas_hash,
        &[a.alt_count],
        &a.alt_contents_hash,
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
    let policy = &ctx.accounts.policy;
    let clock = Clock::get()?;
    require!(
        policy.schema_version == 1
            && policy.enabled
            && policy.revision > 0
            && policy.vault == c.key()
            && policy.governance == c.governance
            && policy.config_version == c.config_version
            && policy.authority != Pubkey::default()
            && policy.genesis_hash != [0; 32]
            && policy.domain == QUOTE_DOMAIN,
        VaultError::QuotePolicy
    );
    let signed_bytes = verified_ed25519_message(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        policy.authority,
    )?;
    let seal = QuoteAuthorizationV1::try_from_slice(&signed_bytes)
        .map_err(|_| VaultError::QuoteSignature)?;
    require!(
        p.executed_bitmap == 0 || p.executed_bitmap == 1 || p.executed_bitmap == 3,
        VaultError::InvalidLeg
    );
    let leg =
        usize::try_from(p.executed_bitmap.count_ones()).map_err(|_| VaultError::InvalidLeg)?;
    require!(
        seal.domain == QUOTE_DOMAIN
            && seal.schema_version == 1
            && seal.context_hash
                == quote_context_hash(
                    c,
                    c.key(),
                    &ctx.accounts.registry,
                    ctx.accounts.registry.key(),
                    policy,
                    p,
                    p.key(),
                    leg,
                    ctx.accounts.source.key(),
                    ctx.accounts.destination.key(),
                    reviewed_router()?,
                ),
        VaultError::QuoteSignature
    );
    require!(
        seal.quote_id == args.quote_id
            && seal.nonce != [0; 32]
            && seal.quote_id == hashv(&[b"c3-quote-id-v1", &seal.nonce]).to_bytes(),
        VaultError::QuoteReplay
    );
    // Tables are evidence, not CPI accounts. Execution verifies their contents
    // again and independently binds every actual resolved AccountInfo.
    require!(
        usize::from(seal.alt_count) == ctx.remaining_accounts.len()
            && seal.alt_contents_hash
                == crate::quote_alt::contents_hash(ctx.remaining_accounts, clock.slot)?,
        VaultError::QuoteSignature
    );
    let age = now
        .checked_sub(seal.builder_timestamp)
        .ok_or(VaultError::Expired)?;
    let lifetime = seal
        .expires_at
        .checked_sub(seal.builder_timestamp)
        .ok_or(VaultError::Expired)?;
    require!(
        seal.builder_slot <= clock.slot
            && seal.expires_slot > clock.slot
            && seal.builder_timestamp <= now
            && age <= policy.max_age_seconds
            && lifetime <= policy.max_age_seconds
            && seal.slippage_bps <= policy.max_slippage_bps,
        VaultError::Expired
    );
    require_eq!(p.schema_version, 2, VaultError::InvalidPlan);
    require_eq!(p.executed_bitmap, (1u8 << leg) - 1, VaultError::InvalidLeg);
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
        seal.builder_timestamp <= now && age <= MAX_QUOTE_AGE_SECONDS,
        VaultError::Expired
    );
    require!(
        seal.expires_at > now
            && seal.expires_at <= p.expires_at
            && lifetime <= MAX_QUOTE_AGE_SECONDS,
        VaultError::Expired
    );
    require!(
        seal.slippage_bps > 0
            && seal.slippage_bps <= p.max_slippage_bps
            && seal.slippage_bps <= MAX_SLIPPAGE_BPS,
        VaultError::InvalidPlan
    );
    require!(
        seal.input_amount > 0 && seal.quoted_output > 0,
        VaultError::InvalidAmount
    );
    let derived_minimum = u128::from(seal.quoted_output)
        .checked_mul(u128::from(TOTAL_BPS - seal.slippage_bps))
        .ok_or(VaultError::Math)?
        / u128::from(TOTAL_BPS);
    require!(
        derived_minimum > 0 && derived_minimum <= u128::from(u64::MAX),
        VaultError::MinimumOutput
    );
    require!(
        seal.minimum_output >= derived_minimum as u64 && seal.minimum_output <= seal.quoted_output,
        VaultError::MinimumOutput
    );
    require!(
        seal.minimum_output >= p.minimum_outputs[leg],
        VaultError::MinimumOutput
    );
    require!(
        args.idempotency != [0; 32]
            && seal.quote_id != [0; 32]
            && seal.route_hash != [0; 32]
            && seal.instruction_hash != [0; 32]
            && seal.account_metas_hash != [0; 32],
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
        require_eq!(seal.input_amount, expected, VaultError::InvalidAmount);
        require_eq!(p.input_budgets[leg], expected, VaultError::InvalidAmount);
    } else {
        require_eq!(
            p.direction,
            plan_direction::REDEMPTION,
            VaultError::InvalidPlan
        );
        require_eq!(
            seal.input_amount,
            p.input_budgets[leg],
            VaultError::InvalidAmount
        );
    }
    require!(
        ctx.accounts.source.amount >= seal.input_amount,
        VaultError::InvalidAmount
    );

    let auth = &mut ctx.accounts.authorization;
    auth.schema_version = 1;
    auth.plan = p.key();
    auth.config_version = c.config_version;
    auth.direction = p.direction;
    auth.leg = leg as u8;
    auth.expected_revision = p.revision;
    auth.router_program = router;
    auth.route_registry_version = ctx.accounts.registry.revision;
    auth.route_registry_hash = ctx.accounts.registry.config_hash;
    auth.quote_policy_revision = policy.revision;
    auth.quote_payload_hash = hashv(&[&signed_bytes]).to_bytes();
    auth.quote_receipt = ctx.accounts.quote_receipt.key();
    auth.quote_expires_slot = seal.expires_slot;
    auth.source = ctx.accounts.source.key();
    auth.destination = ctx.accounts.destination.key();
    auth.input_mint = p.input_mints[leg];
    auth.output_mint = p.output_mints[leg];
    auth.input_amount = seal.input_amount;
    auth.quoted_output = seal.quoted_output;
    auth.minimum_output = seal.minimum_output;
    auth.max_slippage_bps = seal.slippage_bps;
    auth.quote_created_at = seal.builder_timestamp;
    auth.quote_fingerprint = seal.quote_id;
    auth.route_fingerprint = seal.route_hash;
    auth.instruction_hash = seal.instruction_hash;
    auth.account_metas_hash = seal.account_metas_hash;
    auth.alt_count = seal.alt_count;
    auth.alt_contents_hash = seal.alt_contents_hash;
    auth.expires_at = seal.expires_at;
    auth.idempotency = args.idempotency;
    auth.consumed = false;
    auth.bump = ctx.bumps.authorization;

    let receipt = &mut ctx.accounts.quote_receipt;
    receipt.quote_id = seal.quote_id;
    receipt.nonce = seal.nonce;
    receipt.payload_hash = auth.quote_payload_hash;
    receipt.plan = p.key();
    receipt.authorization = auth.key();
    receipt.consumed = false;
    receipt.bump = ctx.bumps.quote_receipt;

    p.router_program = router;
    p.route_hashes[leg] = seal.route_hash;
    p.minimum_outputs[leg] = seal.minimum_output;
    p.active_swap_authorization = commitment(auth.key(), auth);
    p.active_swap_expires_at = seal.expires_at;
    emit!(RouteRegistryEvent {
        vault: c.key(),
        revision: ctx.accounts.registry.revision,
        config_hash: ctx.accounts.registry.config_hash,
        action: 4,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

pub(crate) fn account_metas_hash<'info>(
    accounts: &[AccountInfo<'info>],
    flags: &[u8],
    registry: &RouteProgramRegistry,
    authority: Pubkey,
    source: Pubkey,
    destination: Pubkey,
    router: Pubkey,
) -> Result<([u8; 32], Vec<AccountMeta>)> {
    require!(
        accounts.len() >= 3 && accounts.len() <= 128 && flags.len() == accounts.len(),
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
        if key == router {
            require!(
                account.executable && !account.is_writable && !account.is_signer,
                VaultError::SwapAccount
            );
        }
        let flag = flags[index];
        require!(flag <= 3, VaultError::SwapAccount);
        let signer = flag & 1 != 0;
        let writable = flag & 2 != 0;
        require!(!signer || key == authority, VaultError::SwapAccount);
        require!(!account.is_signer, VaultError::SwapAccount);
        require!(!writable || account.is_writable, VaultError::SwapAccount);
        if let Some(previous) = seen.insert(
            key,
            (account.is_signer, account.is_writable, account.executable),
        ) {
            require!(
                previous == (account.is_signer, account.is_writable, account.executable),
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
                require!(
                    parsed.delegate.is_none() && parsed.close_authority.is_none(),
                    VaultError::SwapAccount
                );
                #[cfg(feature = "local-mock")]
                {
                    let (pool_authority, _) =
                        Pubkey::find_program_address(&[b"liquidity"], &router);
                    require_keys_eq!(parsed.owner, pool_authority, VaultError::SwapAccount);
                }
                #[cfg(not(feature = "local-mock"))]
                {
                    require!(
                        registry.programs[..usize::from(registry.program_count)]
                            .contains(&crate::whirlpool_roles::PROGRAM),
                        VaultError::RouteRegistry
                    );
                    let pool = accounts
                        .iter()
                        .find(|candidate| candidate.key() == parsed.owner)
                        .ok_or(VaultError::SwapAccount)?;
                    let source_info = accounts
                        .iter()
                        .find(|candidate| candidate.key() == source)
                        .ok_or(VaultError::SwapAccount)?;
                    let destination_info = accounts
                        .iter()
                        .find(|candidate| candidate.key() == destination)
                        .ok_or(VaultError::SwapAccount)?;
                    let input = spl_token::state::Account::unpack(&source_info.try_borrow_data()?)
                        .map_err(|_| VaultError::SwapAccount)?;
                    let output =
                        spl_token::state::Account::unpack(&destination_info.try_borrow_data()?)
                            .map_err(|_| VaultError::SwapAccount)?;
                    crate::whirlpool_roles::pool_token_role(
                        pool.key(),
                        *pool.owner,
                        &pool.try_borrow_data()?,
                        key,
                        parsed.owner,
                        parsed.mint,
                        input.mint,
                        output.mint,
                    )?;
                }
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
        bytes.push(flag);
        bytes.push(u8::from(account.is_writable));
        bytes.push(u8::from(account.executable));
        metas.push(if writable {
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
            b"c3-ordered-metas-v3",
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
    flags: Vec<u8>,
) -> Result<()> {
    require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
    require!(!ctx.accounts.config.paused, VaultError::Paused);
    require!(
        ctx.accounts.keeper.key() == ctx.accounts.config.keeper
            || ctx.accounts.keeper.key() == ctx.accounts.plan.wallet,
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
        !a.consumed
            && now < a.expires_at
            && now < p.expires_at
            && Clock::get()?.slot < a.quote_expires_slot,
        VaultError::Expired
    );
    require!(
        a.quote_created_at <= now
            && now
                .checked_sub(a.quote_created_at)
                .ok_or(VaultError::Expired)?
                <= MAX_QUOTE_AGE_SECONDS
            && p.active_swap_expires_at == a.expires_at,
        VaultError::Expired
    );
    require!(a.schema_version == 1, VaultError::InvalidConfig);
    require!(
        ctx.accounts.policy.enabled
            && ctx.accounts.policy.schema_version == 1
            && ctx.accounts.policy.config_version == ctx.accounts.config.config_version
            && ctx.accounts.policy.revision == a.quote_policy_revision,
        VaultError::QuotePolicy
    );
    require!(
        !ctx.accounts.quote_receipt.consumed
            && ctx.accounts.quote_receipt.payload_hash == a.quote_payload_hash
            && a.quote_receipt == ctx.accounts.quote_receipt.key(),
        VaultError::QuoteReplay
    );
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
    require_eq!(p.schema_version, 2, VaultError::InvalidPlan);
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
    let split = ctx
        .remaining_accounts
        .len()
        .checked_sub(usize::from(a.alt_count))
        .ok_or(VaultError::SwapAccount)?;
    let (router_accounts, lookup_accounts) = ctx.remaining_accounts.split_at(split);
    require!(
        a.alt_contents_hash
            == crate::quote_alt::contents_hash(lookup_accounts, Clock::get()?.slot)?,
        VaultError::SwapAuthorization
    );
    let (meta_hash, metas) = account_metas_hash(
        router_accounts,
        &flags,
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
    let mut infos = router_accounts.to_vec();
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
    ctx.accounts.quote_receipt.consumed = true;
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
