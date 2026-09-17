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

## 13. Phase 5D.1 — Mainnet keyless build, inspection, and simulation harness

Observed at `2026-09-16T03:30:36.064Z` UTC. This phase remained read-only: no wallet authorization, signing, transaction submission, transfer, Mainnet mobile configuration, or Devnet payment change occurred.

The reusable harness is `apps/mobile/scripts/c3-core-mainnet-build-simulation.mjs`, invoked with `npm run c3:core:mainnet:build-simulate` from `apps/mobile`. It targets the official Jupiter Swap API V2 Router endpoint `https://api.jup.ag/swap/v2/build` and program-label endpoint. It keeps only summarized metadata and simulation logs in the ignored file `apps/mobile/dist/generated-results/c3-core-mainnet-build-simulation.json`; it never persists serialized unsigned transaction payloads.

### Explicit decision: READY_FOR_DISABLED_IMPLEMENTATION

The earlier `BLOCKED` result was caused solely by a local environment-variable guard that returned before making a request when `JUPITER_API_KEY` was absent. It was not based on a Jupiter authentication response. After removing that premature guard, official keyless access succeeded:

- Nine sequential `/swap/v2/build` requests returned HTTP 200 on their first attempt.
- The program-label request returned HTTP 200 on its first attempt.
- No `x-api-key` header was sent, and no HTTP 401, 403, 429, or retry occurred.
- Keyless requests ran sequentially with at least 2.5 seconds between request starts. Only HTTP 429 is eligible for at most two bounded retries, and `Retry-After` or available rate-limit reset headers are respected.
- `JUPITER_API_KEY` remains optional. When supplied, its value is hidden and used only in the `x-api-key` header; it is never printed or persisted and must never enter Expo public configuration.

This verifies Jupiter authentication behavior for the read-only prototype harness. It does not authorize production mobile clients to embed an API key or imply that current routes will remain available.

### Sequential build and security evidence

The harness obtained fresh exact-input builds for the 20/15/15 USDC, 40/30/30 USDC, and 200/150/150 USDC legs with 100 bps slippage, a 64-account route cap, a 150-slot blockhash window, and native SOL cleanup behavior. All nine independent v0 transactions were below the 1,232-byte limit:

- 50 USDC purchase: cbBTC 688 bytes, Portal ETH 877 bytes, SOL 756 bytes.
- 100 USDC purchase: cbBTC 526 bytes, Portal ETH 490 bytes, SOL 966 bytes.
- 500 USDC purchase: cbBTC 1,128 bytes, Portal ETH 526 bytes, SOL 1,136 bytes.

Every build had the public test address as its only required signer and fee payer. Exact USDC inputs matched the allocation leg. cbBTC and Portal ETH outputs targeted the same user's associated token accounts; native SOL targeted the same user address. Each leg included expected associated-token-account setup where needed. No treasury destination, unexpected SOL transfer, token approval, delegate, authority change, or unsafe close-account instruction was found. No platform or tip fee was reported; compute-budget instructions were present.

Program-label access succeeded. Top-level programs were limited to the Compute Budget Program, Associated Token Program, SPL Token Program, and Jupiter Swap Program v6. Jupiter's label response omitted these entries, so the harness used an official static allowlist; the Jupiter v6 address is verified by Jupiter's official Swap Program documentation. No program remained unknown.

### Combined measurement and simulation evidence

The three-leg combined v0 transaction was measured separately for each purchase and rejected before simulation because every result exceeded 1,232 bytes: 1,656 bytes for 50 USDC, 1,288 bytes for 100 USDC, and 1,893 bytes for 500 USDC. Sequential execution is therefore mandatory for the disabled implementation.

All nine sequential transactions reached read-only RPC simulation with signature verification disabled and a replacement blockhash. None is reported as a successful execution. Each stopped with Jupiter custom error 6025 (`InvalidTokenAccount`) because the public test address had no Mainnet USDC token account. This is an environmental failure, not proof of a route defect or successful execution. Compute consumption and logs were captured in the ignored generated result. No transaction was signed or submitted.

### Safest sequential state machine

The recommended implementation remains three separate transactions: fresh quote -> user review -> MWA approval for one leg -> confirmation -> immutable receipt -> continue. The cbBTC leg uses 40%, Portal ETH 30%, and native SOL 30%. Each request must show the exact input, minimum output, route, fees, network, destination, and expiry information before `signAndSendTransactions` is called. No approval for a later leg is requested before the prior leg is finalized.

Every leg uses an idempotency key composed of `userPublicKey + purchaseId + basketVersion + legAsset + quoteRequestId`, plus an application-side state transition that rejects duplicate submissions. A confirmed leg is never automatically reversed. If a later leg fails, the remaining USDC stays in the user wallet, completed and pending legs remain visible separately, no automatic retry occurs, and resumption requires a fresh quote and explicit user approval for only the missing leg. A stale quote or blockhash is discarded rather than replayed.

This phase does not change the verified Devnet payment flow or mobile transaction code. The next safe action is a disabled-by-default Mainnet implementation of the sequential state machine, followed by structural tests and a supervised simulation with a purpose-built funded test wallet before Mainnet can be exposed in the UI.

## 14. Phase 5E — Disabled non-custodial engine

The first production-oriented engine is implemented behind the public flag `EXPO_PUBLIC_ENABLE_C3_MAINNET`. The flag is fail-closed: only the exact string `true` enables it, and execution is refused unless the configured cluster is `mainnet-beta`. The current `.env.example` keeps the flag `false`; the Devnet app continues to use its existing configuration and purchase implementation.

The engine is isolated under `services/c3-core-mainnet-*` and `constants/c3-core-mainnet.ts`. It centralizes the verified Mainnet mints, decimals, 40/30/30 weights, 100-basis-point slippage cap, Jupiter keyless endpoints, program allowlist, 1,232-byte limit, and blockhash policy. Integer USDC allocation assigns 40% to cbBTC and 30% to Portal ETH; native SOL receives the remainder so all legs sum exactly to the requested amount. Purchases below 50 USDC are rejected on Mainnet only.

Only sequential execution is supported: fresh quote and build -> structural review -> explicit MWA approval -> finalized confirmation -> public receipt -> next leg. A quote is held only in memory and is discarded on restart, expiry, validation failure, cancellation, or completion. The engine rejects stale blockhashes, wrong cluster, wrong mints or amounts, wrong taker, non-user signers or fee payers, treasury destinations, unknown programs, unexpected SOL transfers, delegates, approvals, permanent authorities, unsafe closes, and oversized transactions. It never embeds or reads a Jupiter API key.

Purchase persistence is limited to a cryptographically random, versioned intent ID, wallet address, total and leg allocation metadata, state, timestamps, public signatures, and confirmed output amounts when the finalized transaction exposes them. No unsigned or signed transaction payload is persisted. Confirmed legs cannot be submitted again; a failed or cancelled leg is never automatically retried or reversed. Remaining USDC stays in the user's wallet, completed and pending legs remain distinguishable, and resumption requires a fresh quote plus explicit approval.

The guarded route is registered only for deep-link and future integration testing; the normal account UI does not navigate to it while disabled. It displays the C3 Core weights, estimated and minimum outputs, price impact, slippage, fees, token-account setup disclosure, custody/issuer disclosures, partial-completion risk, Explorer receipts, and localized progress states in all four supported locales. No Mainnet wallet action was requested in Phase 5E. The engine remains disabled until funded-wallet simulation, runtime Seeker verification of the hidden route, and security/legal review are complete.

## 15. Phase 5G.1 — Transaction-validation hardening

The disabled engine was hardened after an independent security review. Mainnet remains disabled by default and the verified Devnet payment flow is unchanged. The engine has no caller-controlled enable override: the exact environment value `EXPO_PUBLIC_ENABLE_C3_MAINNET=true` is required, and the runtime cluster must be exactly `mainnet-beta`. Release builds therefore fail closed when the flag is absent, malformed, or false.

Purchase amounts are parsed as strict decimal strings into USDC base-unit `bigint` values. Signs, scientific notation, non-finite values, excess precision, leading-zero forms, negative values, and overflow are rejected. Mainnet purchases must be between 50 and 500 USDC. The 40/30/30 allocation uses integer arithmetic and assigns the remainder to SOL so the three legs always sum exactly to the input.

Before any future MWA request, each Jupiter build must match the exact input mint, output mint, input amount, output threshold, taker, `ExactIn` mode, slippage bound, route plan, and fresh blockhash window. The route balance graph must consume the complete input and produce the declared output; unsupported route variants and variable step payloads fail closed until independently reviewed. The current validator decodes the official Jupiter V2 `routeV2` and `sharedAccountsRouteV2` discriminators and only the reviewed fixed step layouts.

The compiled v0 transaction is compared with the raw Jupiter build. The connected user must be the only required signer and fee payer. Outputs must resolve to that same user's wallet or canonical associated token account. The C3 treasury is rejected anywhere in the instruction/account set. Unknown top-level programs, human-label-only program matches, arbitrary transfers, approvals, delegates, authority changes, unrelated account closes, duplicate compute-budget instructions, unsafe priority fees, and unexpected setup/cleanup fail closed. Token-2022 is not accepted for the approved basket assets.

For native SOL routes, an ephemeral WSOL account is allowed only when it is the expected user-owned associated account. A close-account instruction is accepted only for that temporary WSOL account, with the connected user as authority and lamport recipient. Other closes or refunds are rejected. Address lookup tables are fetched from RPC, checked against the official lookup-table program, required to be active and current, and compared entry-for-entry with Jupiter's build response; missing, stale, deactivated, or mismatched tables fail closed.

The validator has a sanitized valid fixture and malicious fixtures for excessive input, wrong mint, excessive threshold, invalid slippage, missing taker, wrong swap mode, route amount mismatch, unsupported Jupiter variant, unknown program, extra signer, different fee payer, third-party destination, unauthorized token transfer, unrelated close, fabricated or missing/deactivated lookup tables, and WSOL lamports refunded to a third party. A complete SOL fixture also proves the expected WSOL setup, funding, sync, and user-only cleanup path. These are structural tests only. RPC simulation remains defense-in-depth and must never be presented as successful when it stops because a test address lacks Mainnet balances or token accounts. The sequential state machine, MWA behavior, hardened persistence/recovery model, and no-auto-retry/partial-completion policy are preserved.

The read-only Mainnet build harness now resolves Jupiter-provided lookup-table addresses through Mainnet RPC before compiling an unsigned measurement. It verifies lookup-table ownership, active/current state, and exact on-chain contents; it never fabricates lookup-table accounts from API-provided address arrays. If the official RPC is unavailable, the harness stops without building or simulating and records the environment blocker.

Authoritative implementation references: Jupiter's V2 build schema at https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml, the official Jupiter instruction parser at https://github.com/jup-ag/instruction-parser, the generated Jupiter V2 route layouts at https://docs.rs/jupiter-solana-client/latest/src/jupiter_solana_client/generated/instructions/route_v2.rs.html and https://docs.rs/jupiter-solana-client/latest/src/jupiter_solana_client/generated/instructions/shared_accounts_route_v2.rs.html, and Solana's transaction JSON and program references at https://solana.com/docs/rpc/json-structures and https://solana.com/docs/core/programs.

## Phase 5G.2 persistence and recovery hardening

The disabled Mainnet engine now uses a strict persisted document schema version 2 under a dedicated AsyncStorage key. The document contains only a monotonic document revision and validated purchase metadata. Each intent records the exact `mainnet-beta` cluster, canonical wallet, immutable total input, basket version, per-leg order, approved input/output mints, user-owned destination, state, public signature, approved minimum output, confirmed output, timestamps, and a bounded diagnostic code. Unknown schema versions, extra fields, malformed keys or signatures, unsupported mints, changed allocations, non-canonical integers, invalid timestamps, impossible states, duplicate IDs, and legacy array data are rejected; corrupted data is not silently converted into an executable purchase.

Allocations are recomputed from the immutable original USDC base-unit total on every read: 40% cbBTC, 30% Portal ETH, and the exact remainder as the SOL leg. The three leg amounts must sum exactly to the original input and remain constrained to 50–500 USDC. Intent IDs use 128 bits from the platform cryptographic random source and support an injected generator in tests; they are not derived from wallet, amount, or time.

State mutations use a process-wide asynchronous single-writer mutex, expected revisions, staged writes, read-back verification, and a staging-key conflict check. A stale revision, concurrent conflict, or write verification failure is non-submittable and requires reconciliation. Confirmed legs are immutable. The persisted submission lifecycle distinguishes `awaiting_wallet`, `submitted_unconfirmed`, `confirmed`, `failed_on_chain`, `cancelled_before_submission`, `submission_outcome_uncertain`, and `reconciliation_required`.

The engine persists the leg and intent before wallet approval. A signature returned by `signAndSendTransactions` is treated as submitted immediately; any later RPC, UI, or storage failure preserves the signature and blocks retry or subsequent legs. No automatic retry or reversal exists. Recovery performs a bounded, read-only recent-history search and matches wallet, exact USDC debit, expected mint, user destination, Jupiter program, and timestamp window. Exactly one fully validated match may recover a missing signature; zero or multiple matches remain blocked until explicit review and are never guessed or resubmitted.

Confirmation is an injectable trust boundary. Future execution requires two independently configured Mainnet providers to agree on the signature, finalized slot, error, signer and fee payer, Jupiter program, exact USDC debit, user-owned output, minimum output, lookup-table validation, and prohibited-effect checks. Missing, malformed, timed-out, pruned, or conflicting evidence becomes `reconciliation_required`. A finalized `meta.err` becomes `failed_on_chain` only after the same complete evidence checks. The default app configuration does not configure production providers and Mainnet remains disabled.

The focused regression suite covers malformed and unknown persisted schemas, wallet/amount/mint/allocation/destination tampering, invalid signatures, duplicate IDs, stale and concurrent writes, staged-storage failures, restart visibility of submitted state, confirmed-leg immutability, RPC agreement/disagreement/timeout/malformed evidence, wrong sender or mint, excessive debit, output below minimum, missing effects, finalized on-chain errors, and zero/one/multiple history recovery matches. These tests use sanitized evidence only; they never request a wallet, sign, submit, or transfer.

## Phase 5I.1 — reconciliation evidence, provider quorum, and route sizing hardening

This phase keeps Mainnet disabled and leaves the verified Devnet payment flow unchanged. It hardens the disabled Mainnet engine and its read-only security harness; it does not request a wallet, sign, submit, or transfer funds.

### Finalized transaction evidence

`services/c3-core-mainnet-reconciliation.ts` now requires raw finalized v0 evidence obtained with `maxSupportedTransactionVersion: 0`. The evidence includes static and loaded account keys, every outer and inner instruction with decoded program/account references and base64 data, pre/post SPL token balances, pre/post lamport balances, fees, logs, slot, block time, finality, and independently resolved address lookup tables. Lookup tables are fetched from RPC, checked against the official ALT owner, activity/current-slot rules, referenced indexes, and loaded addresses. Missing or malformed fields fail closed.

Reconciliation validates the connected wallet as the only signer and fee payer, the exact approved USDC debit, user-owned output accounts, expected mints and minimum output, native SOL/temporary WSOL accounting, allowed route programs, token/system/ATA/compute instruction semantics, and prohibited authority, approval, delegate, treasury, arbitrary transfer, and unsafe-close effects. A finalized transaction with an RPC error is reported as `failed_on_chain` only after the same complete evidence checks; incomplete or conflicting evidence remains `reconciliation_required`.

### Independent RPC quorum and evidence fingerprints

Production confirmation now requires at least two explicitly configured Mainnet providers. Each provider must have a non-empty distinct identity and a distinct normalized endpoint; duplicate IDs, duplicate endpoints, invalid endpoints, missing responses, timeouts, malformed evidence, or semantic disagreement fail closed. Semantic quorum includes transaction signature, cluster, slot, block time, finality, error, signer/fee payer, program IDs, balances, instructions, logs, and ALT evidence. Diagnostic fingerprints additionally include provider identity and block time so evidence cannot be confused across providers or time.

The mobile app intentionally does not configure these providers while Mainnet is disabled. Any future release must inject two independent providers explicitly; one shared RPC endpoint is not sufficient.

### Portal ETH v0 serialization boundary

The previously observed `encoding overruns Uint8Array` failure is a route-size failure at v0 serialization, not a wallet or authorization failure. A deterministic estimator now measures the complete serialized v0 envelope, including signatures, static keys, compiled instructions, and lookup-table references, before calling the web3 serializer. The 1,232-byte packet limit is enforced and serialization overflow is classified as `c3_route_too_large`.

The engine requests fresh routes sequentially with bounded `maxAccounts` candidates of 64, 48, and 32. It retries only after a size-classified route failure, never invokes the wallet for an oversized route, and reports the leg unavailable when no compliant candidate remains. This is a bounded route-shaping fallback, not a guarantee that Portal ETH is always routable or that three legs are atomic.

### Realistic adversarial fixtures and regression coverage

`scripts/fixtures/c3-core-mainnet-realistic-fixtures.ts` contains sanitized v0-shaped evidence with a loaded ALT, nested route CPI, token balance deltas, lamport balances, logs, and a deterministic oversized Portal ETH transaction. `c3-core-mainnet-reconciliation-security.test.ts` covers valid cbBTC, Portal ETH, and SOL evidence; malicious inner destinations; wrong ALT ownership; missing inner evidence; wrong output destinations; treasury references; duplicate provider IDs/endpoints; quorum disagreement; provider-aware fingerprints; the 1,232-byte boundary; and the no-wallet-callback size-failure boundary. Existing engine and recovery suites continue to cover allocation, route validation, persistence, restart, duplicate prevention, and partial-completion recovery.

These are deterministic structural tests, not proof of live Mainnet liquidity or successful execution. The Phase 5H dependency finding remains intentionally outside this phase; no dependency upgrade or audit-force change was made. Before enabling Mainnet, configure two genuinely independent providers, run funded-wallet read-only/supervised validation, and resolve any live Portal ETH route or liquidity blocker separately.

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
- Jupiter Swap API overview: https://developers.jup.ag/docs/swap
- Jupiter current Router build API: https://developers.jup.ag/docs/swap/build
- Jupiter Portal setup and API-key handling: https://developers.jup.ag/docs/portal/setup
- Jupiter Swap Program v6 ID and errors: https://developers.jup.ag/docs/swap/v1/common-errors

## Phase 5I.2 — CVE-2025-3194 dependency remediation

The release dependency audit identified `bigint-buffer@1.1.5` (CVE-2025-3194 / GHSA-3gc7-fjrx-p6mg) through this exact pre-remediation chain: `@solana/spl-token@0.4.15` -> `@solana/buffer-layout-utils@0.3.0` -> `bigint-buffer@1.1.5`. The historical `@solana/spl-token@0.4.15` package integrity was `sha512-3Lof3mNov8NVQ3PalIWb1Jgr/TZ6lYM+/sexv2TLqdhNFVth2OfWmH3d7QucgMjSbokkjNiNlRr6I8Fd269uaw==`. The package had three production imports: the verified Devnet buy screen and two disabled Mainnet validation/engine modules. The Android Hermes bundle also contained `toBigIntLE` and `toBufferLE`, so this was a shipped production path rather than a package-manifest-only warning.

The current official package line did not provide a verified patched upstream version compatible with this Expo/React Native and legacy `@solana/web3.js` baseline. The npm audit suggestion to downgrade to `@solana/spl-token@0.1.8` was rejected as an incompatible major change. A dev-only move was also rejected because it left the vulnerable implementation in the installed graph and made audit results ambiguous.

The selected remediation is a small, locally auditable compatibility module at `apps/mobile/utils/spl-token-compatible.ts`. It implements only the helpers used by C Market: synchronous/asynchronous ATA derivation, `createAssociatedTokenAccountInstruction`, and `createTransferCheckedInstruction`. It uses the official ATA seeds, legacy SPL Token and Associated Token program IDs, the official six-account ATA meta order, and the official TransferChecked layout: discriminator `12`, unsigned little-endian u64 amount, and u8 decimals. It rejects non-integer or unsafe numbers, negative values, u64 overflow, invalid decimal widths, and non-exact 8-byte u64 decode input. The Node harness and C3 tests use this same module; `@solana/spl-token`, `@solana/buffer-layout-utils`, and `bigint-buffer` are removed from the project lockfile entirely.

`apps/mobile/scripts/spl-token-compatible.security.test.ts` freezes the official 0.4.15 ATA address and instruction snapshots, compares all account metas and bytes, checks deterministic Devnet transaction-message construction, exercises null/truncated/oversized/malformed u64 inputs, and proves no wallet callback is involved. The official snapshots are test-only evidence and are not bundled.

Verification after remediation: `npm ls --all @solana/spl-token @solana/buffer-layout-utils bigint-buffer` is empty; `npm explain bigint-buffer` finds no dependency; the production Android export contains no `bigint-buffer`, `toBigIntLE`, `toBufferLE`, or `buffer-layout-utils` markers. `npm audit --omit=dev` reports 0 high and 0 critical vulnerabilities after the change (20 moderate findings remain in unrelated Expo, web3, router, and build-tool paths). Before remediation it reported 3 high findings among 25 total, including this advisory. No dependency version was upgraded, Mainnet remains disabled, and the verified Devnet transaction semantics are unchanged.

The read-only C3 Core Mainnet build harness also completed with keyless Jupiter access on 2026-09-16. It built all nine fresh measurements for 50, 100, and 500 USDC across cbBTC, Portal ETH, and SOL, and recorded environmental simulation failures only because the public inspection address is not funded on Mainnet. It made no wallet request and produced no transaction submission. The existing C3 fixture, engine, recovery, reconciliation, and compatibility suites passed. Export warnings remain limited to known `rpc-websockets` and `@noble/hashes` package-export fallbacks; Expo Doctor passed all 21 checks.

## Phase 5I.3 — build capability, persisted-state invariants, and Devnet isolation

The shipped Android artifact is a Devnet-only build. `constants/c3-mainnet-build-capability.ts` contains the source-controlled capability constant `false`; Mainnet capability is not read from `process.env`, constructor options, AsyncStorage, deep links, or route parameters. `assertC3MainnetExecution` remains a second exact-cluster gate, but it cannot be reached successfully while this artifact capability is false. Creating a future Mainnet-capable artifact requires a reviewed source change, a separate release commit, and the complete Mainnet security checklist. The current release never enables Mainnet.

The guarded Mainnet implementation remains preserved under `apps/mobile/disabled/` for review and future controlled work, but its Expo Router screen is no longer registered under `app/`. The Devnet bundle isolation check scans the production Android export for the Mainnet RPC endpoint, Jupiter build/label endpoints, Mainnet C3 mints, and the Jupiter v6 program marker. The current Devnet export must contain none of those values; the guarded implementation is not deleted or silently altered.

Persisted C3 state uses schema version 3. Every read validates an explicit invariant matrix before returning an intent:

| Purchase state                         | Required persisted evidence                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `draft`                                | Every leg is `pending`; no signature, confirmation, or recovery evidence.              |
| `quoting`                              | No blocked leg and the purchase is not complete.                                       |
| `ready_for_review` / `awaiting_wallet` | An approvable `awaiting_approval` leg exists and no leg is blocked.                    |
| `submitted_unconfirmed`                | A submitted leg has a preserved signature or bounded recovery record.                  |
| `confirmed` / `completed`              | Every leg has a signature, approved minimum, confirmed output, and finalized evidence. |
| `failed_on_chain`                      | A failed leg preserves its signature; no submitted, blocked, or confirmed leg remains. |
| `cancelled_before_submission`          | A cancelled leg exists and no leg is confirmed, submitted, or blocked.                 |
| `submission_outcome_uncertain`         | An uncertain leg has a signature or bounded recovery record.                           |
| `reconciliation_required`              | A blocked leg has a signature or bounded recovery record.                              |
| `partially_completed`                  | At least one leg is confirmed and at least one leg remains unresolved or failed.       |

Confirmed legs require finalized evidence and are immutable. Allocations, wallet, cluster, mints, destinations, order, basket version, total amount, intent identifier, and creation time are immutable after intent creation; allocations are recomputed from the original bigint total rather than trusted from persisted input. A corrupted or impossible document is quarantined with a review-required persistence error. It is never normalized into an executable state. Safe v2 draft records can migrate to v3; legacy records that cannot prove the v3 evidence requirements are quarantined.

The Android app has one application process: the manifest contains no additional process, service, or worker for C3 persistence. AsyncStorage mutations are serialized by an in-process single-writer mutex and protected by document revisions, staging writes, read-back verification, and a second revision check immediately before the write. A stale writer or an interrupted staging record fails closed as `storage_conflict` or `reconciliation_required`. Tests cover stale writers, restart visibility, interrupted writes, duplicate IDs, immutable intent fields, migration, corrupted records, and impossible state combinations. This is intentionally not presented as cross-process locking; a future multi-process design must replace AsyncStorage with a transactional store before enabling Mainnet.

Recovery records are bounded to a 24-hour review window and three attempts. A returned signature is persisted before confirmation; missing or uncertain outcomes preserve either the signature or a bounded recovery record and cannot be automatically retried. Restart recovery uses read-only reconciliation and explicit user review. The implementation never treats three sequential legs as atomic and never represents partial completion as full settlement.

### Phase 5I.3 acceptance checks

- `npm run test:c3-core-mainnet-capability` proves environment, direct-guard, and route-registration bypasses remain closed.
- `npm run test:c3-core-mainnet-recovery` proves the v3 matrix, safe migration, quarantine, immutable fields, staged writes, restart, and conflict behavior.
- `npm run test:devnet-bundle-isolation` scans the fresh production Android export for guarded Mainnet endpoints, mints, and program markers.
- The signed APK remains the Devnet release and is validated with its existing package identity and cold-launch procedure. No wallet approval or transaction is part of this phase.

The verified Devnet USDC payment flow is unchanged. Mainnet source remains disabled and excluded from the normal Expo Router graph; this phase does not claim Mainnet settlement capability.
