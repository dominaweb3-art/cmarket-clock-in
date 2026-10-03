# C3 owner protocol — implementation evidence, not release approval

Classification: SHARED. Started from `e680f2bfd060bf50743ecd6571463b7f42448a74`
on `feature/c3-open-pilot-vault`. Mainnet execution and mobile monetary capability
remain immutable `false`; reviewed production configuration remains `null`.
No Mainnet transaction, deployment, wallet approval or transfer was performed.

## Implemented and tested

- Additive migration 0009 retains the SAME `c3_open.intents`, revisions and history.
  Owner-request generations, predecessors, authentication hashes, send attempts,
  results and expiry evidence are append-only. No second position ledger exists.
- Server-generated challenge binds HTTPS audience, PG owner wallet and intent,
  random nonce and DB-clock expiry. Ed25519 verification creates a hashed session;
  raw bearer exists only in volatile mobile/server response memory. Audience is
  rechecked on every use. Explicit recovery reauthentication can bind an expired
  request without granting permission to submit it.
- Exact signed v0 message, wallet signer/payer, blockhash, CAS and session/request
  binding are verified. Signature and dispatch claim commit BEFORE one transport
  call, outside PG locks. A crash/lost reply preserves the signature and permits
  read-only recovery, not a second send. `accepted` is never economic confirmation.
  The gated production sender checks two RPC blockhash/height observations and
  specifies `maxRetries: 0`; it was NOT invoked on Mainnet.
- Safe expiry requires blockhash invalidity followed by finalized unchanged
  account images at/after the invalidity context. Two reviewed HTTPS operators
  are required by the production adapter. Known on-chain signature evidence,
  divergent/missing data, changed inventory, pending finality and CAS conflicts
  block closure. Receipt/outcome contradictions are rejected under the intent lock.
- Mobile exposes explicit owner reauthentication, safe cancellation and request
  replacement in four languages. No background signing or automatic retry.
  Same-generation replay is rejected BEFORE storage changes. Proven non-execution
  with an unregistered server signature preserves the locally saved signature.
  These are owner-request replacements; not a claim of complete mobile settlement-
  plan renewal. The release gate still disables these monetary controls.
- Candidate semantic reconciliation checks exact signed message, ordered inner
  hashes, all token/SOL deltas and finalized configuration/intent bytes before a
  durable CAS transition. Signatures or agreeing RPC replies alone cannot advance
  it. Generated Anchor IDL regression confirms the decoded offsets. This verifier
  is incomplete for production, as explicitly described below.

## Verified local execution and tests

The affected cycle was executed ONCE after the owner migration/pending-query
changes. Evidence is ignored at
`programs/c3-pilot-vault/results/jupiter-cycle-ut624B/report.json`:
all six real cloned Jupiter/Whirlpool legs finalized and reconciled on one PG
intent; sell inputs came from those buys; 1,000,000 local share units were issued
and burned; 998,250 synthetic USDC base units returned. Restart, uncertain-signature
read-only recovery, concurrent workers and duplicate-claim rejection passed.
Packets were 753–846 bytes. This is NOT Mainnet acquisition or a real user position.

Mobile: 26/26 tests; PG owner baseline: 7/7; new PG auth/send/expiry protocol: 6/6;
economic/IDL verifier: 2/2; quorum intake and dual-operator expiry tests passed;
package boundary: 4/4. TypeScript, lint and formatting passed. Expo Doctor 19/19.
Production APK and Android export built successfully. Node module-type, Metro
exports-fallback and Gradle deprecation warnings remain visible.

A separate read-only agent reproduced and reviewed audience, expiry ordering,
reauthentication, signature preservation and pre-persist replay fixes. It confirmed
the targeted replay reproduction performs zero writes and retains the signature.
This is an independent code review within this workflow, NOT an external audit
or a production security/governance approval.

## Dependency scope — no suppression

Initial mobile graph: 4 High / 8 Moderate. Compatible official UUID 11.1.1 is
pinned only under Xcode 3.0.1; CommonJS `generateUuid` passed 1,000 vectors and
registry SRI matched the lockfile. Expo 57.0.25 → 57.0.26 plus its required patch
dependencies fixes Doctor without changing SDK, React Native or MWA versions.

Latest normal and `--omit=dev` mobile audit: **17 High / 0 Moderate** after the
braces advisory database update. These are propagated graph entries, not 17
independent runtime vulnerabilities. Roots:

- Expo → CLI/code-signing certificates → node-forge 1.4.0:
  [official advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
- Expo → CLI → Metro file map → micromatch 4.0.8 → braces 3.0.3:
  [official advisory, updated October 2](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Historical moderate UUID risk:
  [official advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

Neither remaining root has a patched official version; braces 3.0.4 is absent from
the registry. No fork, suppression, force fix or incompatible Expo/RN downgrade.
Both roots remain installed in the mobile build-tool graph. Actual Gradle release
source map has 681 modules: no node-forge, braces, micromatch, npm UUID, Xcode, PG,
local clone harness or external signer module. Generated Hermes bytes match the
APK's embedded bundle exactly. Separate Expo export is not byte-identical and is
NOT substituted as APK evidence. Service production audit: zero findings.

## Preserved candidate artifact

Ignored stable directory: `artifacts/c3-pilot-candidate/2026-10-02-owner-protocol-disabled`.
APK `c-market-c3-mainnet-candidate-0.1.0-disabled.apk`:
SHA-256 `eeefd73add4b92717f342162c97ec4d6d362f3e8d5776eb386aac86938c8253a`.
Package `com.dominaweb3.cmarket.c3candidate`, version 0.1.0/code 1.
Certificate SHA-256
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
Certificate scope is QA ONLY, not governance-approved production signing.
Seeker was detected as `device`; installed package certificate matched. Data-
preserving `adb install -r` succeeded. Cold launch passed with no Metro listener,
followed by Home/Indices/Activity, 40/30/30 and independently checked translated
navigation in en/es/zh-CN/pt-BR. XML/screenshots are ignored in the same directory.
No wallet was opened, no message/transaction was approved, and new physical MWA
authentication remains pending. A separate reviewer verified the APK/hash, actual
Gradle source map and byte-identical embedded Hermes bundle, including false/null
gates and excluded build-tool/local-clone modules.
Existing APKs, default program and IDL were preserved. No program changes required
rebuilding or changing their recorded hashes/capital estimate.

## Exact code blockers — PARTIALLY_COMPLETED

1. `handleProductionOwnerProtocol` connects auth, binding, submission, expiry and
   durable status, but production preparation/position routes and HTTPS hosting
   integration are NOT implemented. Mobile configuration intentionally stays null.
2. The production `c3_open` enrollment/migration runner and trusted owner packet/
   economic-manifest compiler are absent. Migration 0009 was applied only to
   disposable test PG. No caller-supplied manifest is accepted as approval.
3. `verifyOwnerEconomicEffects` is not yet a complete independent decoder of
   settlement-plan revision/inventory and share-mint authorities/extensions. The
   current full snapshot/hash checks do not replace those semantic proofs. Finalized
   production promotion must not be enabled until this is implemented and tested.
4. Mobile settlement-plan renewal (distinct from expired owner-request replacement)
   and end-to-end productive leg capture/promotion still require integration.
   Ephemeral local key tests do NOT substitute physical MWA message/transaction
   signing by the owner. No verified physical MWA return was supplied: the user's
   result text was a placeholder, not PASS.

## One external-input list and safe configuration

Supply public owner wallet; separate governance/update/pause/keeper/quote authority
addresses and decisions; two chosen independent HTTPS RPC operators with reviewed
operator documentation; backend/signer HTTPS origins; and approved exact SOL budget.
Do not invent a Squads membership, program approval, provider or address.

Provision PG TLS/least-privilege roles and signer-provider credentials only in an
isolated server-side secret manager. RPC/Jupiter/Pyth keys also remain server-side:
`DATABASE_URL`, `C3_MAINNET_RPC_PRIMARY_URL`, `C3_MAINNET_RPC_SECONDARY_URL`,
`C3_MAINNET_RPC_PRIMARY_OPERATOR_ID`, `C3_MAINNET_RPC_SECONDARY_OPERATOR_ID`,
`C3_JUPITER_API_KEY`, `C3_PYTH_API_KEY`. Never paste secret values into chat, Git,
Expo public variables, logs or APK. Inputs alone do not resolve the code blockers.

Last verified unchanged-program estimate: persistent capital 3.58436672 SOL,
recoverable temporary buffer 3.52058732 SOL, peak capital 7.10495404 SOL; separate
1 USDC deposit. Deployment/priority/swap fees, extra recovery accounts, services
and operational SOL reserve remain unmeasured/unapproved; this is NOT an all-in
budget or authorization to deploy. Mainnet remains blocked.
