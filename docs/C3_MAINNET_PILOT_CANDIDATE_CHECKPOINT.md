# Controlled C3 pilot candidate — PARTIALLY_COMPLETED / BLOCKED

Classification: SHARED. Evidence captured 2026-10-02 UTC (2026-10-01 Colombia).
Started at `843d5482f7a2153abc764b16dffea27267b46d5c`; implementation checkpoint
`b9a650515c363375710f733ce25d3b3d0849ee54`. This is not a deployment approval,
an external professional audit, or evidence of Mainnet acquisition/redemption.
The machine-readable public artifact record is
`submission/c3-mainnet-pilot-candidate.json`.

## Independent review and fixes

A separate read-only reviewer inspected PDA custody, CPI accounts, signed quote
binding, shares, redemption, journal and recovery. No professional audit or
governance approval is claimed. Reproduced defects and targeted corrections:

- Donations could block claims and force an inconsistent full-balance sale.
  Settlement now accounts only for validated acquisitions. The immutable
  redemption budgets come from the existing on-chain position; a seal must
  authorize that exact budget, backed by sufficient balance, not the complete
  public ATA balance. Unsolicited balances are not NAV/position inventory and
  remain in the vault. No sweep authority was added.
- Default bootstrap previously accepted the first caller claiming governance.
  A public source-controlled bootstrap pin is now mandatory; `None` rejects
  initialization. No production authority has been invented.
- Newly reproduced SBF stack overflow caused `InitializeVault` to fail. Boxed
  account wrappers fixed the local runtime failure without changing account
  metas. Default build now has no stack-overflow diagnostics.
- Finalized evidence can be recorded after intent expiry, but only for its
  persisted signature within the durable 24-hour recovery window. Runtime mock
  source guard prevents a caller from claiming real-chain proof.
- Additive PostgreSQL migration 0004 freezes the complete finalized leg row.
  Negative SQL updates of effects and chain revision are rejected. Historical
  migrations remain unchanged. A database owner/superuser is NOT a safe runtime
  role; production least-privilege enrollment remains incomplete.
- Dormant quorum intake rejects lossy u64 numeric responses, wrong genesis,
  HTTP, host aliases and non-independent reviewed operators. Agreement is
  explicitly **unverified evidence**, never economic confirmation.
- Dormant signing adapter verifies against a copy of the pinned public key and
  rechecks intent/leg state, revision and expiry under transaction lock after
  the external provider. Missing approval stops before PG/provider invocation.
  No production key/provider was configured or invoked.

## Binary difference and regression boundary

The previously approved six-leg cycle at 843d548 used local features, an isolated
ephemeral signer, cloned reserves and synthetic input USDC. None is production
approval. Current default binary excludes mock/probe handlers, has immutable
execution `false`, and bootstrap `None`. Backend capability is `false`, approved
policy `null`; the mobile candidate has no monetary signing callback.

`SettlementPlan` is now schema 2, 901 bytes (v1 was 877): `input_budgets[3]`
is the new immutable accounted budget. Rust authorization/execution, the server
capture, independent fixed-layout effect verifier, IDL fixtures and malicious
mutation tests were updated together. V1 is rejected, not silently upgraded.
Existing local reports/banks are historical evidence and must not be resumed
with a schema-v2 binary. No Mainnet account migration was performed.

The current local-feature binary hash is
`cb43dbaf7f463e795de5d2d2709276b2f74306bf1274bd75a9188c4508ffeee1`;
it MUST NOT be deployed. The preserved default artifact is also **disabled and
not deployable for the pilot**. A future enabled binary requires a new reviewed
source commit, public pins, IDL/hash, tests, costs and explicit approval.

## Actual tests, including failed regressions

- Rust unit tests: 8/8. Mock-validator CPI lifecycle: PASS, including unrelated
  BTC dust before sale, USDC dust before claim, exact payment/share burn and
  duplicate-claim rejection. This uses a mock router, not Jupiter Mainnet.
- IDL-v2/ALT tests: 2/2; unsigned production boundary tests: 4/4; PG recovery and
  immutable-finalized-evidence regression: 1/1 with disposable real PostgreSQL
  and synthetic RPC responses. Service export boundary: 4/4. Mobile tests: 8/8.
- Updated real-Jupiter **cloned** regression, first attempt
  `results/jupiter-cycle-x8ZAx7/report.json`: legs 0–4 finalized and reconciled;
  1,000,000 local shares issued. Leg 5 stopped BEFORE execution at
  `C3_BANK_FRESH_ROUTE_MISSING:H3f4q1Y7mo7qwL5rKFpbesmJ8nKjkFPR6xWtYXGKCKqK`.
  Actual sell inputs came from those buys. No final burn/claim occurred.
- Second bounded attempt `results/jupiter-cycle-vPUzwe/report.json`: legs 0–1
  passed, leg 2 stopped BEFORE execution at
  `C3_BANK_FRESH_ROUTE_MISSING:Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e`.
  No account omission, running-bank overwrite, stale quote or third retry.
  The previously approved full cycle is preserved, but these results do NOT
  certify a complete updated six-leg cycle.
- TypeScript, lint, touched-file formatting and diff checks pass. Default SBF
  builds; IDL contains no local-only handlers. No Mainnet signature, submission,
  transaction simulation with funded credentials, deployment or asset transfer.
- Expo Doctor: 18/19, SDK patch suggestion 57.0.26 versus pinned 57.0.25 remains
  visible. No unrelated dependency change or audit suppression.
- Service production audit: 0 findings. Mobile npm graph: 4 High / 8 Moderate,
  including Expo CLI → node-forge 1.4.0. GHSA-86w9-cpqp-85rv lists no patched
  upstream version at this check. Production Metro source map: 661 modules,
  zero node-forge/code-signing-certificates/clone-launcher modules. This narrows
  Android runtime reachability; it does NOT remediate build-tool dependencies.

## APK and physical Seeker evidence

Separate package `com.dominaweb3.cmarket.c3candidate`, version 0.1.0/code 1.
APK v2 signature verified; certificate is **C Market C3 QA ONLY**, not a newly
approved production signing identity. Existing QA APK remains unchanged at hash
`ba31784ec58c57a854b609864396fa0bf9a8ffe3d6d86ba9489fcef1dfd1430f`.

Installed the new package without uninstalling/updating the stable or QA app.
Verified cold launch without a Metro listener, Home/Indices/Activity, truthful
40/30/30 targets, English/Spanish/Chinese/Portuguese switching and Portuguese
persistence after cold restart. Screens explicitly show absent position/NAV,
missing approval and disabled Buy/Sell. UI XML evidence is ignored under
`apps/c3-pilot/dist/mainnet-candidate/` and contains no connected wallet.

The entry point and actual Hermes bundle exclude cloned-cycle controls. MWA
authorization-only integration compiles; physical wallet chooser/return was
NOT invoked in this execution. User monetary signing, backend position reads
and an executable buy/sell route are not integrated in this candidate.

## Costs — separate from the deposit, not an approved budget

Official Mainnet RPC genesis and rent checks at `2026-10-02T02:32:16.481Z`,
using the current 651,600-byte **disabled** binary, exact binary-sized loader
allocation and schema-v2 accounts:

- Persistent rent: 3,374,745,600 lamports = 3.3747456 SOL.
- Additional transient deployment buffer: 3,310,966,200 lamports.
- Peak rent with buffer: 6,685,711,800 lamports = 6.6857118 SOL.
- Program accounts and six authorization/receipt pairs are included; exact
  public byte sizes/lamport breakdown are in the preserved rent JSON.
- The owner deposit is separately 1 USDC. Network/priority/swap fees, owner ATA
  if absent, SOL reserves, upgrade headroom, recovery attempts and RPC/PG/HSM
  operation are not priced or approved. Deployment fee needs the final approved
  payer and exact message set. Never treat these rent figures as all-in cost or
  authorize a budget for a different future binary.

## Technical stop conditions (not missing owner approval alone)

1. B1: a funded/partially executed on-chain plan can expire after 120 seconds
   without safe refund/cancel or explicit bounded renewal. Inventory may be
   immobilized. Implement and independently verify this before any deposit.
2. B2: restart of `prepared` envelopes and late/uncertain external signing
   results lacks a complete durable attempt journal and recovery path. Preserve
   all signatures; no automatic quote, signing, resend or reversal.
3. Productive chain capture, effect reconciliation and reviewed enrollment into
   `c3_open` are not connected. Existing CHECK scopes are local-only. The dormant
   signer expects future `MAINNET_REVIEWED`, not a client-supplied trust label.
   Prove mainnet program/config/plan/mints/budgets from independent evidence;
   add a reviewed forward migration and restricted PG roles, no duplicate intent.
4. Demonstrate the production external signer transport/identity/deadline,
   independent-operator quorum plus effect verification, and backend/MWA monetary
   packet binding. Candidate buttons must remain disabled meanwhile.
5. Close the updated fresh-route clone regression, dependency/tooling review and
   subsequent independent security review. Mark-to-market NAV is not validated
   by fixed first-owner share issuance; no NAV/price is published in the APK.

## One owner-input / decision list (public metadata only)

1. Pilot wallet public key, approved program ID and bootstrap/update authority;
   governance/emergency/keeper/quote-authority public keys and actual Squads
   membership/threshold/approval references. No keys, seeds or passwords in chat.
2. Two reviewed HTTPS RPC providers with different operator/provider IDs and
   public review references; selected server PostgreSQL and isolated signer
   deployment/backup/recovery model. Credentials stay server-side, undisclosed.
3. Explicit first-owner-only 1 USDC/full-redemption policy, slippage ceiling,
   time limits, pause/recovery obligations and bridge/custody-risk acceptance.
   Fees/SKR remain inactive; later deposits and partial redemptions are excluded.
4. Approved production Android signing certificate/public fingerprint and
   signing continuity decision. The QA-only certificate is not approval.
5. After ALL technical gates close: approval referencing the exact new
   commit/binary/IDL/config/APK hashes and complete SOL budget separately from
   the 1 USDC deposit. Current approval fields are null.

## Conditional deployment sequence — NOT executed

After the above code and tests, review the actual source-pinned authorities and
new binary; independently verify hashes/IDL, program ID and budget. Use separate
restricted PG/service/HSM identities with verified backups; verify genesis and
two operators. Owner/governance approves the concrete package, then a separately
authorized deploy initializes paused config/ATAs/non-transferable share mint,
route registry and quote policy. Inspect authorities, mint extensions, account
owners, current route binaries and exact limits from both RPCs. Test pause and
recovery before enabling an allowlisted owner. Only then request supervised MWA
approval for 1 USDC; reconcile six actual legs, shares, sale and USDC claim.

Stop on missing approval/config, different hash/authority/operator/genesis,
unreconciled funds, stale quote/ALT, packet >1,232 bytes, unexpected effects,
dependency blocker or expired/uncertain operation. Pause new deposits; keep
known signatures/evidence and follow reviewed recovery. Never retry/reverse
automatically or discard state. This disabled snapshot cannot execute that
sequence; no executable deployment command is supplied as approval.

## Primary sources

- [Official MWA specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html)
- [Official Solana program constraints](https://solana.com/docs/core/programs)
- [Official rent RPC](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)
- [Official loader metadata source](https://github.com/anza-xyz/solana-sdk/blob/master/loader-v3-interface/src/state.rs)
- [Reviewed node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
