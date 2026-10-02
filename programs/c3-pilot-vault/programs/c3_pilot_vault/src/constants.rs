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
#[cfg(not(any(feature = "local-mock", feature = "local-jupiter-cycle")))]
pub const ROUTER_EXECUTION_ENABLED: bool = false;
// Separate local-validator artifact only. Never enable this feature in a deployment build.
#[cfg(any(feature = "local-mock", feature = "local-jupiter-cycle"))]
pub const ROUTER_EXECUTION_ENABLED: bool = true;

#[cfg(all(feature = "local-mock", feature = "local-jupiter-cycle"))]
compile_error!("local Jupiter and mock execution are mutually exclusive");

#[cfg(not(feature = "local-mock"))]
pub const REVIEWED_ROUTER_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
#[cfg(feature = "local-mock")]
pub const REVIEWED_ROUTER_ID: &str = "7dfvugVLSaDFrXF6i2SbNji5vJmCvKP9grj4Nh8EysfZ";
