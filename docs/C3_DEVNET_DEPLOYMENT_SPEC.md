# C3 Symmetry V3 Devnet deployment specification

Status: **NO-GO** as of 2026-09-19. Classification: **SHARED**. Mainnet is disabled.

This specification defines the exact deployment candidate for one C3 product: 40% simulated Bitcoin exposure, 30% simulated Ethereum exposure, and 30% WSOL. Users contribute and redeem USDC, while Symmetry V3 owns the vault accounting and issues an SPL participation token. No vault, mint, authority, wallet request, signature, or transaction is created by this phase.

## Verified protocol flow

The deployed Symmetry V3 program is `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`. Finalized Devnet RPC evidence confirms that it is executable and owned by the upgradeable BPF loader. Its global configuration PDA is `BV49JWNeVnRjvMg4BHVoRFXNXHMFqgZFsfHg2QUekynd`, and its rent-payer PDA is `AxVsnKm1dyDm4TUPeiEbkBd98uVEJuiAon6cefKV7Rt3`.

The official flow is asynchronous:

1. A creator signs vault creation. The program creates the vault, a six-decimal share mint, metadata, lookup tables, vault fee accounts, and required token accounts.
2. A user signs creation of one active deposit intent per wallet/vault and deposits permitted tokens into program-controlled custody.
3. The deposit is locked. Fresh price updates are attached. Permissionless keeper transactions execute bounded auctions/swaps needed to match the basket.
4. The program mints proportional vault shares to the user's associated token account. A keeper may claim the defined bounty and close completed intent state.
5. For withdrawal, the user signs an intent and burns/escrows the corresponding shares. Fresh prices and any required auctions are processed. The program redeems the resulting assets to token accounts owned by that same user.
6. A USDC-only exit requires verified auction liquidity. Passing every composition token in `keep_tokens` is a direct proportional redemption; an empty or partial set invokes conversion and therefore must not be represented as instant or guaranteed.

The inspected SDK entry points are `createVaultTx` for creation, `buyVaultTx` and `sellVaultTx` for user intent construction, `rebalanceVaultTx` for rebalancing intent creation, and keeper-stage `mintTx`/`redeemTokensTx` for final share issuance or redemption. These names document the inspected SDK surface; their output remains untrusted until every instruction and account is validated.

User signatures authorize deposit and withdrawal creation. Keeper signatures advance permissionless protocol stages; they do not replace the user or own the shares. Configuration and emergency powers must be held by reviewed Squads authorities, not by the mobile app or a single developer key.

Primary protocol sources:

- <https://docs.symmetry.fi/concepts/vaults>
- <https://docs.symmetry.fi/concepts/intents>
- <https://docs.symmetry.fi/concepts/rebalancing>
- <https://docs.symmetry.fi/concepts/fees-and-oracles>
- <https://docs.symmetry.fi/guides/keeper>
- <https://docs.symmetry.fi/sdk/reference>

## Required programs, accounts, PDAs, and signers

| Item                 | Requirement                                                                | Signer/authority                                      |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| Symmetry V3          | Executable deployed program above                                          | Program-controlled                                    |
| Global config        | PDA seed `global_config`                                                   | Symmetry configuration controls                       |
| Vault share mint     | PDA seed `mint` + little-endian vault id                                   | Created by program; mint authority is the vault PDA   |
| Vault                | PDA seed `basket` + share mint                                             | Program-owned vault authority                         |
| Vault fees           | PDA seed `basket_fees` + vault                                             | Program accounting                                    |
| Withdrawal fees      | PDA seed `withdraw_basket_fees` + vault                                    | Program accounting                                    |
| Rent payer           | PDA seed `rent_payer`                                                      | Program-controlled                                    |
| Bounty vault         | PDA seed `bounty_vault`                                                    | Program-controlled                                    |
| Rebalance intent     | PDA seed `rebalance_intent` + vault + owner                                | Configuration/manager creates; keeper processes       |
| User token accounts  | ATAs for USDC and C3 shares; output ATAs as required                       | User owns accounts and signs intent creation          |
| Vault token accounts | ATAs owned by vault PDA for every configured mint                          | Program-controlled                                    |
| Lookup tables        | Two vault-scoped ALTs created during setup                                 | Creation authority must be reviewed                   |
| Metadata             | Metaplex metadata for C3 share                                             | URI approved before immutable deployment              |
| Price accounts       | Pyth receiver-owned accounts for each exposure                             | Oracle evidence only; never treated as the token mint |
| Keeper               | Operational signer with only protocol stage permissions and bounded budget | Separate least-privileged key; not in APK             |
| Squads configuration | 2-of-3 reviewed multisig candidate                                         | Weight/assets/limits/configuration                    |
| Squads emergency     | Separate 2-of-3 reviewed multisig candidate                                | Pause/emergency actions only                          |
| Fee destination      | Reviewed public token account owned by governance                          | Fees remain disabled in this candidate                |

Required programs are the System, SPL Token, Token-2022 when explicitly selected, Associated Token Account, Metaplex Metadata, Address Lookup Table, Symmetry V3, approved Pyth receiver, and only route programs admitted by a reviewed Jupiter quote/build manifest. Unknown programs or accounts fail closed.

## Devnet assets

The canonical candidate is versioned at `config/c3/c3-devnet-candidate.v1.json`.

- Input USDC: Circle Devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, six decimals. This differs from the Symmetry SDK's current built-in Devnet test USDC `USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT`. The mismatch must be resolved and tested before deployment.
- Solana: WSOL `So11111111111111111111111111111111111111112`, nine decimals, valid SPL mint. Native SOL is a user-boundary convenience only when a reviewed wrap/unwrap lifecycle is proven.
- Bitcoin: no official, redeemable Devnet BTC representation was verified. The candidate therefore requires a clearly labelled `C3 TEST Bitcoin — simulation asset, no BTC backing or redemption` mint.
- Ethereum: no official, redeemable Devnet ETH representation was verified. The candidate therefore requires a clearly labelled `C3 TEST Ethereum — simulation asset, no ETH backing or redemption` mint.

The two TEST mints do not yet exist. If created in a later phase, mint/update authority must be held by a reviewed Devnet Squads multisig, issuance must be limited to documented fixtures, production configuration must reject both mints, and every UI must label them as simulations. They must never be presented as BTC, ETH, bridged assets, redeemable assets, or Mainnet-ready collateral.

Read-only Jupiter requests currently return `TOKEN_NOT_TRADABLE` for both the Circle Devnet USDC and Symmetry test USDC to WSOL. Consequently no verified USDC-to-basket route exists.

## Oracle evidence

Pyth feed identifiers and Devnet receiver-owned accounts are recorded separately from asset mints in the versioned configuration. BTC, ETH, and SOL price accounts exist and are owned by the Pyth receiver program `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`.

The public Hermes latest-price endpoint returned HTTP 401 during this verification, while the Symmetry SDK currently points to that endpoint. Account existence therefore does not prove that a fresh signed update can be obtained and posted. Deployment requires a reviewed official transport that supplies signed updates within 60 seconds without embedding a secret in the APK.

Primary oracle sources:

- <https://docs.pyth.network/price-feeds/core/contract-addresses/solana>
- <https://docs.pyth.network/price-feeds/core/push-feeds/solana>
- <https://docs.pyth.network/price-feeds/core/fetch-price-updates>

## Share model and accounting

Verified properties:

- C3 participation is an SPL share token representing proportional vault ownership.
- Symmetry share mints use six decimals.
- Mint PDA derives from `mint` plus the vault id; vault PDA derives from `basket` plus the mint.
- A standard SPL share can be transferred unless a separate reviewed restriction exists. Product position ownership must therefore follow current on-chain token ownership, not the original purchaser.
- NAV inputs include vault token balances, current approved oracle prices, supply, protocol/vault fees, and liabilities from active intents.

Unverified properties that block deployment:

- exact on-chain order of protocol fee, future C Market fee, conversion, and share mint/burn calculations;
- integer rounding direction at every program instruction;
- residual dust ownership and recoverability;
- exact USDC-only redemption result when auctions are required;
- byte-level equivalence between preview math and executed program math.

The SDK preview contains floor operations and a fee assumption that does not match the observed Devnet global protocol fee. It is not accepted as authoritative accounting evidence. These details require executable program test vectors and reconciled RPC results before any user-facing quote or deployment.

## Product-approved candidate fee policy

Version `c3-fees/product-candidate-v1` records 15 bps for buy, 15 bps for sell, and 7.5 bps after a verified SKR discount. Product approved this candidate only. Collection and the SKR discount remain disabled until Security review and Squads governance approval are recorded.

Symmetry host fees are immutable integer basis points at vault creation and cannot encode 7.5 bps. Therefore the deployment candidate sets Symmetry host deposit and withdrawal fees to zero. No alternate fee mechanism may be added without a new security-reviewed, governance-approved version. The historical 60 bps deposit and 10 bps withdrawal proposals remain preserved as obsolete provenance.

Network fees, account rent, Jupiter costs, liquidity impact, and slippage are separate user costs and must never be folded into or mislabeled as the C Market fee.

## Proposed C Market safety policy

These are conservative C Market policy candidates, not Symmetry protocol guarantees:

- Oracle freshness: at most 60 seconds; confidence interval at most 200 bps.
- Quote expiry: 30 seconds; transaction age at most 60 seconds.
- Overall slippage: at most 100 bps; each swap leg at most 50 bps.
- Oracle-versus-quote deviation pause: 300 bps.
- Purchase range: 5–500 USDC; total test vault exposure at most 5,000 USDC.
- Rebalance: 300 bps absolute drift or 1,000 bps relative drift; one-hour cooldown.
- One concurrent intent per wallet/vault, matching the protocol constraint.
- Automatic transaction retries: zero. Uncertain outcomes require reconciliation and explicit user action.

Observed protocol values are separate: global configuration currently allows creation/deposit/withdraw/automation, uses 60-second price updates, a 600-second rebalance-intent lifetime, and reports 50 bps protocol deposit, withdrawal, and trade values. They must be re-read immediately before deployment and must not be confused with the disabled C Market fee.

Any missing/stale oracle, excessive confidence/deviation, expired/missing quote, wrong network/mint/owner/decimals, unknown route program, keeper/RPC uncertainty, exposure-limit breach, duplicate/partial intent, or unreconciled share accounting pauses the operation.

## Dependency and mobile boundary

`@symmetry-hq/sdk@1.0.22` was inspected in an isolated temporary directory. It is not installed in `apps/mobile` because its current dependency graph reintroduces `@solana/spl-token` and the vulnerable `bigint-buffer` path previously removed from the Android release. Builder/keeper tooling, if later approved, must live outside the mobile package, pin dependencies, validate every generated instruction, and expose no private authority to the APK.

## Deployment decision

**NO-GO.** The gate is intentionally strict and cannot pass with null mints, placeholder authorities, missing metadata, stale/unavailable signed prices, absent routes, or unverified share accounting. Run `npm run c3:devnet:deployment-readiness` from `apps/mobile`; a nonzero exit is the expected result until every mandatory input is independently proven.
