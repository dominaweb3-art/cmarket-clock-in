use crate::errors::VaultError;
use anchor_lang::prelude::*;

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(VaultError::Math))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(VaultError::Math))
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
}
