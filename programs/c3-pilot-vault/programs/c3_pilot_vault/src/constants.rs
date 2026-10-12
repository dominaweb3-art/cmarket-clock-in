pub const SCHEMA_VERSION: u8 = 1;
pub const CONFIG_VERSION: u64 = 1;
pub const ONE_USDC: u64 = 1_000_000;
pub const SHARE_UNITS: u64 = 1_000_000;
pub const BTC_BPS: u16 = 4_000;
pub const ETH_BPS: u16 = 3_000;
pub const SOL_BPS: u16 = 3_000;
pub const TOTAL_BPS: u16 = 10_000;
pub const MAX_INTENT_SECONDS: i64 = 3_600;
pub const VAULT_SEED: &[u8] = b"c3-vault-v1";
pub const AUTHORITY_SEED: &[u8] = b"c3-authority-v1";
pub const SHARE_SEED: &[u8] = b"c3-share-v1";
pub const PLAN_SEED: &[u8] = b"c3-plan-v1";
pub const MAX_QUOTE_AGE_SECONDS: i64 = 30;
pub const MAX_PLAN_SECONDS: i64 = 120;
pub const MAX_SLIPPAGE_BPS: u16 = 100;
pub const SWAP_AUTH_SEED: &[u8] = b"c3-swap-auth-v1";
pub const ROUTE_REGISTRY_SEED: &[u8] = b"c3-route-reg-v1";
pub const QUOTE_POLICY_SEED: &[u8] = b"c3-quote-policy-v1";
pub const QUOTE_RECEIPT_SEED: &[u8] = b"c3-quote-receipt-v1";
pub const QUOTE_DOMAIN: [u8; 16] = *b"C3QUOTESEAL-V1!!";
pub const MAX_ROUTE_PROGRAMS: usize = 16;

// A reviewed release must pin a PUBLIC bootstrap authority in source. None is
// intentionally not an address and must never mean "the first caller wins".
pub const PRODUCTION_BOOTSTRAP_AUTHORITY: Option<anchor_lang::prelude::Pubkey> = None;

// The production binary contains the boundary but cannot execute it before a
// separately reviewed configuration/release. Environment variables cannot flip it.
#[cfg(not(any(
    feature = "local-mock",
    feature = "local-jupiter-cycle",
    feature = "devnet-evaluation"
)))]
pub const ROUTER_EXECUTION_ENABLED: bool = false;
// Separate local-validator or explicitly simulated Devnet evaluation artifact.
// The default Mainnet candidate remains disabled.
#[cfg(any(
    feature = "local-mock",
    feature = "local-jupiter-cycle",
    feature = "devnet-evaluation"
))]
pub const ROUTER_EXECUTION_ENABLED: bool = true;

#[cfg(all(feature = "local-mock", feature = "local-jupiter-cycle"))]
compile_error!("local Jupiter and mock execution are mutually exclusive");

#[cfg(not(any(feature = "local-mock", feature = "devnet-evaluation")))]
pub const REVIEWED_ROUTER_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
#[cfg(feature = "local-mock")]
pub const REVIEWED_ROUTER_ID: &str = "7dfvugVLSaDFrXF6i2SbNji5vJmCvKP9grj4Nh8EysfZ";

#[cfg(feature = "devnet-evaluation")]
pub const REVIEWED_ROUTER_ID: &str = "F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7";
#[cfg(feature = "devnet-evaluation")]
pub const EVALUATION_BOOTSTRAP_AUTHORITY: anchor_lang::prelude::Pubkey =
    anchor_lang::prelude::pubkey!("6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC");

#[cfg(all(
    feature = "devnet-evaluation",
    any(
        feature = "local-mock",
        feature = "local-jupiter-cycle",
        feature = "local-jupiter-probe"
    )
))]
compile_error!("Devnet evaluation cannot include local experiment features");

/// Preserve the default candidate PDA bytes. Only the separate evaluation
/// artifact partitions accounts by owner; its public bootstrap remains pinned.
pub fn vault_seed(owner: anchor_lang::prelude::Pubkey) -> Vec<u8> {
    scoped_seed(VAULT_SEED, owner)
}
pub fn authority_seed(owner: anchor_lang::prelude::Pubkey) -> Vec<u8> {
    scoped_seed(AUTHORITY_SEED, owner)
}
// Round 1 preserves every deployed PDA. Additional evaluation purchases get
// separate immutable inventories/share mints, never a reset of an old vault.
pub fn vault_round_seed(owner: anchor_lang::prelude::Pubkey, round: u64) -> Vec<u8> {
    round_seed(VAULT_SEED, owner, round)
}
pub fn authority_round_seed(owner: anchor_lang::prelude::Pubkey, round: u64) -> Vec<u8> {
    round_seed(AUTHORITY_SEED, owner, round)
}
fn round_seed(prefix: &[u8], owner: anchor_lang::prelude::Pubkey, round: u64) -> Vec<u8> {
    #[cfg(feature = "devnet-evaluation")]
    if round > 1 {
        return anchor_lang::solana_program::hash::hashv(&[
            prefix,
            owner.as_ref(),
            &round.to_le_bytes(),
        ])
        .to_bytes()
        .to_vec();
    }
    #[cfg(not(feature = "devnet-evaluation"))]
    let _ = round;
    scoped_seed(prefix, owner)
}
pub fn purchase_amount(amount: u64, maximum: u64) -> anchor_lang::prelude::Result<()> {
    use anchor_lang::prelude::*;
    #[cfg(feature = "devnet-evaluation")]
    require!(
        amount >= ONE_USDC && amount <= maximum && maximum <= 1_000_000 * ONE_USDC,
        crate::errors::VaultError::InvalidAmount
    );
    #[cfg(not(feature = "devnet-evaluation"))]
    {
        let _ = maximum;
        require_eq!(amount, ONE_USDC, crate::errors::VaultError::InvalidAmount);
    }
    Ok(())
}
pub fn deposit_budgets(amount: u64) -> anchor_lang::prelude::Result<[u64; 3]> {
    let btc = crate::arithmetic::portion(amount, BTC_BPS)?;
    let eth = crate::arithmetic::portion(amount, ETH_BPS)?;
    let sol = amount
        .checked_sub(btc)
        .and_then(|n| n.checked_sub(eth))
        .ok_or(crate::errors::VaultError::InvalidAmount)?;
    Ok([btc, eth, sol])
}
fn scoped_seed(prefix: &[u8], _owner: anchor_lang::prelude::Pubkey) -> Vec<u8> {
    #[cfg(feature = "devnet-evaluation")]
    {
        anchor_lang::solana_program::hash::hashv(&[prefix, _owner.as_ref()])
            .to_bytes()
            .to_vec()
    }
    #[cfg(not(feature = "devnet-evaluation"))]
    {
        prefix.to_vec()
    }
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;
    #[test]
    fn evaluation_wallet_isolation_or_default_byte_equivalence() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        #[cfg(feature = "devnet-evaluation")]
        {
            assert_ne!(vault_seed(a), vault_seed(b));
            assert_ne!(authority_seed(a), authority_seed(b));
            assert_ne!(vault_seed(a), authority_seed(a));
            assert_eq!(vault_seed(a).len(), 32);
        }
        #[cfg(not(feature = "devnet-evaluation"))]
        {
            assert_eq!(vault_seed(a), VAULT_SEED);
            assert_eq!(vault_seed(b), VAULT_SEED);
            assert_eq!(authority_seed(a), AUTHORITY_SEED);
        }
    }
    #[test]
    fn amounts_rounding_and_legacy_round_are_explicit() {
        let owner = Pubkey::new_unique();
        assert_eq!(vault_round_seed(owner, 1), vault_seed(owner));
        assert_eq!(authority_round_seed(owner, 1), authority_seed(owner));
        for amount in [
            1_000_000,
            1_000_001,
            10_234_567,
            100_000_000,
            200_000_000,
            10_000 * ONE_USDC,
            1_000_000 * ONE_USDC,
        ] {
            let legs = deposit_budgets(amount).unwrap();
            assert_eq!(legs.iter().sum::<u64>(), amount);
            #[cfg(feature = "devnet-evaluation")]
            assert!(purchase_amount(amount, 1_000_000 * ONE_USDC).is_ok());
        }
        #[cfg(feature = "devnet-evaluation")]
        {
            assert_ne!(vault_round_seed(owner, 1), vault_round_seed(owner, 2));
            assert_ne!(
                authority_round_seed(owner, 2),
                authority_round_seed(owner, 3)
            );
            assert!(purchase_amount(999_999, 200_000_000).is_err());
            assert!(purchase_amount(200_000_001, 200_000_000).is_err());
            assert!(purchase_amount(1_000_000 * ONE_USDC + 1, 1_000_000 * ONE_USDC).is_err());
        }
        #[cfg(not(feature = "devnet-evaluation"))]
        {
            assert_eq!(vault_round_seed(owner, 2), VAULT_SEED);
            assert!(purchase_amount(100_000_000, 200_000_000).is_err());
        }
    }
}
