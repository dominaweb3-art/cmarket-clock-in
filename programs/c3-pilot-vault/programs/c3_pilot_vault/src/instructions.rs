use crate::{constants::*, state::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
    token_2022::Token2022,
    token_interface::{Mint as ShareMint, TokenAccount as ShareAccount},
};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Stored as the governance public key; not a mint or token authority.
    pub governance: UncheckedAccount<'info>,
    /// CHECK: Stored as an emergency public key, may only pause.
    pub emergency: UncheckedAccount<'info>,
    /// CHECK: Stored as the allowlisted pilot wallet.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: PDA signer; no data account is required.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(init, payer = payer, seeds = [VAULT_SEED], bump, space = 8 + VaultConfig::INIT_SPACE)]
    pub config: Account<'info, VaultConfig>,
    pub usdc_mint: Account<'info, Mint>,
    pub btc_mint: Account<'info, Mint>,
    pub eth_mint: Account<'info, Mint>,
    pub wsol_mint: Account<'info, Mint>,
    pub share_mint: InterfaceAccount<'info, ShareMint>,
    pub vault_usdc: Account<'info, TokenAccount>,
    pub vault_btc: Account<'info, TokenAccount>,
    pub vault_eth: Account<'info, TokenAccount>,
    pub vault_wsol: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub share_token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Govern<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateDepositIntent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(init, payer = owner, seeds = [b"deposit", config.key().as_ref(), owner.key().as_ref(), nonce.to_le_bytes().as_ref()], bump, space = 8 + DepositIntent::INIT_SPACE)]
    pub intent: Account<'info, DepositIntent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositUsdc<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [b"deposit", config.key().as_ref(), owner.key().as_ref(), intent.nonce.to_le_bytes().as_ref()], bump)]
    pub intent: Account<'info, DepositIntent>,
    #[account(mut, constraint = owner_usdc.owner == owner.key(), constraint = owner_usdc.mint == config.usdc_mint)]
    pub owner_usdc: Account<'info, TokenAccount>,
    #[account(mut, address = config.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(address = config.vault_btc)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(address = config.vault_eth)]
    pub vault_eth: Account<'info, TokenAccount>,
    #[account(address = config.vault_wsol)]
    pub vault_wsol: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecordDepositSettlement<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, constraint = intent.vault == config.key())]
    pub intent: Account<'info, DepositIntent>,
    #[account(seeds = [PLAN_SEED, intent.key().as_ref()], bump = plan.bump, constraint = plan.intent == intent.key())]
    pub plan: Box<Account<'info, SettlementPlan>>,
    #[account(address = config.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(address = config.vault_btc)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(address = config.vault_eth)]
    pub vault_eth: Account<'info, TokenAccount>,
    #[account(address = config.vault_wsol)]
    pub vault_wsol: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct CreateDepositPlan<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, constraint = intent.vault == config.key())]
    pub intent: Account<'info, DepositIntent>,
    #[account(init, payer = keeper, seeds = [PLAN_SEED, intent.key().as_ref()], bump, space = 8 + SettlementPlan::INIT_SPACE)]
    pub plan: Account<'info, SettlementPlan>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IssueShares<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [b"deposit", config.key().as_ref(), owner.key().as_ref(), intent.nonce.to_le_bytes().as_ref()], bump)]
    pub intent: Account<'info, DepositIntent>,
    /// CHECK: PDA signer, checked by seeds and bump.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = config.share_mint)]
    pub share_mint: InterfaceAccount<'info, ShareMint>,
    #[account(address = config.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(address = config.vault_btc)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(address = config.vault_eth)]
    pub vault_eth: Account<'info, TokenAccount>,
    #[account(address = config.vault_wsol)]
    pub vault_wsol: Account<'info, TokenAccount>,
    #[account(mut, constraint = owner_shares.owner == owner.key(), constraint = owner_shares.mint == config.share_mint)]
    pub owner_shares: InterfaceAccount<'info, ShareAccount>,
    pub share_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateRedemptionIntent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(init, payer = owner, seeds = [b"redemption", config.key().as_ref(), owner.key().as_ref(), nonce.to_le_bytes().as_ref()], bump, space = 8 + RedemptionIntent::INIT_SPACE)]
    pub intent: Account<'info, RedemptionIntent>,
    #[account(constraint = owner_shares.owner == owner.key(), constraint = owner_shares.mint == config.share_mint)]
    pub owner_shares: InterfaceAccount<'info, ShareAccount>,
    #[account(address = config.vault_btc)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(address = config.vault_eth)]
    pub vault_eth: Account<'info, TokenAccount>,
    #[account(address = config.vault_wsol)]
    pub vault_wsol: Account<'info, TokenAccount>,
    #[account(address = config.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnShares<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [b"redemption", config.key().as_ref(), owner.key().as_ref(), intent.nonce.to_le_bytes().as_ref()], bump)]
    pub intent: Account<'info, RedemptionIntent>,
    #[account(mut, constraint = owner_shares.owner == owner.key(), constraint = owner_shares.mint == config.share_mint)]
    pub owner_shares: InterfaceAccount<'info, ShareAccount>,
    #[account(mut, address = config.share_mint)]
    pub share_mint: InterfaceAccount<'info, ShareMint>,
    pub share_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct RecordRedemptionSettlement<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, constraint = intent.vault == config.key())]
    pub intent: Account<'info, RedemptionIntent>,
    #[account(seeds = [PLAN_SEED, intent.key().as_ref()], bump = plan.bump, constraint = plan.intent == intent.key())]
    pub plan: Box<Account<'info, SettlementPlan>>,
    #[account(address = config.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(address = config.vault_btc)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(address = config.vault_eth)]
    pub vault_eth: Account<'info, TokenAccount>,
    #[account(address = config.vault_wsol)]
    pub vault_wsol: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct CreateRedemptionPlan<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, constraint = intent.vault == config.key())]
    pub intent: Account<'info, RedemptionIntent>,
    #[account(init, payer = keeper, seeds = [PLAN_SEED, intent.key().as_ref()], bump, space = 8 + SettlementPlan::INIT_SPACE)]
    pub plan: Account<'info, SettlementPlan>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: crate::swap_leg::AuthorizeSwapArgs)]
pub struct AuthorizeSwapLeg<'info> {
    #[account(mut, address = config.governance)]
    pub governance: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Box<Account<'info, VaultConfig>>,
    #[account(mut, seeds = [PLAN_SEED, plan.intent.as_ref()], bump = plan.bump,
        constraint = plan.vault == config.key())]
    pub plan: Box<Account<'info, SettlementPlan>>,
    /// CHECK: Only the seed-derived PDA can sign an inner token operation.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub source: Box<Account<'info, TokenAccount>>,
    pub destination: Box<Account<'info, TokenAccount>>,
    /// CHECK: Executable address is compared to the source-reviewed router ID.
    #[account(executable)]
    pub router_program: UncheckedAccount<'info>,
    #[account(init, payer = governance,
        seeds = [SWAP_AUTH_SEED, plan.key().as_ref(), args.idempotency.as_ref()], bump,
        space = 8 + SwapLegAuthorization::INIT_SPACE)]
    pub authorization: Box<Account<'info, SwapLegAuthorization>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteSwapLeg<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Box<Account<'info, VaultConfig>>,
    #[account(mut, seeds = [PLAN_SEED, plan.intent.as_ref()], bump = plan.bump,
        constraint = plan.vault == config.key())]
    pub plan: Box<Account<'info, SettlementPlan>>,
    #[account(mut, seeds = [SWAP_AUTH_SEED, plan.key().as_ref(), authorization.idempotency.as_ref()],
        bump = authorization.bump, constraint = authorization.plan == plan.key())]
    pub authorization: Box<Account<'info, SwapLegAuthorization>>,
    /// CHECK: Only the seed-derived PDA can sign an inner token operation.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = authorization.source)]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = authorization.destination)]
    pub destination: Box<Account<'info, TokenAccount>>,
    /// CHECK: Executable address is compared to the source-reviewed router ID.
    #[account(executable, address = authorization.router_program)]
    pub router_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimUsdc<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [b"redemption", config.key().as_ref(), owner.key().as_ref(), intent.nonce.to_le_bytes().as_ref()], bump)]
    pub intent: Account<'info, RedemptionIntent>,
    /// CHECK: PDA signer, checked by seeds and bump.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = config.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, constraint = owner_usdc.owner == owner.key(), constraint = owner_usdc.mint == config.usdc_mint)]
    pub owner_usdc: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut, address = config.share_mint)]
    pub share_mint: InterfaceAccount<'info, ShareMint>,
    #[account(mut, constraint = owner_shares.owner == owner.key(), constraint = owner_shares.mint == config.share_mint)]
    pub owner_shares: InterfaceAccount<'info, ShareAccount>,
    pub token_program: Program<'info, Token>,
    pub share_token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct ExpireIntent<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, constraint = deposit.vault == config.key())]
    pub deposit: Account<'info, DepositIntent>,
}

#[derive(Accounts)]
pub struct CloseCompletedIntent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, close = owner, constraint = redemption.vault == config.key(), constraint = redemption.wallet == owner.key())]
    pub redemption: Account<'info, RedemptionIntent>,
}

#[cfg(feature = "local-mock")]
#[derive(Accounts)]
pub struct MockSettle<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [VAULT_SEED], bump)]
    pub config: Box<Account<'info, VaultConfig>>,
    /// CHECK: PDA signer, checked by seeds and bump.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = config.vault_usdc)]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.vault_btc)]
    pub vault_btc: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.vault_eth)]
    pub vault_eth: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.vault_wsol)]
    pub vault_wsol: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = config.btc_mint)]
    pub btc_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = config.eth_mint)]
    pub eth_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = config.wsol_mint)]
    pub wsol_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[cfg(feature = "local-mock")]
#[derive(Accounts)]
pub struct MockDeposit<'info> {
    pub accounts: MockSettle<'info>,
    #[account(mut, constraint = intent.vault == accounts.config.key())]
    pub intent: Box<Account<'info, DepositIntent>>,
}

#[cfg(feature = "local-mock")]
#[derive(Accounts)]
pub struct MockRedemption<'info> {
    pub accounts: MockSettle<'info>,
    #[account(mut, constraint = intent.vault == accounts.config.key())]
    pub intent: Box<Account<'info, RedemptionIntent>>,
}

#[cfg(feature = "local-mock")]
#[derive(Accounts)]
pub struct MockDepositLeg<'info> {
    pub accounts: MockSettle<'info>,
    #[account(mut, constraint = intent.vault == accounts.config.key())]
    pub intent: Box<Account<'info, DepositIntent>>,
    #[account(mut, seeds = [PLAN_SEED, intent.key().as_ref()], bump = plan.bump)]
    pub plan: Box<Account<'info, SettlementPlan>>,
}

#[cfg(feature = "local-mock")]
#[derive(Accounts)]
pub struct MockRedemptionLeg<'info> {
    pub accounts: MockSettle<'info>,
    #[account(mut, constraint = intent.vault == accounts.config.key())]
    pub intent: Box<Account<'info, RedemptionIntent>>,
    #[account(mut, seeds = [PLAN_SEED, intent.key().as_ref()], bump = plan.bump)]
    pub plan: Box<Account<'info, SettlementPlan>>,
}
