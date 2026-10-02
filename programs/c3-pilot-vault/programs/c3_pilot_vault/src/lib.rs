use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::{
    token::{self, TransferChecked},
    token_2022::{self, Burn as Burn2022, MintTo as MintTo2022},
};

pub mod arithmetic;
pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
#[cfg(feature = "local-jupiter-probe")]
pub mod local_jupiter_probe;
#[cfg(feature = "local-mock")]
pub mod mock_local_only;
pub mod quote_alt;
pub mod settlement_plan;
pub mod state;
pub mod swap_leg;
pub mod token_validation;
pub mod transitions;
pub mod whirlpool_roles;

use arithmetic::*;
use constants::*;
use errors::VaultError;
use events::{emit_state, kind, QuotePolicyEvent, RouteRegistryEvent};
use instructions::*;
#[cfg(feature = "local-jupiter-probe")]
use local_jupiter_probe::*;
use state::*;
use token_validation::*;
use transitions::*;

declare_id!("AFVCPVUExRgftDsE88NUewCnFyG3gRpEmkUiAdzs5qhb");

#[program]
pub mod c3_pilot_vault {
    use super::*;

    /// Isolated cloned-state CPI experiment only. No production entrypoint,
    /// settlement-plan state, share issuance or Mainnet execution is enabled.
    #[cfg(feature = "local-jupiter-probe")]
    pub fn local_jupiter_probe<'info>(
        ctx: Context<'_, '_, '_, 'info, Probe<'info>>,
        instruction_data: Vec<u8>,
        flags: Vec<u8>,
    ) -> Result<()> {
        local_jupiter_probe::run(ctx, instruction_data, flags)
    }

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        keeper: Pubkey,
        config_version: u64,
        weights: [u16; 3],
        max_tvl: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.payer.key(),
            ctx.accounts.governance.key(),
            VaultError::Unauthorized
        );
        require!(
            keeper != Pubkey::default()
                && ctx.accounts.emergency.key() != Pubkey::default()
                && ctx.accounts.owner.key() != Pubkey::default(),
            VaultError::InvalidConfig
        );
        require_eq!(config_version, CONFIG_VERSION, VaultError::InvalidConfig);
        require!(
            weights == [BTC_BPS, ETH_BPS, SOL_BPS],
            VaultError::InvalidConfig
        );
        require_eq!(
            weights.iter().map(|x| *x as u32).sum::<u32>(),
            TOTAL_BPS as u32,
            VaultError::InvalidConfig
        );
        require_eq!(max_tvl, ONE_USDC, VaultError::InvalidConfig);
        let a = ctx.accounts.vault_authority.key();
        let mints = [
            ctx.accounts.usdc_mint.key(),
            ctx.accounts.btc_mint.key(),
            ctx.accounts.eth_mint.key(),
            ctx.accounts.wsol_mint.key(),
        ];
        distinct(&mints)?;
        require_eq!(
            ctx.accounts.usdc_mint.decimals,
            6,
            VaultError::InvalidConfig
        );
        share_mint(&ctx.accounts.share_mint, a)?;
        require_eq!(ctx.accounts.share_mint.supply, 0, VaultError::InvalidConfig);
        vault_token(&ctx.accounts.vault_usdc, &ctx.accounts.usdc_mint, a)?;
        vault_token(&ctx.accounts.vault_btc, &ctx.accounts.btc_mint, a)?;
        vault_token(&ctx.accounts.vault_eth, &ctx.accounts.eth_mint, a)?;
        vault_token(&ctx.accounts.vault_wsol, &ctx.accounts.wsol_mint, a)?;
        for balance in [
            ctx.accounts.vault_usdc.amount,
            ctx.accounts.vault_btc.amount,
            ctx.accounts.vault_eth.amount,
            ctx.accounts.vault_wsol.amount,
        ] {
            require_eq!(balance, 0, VaultError::InvalidConfig);
        }
        let c = &mut ctx.accounts.config;
        c.schema_version = SCHEMA_VERSION;
        c.config_version = CONFIG_VERSION;
        c.governance = ctx.accounts.governance.key();
        c.emergency = ctx.accounts.emergency.key();
        c.keeper = keeper;
        c.allowlisted_owner = ctx.accounts.owner.key();
        c.paused = true;
        c.usdc_mint = mints[0];
        c.btc_mint = mints[1];
        c.eth_mint = mints[2];
        c.wsol_mint = mints[3];
        c.share_mint = ctx.accounts.share_mint.key();
        c.vault_usdc = ctx.accounts.vault_usdc.key();
        c.vault_btc = ctx.accounts.vault_btc.key();
        c.vault_eth = ctx.accounts.vault_eth.key();
        c.vault_wsol = ctx.accounts.vault_wsol.key();
        c.btc_bps = BTC_BPS;
        c.eth_bps = ETH_BPS;
        c.sol_bps = SOL_BPS;
        c.max_tvl = ONE_USDC;
        c.max_deposit = ONE_USDC;
        c.deposit_counter = 0;
        c.redemption_counter = 0;
        c.total_shares_issued = 0;
        c.lifecycle = 0;
        c.authority_bump = ctx.bumps.vault_authority;
        c.reserved = [0; 64];
        emit_state(
            c.key(),
            Pubkey::default(),
            c.allowlisted_owner,
            kind::INITIALIZED,
            0,
        )
    }

    pub fn initialize_route_registry(ctx: Context<InitializeRouteRegistry>) -> Result<()> {
        let r = &mut ctx.accounts.registry;
        r.schema_version = 1;
        r.vault = ctx.accounts.config.key();
        r.governance = ctx.accounts.config.governance;
        r.config_version = ctx.accounts.config.config_version;
        r.revision = 0;
        r.config_hash = [0; 32];
        r.enabled = false;
        r.activation_slot = 0;
        r.expiry_slot = 0;
        r.program_count = 0;
        r.programs = [Pubkey::default(); MAX_ROUTE_PROGRAMS];
        r.bump = ctx.bumps.registry;
        emit!(RouteRegistryEvent {
            vault: r.vault,
            revision: r.revision,
            config_hash: r.config_hash,
            action: 1,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn initialize_quote_policy(ctx: Context<InitializeQuotePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        policy.schema_version = 1;
        policy.vault = ctx.accounts.config.key();
        policy.governance = ctx.accounts.config.governance;
        policy.config_version = ctx.accounts.config.config_version;
        policy.revision = 0;
        policy.authority = Pubkey::default();
        policy.enabled = false;
        policy.max_age_seconds = 0;
        policy.max_slippage_bps = 0;
        policy.genesis_hash = [0; 32];
        policy.domain = QUOTE_DOMAIN;
        policy.bump = ctx.bumps.policy;
        emit!(QuotePolicyEvent {
            vault: policy.vault,
            revision: 0,
            authority: policy.authority,
            enabled: false,
            action: 1,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn configure_quote_policy(
        ctx: Context<GovernQuotePolicy>,
        authority: Pubkey,
        genesis_hash: [u8; 32],
        max_age_seconds: i64,
        max_slippage_bps: u16,
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        require!(
            authority != Pubkey::default() && genesis_hash != [0; 32],
            VaultError::QuotePolicy
        );
        require!(
            max_age_seconds > 0 && max_age_seconds <= MAX_QUOTE_AGE_SECONDS,
            VaultError::QuotePolicy
        );
        require!(
            max_slippage_bps > 0 && max_slippage_bps <= MAX_SLIPPAGE_BPS,
            VaultError::QuotePolicy
        );
        let policy = &mut ctx.accounts.policy;
        require!(
            policy.schema_version == 1
                && policy.config_version == ctx.accounts.config.config_version,
            VaultError::QuotePolicy
        );
        policy.revision = policy.revision.checked_add(1).ok_or(VaultError::Math)?;
        policy.authority = authority;
        policy.genesis_hash = genesis_hash;
        policy.max_age_seconds = max_age_seconds;
        policy.max_slippage_bps = max_slippage_bps;
        policy.enabled = true;
        emit!(QuotePolicyEvent {
            vault: policy.vault,
            revision: policy.revision,
            authority,
            enabled: true,
            action: 2,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn disable_quote_policy(ctx: Context<GovernQuotePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        require!(policy.schema_version == 1, VaultError::QuotePolicy);
        policy.revision = policy.revision.checked_add(1).ok_or(VaultError::Math)?;
        policy.enabled = false;
        emit!(QuotePolicyEvent {
            vault: policy.vault,
            revision: policy.revision,
            authority: policy.authority,
            enabled: false,
            action: 3,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn replace_route_registry(
        ctx: Context<GovernRouteRegistry>,
        programs: Vec<Pubkey>,
        activation_slot: u64,
        expiry_slot: u64,
        config_hash: [u8; 32],
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let r = &mut ctx.accounts.registry;
        let slot = Clock::get()?.slot;
        require!(
            r.schema_version == 1 && r.config_version == ctx.accounts.config.config_version,
            VaultError::RouteRegistry
        );
        require!(
            !programs.is_empty() && programs.len() <= MAX_ROUTE_PROGRAMS,
            VaultError::RouteRegistry
        );
        require!(
            config_hash != [0; 32] && expiry_slot > slot && expiry_slot > activation_slot,
            VaultError::RouteRegistry
        );
        let mut unique = std::collections::BTreeSet::new();
        for id in &programs {
            require!(
                *id != Pubkey::default() && unique.insert(*id),
                VaultError::RouteRegistry
            );
        }
        require!(
            unique.contains(&swap_leg::reviewed_router()?),
            VaultError::RouteRegistry
        );
        require_eq!(
            ctx.remaining_accounts.len(),
            programs.len(),
            VaultError::RouteRegistry
        );
        for (id, account) in programs.iter().zip(ctx.remaining_accounts.iter()) {
            require_keys_eq!(*id, account.key(), VaultError::RouteRegistry);
            require!(
                account.executable && !account.is_writable && !account.is_signer,
                VaultError::RouteRegistry
            );
        }
        let program_bytes: Vec<u8> = programs.iter().flat_map(|id| id.to_bytes()).collect();
        let expected_hash = hashv(&[
            b"c3-route-registry-v1",
            r.vault.as_ref(),
            &r.config_version.to_le_bytes(),
            &activation_slot.to_le_bytes(),
            &expiry_slot.to_le_bytes(),
            &[programs.len() as u8],
            &program_bytes,
        ])
        .to_bytes();
        require!(config_hash == expected_hash, VaultError::RouteRegistry);
        r.revision = r.revision.checked_add(1).ok_or(VaultError::Math)?;
        r.programs = [Pubkey::default(); MAX_ROUTE_PROGRAMS];
        for (index, id) in programs.iter().enumerate() {
            r.programs[index] = *id;
        }
        r.program_count = programs.len() as u8;
        r.config_hash = config_hash;
        r.activation_slot = activation_slot;
        r.expiry_slot = expiry_slot;
        r.enabled = true;
        emit!(RouteRegistryEvent {
            vault: r.vault,
            revision: r.revision,
            config_hash: r.config_hash,
            action: 2,
            slot,
        });
        Ok(())
    }

    pub fn disable_route_registry(ctx: Context<GovernRouteRegistry>) -> Result<()> {
        let r = &mut ctx.accounts.registry;
        require!(
            r.schema_version == 1 && r.enabled,
            VaultError::RouteRegistry
        );
        r.revision = r.revision.checked_add(1).ok_or(VaultError::Math)?;
        r.enabled = false;
        emit!(RouteRegistryEvent {
            vault: r.vault,
            revision: r.revision,
            config_hash: r.config_hash,
            action: 3,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    pub fn set_keeper(ctx: Context<Govern>, next: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            c.governance,
            VaultError::Unauthorized
        );
        require!(next != Pubkey::default(), VaultError::InvalidConfig);
        require!(
            c.lifecycle == 0 || c.lifecycle == 4,
            VaultError::InvalidState
        );
        c.keeper = next;
        c.config_version = add(c.config_version, 1)?;
        emit_state(c.key(), Pubkey::default(), next, kind::KEEPER_CHANGED, 0)
    }

    pub fn pause(ctx: Context<Govern>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(
            ctx.accounts.authority.key() == c.governance
                || ctx.accounts.authority.key() == c.emergency,
            VaultError::Unauthorized
        );
        require!(!c.paused, VaultError::InvalidState);
        c.paused = true;
        emit_state(
            c.key(),
            Pubkey::default(),
            ctx.accounts.authority.key(),
            kind::PAUSED,
            0,
        )
    }

    pub fn unpause(ctx: Context<Govern>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            c.governance,
            VaultError::Unauthorized
        );
        require!(c.paused, VaultError::InvalidState);
        c.paused = false;
        emit_state(
            c.key(),
            Pubkey::default(),
            ctx.accounts.authority.key(),
            kind::UNPAUSED,
            0,
        )
    }

    pub fn create_deposit_intent(
        ctx: Context<CreateDepositIntent>,
        nonce: u64,
        amount: u64,
        config_version: u64,
        expires_at: i64,
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &mut ctx.accounts.config;
        require!(!c.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.owner.key(),
            c.allowlisted_owner,
            VaultError::Unauthorized
        );
        require_eq!(c.config_version, config_version, VaultError::InvalidConfig);
        require_eq!(amount, ONE_USDC, VaultError::InvalidAmount);
        require_eq!(c.deposit_counter, 0, VaultError::PilotLimit);
        require_eq!(c.lifecycle, 0, VaultError::PilotLimit);
        expiry(expires_at)?;
        let now = Clock::get()?;
        let d = &mut ctx.accounts.intent;
        d.schema_version = SCHEMA_VERSION;
        d.config_version = c.config_version;
        d.vault = c.key();
        d.wallet = ctx.accounts.owner.key();
        d.nonce = nonce;
        d.created_slot = now.slot;
        d.created_at = now.unix_timestamp;
        d.expires_at = expires_at;
        d.status = deposit_status::DRAFT;
        d.amount = amount;
        d.btc_bps = BTC_BPS;
        d.eth_bps = ETH_BPS;
        d.sol_bps = SOL_BPS;
        d.fingerprint = hashv(&[
            b"c3-deposit-v1",
            c.key().as_ref(),
            d.wallet.as_ref(),
            &nonce.to_le_bytes(),
            &amount.to_le_bytes(),
            &config_version.to_le_bytes(),
            &expires_at.to_le_bytes(),
        ])
        .to_bytes();
        c.deposit_counter = add(c.deposit_counter, 1)?;
        c.lifecycle = 1;
        emit_state(c.key(), d.key(), d.wallet, kind::DEPOSIT_CREATED, amount)
    }

    pub fn deposit_usdc(ctx: Context<DepositUsdc>) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &ctx.accounts.config;
        let d = &mut ctx.accounts.intent;
        require!(!c.paused, VaultError::Paused);
        require_keys_eq!(d.wallet, ctx.accounts.owner.key(), VaultError::Unauthorized);
        require_eq!(
            d.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        at(d.status, deposit_status::DRAFT)?;
        live(d.expires_at)?;
        require_eq!(d.amount, ONE_USDC, VaultError::InvalidAmount);
        ata(
            ctx.accounts.owner_usdc.key(),
            d.wallet,
            c.usdc_mint,
            anchor_spl::token::ID,
        )?;
        require_eq!(ctx.accounts.vault_usdc.amount, 0, VaultError::Settlement);
        for a in [
            &ctx.accounts.vault_btc,
            &ctx.accounts.vault_eth,
            &ctx.accounts.vault_wsol,
        ] {
            require_eq!(a.amount, 0, VaultError::Settlement);
        }
        d.usdc_before = ctx.accounts.vault_usdc.amount;
        d.btc_before = ctx.accounts.vault_btc.amount;
        d.eth_before = ctx.accounts.vault_eth.amount;
        d.wsol_before = ctx.accounts.vault_wsol.amount;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault_usdc.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            ONE_USDC,
            6,
        )?;
        d.deposited = ONE_USDC;
        d.status = deposit_status::USDC_DEPOSITED;
        d.status = deposit_status::SETTLEMENT_PENDING;
        emit_state(c.key(), d.key(), d.wallet, kind::USDC_DEPOSITED, ONE_USDC)
    }

    pub fn record_deposit_settlement(
        ctx: Context<RecordDepositSettlement>,
        settlement_id: [u8; 32],
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &ctx.accounts.config;
        let d = &mut ctx.accounts.intent;
        let p = &ctx.accounts.plan;
        require_keys_eq!(
            ctx.accounts.keeper.key(),
            c.keeper,
            VaultError::Unauthorized
        );
        require_eq!(
            d.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        at(d.status, deposit_status::SETTLEMENT_PENDING)?;
        live(d.expires_at)?;
        require_keys_eq!(p.vault, c.key(), VaultError::InvalidPlan);
        require_keys_eq!(p.wallet, d.wallet, VaultError::InvalidPlan);
        require_eq!(
            p.direction,
            plan_direction::DEPOSIT,
            VaultError::InvalidPlan
        );
        require_eq!(p.executed_bitmap, 0b111, VaultError::Settlement);
        require_eq!(
            p.lifecycle,
            plan_lifecycle::ACTIVE,
            VaultError::InvalidState
        );
        require_eq!(p.revision, 3, VaultError::InvalidState);
        require!(
            p.actual_inputs == [400_000, 300_000, 300_000],
            VaultError::Settlement
        );
        require!(
            p.actual_outputs.iter().all(|amount| *amount > 0),
            VaultError::Settlement
        );
        require!(
            settlement_id != [0; 32]
                && settlement_id == p.idempotency
                && (d.settlement_id == [0; 32] || d.settlement_id == settlement_id),
            VaultError::Settlement
        );
        d.settlement_id = settlement_id;
        if [d.btc_input_usdc, d.eth_input_usdc, d.wsol_input_usdc] == [0; 3] {
            [d.btc_input_usdc, d.eth_input_usdc, d.wsol_input_usdc] = p.actual_inputs;
        }
        require_eq!(
            d.btc_input_usdc,
            portion(ONE_USDC, BTC_BPS)?,
            VaultError::Settlement
        );
        require_eq!(
            d.eth_input_usdc,
            portion(ONE_USDC, ETH_BPS)?,
            VaultError::Settlement
        );
        require_eq!(
            d.wsol_input_usdc,
            portion(ONE_USDC, SOL_BPS)?,
            VaultError::Settlement
        );
        require_eq!(
            add(add(d.btc_input_usdc, d.eth_input_usdc)?, d.wsol_input_usdc)?,
            ONE_USDC,
            VaultError::Settlement
        );
        require_eq!(ctx.accounts.vault_usdc.amount, 0, VaultError::Settlement);
        require_eq!(
            ctx.accounts.vault_btc.amount,
            p.actual_outputs[0],
            VaultError::Settlement
        );
        require_eq!(
            ctx.accounts.vault_eth.amount,
            p.actual_outputs[1],
            VaultError::Settlement
        );
        require_eq!(
            ctx.accounts.vault_wsol.amount,
            p.actual_outputs[2],
            VaultError::Settlement
        );
        d.btc_after = ctx.accounts.vault_btc.amount;
        d.eth_after = ctx.accounts.vault_eth.amount;
        d.wsol_after = ctx.accounts.vault_wsol.amount;
        d.status = deposit_status::SETTLEMENT_RECORDED;
        emit_state(c.key(), d.key(), d.wallet, kind::DEPOSIT_SETTLED, ONE_USDC)
    }

    pub fn create_deposit_settlement_plan(
        ctx: Context<CreateDepositPlan>,
        route_hashes: [[u8; 32]; 3],
        minimum_outputs: [u64; 3],
        quote_created_at: i64,
        expires_at: i64,
        max_slippage_bps: u16,
        idempotency: [u8; 32],
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &ctx.accounts.config;
        let d = &ctx.accounts.intent;
        require_keys_eq!(
            ctx.accounts.keeper.key(),
            c.keeper,
            VaultError::Unauthorized
        );
        at(d.status, deposit_status::SETTLEMENT_PENDING)?;
        live(d.expires_at)?;
        require_eq!(d.deposited, ONE_USDC, VaultError::InvalidAmount);
        require_eq!(
            d.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        settlement_plan::initialize(
            &mut ctx.accounts.plan,
            c,
            c.key(),
            d.key(),
            d.wallet,
            plan_direction::DEPOSIT,
            [c.usdc_mint; 3],
            [c.btc_mint, c.eth_mint, c.wsol_mint],
            [c.vault_usdc; 3],
            [c.vault_btc, c.vault_eth, c.vault_wsol],
            route_hashes,
            minimum_outputs,
            quote_created_at,
            expires_at,
            max_slippage_bps,
            idempotency,
            ctx.bumps.plan,
        )
    }

    pub fn create_redemption_settlement_plan(
        ctx: Context<CreateRedemptionPlan>,
        route_hashes: [[u8; 32]; 3],
        minimum_outputs: [u64; 3],
        quote_created_at: i64,
        expires_at: i64,
        max_slippage_bps: u16,
        idempotency: [u8; 32],
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &ctx.accounts.config;
        let r = &ctx.accounts.intent;
        require_keys_eq!(
            ctx.accounts.keeper.key(),
            c.keeper,
            VaultError::Unauthorized
        );
        at(r.status, redemption_status::LIQUIDATION_PENDING)?;
        require_eq!(r.share_amount, SHARE_UNITS, VaultError::InvalidAmount);
        require_eq!(
            r.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        settlement_plan::initialize(
            &mut ctx.accounts.plan,
            c,
            c.key(),
            r.key(),
            r.wallet,
            plan_direction::REDEMPTION,
            [c.btc_mint, c.eth_mint, c.wsol_mint],
            [c.usdc_mint; 3],
            [c.vault_btc, c.vault_eth, c.vault_wsol],
            [c.vault_usdc; 3],
            route_hashes,
            minimum_outputs,
            quote_created_at,
            expires_at,
            max_slippage_bps,
            idempotency,
            ctx.bumps.plan,
        )
    }

    /// A governance-signed, single-use authorization bound to a plan revision.
    /// The default build deliberately rejects it until a reviewed release exists.
    pub fn authorize_swap_leg(
        ctx: Context<AuthorizeSwapLeg>,
        args: swap_leg::AuthorizeSwapArgs,
    ) -> Result<()> {
        swap_leg::authorize(ctx, args)
    }

    /// The keeper can only pay fees and execute the exact approved CPI envelope.
    pub fn execute_swap_leg<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteSwapLeg<'info>>,
        instruction_data: Vec<u8>,
        flags: Vec<u8>,
    ) -> Result<()> {
        swap_leg::execute(ctx, instruction_data, flags)
    }

    pub fn issue_initial_shares(ctx: Context<IssueShares>) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &mut ctx.accounts.config;
        let d = &mut ctx.accounts.intent;
        require_keys_eq!(d.wallet, ctx.accounts.owner.key(), VaultError::Unauthorized);
        require_eq!(
            d.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        at(d.status, deposit_status::SETTLEMENT_RECORDED)?;
        require_eq!(c.total_shares_issued, 0, VaultError::PilotLimit);
        require_eq!(ctx.accounts.share_mint.supply, 0, VaultError::PilotLimit);
        require_eq!(ctx.accounts.owner_shares.amount, 0, VaultError::PilotLimit);
        require_eq!(ctx.accounts.vault_usdc.amount, 0, VaultError::Settlement);
        require_eq!(
            ctx.accounts.vault_btc.amount,
            d.btc_after,
            VaultError::Settlement
        );
        require_eq!(
            ctx.accounts.vault_eth.amount,
            d.eth_after,
            VaultError::Settlement
        );
        require_eq!(
            ctx.accounts.vault_wsol.amount,
            d.wsol_after,
            VaultError::Settlement
        );
        require!(
            d.btc_after > 0 && d.eth_after > 0 && d.wsol_after > 0,
            VaultError::Settlement
        );
        ata(
            ctx.accounts.owner_shares.key(),
            d.wallet,
            c.share_mint,
            anchor_spl::token_2022::ID,
        )?;
        share_mint(&ctx.accounts.share_mint, ctx.accounts.vault_authority.key())?;
        let bump = [c.authority_bump];
        let signer: &[&[u8]] = &[AUTHORITY_SEED, &bump];
        token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.share_token_program.to_account_info(),
                MintTo2022 {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.owner_shares.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[signer],
            ),
            SHARE_UNITS,
        )?;
        d.shares_issued = SHARE_UNITS;
        d.status = deposit_status::SHARES_ISSUED;
        c.total_shares_issued = SHARE_UNITS;
        c.lifecycle = 2;
        d.status = deposit_status::ACTIVE;
        emit_state(c.key(), d.key(), d.wallet, kind::SHARES_ISSUED, SHARE_UNITS)
    }

    pub fn create_redemption_intent(
        ctx: Context<CreateRedemptionIntent>,
        nonce: u64,
        shares: u64,
        config_version: u64,
        expires_at: i64,
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &mut ctx.accounts.config;
        require!(!c.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.owner.key(),
            c.allowlisted_owner,
            VaultError::Unauthorized
        );
        require_eq!(c.config_version, config_version, VaultError::InvalidConfig);
        require_eq!(c.lifecycle, 2, VaultError::InvalidState);
        require_eq!(c.redemption_counter, 0, VaultError::PilotLimit);
        require_eq!(shares, SHARE_UNITS, VaultError::InvalidAmount);
        require_eq!(
            ctx.accounts.owner_shares.amount,
            shares,
            VaultError::InvalidAmount
        );
        ata(
            ctx.accounts.owner_shares.key(),
            ctx.accounts.owner.key(),
            c.share_mint,
            anchor_spl::token_2022::ID,
        )?;
        expiry(expires_at)?;
        let now = Clock::get()?;
        let r = &mut ctx.accounts.intent;
        r.schema_version = SCHEMA_VERSION;
        r.config_version = c.config_version;
        r.vault = c.key();
        r.wallet = ctx.accounts.owner.key();
        r.nonce = nonce;
        r.created_slot = now.slot;
        r.created_at = now.unix_timestamp;
        r.expires_at = expires_at;
        r.status = redemption_status::REQUESTED;
        r.share_amount = shares;
        r.btc_before = ctx.accounts.vault_btc.amount;
        r.eth_before = ctx.accounts.vault_eth.amount;
        r.wsol_before = ctx.accounts.vault_wsol.amount;
        r.usdc_before = ctx.accounts.vault_usdc.amount;
        require_eq!(r.usdc_before, 0, VaultError::Settlement);
        let d = &ctx.accounts.deposit;
        at(d.status, deposit_status::ACTIVE)?;
        require_eq!(
            d.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        require_eq!(d.shares_issued, shares, VaultError::InvalidAmount);
        require!(
            d.btc_after > 0 && d.eth_after > 0 && d.wsol_after > 0,
            VaultError::Settlement
        );
        require_eq!(r.btc_before, d.btc_after, VaultError::Settlement);
        require_eq!(r.eth_before, d.eth_after, VaultError::Settlement);
        require_eq!(r.wsol_before, d.wsol_after, VaultError::Settlement);
        r.fingerprint = hashv(&[
            b"c3-redemption-v1",
            c.key().as_ref(),
            r.wallet.as_ref(),
            &nonce.to_le_bytes(),
            &shares.to_le_bytes(),
            &config_version.to_le_bytes(),
            &expires_at.to_le_bytes(),
        ])
        .to_bytes();
        c.redemption_counter = add(c.redemption_counter, 1)?;
        c.lifecycle = 3;
        emit_state(c.key(), r.key(), r.wallet, kind::REDEMPTION_CREATED, shares)
    }

    pub fn lock_shares_for_redemption(ctx: Context<BurnShares>) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &ctx.accounts.config;
        let r = &mut ctx.accounts.intent;
        require_keys_eq!(r.wallet, ctx.accounts.owner.key(), VaultError::Unauthorized);
        require_eq!(
            r.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        at(r.status, redemption_status::REQUESTED)?;
        live(r.expires_at)?;
        require_eq!(r.share_amount, SHARE_UNITS, VaultError::InvalidAmount);
        require_eq!(
            ctx.accounts.owner_shares.amount,
            SHARE_UNITS,
            VaultError::InvalidAmount
        );
        require_eq!(
            ctx.accounts.share_mint.supply,
            SHARE_UNITS,
            VaultError::InvalidAmount
        );
        ata(
            ctx.accounts.owner_shares.key(),
            r.wallet,
            c.share_mint,
            anchor_spl::token_2022::ID,
        )?;
        // Non-transferable shares remain with the owner until liquidation is proven.
        // The single-position vault lifecycle and this intent prevent a second redemption.
        r.status = redemption_status::LIQUIDATION_PENDING;
        emit_state(c.key(), r.key(), r.wallet, kind::SHARES_LOCKED, SHARE_UNITS)
    }

    pub fn record_redemption_settlement(
        ctx: Context<RecordRedemptionSettlement>,
        settlement_id: [u8; 32],
    ) -> Result<()> {
        require!(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled);
        let c = &ctx.accounts.config;
        let r = &mut ctx.accounts.intent;
        let p = &ctx.accounts.plan;
        require_keys_eq!(
            ctx.accounts.keeper.key(),
            c.keeper,
            VaultError::Unauthorized
        );
        require_eq!(
            r.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        at(r.status, redemption_status::LIQUIDATION_PENDING)?;
        require_keys_eq!(p.vault, c.key(), VaultError::InvalidPlan);
        require_keys_eq!(p.wallet, r.wallet, VaultError::InvalidPlan);
        require_eq!(
            p.direction,
            plan_direction::REDEMPTION,
            VaultError::InvalidPlan
        );
        require_eq!(p.executed_bitmap, 0b111, VaultError::Settlement);
        require_eq!(
            p.lifecycle,
            plan_lifecycle::CLAIMABLE,
            VaultError::InvalidState
        );
        require_eq!(p.revision, 3, VaultError::InvalidState);
        require!(
            p.actual_inputs == [r.btc_before, r.eth_before, r.wsol_before],
            VaultError::Settlement
        );
        require!(
            p.actual_outputs.iter().all(|amount| *amount > 0),
            VaultError::Settlement
        );
        require!(
            settlement_id != [0; 32]
                && settlement_id == p.idempotency
                && (r.settlement_id == [0; 32] || r.settlement_id == settlement_id),
            VaultError::Settlement
        );
        r.settlement_id = settlement_id;
        require_eq!(ctx.accounts.vault_btc.amount, 0, VaultError::Settlement);
        require_eq!(ctx.accounts.vault_eth.amount, 0, VaultError::Settlement);
        require_eq!(ctx.accounts.vault_wsol.amount, 0, VaultError::Settlement);
        let realized_usdc = p
            .actual_outputs
            .iter()
            .try_fold(0u64, |sum, amount| add(sum, *amount))?;
        require_eq!(
            ctx.accounts.vault_usdc.amount,
            realized_usdc,
            VaultError::Settlement
        );
        r.usdc_claimable = realized_usdc;
        r.status = redemption_status::LIQUIDATION_RECORDED;
        r.status = redemption_status::USDC_CLAIMABLE;
        emit_state(
            c.key(),
            r.key(),
            r.wallet,
            kind::REDEMPTION_SETTLED,
            r.usdc_claimable,
        )
    }

    pub fn claim_usdc(ctx: Context<ClaimUsdc>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        let r = &mut ctx.accounts.intent;
        require_keys_eq!(r.wallet, ctx.accounts.owner.key(), VaultError::Unauthorized);
        require_eq!(
            r.config_version,
            c.config_version,
            VaultError::InvalidConfig
        );
        at(r.status, redemption_status::USDC_CLAIMABLE)?;
        require_eq!(r.usdc_returned, 0, VaultError::InvalidState);
        require!(r.usdc_claimable > 0, VaultError::Settlement);
        require_eq!(
            ctx.accounts.vault_usdc.amount,
            r.usdc_claimable,
            VaultError::Settlement
        );
        require_eq!(
            ctx.accounts.owner_shares.amount,
            SHARE_UNITS,
            VaultError::InvalidAmount
        );
        require_eq!(
            ctx.accounts.share_mint.supply,
            SHARE_UNITS,
            VaultError::InvalidAmount
        );
        ata(
            ctx.accounts.owner_shares.key(),
            r.wallet,
            c.share_mint,
            anchor_spl::token_2022::ID,
        )?;
        ata(
            ctx.accounts.owner_usdc.key(),
            r.wallet,
            c.usdc_mint,
            anchor_spl::token::ID,
        )?;
        let bump = [c.authority_bump];
        let signer: &[&[u8]] = &[AUTHORITY_SEED, &bump];
        // Burn and USDC transfer are atomic: if either fails, neither effect survives.
        token_2022::burn(
            CpiContext::new(
                ctx.accounts.share_token_program.to_account_info(),
                Burn2022 {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.owner_shares.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            SHARE_UNITS,
        )?;
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.owner_usdc.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[signer],
            ),
            r.usdc_claimable,
            6,
        )?;
        r.usdc_returned = r.usdc_claimable;
        r.status = redemption_status::USDC_RECEIVED;
        r.status = redemption_status::COMPLETED;
        c.lifecycle = 4;
        emit_state(c.key(), r.key(), r.wallet, kind::SHARES_BURNED, SHARE_UNITS)?;
        emit_state(
            c.key(),
            r.key(),
            r.wallet,
            kind::USDC_CLAIMED,
            r.usdc_returned,
        )
    }

    pub fn expire_intent(ctx: Context<ExpireIntent>) -> Result<()> {
        let d = &mut ctx.accounts.deposit;
        require_keys_eq!(
            ctx.accounts.caller.key(),
            d.wallet,
            VaultError::Unauthorized
        );
        at(d.status, deposit_status::DRAFT)?;
        require!(
            Clock::get()?.unix_timestamp >= d.expires_at,
            VaultError::Expired
        );
        d.status = deposit_status::EXPIRED;
        emit_state(
            ctx.accounts.config.key(),
            d.key(),
            d.wallet,
            kind::EXPIRED,
            0,
        )
    }

    pub fn close_completed_intent(ctx: Context<CloseCompletedIntent>) -> Result<()> {
        at(ctx.accounts.redemption.status, redemption_status::COMPLETED)?;
        emit_state(
            ctx.accounts.config.key(),
            ctx.accounts.redemption.key(),
            ctx.accounts.owner.key(),
            kind::CLOSED,
            ctx.accounts.redemption.usdc_returned,
        )
    }

    #[cfg(feature = "local-mock")]
    pub fn mock_execute_deposit_leg(
        ctx: Context<MockDepositLeg>,
        leg: u8,
        expected_revision: u64,
        route_hash: [u8; 32],
    ) -> Result<()> {
        mock_local_only::deposit_leg(ctx, leg, expected_revision, route_hash)
    }

    #[cfg(feature = "local-mock")]
    pub fn mock_execute_redemption_leg(
        ctx: Context<MockRedemptionLeg>,
        leg: u8,
        expected_revision: u64,
        route_hash: [u8; 32],
    ) -> Result<()> {
        mock_local_only::redemption_leg(ctx, leg, expected_revision, route_hash)
    }

    #[cfg(feature = "local-mock")]
    pub fn mock_settle_deposit(ctx: Context<MockDeposit>, settlement_id: [u8; 32]) -> Result<()> {
        mock_local_only::deposit(ctx, settlement_id)
    }

    #[cfg(feature = "local-mock")]
    pub fn mock_settle_redemption(
        ctx: Context<MockRedemption>,
        settlement_id: [u8; 32],
    ) -> Result<()> {
        mock_local_only::redemption(ctx, settlement_id)
    }
}
