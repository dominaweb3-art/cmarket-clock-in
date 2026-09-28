use crate::errors::VaultError;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    non_transferable::NonTransferable, BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::{Mint, TokenAccount},
    token_2022::spl_token_2022,
    token_interface::Mint as ShareMint,
};

pub fn distinct(mints: &[Pubkey; 4]) -> Result<()> {
    for i in 0..4 {
        for j in (i + 1)..4 {
            require_keys_neq!(mints[i], mints[j], VaultError::InvalidConfig);
        }
    }
    Ok(())
}

pub fn vault_token(
    account: &Account<TokenAccount>,
    mint: &Account<Mint>,
    authority: Pubkey,
) -> Result<()> {
    require_keys_eq!(account.mint, mint.key(), VaultError::TokenMismatch);
    require_keys_eq!(account.owner, authority, VaultError::TokenMismatch);
    require_keys_eq!(
        account.key(),
        get_associated_token_address_with_program_id(
            &authority,
            &mint.key(),
            &anchor_spl::token::ID
        ),
        VaultError::TokenMismatch
    );
    Ok(())
}

pub fn share_mint(mint: &InterfaceAccount<ShareMint>, authority: Pubkey) -> Result<()> {
    require_keys_eq!(
        *mint.to_account_info().owner,
        spl_token_2022::ID,
        VaultError::TransferableShares
    );
    require_eq!(mint.decimals, 6, VaultError::TransferableShares);
    require!(
        mint.mint_authority
            == anchor_lang::solana_program::program_option::COption::Some(authority),
        VaultError::TransferableShares
    );
    require!(
        mint.freeze_authority == anchor_lang::solana_program::program_option::COption::None
            || mint.freeze_authority
                == anchor_lang::solana_program::program_option::COption::Some(authority),
        VaultError::TransferableShares
    );
    let info = mint.to_account_info();
    let data = info.try_borrow_data()?;
    let parsed = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)
        .map_err(|_| error!(VaultError::TransferableShares))?;
    parsed
        .get_extension::<NonTransferable>()
        .map_err(|_| error!(VaultError::TransferableShares))?;
    Ok(())
}

pub fn ata(account: Pubkey, wallet: Pubkey, mint: Pubkey, token_program: Pubkey) -> Result<()> {
    require_keys_eq!(
        account,
        get_associated_token_address_with_program_id(&wallet, &mint, &token_program),
        VaultError::TokenMismatch
    );
    Ok(())
}
