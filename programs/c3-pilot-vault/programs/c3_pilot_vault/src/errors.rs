use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused")]
    Paused,
    #[msg("Unauthorized authority")]
    Unauthorized,
    #[msg("Invalid configuration or version")]
    InvalidConfig,
    #[msg("Exactly one USDC is required")]
    InvalidAmount,
    #[msg("The pilot already has a position or intent")]
    PilotLimit,
    #[msg("Invalid or duplicate lifecycle transition")]
    InvalidState,
    #[msg("Intent is expired or expiry is invalid")]
    Expired,
    #[msg("Arithmetic overflow or underflow")]
    Math,
    #[msg("Token account, mint, or owner mismatch")]
    TokenMismatch,
    #[msg("Settlement balance evidence is insufficient")]
    Settlement,
    #[msg("Share mint must be non-transferable Token-2022")]
    TransferableShares,
    #[msg("Wrong owner or destination")]
    Destination,
    #[msg("This instruction exists only in local mock builds")]
    MockOnly,
}
