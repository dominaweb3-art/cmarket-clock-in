use anchor_lang::prelude::*;

#[event]
pub struct VaultEvent {
    pub version: u8,
    pub vault: Pubkey,
    pub intent: Pubkey,
    pub wallet: Pubkey,
    pub kind: u8,
    pub amount: u64,
    pub slot: u64,
}

pub mod kind {
    pub const INITIALIZED: u8 = 1;
    pub const PAUSED: u8 = 2;
    pub const UNPAUSED: u8 = 3;
    pub const DEPOSIT_CREATED: u8 = 4;
    pub const USDC_DEPOSITED: u8 = 5;
    pub const DEPOSIT_SETTLED: u8 = 6;
    pub const SHARES_ISSUED: u8 = 7;
    pub const REDEMPTION_CREATED: u8 = 8;
    pub const SHARES_BURNED: u8 = 9;
    pub const REDEMPTION_SETTLED: u8 = 10;
    pub const USDC_CLAIMED: u8 = 11;
    pub const EXPIRED: u8 = 12;
    pub const CLOSED: u8 = 13;
    pub const KEEPER_CHANGED: u8 = 14;
}

pub fn emit_state(
    vault: Pubkey,
    intent: Pubkey,
    wallet: Pubkey,
    kind: u8,
    amount: u64,
) -> Result<()> {
    emit!(VaultEvent {
        version: 1,
        vault,
        intent,
        wallet,
        kind,
        amount,
        slot: Clock::get()?.slot
    });
    Ok(())
}
