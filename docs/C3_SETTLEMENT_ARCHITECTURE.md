# C3 Settlement Architecture

Status: Phase 5A design only. This document does not enable settlement, change the mobile transaction, or authorize wallet activity.

## 1. Current truth and design decision

The verified C Market flow is a Devnet USDC payment from the buyer wallet to the configured C3 treasury. It does not currently acquire or distribute SOL, USDC, or JitoSOL. Until on-chain evidence exists, the product must describe the basket as planned and must not claim that a 50/30/20 allocation occurred.

### Options considered

| Option | Strengths | Risks and delivery cost | Decision |
| --- | --- | --- | --- |
| Non-custodial basket settlement into the buyer wallet | Best custody posture; the buyer receives the assets directly; a single atomic transaction can be inspected in Explorer; compatible with Mobile Wallet Adapter because the buyer signs the transaction. | Requires a settlement contract or carefully composed instruction set, live liquidity for every leg, quote expiry/slippage controls, ATA handling, transaction-size/compute management, and a safe way to source the payment while delivering outputs. Devnet liquidity is not a safe assumption. | Canonical production target, after audited implementation and Mainnet liquidity verification. |
| Treasury-managed settlement with verifiable accounting | Closest to the current payment model; can support asynchronous execution and reconciliation; easier to demonstrate with an indexed receipt and explicit status. | Custody and operational-key risk; an off-chain ledger alone is not proof of allocation; partial execution, insolvency, and legal/product-claim risk are material. It is not acceptable to call a payment “settled” before every leg is proven. | Recommended hackathon architecture: a narrowly scoped, transparent settlement service and on-chain receipt/escrow design, initially disabled on Devnet when real routes are unavailable. |
| Tokenized vault or receipt token | Composable position and transferability; on-chain ownership can be easy to query. | Requires a vault/share-price/redemption design, token authority controls, NAV/oracle policy, audits, accounting, and stronger legal disclosure. A receipt token can itself look like an investment product. | Defer; not an MVP or a safe shortcut. |

### Recommendation

Use treasury-managed settlement with verifiable accounting as the achievable C3 MVP, but define the long-term trust boundary so it can migrate to non-custodial output settlement. The MVP must be a real state machine, not a simulated allocation: `payment_finalized -> settlement_pending -> each_leg_finalized -> settled`, or `failed/recoverable`. A payment with no completed legs remains a payment, not a C3 position.

This recommendation is about delivery scope, not an investment recommendation. It preserves the already verified payment path, avoids inventing a Devnet market, and gives judges a reproducible audit trail. The production target remains non-custodial atomic settlement into the buyer wallet.

## 2. Verified platform facts and source URLs

The following are verified facts from primary documentation; recommendations are identified separately.

- Solana transactions are atomic units composed of multiple instructions. The current documented limit is 1,232 bytes and 1.4M compute units; CPIs have a maximum stack depth of five. Address Lookup Tables can reduce account-address pressure in versioned transactions. Source: https://solana.com/docs/core and https://solana.com/docs/core/transactions/versioned-transactions
- Recent blockhashes expire. The application must retain `lastValidBlockHeight`, confirm against the same blockhash window, and classify expiration separately from rejection or RPC failure. Source: https://solana.com/developers/cookbook/transactions/confirmation
- Token accounts and associated token accounts are mint-and-owner specific. Creating an ATA in the same transaction is possible, but the payer bears rent and untrusted destination handling can create abuse or cost risk. Source: https://solana.com/docs/payments/send-payments/verify-address and https://solana.com/docs/tokens/basics
- Native SOL is not an SPL token account balance. WSOL uses the native mint `So11111111111111111111111111111111111111112`, with wrap/sync/unwrap instructions when a token route requires it. Source: https://solana.com/docs/tokens/basics and https://solana.com/nl/docs/tokens/basics/sync-native
- Mobile Wallet Adapter lets an app request transaction signing/submission through the wallet; `signAndSendTransactions` is the preferred MWA 2.0 path. The app supplies the cluster/RPC context. Source: https://docs.solanamobile.com/get-started/react-native/mobile-wallet-adapter and https://docs.solanamobile.com/mobile-wallet-adapter/diagrams
- Jito documents a Devnet deployment, but it is a separate deployment from Mainnet: Devnet program `DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib`, stake pool `JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ`, and Devnet JitoSOL mint `J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi`. The Mainnet/Testnet mint is `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`. Jito also states that the Devnet deployment on the shared SPL Stake Pool program is outdated and recommends its separate current Devnet deployment. Source: https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/
- Jito recommends Jupiter for buying or selling JitoSOL and warns that trade execution can have slippage. Source: https://www.jito.network/docs/jitosol/get-started/buying-or-selling-jitosol-flow/
- Jupiter’s current developer documentation describes Swap API v2 order/build flows, assembled transactions or raw instructions, transaction landing, account setup instructions, `maxAccounts`, and slippage/RTSE controls. The documented integration is not evidence of a Devnet route. Source: https://dev.jup.ag/docs/swap

## 3. Network and Devnet feasibility

The current canonical app remains Solana Devnet with the repository’s existing public configuration. The Devnet USDC mint is a test asset and has no Mainnet value or liquidity implication. Devnet accounts, balances, routes, and program deployments are independent from Mainnet.

Jupiter support must be treated as a runtime capability, not inferred from a Mainnet quote. Before enabling a Devnet settlement leg, a read-only preflight must prove that the exact input/output mints, amount, route, setup instructions, quote expiry, and transaction simulation work on Devnet. If the official Jupiter endpoint does not return a valid Devnet route, settlement is disabled with a truthful “not available on Devnet” state.

JitoSOL is technically deployed on Devnet according to Jito’s official address page, but that does not prove sufficient supply, faucet access, exchange liquidity, or a Jupiter route for the required amount. The Devnet JitoSOL mint must therefore be discovered from the active Jito deployment and never replaced by the Mainnet mint. A demo may show the verified payment and a pending/planned settlement state; it may not show 50/30/20 as completed without three verifiable legs.

## 4. Recommended user journey

1. The user selects C3 and sees the versioned target weights: SOL 50%, USDC 30%, JitoSOL 20%.
2. The review screen states the cluster, payment asset, treasury destination, minimum amount, fees, slippage policy, and that the current Devnet prototype may record payment without settlement.
3. MWA opens the compatible wallet. The buyer signs only the payment transaction currently supported by the app.
4. The app confirms the payment signature at the required commitment and stores the signature as the idempotency key.
5. A settlement worker observes the finalized payment, validates the exact mint, sender, destination, amount, cluster, and basket version, then creates or updates a public receipt record.
6. If all required routes and controls are available, the worker executes the legs under the state machine below. Otherwise it leaves the receipt `settlement_pending` and explains why.
7. The app displays payment, settlement status, per-leg signatures, actual amounts, quote timestamps, and Explorer links. It never converts “planned” into “settled”.

## 5. On-chain sequence and custody model

### MVP treasury-managed sequence

1. Existing user-signed USDC payment to the C3 treasury remains unchanged.
2. A permissionless observer detects finality and creates an idempotent settlement record keyed by payment signature plus basket-version hash.
3. A restricted executor validates the record and obtains fresh quotes. Each quote is bounded by input/output minimums, expiry, route allowlists, and a maximum fee.
4. The executor creates only the required treasury-owned ATAs, pays rent from a bounded operational account, and executes each leg. A failed leg stops further execution and marks the record recoverable; it does not claim completion.
5. The executor writes or emits a receipt containing the payment signature, exact input, basket version, target amounts, actual output amounts, leg signatures, and status. A reconciliation job verifies the balances and signatures independently.

This model is treasury custody: the basket assets remain under treasury-controlled accounts unless and until a later withdrawal or delivery feature is implemented. That requires explicit operational controls, key rotation, withdrawal policy, access logging, and legal review. No private key belongs in the mobile app.

### Production non-custodial target

After audit, compose a single buyer-signed transaction or settlement-program interaction that atomically routes payment and delivers the resulting SOL/USDC/JitoSOL to buyer-owned accounts. Use v0 transactions and ALTs only when measured account pressure requires them. If the complete plan cannot fit or simulate, split it into explicit stages with a receipt state and user-visible recovery; do not pretend a multi-transaction sequence is atomic.

## 6. Failure, recovery, and accounting

Required statuses: `payment_pending`, `payment_finalized`, `settlement_pending`, `leg_quoted`, `leg_submitted`, `leg_finalized`, `settled`, `failed_recoverable`, and `manual_review`.

- Expired blockhash: rebuild from fresh quotes/blockhash; never blindly replay a payment.
- Quote expired or slippage exceeded: mark the leg retryable and require a new bounded quote.
- ATA missing: create the exact mint/owner ATA only after validation; record the rent payer.
- Insufficient SOL for fees: stop before execution and record a clear operational error.
- RPC timeout: query signature status and balances before any retry; payment signature is the idempotency key.
- Partial execution: reconcile actual treasury balances and leg signatures; retry only the missing leg under a new state transition, with no duplicate credit.
- Wallet rejection affects only the user payment stage; no settlement worker acts without a finalized payment.

Receipt fields: `receipt_id`, `payment_signature`, `cluster`, `payer`, `treasury`, `payment_mint`, `payment_amount_base_units`, `basket_id`, `basket_version_hash`, `target_weights_bps`, `quote_ids/timestamps`, `actual_leg_amounts`, `leg_signatures`, `status`, `created_at`, `updated_at`, and `failure_code`. Activity history should expose public values only and link every signature to the correct cluster.

## 7. Security boundaries and required configuration

The mobile app remains a public read/signing client. It must not hold treasury keys, executor keys, seed phrases, Jupiter credentials, or database credentials. The settlement service must use a restricted signer or multisig/HSM-backed operational boundary, allowlisted programs/mints, bounded per-payment limits, replay protection, immutable audit logs, alerting, and independent reconciliation.

Future public configuration names, without values, should be:

- `EXPO_PUBLIC_SOLANA_CLUSTER`
- `EXPO_PUBLIC_SOLANA_RPC_URL`
- `EXPO_PUBLIC_DEVNET_USDC_MINT`
- `EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY`
- `EXPO_PUBLIC_APP_IDENTITY_URI`
- `EXPO_PUBLIC_C3_BASKET_ID`
- `EXPO_PUBLIC_C3_BASKET_VERSION`
- `EXPO_PUBLIC_C3_SETTLEMENT_ENABLED`
- `EXPO_PUBLIC_C3_JITOSOL_MINT` (network-specific; never reuse Mainnet on Devnet)

Server-only configuration should not be placed in Expo variables: executor signer reference, RPC credentials, Jupiter credentials if required by the selected API plan, database URL, alerting credentials, and deployment secrets.

## 8. MVP stages and acceptance criteria

Stage 0 — Design and legal/product review: freeze weights, fees, minimums, disclosures, custody model, and basket versioning.

Stage 1 — Read-only Devnet preflight: discover active mints/programs, verify the Devnet JitoSOL deployment, probe official quote availability, simulate ATA creation and route size, and fail closed when a route is absent. No signing or settlement.

Stage 2 — Receipt-only integration: index the existing verified payment, create an idempotent `payment_finalized` receipt, and show truthful pending/not-available status. Existing payment rollback remains intact.

Stage 3 — Treasury-managed test settlement: use only supported test assets and a bounded executor; prove each leg with signatures, balances, and Explorer links; test duplicate payments, quote expiry, partial failure, retries, and reconciliation.

Stage 4 — Security and operational review: audit program/service boundaries, key controls, rate limits, monitoring, recovery, and user disclosures.

Stage 5 — Mainnet migration: use separately verified Mainnet mints, pools, routes, fees, liquidity, legal terms, and release configuration. Do not promote Devnet addresses or claims.

Acceptance requires: every receipt is idempotent; every completed leg has a finalized signature; exact mints and amounts reconcile; failed legs are visible and recoverable; no duplicate settlement is possible; the app never claims C3 allocation from a payment alone; and a cold-start Seeker demo can show the receipt and Explorer evidence without hidden manual steps.

## 9. What can be demonstrated now and what must wait

Truthfully demonstrable on Devnet today: C Market identity, MWA wallet connection, Devnet USDC balance, a user-approved USDC payment to the C3 treasury, finalized signature verification, Explorer evidence, and a clearly labeled planned/pending settlement architecture.

Must wait for implementation and evidence: automatic 50/30/20 allocation, JitoSOL acquisition, quote and slippage guarantees, user basket position, redemption, yield, rebalancing, Mainnet funds, investment-like claims, and any claim that C3 settlement happened.

## 10. Rollback plan

Keep the current payment path behind the existing Devnet configuration and feature flag. If settlement preflight, executor, or reconciliation fails, disable settlement only, preserve payment confirmation and Explorer receipt, label the result “USDC payment recorded; basket settlement not enabled,” and do not reverse or replay the payment automatically. Roll back the receipt/worker deployment independently of the mobile APK. The verified app remains usable and no user wallet action is required for rollback.

## Sources

- Solana Mobile Wallet Adapter: https://docs.solanamobile.com/get-started/react-native/mobile-wallet-adapter
- Solana Mobile MWA diagrams: https://docs.solanamobile.com/mobile-wallet-adapter/diagrams
- Solana core concepts and transaction limits: https://solana.com/docs/core
- Solana versioned transactions and ALTs: https://solana.com/es/docs/core/transactions/versioned-transactions
- Solana confirmation and blockhash expiry: https://solana.com/developers/cookbook/transactions/confirmation
- Solana SPL token basics and WSOL: https://solana.com/docs/tokens/basics
- Solana payment address/ATA verification: https://solana.com/docs/payments/send-payments/verify-address
- Jupiter developer Swap documentation: https://dev.jup.ag/docs/swap
- Jito deployed programs and network-specific mints: https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/
- Jito buying or selling JitoSOL: https://www.jito.network/docs/jitosol/get-started/buying-or-selling-jitosol-flow/
