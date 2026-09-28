# C3 open vault: controlled pilot architecture

Status: C3V1 local-validator implementation candidate. Not a deployed or audited Mainnet product.

## Why the execution path changed

The preserved Symmetry V3 adapter did not provide enough independently verifiable public instruction semantics or guaranteed USDC redemption controls for the pilot. C Market therefore owns the open-source vault program and can test its account constraints, share issuance, custody, redemption and event trail. The previous Symmetry research and builder are not deleted; they remain a future adapter option.

## C3V1 boundary

One allowlisted owner deposits exactly 1,000,000 mock-USDC base units (six decimals). The vault starts paused and has a 1-USDC TVL cap. The immutable target is 4,000/3,000/3,000 basis points for mock BTC/ETH/WSOL exposures. A test-only, feature-gated `MOCK_LOCAL_ONLY` adapter burns the deposited mock USDC and mints deterministic mock outputs into four program-controlled vault token accounts. The vault then mints exactly 1,000,000 non-transferable Token-2022 C3 share base units into the owner's share ATA. These shares, not an internal ledger, represent the entire owner-only position.

For redemption, the owner authorizes full share burning. The local mock adapter burns vault mock assets and mints 990,000 mock-USDC units into the vault. The program records verified balances and only then transfers 990,000 to the same owner's USDC ATA. The 10,000-unit shortfall is deterministic mock slippage, not an observed market price. A later deposit or partial redemption is prohibited in C3V1.

The program uses versioned VaultConfig, DepositIntent and RedemptionIntent accounts, a VaultAuthority PDA as token-account owner and share-mint authority, immutable mint/account addresses, an allowlisted wallet, a separate keeper, governance and emergency pause authority, checked integer arithmetic, intent fingerprints, one-use lifecycle transitions and versioned events. Events assist evidence review; account state and SPL balances are authoritative.

The local mock feature must never be used to build a production artifact. Without it, new deposits and settlement recording fail closed. No mobile navigation, Mainnet flag, production mint, production authority, Jupiter integration, Pyth key, or Symmetry SDK is added by C3V1.

## Next step: C3V2

Replace `MOCK_LOCAL_ONLY` with a separately reviewed Jupiter settlement adapter. Pre-wallet and post-confirmation checks must prove exact USDC debits, allowed route programs, PDA-controlled output accounts, bounded slippage, expiry, vault balance deltas, no third-party destination, and complete redemption to USDC. Independently review the new program, backend and mobile integration before any supervised Mainnet operation. The local mock amounts are not Mainnet economics.

Sources for token behavior: [Solana Token Extensions](https://solana.com/docs/tokens/extensions), [Anchor token extension guidance](https://www.anchor-lang.com/docs/tokens/extensions).
