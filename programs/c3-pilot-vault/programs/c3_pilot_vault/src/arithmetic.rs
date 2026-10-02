use crate::errors::VaultError;
use anchor_lang::prelude::*;

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(VaultError::Math))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(VaultError::Math))
}

/// Unsolicited SPL transfers are not position inventory. Require sufficient
/// backing, never equality with a publicly writable token account's balance.
pub fn backed(balance: u64, accounted: u64) -> Result<()> {
    require!(balance >= accounted, VaultError::Settlement);
    Ok(())
}

pub fn bootstrap_authorized(payer: Pubkey, governance: Pubkey) -> Result<()> {
    require_keys_eq!(payer, governance, VaultError::Unauthorized);
    #[cfg(not(any(feature = "local-mock", feature = "local-jupiter-cycle")))]
    require!(
        crate::constants::PRODUCTION_BOOTSTRAP_AUTHORITY == Some(governance),
        VaultError::Unauthorized
    );
    Ok(())
}

pub fn portion(amount: u64, bps: u16) -> Result<u64> {
    let n = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or_else(|| error!(VaultError::Math))?;
    u64::try_from(n / 10_000).map_err(|_| error!(VaultError::Math))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_pilot_allocation() {
        assert_eq!(portion(1_000_000, 4_000).unwrap(), 400_000);
        assert_eq!(portion(1_000_000, 3_000).unwrap(), 300_000);
        assert!(add(u64::MAX, 1).is_err());
        assert!(sub(0, 1).is_err());
    }
    #[test]
    fn unsolicited_dust_cannot_block_accounted_claim_or_enlarge_it() {
        for amount in [1, 400_000, 998_145, u64::MAX - 1] {
            assert!(backed(amount, amount).is_ok());
            assert!(backed(amount + 1, amount).is_ok());
            assert!(backed(amount - 1, amount).is_err());
            assert_eq!(sub(amount + 1, amount).unwrap(), 1);
        }
    }
    #[test]
    fn absent_production_bootstrap_does_not_trust_first_caller() {
        let caller = Pubkey::new_unique();
        #[cfg(not(any(feature = "local-mock", feature = "local-jupiter-cycle")))]
        assert!(bootstrap_authorized(caller, caller).is_err());
        assert!(bootstrap_authorized(caller, Pubkey::new_unique()).is_err());
    }
}
