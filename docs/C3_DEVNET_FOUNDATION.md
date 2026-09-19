# C3 Symmetry V3 Devnet foundation

## Purpose

This milestone starts the production C3 path without changing the verified CLOCK IN payment flow or enabling Mainnet. The mobile app can now verify, through finalized read-only Solana RPC calls, whether the Symmetry V3 program, the configured C3 vault account, and the configured C3 share mint exist with the expected owners.

The target methodology is fixed and versioned in code:

- Bitcoin exposure: 4,000 basis points (40%).
- Ethereum exposure: 3,000 basis points (30%).
- Solana exposure: 3,000 basis points (30%).
- Total: exactly 10,000 basis points (100%).

## Verified on 2026-09-19

The official Symmetry V3 npm documentation identifies program `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`, supports the `devnet` network, and documents tokenized vault shares, deposits, withdrawals, intents, and permissionless keepers.

A finalized read-only request to the official Solana Devnet RPC confirmed that this program account exists, is executable, and is owned by the upgradeable BPF loader. This proves program deployment only. It does not prove that a C Market C3 vault exists or that deposits and withdrawals work.

Primary source: <https://www.npmjs.com/package/@symmetry-hq/sdk>

## Current mobile behavior

The C3 details screen performs a read-only readiness check:

1. Verify the Symmetry V3 program account is executable on Devnet.
2. If no reviewed vault and share mint are configured, show `deployment_required` truthfully.
3. If both are configured, verify that the vault is owned by the Symmetry V3 program.
4. Verify that the share mint is a structurally valid SPL Token or Token-2022 mint account.
5. Keep purchase and sale execution disabled in every state.

The check never requests wallet authorization, constructs a transaction, signs, submits, retries a payment, or moves funds.

## Public configuration

After a reviewed Devnet deployment, configure both variables together:

- `EXPO_PUBLIC_C3_SYMMETRY_VAULT_ADDRESS`
- `EXPO_PUBLIC_C3_SHARE_MINT`

Missing values produce `deployment_required`. A partial or malformed configuration fails closed as `configuration_invalid`.

## Dependency decision

`@symmetry-hq/sdk@1.0.22` currently depends on `@solana/spl-token`, which transitively uses the vulnerable `bigint-buffer` path that was deliberately removed from the Android production graph during Phase 5I.2. Therefore this milestone does not add the Symmetry SDK to the mobile APK.

The recommended boundary is:

- Mobile: read-only public state, strict transaction-plan validation, and MWA authorization.
- Isolated builder/keeper service: pinned and audited Symmetry SDK, intent processing, and keeper tasks.
- On-chain program: vault custody, shares, accounting, and settlement.

No service or keeper is deployed by this milestone. Before introducing the SDK anywhere, its dependency chain, transaction output, permissions, license, and release bundle isolation must be reviewed.

## Blocking work before a functional buy/sell demo

1. Confirm Devnet representations and oracles for the selected Bitcoin and Ethereum exposure. Do not substitute Mainnet mints or simulated assets.
2. Resolve and approve one fee schedule; conflicting proposals remain in project documentation.
3. Define NAV, share decimals, rounding, slippage, minimums, and withdrawal semantics.
4. Create a governed Devnet C3 vault and share mint with evidence of its configuration.
5. Build the least-privileged keeper and independent reconciliation service.
6. Add a wallet-facing deposit flow only after validating every generated instruction, signer, authority, destination, amount, program, ALT, expiry, and recovery state.
7. Add sale and USDC withdrawal with the same controls.

Until those steps pass review, the existing Devnet USDC payment remains a separate prototype and must not be described as a C3 vault purchase.
