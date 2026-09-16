# C3 Settlement Architecture

Status: Phase 5C Mainnet feasibility design only. This document does not enable settlement, change the mobile transaction, or authorize wallet activity.

## 1. Current truth and design decision

The verified C Market flow is a Devnet USDC payment from the buyer wallet to the configured C3 treasury. It does not currently acquire or distribute basket assets. The former C3 target of SOL 50% / USDC 30% / JitoSOL 20% is superseded by C3 Core: Bitcoin exposure 40% / Ethereum exposure 30% / Solana exposure 30%. Until on-chain evidence exists, the product must describe the basket as planned and must not claim that an allocation occurred.

The Devnet payment release remains fully functional and separate from the future Mainnet C3 Core design. No Mainnet values are copied into the mobile app or its public configuration by this document-only phase.

### Options considered

| Option                                                 | Strengths                                                                                                                                                                                              | Risks and delivery cost                                                                                                                                                                                                                                                                          | Decision                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-custodial basket settlement into the buyer wallet  | Best custody posture; the buyer receives the assets directly; a single atomic transaction can be inspected in Explorer; compatible with Mobile Wallet Adapter because the buyer signs the transaction. | Requires a settlement contract or carefully composed instruction set, live liquidity for every leg, quote expiry/slippage controls, ATA handling, transaction-size/compute management, and a safe way to source the payment while delivering outputs. Devnet liquidity is not a safe assumption. | Canonical production target, after audited implementation and Mainnet liquidity verification.                                                                                            |
| Treasury-managed settlement with verifiable accounting | Closest to the current payment model; can support asynchronous execution and reconciliation; easier to demonstrate with an indexed receipt and explicit status.                                        | Custody and operational-key risk; an off-chain ledger alone is not proof of allocation; partial execution, insolvency, and legal/product-claim risk are material. It is not acceptable to call a payment “settled” before every leg is proven.                                                   | Recommended hackathon architecture: a narrowly scoped, transparent settlement service and on-chain receipt/escrow design, initially disabled on Devnet when real routes are unavailable. |
| Tokenized vault or receipt token                       | Composable position and transferability; on-chain ownership can be easy to query.                                                                                                                      | Requires a vault/share-price/redemption design, token authority controls, NAV/oracle policy, audits, accounting, and stronger legal disclosure. A receipt token can itself look like an investment product.                                                                                      | Defer; not an MVP or a safe shortcut.                                                                                                                                                    |

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

## 11. Phase 5B read-only Devnet feasibility preflight

Preflight tool: `apps/mobile/scripts/c3-devnet-feasibility-preflight.mjs`, run with `npm run c3:preflight` from `apps/mobile`. It performs only JSON-RPC reads and read-only Jupiter quote requests. It does not request wallet authorization, construct or serialize transactions, or submit anything. A machine-readable result is written under the ignored path `apps/mobile/dist/generated-results/`.

Observed at `2026-09-15T22:54:27.734Z` (UTC), against `https://api.devnet.solana.com`:

- RPC: `verified`. `getHealth` returned `ok`; version, epoch, and finalized account reads also resolved.
- Configured Devnet USDC mint: `verified`. The account exists, is owned by the SPL Token Program, is initialized, and reports 6 decimals and non-zero supply.
- JitoSOL Devnet mint: `verified`. The official Jito Devnet mint account exists, is owned by the SPL Token Program, is initialized, and reports 9 decimals and non-zero supply.
- Jito deployment: `verified` for the official Devnet program and stake-pool accounts listed in Section 2. This confirms deployed accounts, not a liquid USDC conversion route.
- Jupiter endpoint: `https://api.jup.ag/swap/v1/quote`. The preflight supplied no API key and never printed or persisted any credential. The API was queried only for quote responses.
- Jupiter USDC -> SOL/WSOL: `unavailable` for the 5, 10, and 50 USDC purchase sizes. The observed response was `TOKEN_NOT_TRADABLE`; therefore no quote, price impact, route, or expiry can be truthfully reported.
- Jupiter USDC -> JitoSOL: `unavailable` for 5 and 10 USDC; the observed response was `TOKEN_NOT_TRADABLE`. The 50 USDC request returned HTTP 429, which is `unavailable/uncertain` rather than evidence of a route. No quote, price impact, route, or expiry can be truthfully reported.
- Leg amounts tested: SOL/WSOL at 2.50, 5.00, and 25.00 USDC; JitoSOL at 1.00, 2.00, and 10.00 USDC, corresponding to 50% and 20% of 5, 10, and 50 USDC. The remaining 30% USDC leg requires no swap.
- Liquidity and slippage: `unavailable` because no valid Devnet Jupiter route was returned. The preflight does not substitute Mainnet data. ATA setup, transaction size, simulation, quote expiry, and execution fees remain pending until a real route exists.
- Cluster restriction: `verified` as a safety rule. The configured app is Devnet-only; a Mainnet/Testnet quote or mint cannot establish Devnet feasibility.

### Explicit decision: NO-GO

The C3 basket cannot truthfully execute its real 50/30/20 allocation on Devnet based on this preflight. The Devnet USDC and JitoSOL accounts exist, but the required Jupiter routes are unavailable and one JitoSOL request was rate-limited. The tool exits non-zero for this mandatory-feasibility failure. This is not evidence that the routes can never exist; it is sufficient evidence that settlement must remain disabled until a later preflight verifies them.

Jito’s direct Devnet path is `conditional`, not a GO: the official program, stake pool, and mint accounts are present, and Jito documents direct minting from SOL or conversion from stake accounts. That path does not convert the current USDC payment by itself, so it cannot satisfy the C3 20% USDC-to-JitoSOL leg without a separately verified USDC-to-SOL conversion path and additional operational controls.

Smallest truthful hackathon alternative: preserve the verified USDC payment, expose the C3 weights as a planned methodology, and add only a read-only receipt state such as “payment recorded; basket settlement unavailable on Devnet.” Do not use simulated assets or present a simulated allocation as real. Re-run this preflight after any network, mint, or official-route change before implementing settlement.

## 12. Phase 5C — C3 Core Mainnet feasibility preflight

Observed at `2026-09-16T01:36:21.594Z` UTC using read-only Mainnet RPC and Jupiter quote requests. This section is evidence and design guidance only; it does not switch the mobile app to Mainnet and does not authorize or build a transaction.

### Canonical target and asset selection

The fixed C3 Core target is:

- Bitcoin exposure: 40%, represented by cbBTC.
- Ethereum exposure: 30%, represented by Wormhole Portal ETH.
- Solana exposure: 30%, represented by native SOL. WSOL may be used only as an internal swap-route asset and must be unwrapped before presenting the final balance when the route requires it.

The old SOL 50% / USDC 30% / JitoSOL 20% composition is superseded and must not be used in new Mainnet materials or implementation plans.

Input USDC was verified on Mainnet as mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, owned by the SPL Token Program, initialized, with 6 decimals. The read-only script also checks its finalized supply before quoting.

Preferred Bitcoin representation: cbBTC mint `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij`. Finalized RPC data reported SPL Token Program ownership, 8 decimals, and supply `3385.24163108` cbBTC. Jupiter’s token directory marked it verified, with approximately `$28.28M` liquidity, approximately `$53.90M` 24-hour buy volume, approximately `$50.24M` 24-hour sell volume, and approximately 73,151 holders at observation time. Coinbase states that cbBTC is backed 1:1 by BTC held in Coinbase custody. This creates centralized issuer, custody, redemption, jurisdiction, and potential depeg risks; a Jupiter verification badge is not a solvency or redemption guarantee.

Ethereum candidates compared:

| Candidate           | Mainnet mint and observed facts                                                                                                                                                                                                                                                                                                                           | Decision and risks                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wormhole Portal ETH | `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs`; finalized RPC reported SPL Token Program ownership, 8 decimals, and supply `41538.62044554`. Jupiter marked it verified/major/strict, with approximately `$21.66M` liquidity, approximately `$19.42M` 24-hour buy volume, approximately `$19.64M` 24-hour sell volume, and approximately 127,552 holders. | Selected. The representation has the strongest observed combination of current verification, liquidity, volume, and routing. Wormhole’s wrapped-token model depends on source-chain custody/locking, Guardian-attested messages, destination minting, and later redemption; bridge, custodian, depeg, and operational risks remain. |
| Sollet soETH        | `2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk`; finalized RPC reported SPL Token Program ownership, 6 decimals, and supply `483499.577393`. Jupiter marked it verified/strict/community, but observed liquidity was approximately `$34.6K`, 24-hour buy and sell volume approximately `$7.3K` each, with organic score 0.                                 | Rejected for the target basket. Current primary issuer, backing, bridge, and redemption documentation was not established; low liquidity and legacy operational risk make it unsuitable for a 30% strategic allocation.                                                                                                             |
| Wormhole wstETH     | Jupiter search returned `ZScHuTtqZukUrtZS43teTKGs2VqkKL8k4QCouR2n6Uo`.                                                                                                                                                                                                                                                                                    | Not selected: it is staked-Ethereum exposure rather than plain ETH exposure, and the observed liquidity was approximately `$10`; its additional staking, bridge, redemption, and depeg risks do not fit this fixed ETH sleeve.                                                                                                      |

The selection is therefore based on verified mint identity, observed liquidity and volume, current route quality, and a documented bridge model—not on the ETH symbol alone.

### Read-only Jupiter quote results

The reusable script is `apps/mobile/scripts/c3-core-mainnet-feasibility-preflight.mjs`, invoked with `npm run c3:core:mainnet-preflight` from `apps/mobile`. It calls the current `/swap/v1/quote` endpoint with Mainnet USDC and 100 bps slippage. It never requests wallet authorization, builds or serializes a transaction, or submits one. Keyless requests are rate-limited; the script spaces requests and uses the official lite-api endpoint only as a read-only fallback after a 429. No API-key value is printed or persisted.

| Purchase | Leg                    |  Expected output |   Minimum output |   Price impact (Jupiter value) | Route / DEXes                                         |
| -------- | ---------------------- | ---------------: | ---------------: | -----------------------------: | ----------------------------------------------------- |
| 50 USDC  | 20 USDC -> cbBTC       | 0.00026460 cbBTC | 0.00026196 cbBTC | 0.0001057728026860619440170314 | HumidiFi                                              |
| 50 USDC  | 15 USDC -> Portal ETH  |   0.00625950 ETH |   0.00619691 ETH |                              0 | HumidiFi                                              |
| 50 USDC  | 15 USDC -> native SOL  |  0.155059132 SOL |  0.153508541 SOL |                              0 | Byreal -> Byreal; lite-api fallback after primary 429 |
| 100 USDC | 40 USDC -> cbBTC       | 0.00052928 cbBTC | 0.00052399 cbBTC |                              0 | GoonFi V2                                             |
| 100 USDC | 30 USDC -> Portal ETH  |   0.01251858 ETH |   0.01239340 ETH | 0.0000724052805505810284905958 | HumidiFi                                              |
| 100 USDC | 30 USDC -> native SOL  |  0.310057430 SOL |  0.306956856 SOL |                              0 | HumidiFi                                              |
| 500 USDC | 200 USDC -> cbBTC      | 0.00264623 cbBTC | 0.00261977 cbBTC | 0.0000576708230303945726965002 | TesseraV                                              |
| 500 USDC | 150 USDC -> Portal ETH |   0.06259774 ETH |   0.06197177 ETH |                              0 | TesseraV                                              |
| 500 USDC | 150 USDC -> native SOL |  1.550402603 SOL |  1.534898577 SOL |                              0 | BisonFi                                               |

The quote response exposes net output, route plans, DEX labels, `otherAmountThreshold`, price impact, and context slot. These quote-only responses did not return explicit fee fields; the `fees` result is therefore recorded as “not returned by the quote response; reflected only in the net output amount,” not as zero. The 165-byte SPL token-account rent estimate was `1,488,440` lamports. Exact setup/cleanup costs are route- and account-dependent and were not built. cbBTC and Portal ETH may require user-owned associated token accounts; native SOL has no final token account; internal WSOL setup is route-dependent.

The quote payload did not provide a transaction expiry. A future implementation must rebuild quotes immediately before signing, then build with a fresh recent blockhash and retain `lastValidBlockHeight`. The recorded timestamp and context slot are evidence of the read-only quote, not a guarantee that the quote remains executable.

### Decision: CONDITIONAL_GO

The requested Mainnet routes were available for all 50, 100, and 500 USDC purchase sizes at the observation timestamp, so a production proof-of-concept is feasible. This is not a release approval. The decision remains conditional on transaction-build and simulation evidence, account setup, v0 transaction sizing/compute measurements, scoped API rate control, wallet UX, security review, custody/bridge risk disclosures, and legal/product review.

### Transaction packaging and recovery recommendation

A single versioned transaction was not proven because the read-only phase intentionally did not call a build endpoint, serialize instructions, or simulate. Three swaps plus ATA creation, possible WSOL wrap/unwrap, compute-budget instructions, and address tables may exceed safe size or compute margins. The safest MVP is three explicit sequential swap transactions:

1. Quote USDC -> cbBTC for 40%, show route, price impact, minimum output, programs, and fees, and request one MWA approval.
2. After finality, quote USDC -> Portal ETH for 30%, show the same details, and request a second MWA approval.
3. After finality, quote USDC -> native SOL for 30% (using WSOL only internally if required), show the same details, and request a third MWA approval.

Each route must send output directly to the same buyer wallet. A leg failure stops the sequence, reconciles confirmed signatures and balances, marks the basket partial/recoverable, and never claims the target allocation. The app must not auto-retry a failed or expired swap; the user may explicitly retry only the missing leg with a fresh quote and fresh MWA approval. If the first leg succeeds and a later leg fails, no duplicate credit or silent treasury custody is created.

MWA should present Mainnet as a separate, explicit future release context and use `signAndSendTransactions` for each approved swap. The wallet must show the exact input mint/amount, destination wallet, output mint/route, minimum output, network, and Explorer link. No background or automatic signing is permitted.

### Non-custodial production flow and future rebalance

The user selects C3 Core and sees fixed 40/30/30 weights. C Market reads balances and obtains fresh quotes. USDC leaves the user wallet only through the user-approved Jupiter swaps. cbBTC, Portal ETH, and native SOL return directly to that same user wallet. C Market never receives or controls a private key, and the existing Devnet treasury payment remains a separate prototype path.

A future rebalance must be user-authorized: read current holdings, compare them with target weights, calculate deltas, obtain fresh bounded quotes, show all fees/slippage/minimums, and request explicit MWA approvals. There is no automatic rebalancing, custody, yield, or guaranteed-return claim.

### Required future evidence and remaining blockers

Before Mainnet implementation, build and simulate every leg, measure v0 size and compute, test ATA creation and rent, verify output ownership, enforce mint/program/route allowlists, handle quote and blockhash expiry, rate-limit the Jupiter integration without putting a secret in Expo, and complete wallet, security, custody, bridge, legal, and product-copy review. Mainnet liquidity observations do not prove redemption or solvency. The Devnet app and verified Devnet payment must remain unchanged and independently releasable.

## Sources

- Solana Mobile Wallet Adapter: https://docs.solanamobile.com/get-started/react-native/mobile-wallet-adapter
- Solana Mobile MWA diagrams: https://docs.solanamobile.com/mobile-wallet-adapter/diagrams
- Solana core concepts and transaction limits: https://solana.com/docs/core
- Solana versioned transactions and ALTs: https://solana.com/es/docs/core/transactions/versioned-transactions
- Solana confirmation and blockhash expiry: https://solana.com/developers/cookbook/transactions/confirmation
- Solana SPL token basics and WSOL: https://solana.com/docs/tokens/basics
- Solana payment address/ATA verification: https://solana.com/docs/payments/send-payments/verify-address
- Jupiter developer Swap documentation: https://dev.jup.ag/docs/swap
- Jupiter Swap API quote endpoint used by the read-only preflight: https://api.jup.ag/swap/v1/quote
- Jito deployed programs and network-specific mints: https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/
- Jito buying or selling JitoSOL: https://www.jito.network/docs/jitosol/get-started/buying-or-selling-jitosol-flow/
- Jito staking SOL for JitoSOL: https://www.jito.network/docs/jitosol/get-started/stake-sol-for-jitosol-flow/overview/
- Coinbase cbBTC overview and Solana mint: https://www.coinbase.com/cbbtc
- Coinbase cbBTC proof of reserves: https://www.coinbase.com/en-it/cbbtc/proof-of-reserves
- Jupiter current quote API documentation: https://dev.jup.ag/docs/swap/v1/get-quote
- Jupiter token search documentation: https://dev.jup.ag/docs/tokens/v2/search
- Jupiter API rate limits: https://dev.jup.ag/docs/portal/rate-limits
- Wormhole Wrapped Token Transfers: https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/overview/
- Wormhole Connect supported token configuration: https://wormhole.com/docs/products/connect/configuration/configuration-v0/
- Solana token verification guidance: https://solana.com/docs/tokens/how-to-verify-a-token
