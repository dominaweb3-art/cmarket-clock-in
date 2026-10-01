//! ALTs compress the outer message, never CPI. Bind their complete public
//! contents while execution independently binds every resolved AccountInfo.
use crate::errors::VaultError;
use anchor_lang::{
    prelude::*,
    solana_program::{
        address_lookup_table::{program, state::AddressLookupTable},
        hash::hashv,
    },
};
pub fn contents_hash(accounts: &[AccountInfo], slot: u64) -> Result<[u8; 32]> {
    require!(slot > 0, VaultError::QuoteSignature);
    require!(accounts.len() <= 4, VaultError::QuoteSignature);
    if accounts.is_empty() {
        return Ok([0; 32]);
    }
    let mut parts = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for account in accounts {
        require!(
            !account.is_writable
                && !account.is_signer
                && !account.executable
                && seen.insert(account.key()),
            VaultError::QuoteSignature
        );
        require_keys_eq!(*account.owner, program::ID, VaultError::QuoteSignature);
        let data = account.try_borrow_data()?;
        let table =
            AddressLookupTable::deserialize(&data).map_err(|_| VaultError::QuoteSignature)?;
        require!(
            table.meta.deactivation_slot == u64::MAX
                && table.meta.last_extended_slot < slot
                && table.addresses.len() <= 256,
            VaultError::QuoteSignature
        );
        parts.extend_from_slice(account.key.as_ref());
        parts.extend_from_slice(account.owner.as_ref());
        parts.extend_from_slice(&(data.len() as u32).to_le_bytes());
        parts.extend_from_slice(&data);
    }
    Ok(hashv(&[b"c3-alt-resolved-v1", &[accounts.len() as u8], &parts]).to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolved_alt_matches_server_vector_and_rejects_unusable_evidence() {
        let key = pubkey!("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij");
        let owner = program::ID;
        let mut lamports = 1;
        let mut data = [0u8; 88];
        data[..4].copy_from_slice(&1u32.to_le_bytes());
        data[4..12].copy_from_slice(&u64::MAX.to_le_bytes());
        data[12..20].copy_from_slice(&10u64.to_le_bytes());
        data[56..]
            .copy_from_slice(pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").as_ref());
        let account = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        let expected = [
            0xc7, 0xbc, 0x2c, 0xda, 0xe2, 0xc3, 0xc4, 0x10, 0xd9, 0x2e, 0x53, 0xd7, 0x9f, 0x2a,
            0x11, 0x5a, 0xb7, 0xbe, 0xb2, 0xb6, 0xb2, 0x7e, 0x54, 0x12, 0x07, 0xb0, 0xa9, 0xb7,
            0xe6, 0x2b, 0x48, 0x5f,
        ];
        assert_eq!(contents_hash(&[account.clone()], 11).unwrap(), expected);
        assert!(contents_hash(&[account.clone()], 10).is_err());
        assert!(contents_hash(&[account.clone(), account.clone()], 11).is_err());
        let mut writable = account.clone();
        writable.is_writable = true;
        assert!(contents_hash(&[writable], 11).is_err());
        let mut signer = account.clone();
        signer.is_signer = true;
        assert!(contents_hash(&[signer], 11).is_err());
        account.try_borrow_mut_data().unwrap()[87] ^= 1;
        assert_ne!(contents_hash(&[account.clone()], 11).unwrap(), expected);
        account.try_borrow_mut_data().unwrap()[4..12].copy_from_slice(&12u64.to_le_bytes());
        assert!(contents_hash(&[account.clone()], 11).is_err());
        let wrong_owner = Pubkey::default();
        let mut invalid = account;
        invalid.owner = &wrong_owner;
        assert!(contents_hash(&[invalid], 11).is_err());
        assert!(contents_hash(&[], 0).is_err());
        assert_eq!(contents_hash(&[], 11).unwrap(), [0; 32]);
    }
}
