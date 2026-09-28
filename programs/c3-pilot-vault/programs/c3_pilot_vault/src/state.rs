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

pub mod deposit_status {
    pub const DRAFT: u8 = 0;
    pub const USDC_DEPOSITED: u8 = 1;
    pub const SETTLEMENT_PENDING: u8 = 2;
    pub const SETTLEMENT_RECORDED: u8 = 3;
    pub const SHARES_ISSUED: u8 = 4;
    pub const ACTIVE: u8 = 5;
    pub const EXPIRED: u8 = 6;
}

pub mod redemption_status {
    pub const REQUESTED: u8 = 0;
    pub const SHARES_BURNED: u8 = 1;
    pub const LIQUIDATION_PENDING: u8 = 2;
    pub const LIQUIDATION_RECORDED: u8 = 3;
    pub const USDC_CLAIMABLE: u8 = 4;
    pub const USDC_RECEIVED: u8 = 5;
    pub const COMPLETED: u8 = 6;
    pub const EXPIRED: u8 = 7;
}
