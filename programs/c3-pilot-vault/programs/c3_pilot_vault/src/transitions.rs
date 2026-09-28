use crate::{constants::MAX_INTENT_SECONDS, errors::VaultError};
use anchor_lang::prelude::*;

pub fn expiry(expires_at: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        expires_at > now
            && expires_at
                <= now
                    .checked_add(MAX_INTENT_SECONDS)
                    .ok_or(VaultError::Math)?,
        VaultError::Expired
    );
    Ok(())
}

pub fn live(expires_at: i64) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp < expires_at,
        VaultError::Expired
    );
    Ok(())
}

pub fn at(actual: u8, expected: u8) -> Result<()> {
    require_eq!(actual, expected, VaultError::InvalidState);
    Ok(())
}
