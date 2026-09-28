# C3 open-vault pilot security model

Status: local candidate, not audited for public funds. Mainnet disabled.

The user signs only with their own wallet; the vault program never receives a private key. Vault USDC and mock underlying token accounts are owned by the VaultAuthority PDA. The keeper has no generic token-transfer or withdrawal instruction. Governance can select a keeper and pause/unpause; emergency can pause only. The share mint uses Token-2022 NonTransferable and a PDA mint authority, so a wallet cannot transfer its position to bypass owner-only accounting.

Every intent is bound to vault, wallet, nonce, configuration version, expiry and cryptographic fingerprint. The one-deposit/one-redemption counters and exact transition checks reject duplicate creation, mint, burn, settlement record and claim. Distinct mints, SPL program ownership, vault ATAs, the owner's ATAs, mint authority, share extension and decimal counts are checked on-chain. Checked u64/u128 arithmetic rejects overflow and underflow.

Known limitations requiring C3V2 and an independent audit: the local mock does not prove external swap execution, oracle valuation or real 40/30/30 market-value exposure. The first-deposit share price is fixed only for this one-owner fixture. Live Jupiter settlement, production mint allowlists, authority governance, operational recovery, ability to return funded-but-unsettled USDC, liquidity, quote expiry and full redemption accounting remain unimplemented. A funded intent that expires or a burned position without completed liquidation requires manual intervention; do not deploy this candidate against real assets. Production build must reject new deposits and mock settlement entry points.

Never claim that a local mock test proves a Mainnet basket or guarantees a 1-USDC economic execution. No public Mainnet or phone action is authorized in C3V1.

Tooling caveat (2026-09-28): `npm audit --omit=dev` reports zero findings for each new package, but the local-validator test package's full development audit reports 12 advisories (5 high, 7 moderate) and the currently unintegrated client package's full development audit reports 7 (2 high, 5 moderate). Local SPL Token test tooling and the Anchor client must not be silently promoted into a mobile release graph. Anchor 0.31.1 also emits macro/deprecation warnings and the local SBF builder emits a syscall-linkage warning, even though the built program executes in the isolated validator. These warnings are not a security approval; C3V2 requires dependency and deploy-artifact review before use with real assets.
