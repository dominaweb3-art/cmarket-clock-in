use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub schema_version: u8,
    pub config_version: u64,
    pub governance: Pubkey,
    pub emergency: Pubkey,
    pub keeper: Pubkey,
    pub allowlisted_owner: Pubkey,
    pub paused: bool,
    pub usdc_mint: Pubkey,
    pub btc_mint: Pubkey,
    pub eth_mint: Pubkey,
    pub wsol_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_usdc: Pubkey,
    pub vault_btc: Pubkey,
    pub vault_eth: Pubkey,
    pub vault_wsol: Pubkey,
    pub btc_bps: u16,
    pub eth_bps: u16,
    pub sol_bps: u16,
    pub max_tvl: u64,
    pub max_deposit: u64,
    pub deposit_counter: u64,
    pub redemption_counter: u64,
    pub total_shares_issued: u64,
    pub lifecycle: u8,
    pub authority_bump: u8,
    pub reserved: [u8; 64],
}

#[account]
#[derive(InitSpace)]
pub struct DepositIntent {
    pub schema_version: u8,
    pub config_version: u64,
    pub vault: Pubkey,
    pub wallet: Pubkey,
    pub nonce: u64,
    pub created_slot: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub status: u8,
    pub amount: u64,
    pub deposited: u64,
    pub usdc_before: u64,
    pub btc_before: u64,
    pub eth_before: u64,
    pub wsol_before: u64,
    pub btc_after: u64,
    pub eth_after: u64,
    pub wsol_after: u64,
    pub shares_issued: u64,
    pub btc_bps: u16,
    pub eth_bps: u16,
    pub sol_bps: u16,
    pub btc_input_usdc: u64,
    pub eth_input_usdc: u64,
    pub wsol_input_usdc: u64,
    pub settlement_id: [u8; 32],
    pub fingerprint: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct RedemptionIntent {
    pub schema_version: u8,
    pub config_version: u64,
    pub vault: Pubkey,
    pub wallet: Pubkey,
    pub nonce: u64,
    pub created_slot: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub status: u8,
    pub share_amount: u64,
    pub btc_before: u64,
    pub eth_before: u64,
    pub wsol_before: u64,
    pub usdc_before: u64,
    pub usdc_claimable: u64,
    pub usdc_returned: u64,
    pub settlement_id: [u8; 32],
    pub fingerprint: [u8; 32],
}

/// One immutable three-leg intent. Signatures and finality evidence live in the durable indexer,
/// since a Solana program cannot know its enclosing transaction signature at execution time.
#[account]
#[derive(InitSpace, Default)]
pub struct SettlementPlan {
    pub schema_version: u8,
    pub config_version: u64,
    pub vault: Pubkey,
    pub intent: Pubkey,
    pub wallet: Pubkey,
    pub share_mint: Pubkey,
    pub direction: u8,
    pub amount: u64,
    pub weights: [u16; 3],
    pub input_mints: [Pubkey; 3],
    pub output_mints: [Pubkey; 3],
    pub source_accounts: [Pubkey; 3],
    pub destination_accounts: [Pubkey; 3],
    pub router_program: Pubkey,
    pub route_hashes: [[u8; 32]; 3],
    pub minimum_outputs: [u64; 3],
    pub max_slippage_bps: u16,
    pub quote_created_at: i64,
    pub expires_at: i64,
    pub executed_bitmap: u8,
    pub lifecycle: u8,
    pub revision: u64,
    pub idempotency: [u8; 32],
    pub actual_inputs: [u64; 3],
    /// Immutable accounted budget, never the total balance of a public ATA.
    pub input_budgets: [u64; 3],
    pub actual_outputs: [u64; 3],
    pub failure_evidence: [u8; 32],
    pub active_swap_authorization: [u8; 32],
    pub active_swap_expires_at: i64,
    pub bump: u8,
}

/// A governance-approved, single-use swap envelope for exactly one plan revision.
/// The plan separately stores this account's commitment, preventing a self-hashed
/// instruction from authorizing itself. It stores no private key or signature.
#[account]
#[derive(InitSpace)]
pub struct SwapLegAuthorization {
    pub schema_version: u8,
    pub plan: Pubkey,
    pub config_version: u64,
    pub direction: u8,
    pub leg: u8,
    pub expected_revision: u64,
    pub router_program: Pubkey,
    pub route_registry_version: u64,
    pub route_registry_hash: [u8; 32],
    pub quote_policy_revision: u64,
    pub quote_payload_hash: [u8; 32],
    pub quote_receipt: Pubkey,
    pub quote_expires_slot: u64,
    pub source: Pubkey,
    pub destination: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_amount: u64,
    pub quoted_output: u64,
    pub minimum_output: u64,
    pub max_slippage_bps: u16,
    pub quote_created_at: i64,
    pub quote_fingerprint: [u8; 32],
    pub route_fingerprint: [u8; 32],
    pub instruction_hash: [u8; 32],
    pub account_metas_hash: [u8; 32],
    pub alt_count: u8,
    pub alt_contents_hash: [u8; 32],
    pub expires_at: i64,
    pub idempotency: [u8; 32],
    pub consumed: bool,
    pub bump: u8,
}

/// Governance-owned route policy. An uninitialized registry cannot authorize a swap.
/// Production execution remains separately disabled by an immutable build constant.
#[account]
#[derive(InitSpace)]
pub struct RouteProgramRegistry {
    pub schema_version: u8,
    pub vault: Pubkey,
    pub governance: Pubkey,
    pub config_version: u64,
    pub revision: u64,
    pub config_hash: [u8; 32],
    pub enabled: bool,
    pub activation_slot: u64,
    pub expiry_slot: u64,
    pub program_count: u8,
    pub programs: [Pubkey; 16],
    pub bump: u8,
}

/// Governance-controlled signing policy. An initialized policy is still disabled.
#[account]
#[derive(InitSpace)]
pub struct QuoteAuthorityPolicy {
    pub schema_version: u8,
    pub vault: Pubkey,
    pub governance: Pubkey,
    pub config_version: u64,
    pub revision: u64,
    pub authority: Pubkey,
    pub enabled: bool,
    pub max_age_seconds: i64,
    pub max_slippage_bps: u16,
    pub genesis_hash: [u8; 32],
    pub domain: [u8; 16],
    pub bump: u8,
}

/// Globally unique quote identity. It remains allocated after execution.
#[account]
#[derive(InitSpace)]
pub struct QuoteReceipt {
    pub quote_id: [u8; 32],
    pub nonce: [u8; 32],
    pub payload_hash: [u8; 32],
    pub plan: Pubkey,
    pub authorization: Pubkey,
    pub consumed: bool,
    pub bump: u8,
}

pub mod plan_direction {
    pub const DEPOSIT: u8 = 1;
    pub const REDEMPTION: u8 = 2;
}

pub mod plan_lifecycle {
    pub const FUNDED: u8 = 1;
    pub const BUYING: u8 = 2;
    pub const ACTIVE: u8 = 3;
    pub const REDEMPTION_REQUESTED: u8 = 4;
    pub const SELLING: u8 = 5;
    pub const CLAIMABLE: u8 = 6;
    pub const REDEEMED: u8 = 7;
    pub const FAILED_RECOVERABLE: u8 = 8;
    pub const PARTIALLY_COMPLETED: u8 = 9;
    pub const MANUAL_REVIEW: u8 = 10;
}

pub mod deposit_status {
    pub const DRAFT: u8 = 0;
    pub const USDC_DEPOSITED: u8 = 1;
    pub const SETTLEMENT_PENDING: u8 = 2;
    pub const SETTLEMENT_RECORDED: u8 = 3;
    pub const SHARES_ISSUED: u8 = 4;
    pub const ACTIVE: u8 = 5;
    pub const EXPIRED: u8 = 6;
    pub const REFUNDED: u8 = 7;
}

pub mod redemption_status {
    pub const REQUESTED: u8 = 0;
    pub const SHARES_LOCKED: u8 = 1;
    pub const LIQUIDATION_PENDING: u8 = 2;
    pub const LIQUIDATION_RECORDED: u8 = 3;
    pub const USDC_CLAIMABLE: u8 = 4;
    pub const USDC_RECEIVED: u8 = 5;
    pub const COMPLETED: u8 = 6;
    pub const EXPIRED: u8 = 7;
}
