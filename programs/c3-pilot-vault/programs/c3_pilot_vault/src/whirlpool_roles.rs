//! Narrow legacy SPL-token Whirlpool role adapter. Not permission for arbitrary
//! pools, token accounts or DEXes. The governed registry must separately allow
//! the executable Whirlpool program; production remains immutable-disabled.
//! Layout/PDA source: orca-so/whirlpools programs/whirlpool/src/state/whirlpool.rs
//! and instructions/swap.rs. Unsupported Token-2022 and new layouts fail closed.
use crate::errors::VaultError;
use anchor_lang::{prelude::*, solana_program::hash::hashv};

pub const PROGRAM: Pubkey =
    anchor_lang::solana_program::pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const LEN: usize = 653;

fn key(data: &[u8], offset: usize) -> Pubkey {
    Pubkey::new_from_array(data[offset..offset + 32].try_into().unwrap())
}

/// Verify the actual account, its Anchor layout, PDA seeds and token-vault
/// relationships. A matching human-readable route label is never consulted.
pub fn pool_token_role(
    pool_key: Pubkey,
    pool_owner: Pubkey,
    data: &[u8],
    token_key: Pubkey,
    token_owner: Pubkey,
    token_mint: Pubkey,
    input_mint: Pubkey,
    output_mint: Pubkey,
) -> Result<()> {
    require!(
        pool_owner == PROGRAM && data.len() == LEN,
        VaultError::SwapAccount
    );
    require!(
        data[..8] == hashv(&[b"account:Whirlpool"]).to_bytes()[..8],
        VaultError::SwapAccount
    );
    let config = key(data, 8);
    let mint_a = key(data, 101);
    let vault_a = key(data, 133);
    let mint_b = key(data, 181);
    let vault_b = key(data, 213);
    require!(
        mint_a != mint_b && vault_a != vault_b,
        VaultError::SwapAccount
    );
    let derived = Pubkey::create_program_address(
        &[
            b"whirlpool",
            config.as_ref(),
            mint_a.as_ref(),
            mint_b.as_ref(),
            &data[43..45],
            &data[40..41],
        ],
        &PROGRAM,
    )
    .map_err(|_| VaultError::SwapAccount)?;
    require!(
        derived == pool_key && token_owner == pool_key,
        VaultError::SwapAccount
    );
    require!(
        (mint_a == input_mint && mint_b == output_mint)
            || (mint_b == input_mint && mint_a == output_mint),
        VaultError::SwapAccount
    );
    require!(
        (token_key == vault_a && token_mint == mint_a)
            || (token_key == vault_b && token_mint == mint_b),
        VaultError::SwapAccount
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Pubkey, Vec<u8>, Pubkey, Pubkey, Pubkey, Pubkey) {
        let config = Pubkey::new_unique();
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let va = Pubkey::new_unique();
        let vb = Pubkey::new_unique();
        let seed = 64u16.to_le_bytes();
        let (pool, bump) = Pubkey::find_program_address(
            &[b"whirlpool", config.as_ref(), a.as_ref(), b.as_ref(), &seed],
            &PROGRAM,
        );
        let mut data = vec![0; LEN];
        data[..8].copy_from_slice(&hashv(&[b"account:Whirlpool"]).to_bytes()[..8]);
        data[8..40].copy_from_slice(config.as_ref());
        data[40] = bump;
        data[43..45].copy_from_slice(&seed);
        data[101..133].copy_from_slice(a.as_ref());
        data[133..165].copy_from_slice(va.as_ref());
        data[181..213].copy_from_slice(b.as_ref());
        data[213..245].copy_from_slice(vb.as_ref());
        (pool, data, a, b, va, vb)
    }
    #[test]
    fn accepts_only_actual_pool_vaults_in_both_directions() {
        let (pool, data, a, b, va, vb) = fixture();
        assert!(pool_token_role(pool, PROGRAM, &data, va, pool, a, a, b).is_ok());
        assert!(pool_token_role(pool, PROGRAM, &data, vb, pool, b, b, a).is_ok());
        assert!(
            pool_token_role(pool, PROGRAM, &data, Pubkey::new_unique(), pool, a, a, b).is_err()
        );
        assert!(pool_token_role(pool, PROGRAM, &data, va, Pubkey::new_unique(), a, a, b).is_err());
        assert!(pool_token_role(pool, PROGRAM, &data, va, pool, b, a, b).is_err());
        assert!(
            pool_token_role(pool, PROGRAM, &data, va, pool, a, a, Pubkey::new_unique()).is_err()
        );
    }
    #[test]
    fn rejects_malformed_owner_discriminator_and_pda() {
        let (pool, data, a, b, va, _) = fixture();
        for len in [0, 7, 8, 101, 652, 654] {
            assert!(pool_token_role(pool, PROGRAM, &vec![0; len], va, pool, a, a, b).is_err());
        }
        assert!(pool_token_role(pool, Pubkey::new_unique(), &data, va, pool, a, a, b).is_err());
        assert!(pool_token_role(Pubkey::new_unique(), PROGRAM, &data, va, pool, a, a, b).is_err());
        for offset in [0, 8, 40, 43, 101, 133, 181] {
            let mut changed = data.clone();
            changed[offset] ^= 1;
            assert!(pool_token_role(pool, PROGRAM, &changed, va, pool, a, a, b).is_err());
        }
    }
}
