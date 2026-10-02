# Connected owner workflow — 2026-10-02

Classification: SHARED. Starting HEAD `95336e29e7a81dc45c3d7b7856c62986ae18d5f5`,
branch `feature/c3-open-pilot-vault`. **PARTIALLY_COMPLETED; NOT a monetary release.**
This updates the mobile/API results of the previous plan-generation checkpoint,
without superseding its preserved historical evidence or opening Mainnet.

## Implemented and demonstrated

The same mobile `OwnerController` now drives deposit, share issuance, full
redemption and USDC claim through an actual loopback HTTP server, one PostgreSQL
intent, immutable owner requests/receipts and verified finalized lifecycle effects.
Create+fund and create+lock are atomic owner transactions. The server derives
accounts/amounts/revisions from durable state and finalized vault configuration;
the mobile client independently reconstructs reviewed IDL bytes/metas and hashes
the complete reviewed message before approval. Wallet signatures are persisted
before explicit local broadcast. Neither client controller nor HTTP bridge retries
or broadcasts automatically.

Migration `0008_owner_operations.sql` is additive and local-only. Public IDs,
hashes and signatures are immutable. No unsigned/signed payload, secret or wallet
authorization token is stored. A finalized message receipt cannot issue shares or
confirm economics. Only the private non-mock checkpoint, using the exact stored
owner signature and semantic lifecycle verification, writes economic effects in
the same transaction as state/event advancement. Owner requests participate in
the intent locking boundary with plan renewals and isolated signer dispatch.

The updated six-leg cycle report is ignored:
`programs/c3-pilot-vault/results/jupiter-cycle-35vGrk/report.json`.
Intent `cc90d152-e05b-42c6-9816-0cf3895fd9f9`, result
`PASS_LOCAL_CLONED_JUPITER_CYCLE`. All six Jupiter/Whirlpool legs passed actual
cloned-validator execution; sales used the actual balances obtained by purchases.
All signatures and sealed quote authorizations were durable and effects reconciled.

| Leg               | Input units | Quoted output | Threshold = signed minimum | v0 bytes |
| ----------------- | ----------: | ------------: | -------------------------: | -------: |
| USDC → cbBTC      |      400000 |           473 |                        469 |      753 |
| USDC → Portal ETH |      300000 |         11250 |                      11138 |      753 |
| USDC → WSOL       |      300000 |       2540141 |                    2514740 |      846 |
| cbBTC → USDC      |         473 |        398869 |                     394881 |      784 |
| Portal ETH → USDC |       11248 |        299615 |                     296619 |      815 |
| WSOL → USDC       |     2541802 |        300071 |                     297071 |      846 |

Issued and burned 1,000,000 local share units; returned **998443 synthetic USDC
base units**, not a guaranteed 1 USDC return. New-process restart, owner renewal,
uncertain read-only recovery, duplicate promotion/claim rejection and three
hostile mutations of actual validator transaction evidence passed. Ephemeral
local keys are not physical MWA approval or Mainnet acquisition. The fixture
uses the same controller, not the Android UI itself, to drive the local bank.

Position HTTP reads the Token-2022 ATA, mint and vault configuration at one
finalized context; verifies wallet, share mint, program ownership, initialization,
decimals, mint authority, supply bounds and 4000/3000/3000 targets. It exposes
raw shares and slot, never invented NAV. Its HTTP/PG position regression uses
synthetic RPC accounts; the cycle independently verifies actual share effects.
`LOCAL_CLONE` position/finality is rejected by the production mobile codec.

## Mobile, review and validation

Reproduce from `services/c3-mainnet`: `npm run test:open-owner-postgres` for the
disposable journal/HTTP tests. The integrated cycle command is
`C3_LOCAL_VALIDATOR_BIN=/Users/juantorres/.local/share/solana/install/releases/3.1.10/solana-release/bin/solana-test-validator node scripts/test-postgres-local.mjs --open-jupiter-cycle --renew-plan`.
It signs and sends only in the ephemeral cloned local bank, never Mainnet; do not
invoke it as a production keeper. Reuse the passed report unless code changes
require replaying the cycle.

Candidate screens wire to the owner controller and gated MWA `signTransactions`.
One panel stays mounted across Home/Indices/Activity, preserving its pending
controller; changing wallet deliberately clears that wallet's view. Public receipt
metadata is persisted separately from in-memory packets. Restart cannot trust a
stored finalized state: explicit recovery is required. Invalid `signed/null`,
forged message hashes and mismatched evidence cannot overwrite a valid receipt.

Separate read-only AI reviewer reproduced hash-binding and null-signature defects;
both were corrected and independently rechecked. No new High/Medium was reproduced
in those targeted changes. This is **not** a professional external audit, a review
of the complete production system or governance approval.

TypeScript/lint/format: three packages passed. Mobile tests 22/22; real disposable
PG owner tests 7/7, generation tests 13/13, quote/signer 2/2, recovery 1/1; focused
RPC/external-signer/production-boundary tests 7/7. Service export boundary 4/4 and
vault artifact boundary 2/2 passed. Rust source/binary were unchanged; the six-leg
cycle exercised the existing separate local binary. No redundant Rust rebuild.

Android export and signed release build passed. Source map: 668 sources, including
owner controller/policy/backend/position, no clone launcher, server, PostgreSQL or
isolated signing-journal modules. APK signature v2, QA-only RSA3072 certificate.
The immutable monetary capability remains false and reviewed configuration null.

Expo Doctor 18/19: installed 57.0.25 differs from recommended 57.0.26. Existing Metro
`@noble/hashes/crypto.js` fallback, Node module-type and Gradle deprecation warnings
remain. No unrelated upgrades or suppressions. Direct SHA-256 helper pins the
already-installed `@noble/hashes` 2.4.0; official npm SRI matches the lockfile.
`npm audit --omit=dev`: 4 High, 8 Moderate, 0 Critical; audit is **not clean**.
Node-forge, xcode and the vulnerable npm uuid modules were absent from mapped APK
runtime sources; Expo's Metro require shim is present. Build-tool risks still need
compatible remediation before approval; no force-fix or false clean-audit claim.

## Exact preserved package (ignored, not committed)

Directory `artifacts/c3-pilot-candidate/2026-10-02-owner-workflow-disabled-final/`:

- APK `c-market-c3-mainnet-candidate-0.1.0-disabled.apk`, SHA-256
  `fdb872187f6687ca7090706135b347eb26770dcc02d4dc4dc8138e75c5327a59`.
- Package `com.dominaweb3.cmarket.c3candidate`, 0.1.0/code 1.
- QA certificate SHA-256
  `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
- Disabled SO 692864 bytes, SHA-256
  `d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
- IDL SHA-256
  `7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`.

Prior QA/stable APKs and other worktrees remain intact. A matching certificate
allowed data-preserving candidate installation. Standalone cold launch succeeded
without Metro. Home, 40/30/30 Indices and truthful empty Activity passed on Seeker.
Four-language switching/persistence passed on the preceding same-source-language
candidate; final navigation received its own physical recheck. Phantom chooser
opened; successful user connection/return and physical monetary MWA are not proven.

Read-only official Mainnet rent evidence at `2026-10-02T22:00:05.426Z`:
3.58436672 SOL persistent; 3.52058732 SOL recoverable deployment buffer;
7.10495404 SOL transient peak. This is for the **disabled** binary with max-len
equal to its size. Deployment/network/priority fees, owner ATA/reserve, services,
upgrade headroom and later attempts are excluded. Separate 1 USDC deposit.
No deployment budget is approved; enabling code requires reviewed rebuild/hashes
and refreshed costs, not deployment of these disabled artifacts.

## Exact remaining implementation gates

1. `collectFinalizedOpenEconomicEvidence` still returns
   `FINALIZED_QUORUM_REQUIRES_SEMANTIC_VERIFICATION`. It cannot promote PostgreSQL
   economics. Production lifecycle/CPI/account/ALT semantic verification must be
   connected to durable transitions; equal RPC responses alone are not enough.
2. `createIsolatedOwnerServer` is a fixed-intent, loopback-only test bridge.
   Reviewed production authentication/bootstrap and explicit submission transport
   are absent. `reviewedCandidateOwnerConfiguration()` remains null. Setting
   credentials alone does not complete this implementation.
3. Owner requests have an immutable unique intent/action. A prepared request lost
   or expired before its receipt stays blocked; verified terminal absence and
   append-only replacement are missing. Do not delete it or silently prepare again.
   Plan-generation recovery exists, but its owner-renewal endpoint/UI is not wired
   into this candidate controller. Stale-blockhash revalidation before physical
   approval also needs the reviewed production evidence adapter.
4. The economic position backend remains local-only; production independent
   freshness/ownership proof and NAV are absent. Physical explicit signing and
   lifecycle recovery in an approved isolated MWA setup remain unverified.

Owner inputs requested once: public allowlisted wallet and upgrade/governance/
pause/keeper/quote authorities; isolated signer public identity; reviewed names
of two independent RPC providers/operators; server/PostgreSQL/backend operating
decision and maximum budget. Secrets are entered only in isolated server storage,
never chat/APK/Git. Inputs are not approvals and do not close code gaps.

Mainnet, real Buy/Sell, fees and SKR remain disabled. No Mainnet wallet transaction,
deployment, transfer or push occurred. Only local ephemeral validator operations
and read-only official RPC/Jupiter requests were executed. Next implementation:
close semantic two-operator promotion and terminal owner-request recovery before
preparing an enablement package. Phone action is connection-only QA of the exact
APK above; do not authorize a monetary signature.
