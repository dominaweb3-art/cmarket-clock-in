# C3 trusted owner integration — partial implementation evidence

Classification: SHARED. Starting commit:
`cbc11149ad55ccb36ebb80bc7b95dd34839c77e6`, branch
`feature/c3-open-pilot-vault`. Execution spans October 2–3, 2026.
This is **PARTIALLY_COMPLETED**, not production approval. Mainnet execution and
mobile monetary capability stay immutable `false`; approved configuration stays
`null`. No Mainnet authorization, signing, submission, transfer, publication,
deployment or push occurred. The local validator uses ephemeral fixture keys and
synthetic initial balances. Those signatures and cloned swaps are NOT Mainnet
asset acquisition or a physical user's MWA signature.

## Implemented code and boundaries

1. `open-owner-compiler.ts` derives owner packets from versioned server policy,
   durable intent, wallet, vault, generations and finalized account evidence.
   It verifies byte-pinned Anchor IDL, canonical instruction/account order,
   privilege union, exact budgets, minima, ownership, expiry, signer/payer and
   complete unsigned v0 size. Client-supplied policies or manifests are not
   approval. Manifest and economic expectations commit together with request
   creation under PostgreSQL locks/CAS; prior records remain immutable.
2. `open-state-semantics.ts` independently decodes raw vault, intent, plan,
   Token-2022 share mint and token account data. It checks program ownership,
   authorities, allowed extensions, reserves, actual acquired inventory,
   progression bitmaps and settlement identity. `open-owner-effects.ts` requires
   exact signed message, ordered inner instructions and complete token/SOL
   effects before share issuance, redemption or claim promotion. Valid signature
   storage alone never confirms an economic action. Prefunded System-owned empty
   PDAs are handled using actual prebalances and exact Anchor rent/setup effects;
   unrelated transfers or initialized replacement accounts fail closed.
3. `open-owner-schema.ts` explicitly applies ten pinned additive migrations and
   enrolls the SAME `c3_open.intents` plus six legs. Migration 0010 introduces
   immutable enrollment/manifests and finalized-failure outcomes; it does not
   create another position ledger. `open-owner-trust.ts` binds every productive
   preparation, read, submission, expiry and reconciliation to that enrollment
   and source-reviewed policy, including the actual approved share mint.
4. `open-owner-auth-http.ts`, `open-owner-http-server.ts` and `open-owner-entry.ts`
   connect authentication, preparation, position, explicit submit, expiry and
   reconciliation behind direct HTTPS. Startup requires reviewed approval before
   reading secrets or opening PostgreSQL/TLS. Origin/Host, methods, bounded body,
   verified PG TLS and sanitized failures are enforced. The isolated test adapter
   and productive two-independent-RPC wrapper use the SAME owner compiler and
   preparation service core; no substitute mobile packet compiler was introduced.
5. `open-owner-renewal.ts` reconciles an explicitly owner-signed renewal before
   append-only generation promotion. It preserves inventory, prior seals,
   signatures and history; active/uncertain submissions block incompatible
   preparation. `open-owner-expiry.ts` closes requests only after independent
   finalized non-execution/rollback evidence and dead blockhash checks, not device
   time. Owner and renewal outcome journals close atomically.
6. Mobile `owner-policy`, `owner-controller`, `owner-backend`, `candidate-owner`
   and `OwnerLifecyclePanel` implement review, explicit MWA renewal, authenticated
   position queries and read-only reconciliation of uncertain requests. No
   automatic authorization, send, retry or monetary background action exists.
7. `open-production-signer.ts` verifies the quote's exact durable generation and
   corresponding renewal deadline both before and after the isolated signer.
   Advancement across signing rejects stale authorization. The external signer
   still has no local-key fallback; it was not invoked with production material.

**Remaining code link (not an external-input-only blocker):** productive creation
of settlement plans and trusted Jupiter leg contexts, quote sealing/signing,
finalized Jupiter leg effect promotion and orchestration are not yet connected to
this HTTPS service. They still live in `pilot-open-local/open-quote.ts`,
`open-reconcile.ts` and `orchestrator.ts`. Historical migration 0003 permits only
`LOCAL_CLONE`/`LOCAL_MOCK` quote contexts, while the productive signer requires
`MAINNET_REVIEWED`. A constraint relaxation alone would self-certify trust and is
not a fix. A reviewed factory/verifier/migration must produce and bind those
contexts and CAS promotions before buy → position → sell → claim can complete
through the productive service. Position NAV deliberately returns
`PRICE_NOT_RECONCILED`, not a fabricated valuation. No complete production C3
position or redemption is claimed.

## Focused verification

- TypeScript, lint, formatting and `git diff --check`: PASS for affected packages.
- Owner compiler/raw-state semantics, effect reconciliation, rollback/expiry,
  renewal, trust and signer-generation tests: PASS. Some test imports register
  shared fixture cases; runner totals must not be described as distinct vectors.
- Real disposable PostgreSQL compiler/enrollment/auth/durability: 7/7 PASS,
  including both actual SQL SELECTs extracted from the production signer and
  generation advancement rejection. This is real SQL with synthetic quote and
  generation records, NOT an actual production HSM signing test.
- PostgreSQL owner protocol: 6/6 PASS; package-boundary tests: 4/4 PASS;
  v0 size/metas/ALT checks: 7/7 PASS. Mobile tests: 26/26 PASS. Expo Doctor: 19/19;
  Android export and signed Gradle build: PASS.
- A separate read-only agent reviewed the targeted changes and identified a
  signer SQL test projection bug; the assertion was corrected and the actual PG
  test rerun successfully. Other reproduced expiry, renewal, prefunding and
  enrollment issues were corrected. This is a separate code review within this
  workflow, not an external professional audit or governance approval. The
  complete productive economic flow remains unapproved.

Useful reproducible commands from `services/c3-mainnet`:

```text
npm run typecheck
npm run lint:check
npm run format:check
npm run test:open-owner-compiler
npm run test:open-owner-protocol
npm run test:open-v0-measure
npm run test:boundary
```

After build, `node dist/open-owner-entry.js check` currently returns
`C3_OPEN_PRODUCTION_NOT_APPROVED` (exit 2) BEFORE database or TLS access. This is
the expected gate, not a successful deployment. Following a separately reviewed
concrete release, `migrate`, `enroll`, `check`, `start` are explicit commands of
the same entry; they were not executed on a production service. Schema changes
never run automatically at service startup. Hosting has not been published.

## Affected Jupiter cloned cycle — not a complete current cycle

Ignored evidence: `programs/c3-pilot-vault/results/jupiter-cycle-znuZfh/report.json`.
Using the shared trusted owner compiler, actual local validator transactions and
the same PostgreSQL intent, five legs finalized and reconciled:

- Buy cbBTC: 400,000 USDC base units; quoted 472; minimum 468; packet 753 bytes.
- Buy Portal ETH: 300,000; quoted 11,178; minimum 11,067; actual 11,177; 753 bytes.
- Buy WSOL: 300,000; quoted 2,515,583; minimum 2,490,428; 846 bytes.
- Sell the actually acquired 472 cbBTC units: quote 398,627 USDC; minimum 394,641;
  784 bytes.
- Sell the actually acquired 11,177 ETH units: quote 299,171 USDC; minimum 296,180;
  815 bytes.

Local 1,000,000 share units were issued; owner renewal generation 1/revision 1,
restart, uncertain-signature read-only recovery, worker concurrency and altered
actual RPC evidence rejection passed. The sixth WSOL sale stopped after three
bounded fresh-route attempts with `C3_BANK_FRESH_ROUTE_MISSING` for
`GLQdMoJ6RJzWSBLiguhKVqt5K7B6EBSk6xiRBxiLRpbz`. No missing account was injected
into an already funded bank, no stale quote accepted, and no full burn/claim was
reported for this run. The prior six-leg historical report remains preserved;
it does not establish completion after these changes.

## Concrete preserved package and physical QA

Ignored artifact directory:
`artifacts/c3-pilot-candidate/2026-10-02-trusted-compiler-disabled`.
Earlier APKs, QA app data and stable app packages were preserved.

- APK: `c-market-c3-mainnet-candidate-0.1.0-disabled.apk`.
  SHA-256 `acfe040f63ad77b80d02ee5291b7d56edf4da73dd26b5b98bc67a82db940b6a2`.
  Package `com.dominaweb3.cmarket.c3candidate`, 0.1.0/code 1.
- QA-only certificate SHA-256:
  `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
  This is not a governance-approved production certificate.
- Unchanged disabled default program: 692,864 bytes;
  SHA-256 `d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
  Preserved as `c3_pilot_vault-disabled.so`.
- Unchanged IDL: `c3_pilot_vault-disabled.idl.json`;
  SHA-256 `7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`.
- Actual Gradle release source map: 669 modules, excluding node-forge, braces,
  micromatch, PostgreSQL, productive builder/signer and local clone harness.
  Generated Hermes bytes exactly match the APK embedded bundle:
  `43e569f2ff75bd3d826c4be1e89b153f46a78d42cd6d36553ffe575a1b895f77`.
- Seeker detected as ADB `device`. Installed certificate matched; `adb install -r`
  preserved data. Cold launch without Metro, Home/Indices/Activity, 40/30/30 and
  en/es/zh-CN/pt-BR switching passed. Visual/XML evidence is ignored beside APK.
- MWA wallet chooser opened and displayed Phantom; Back exited without selecting
  or approving. Physical Phantom return, authentication-message signature,
  transaction signature and integrated economic backend interaction remain
  UNVERIFIED. The user's placeholder was not interpreted as PASS.

## Dependency and operational status

Mobile npm audit: 17 High / 0 Moderate propagated entries; root build-tool
dependencies are node-forge 1.4.0 and braces 3.0.3. Their vulnerable modules are
absent from the inspected actual APK bundle. Neither root had a patched official
registry version at this check; no forced upgrades, unofficial forks or advisory
suppression. Service production audit: zero findings. Build-tool risk remains
documented; absence from this APK is not a claim that the installed graph is clean.
Gradle deprecation, optional system-UI and module/export warnings remain visible.

Official public Mainnet RPC read-only rent estimate, `2026-10-03T05:28:50.752Z`:
`public-rent-estimate.json` beside artifacts. Persistent capital **3.58436672 SOL**;
recoverable temporary deployment buffer **3.52058732 SOL**; peak capital
**7.10495404 SOL**, plus the distinct **1 USDC** pilot deposit. Calculated with
maximum program length equal to this disabled binary size. Deployment/priority
fees, swap fees, additional recovery accounts, operational SOL reserve and
RPC/PG/signer hosting expenses remain unmeasured/unapproved. This is NOT a complete
budget, not a deployable approval package and not authority to spend.

## One final external-input list

**Public data and owner decisions:** exact allowlisted owner wallet; separate
governance/update/pause/keeper/quote authority public keys and role decisions;
reviewed production program/configuration/registry/share-mint addresses tied to
the concrete package; two selected independent HTTPS RPC operator/provider IDs
with reviewed operator metadata; backend/signer HTTPS origins; signature policy,
pilot limits and exact approved SOL budget. Obtain public addresses from each
wallet/provider's official dashboard. Do not invent Squads members or approval.

**Server-side secrets only:** TLS certificate/key, verified PostgreSQL CA and
least-privilege connection credentials; isolated external signer credentials;
RPC/Jupiter/Pyth credentials where required. Configure directly in the chosen
server's secret manager and mount read-only files for TLS/CA; never send values
through chat, Git, EXPO_PUBLIC variables or APK. Owner entry variable names are
`DATABASE_URL`, `C3_DATABASE_CA_FILE`, `C3_OWNER_HTTPS_ORIGIN`,
`C3_OWNER_TLS_KEY_FILE`, `C3_OWNER_TLS_CERT_FILE`, `C3_OWNER_HTTPS_PORT`.
Secret names are not evidence that a provider or server has been provisioned.

**Code still required, independently of those inputs:** the trusted productive
six-leg plan/context factory, authorization/signing and finalized economic/CAS
promoter described above; safe fresh-route environment reconstruction for the
sixth cloned leg; current complete burn/claim proof; productive NAV; and explicit
physical MWA signing/return validation in a clearly labeled isolated environment.
Do not enable Mainnet or relax trust boundaries to bypass those links.
