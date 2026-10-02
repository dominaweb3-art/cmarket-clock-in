# Controlled C3 pilot candidate — PARTIALLY_COMPLETED / BLOCKED

## Latest implementation checkpoint — 2026-10-02

Classification: SHARED. Resumed at `599e242c29c053676e5c0111b4b71ae7c28cc6bd`.
Verified commits: `e71170166acad69b65ef1b9d961a7ef407214c57` (durable signer),
`c1105e54d8bbf1b7c3d6534b86ef4ca12536bf94` (owner recovery primitives),
`ee4c69ab5d11bcc6b8ef6ddf5b51815a4a1f8542` (bounded clone preparation/quote clocks).
This section supersedes the current-result statements below; the older checkpoint
is intentionally preserved as provenance. No source capability or approval was enabled.

### Verified implementation, not a Mainnet release

- Isolated signer now records canonical request identity and dispatch in PostgreSQL
  **before** contacting the external provider. Connections/locks are released during
  the provider call. A lost result permits lookup only, never another blind signature.
  Ed25519 result, immutable bytes, revision, three lookup attempts and database-clock
  24-hour deadline are durable. Additive migrations 0005/0006 preserve prior checksums.
  Disposable PostgreSQL tests: 2/2, including concurrent callers, restart/lost reply,
  altered bytes, lookup exhaustion and pool-size-one deadlock regression.
- HTTPS external adapter has a stable request ID, eight-second timeout, 4,096-byte
  response cap, public identity binding and no retry. It is not an enrolled production
  HSM. Source policy null/capability false prevents production invocation. External
  transport and disabled/quorum tests: 6/6. Short transactions follow the PostgreSQL
  best-practices skill; no least-privilege production role was invented.
- Owner can renew an expired partial plan with exact revision comparison while
  preserving completed legs, budgets, minimums, inventory and user rights. Revision
  increments and old active authorization is invalidated. Keeper cannot create an
  expired deposit plan; owner fallback retains the same quote/route restrictions.
  Intact, unswapped expired deposits may be refunded by their owner, including under
  pause; partial positions cannot use this refund. Actual local-validator targeted
  tests passed for plan/no-plan refund, unauthorized owner, stale revision and duplicate
  refund. Rust 9/9 includes partial buy/sell inventory preservation; this is not a
  complete durable backend recovery integration.
- Clone preparation discovers canonical USDC pairs through official read-only RPC,
  checks pool/reserve/tick/program/ALT accounts, caps unique pools at 96 and quote
  attempts at three. It never overwrites a running bank. A missing required account
  remains a blocker, not permission to omit it. Quote clock waits at most 5.1 seconds
  without changing Jupiter creation time or expiry; stale/future/policy errors remain
  closed. Four focused clock tests and four economic-effect tests passed. A separate
  read-only reviewer reproduced and verified correction of the delayed-timer LOW.

### Updated integrated cycle: PASS_LOCAL_CLONED_JUPITER_CYCLE

Ignored evidence: `programs/c3-pilot-vault/results/jupiter-cycle-RfSq7y/report.json`.
One PostgreSQL intent `9f369332-6d48-4165-a6b5-14a9e77ecf80`, isolated ephemeral
quote signer, Ed25519 on-chain verification and real cloned Jupiter/Whirlpool CPI:

- All six legs finalized and independently reconciled against actual local RPC.
- Buy inputs 400000/300000/300000 synthetic USDC units. Their expected outputs /
  Jupiter thresholds / signed minimums were 464/460/460, 11032/10922/10922 and
  2462356/2437733/2437733. No seal authorized less than its exact validated threshold.
- Sell inputs 464 cbBTC units, 11023 Portal ETH units and 2459711 WSOL units came
  from actual buy effects in this same bank, not independently pre-funded fixtures.
  Expected output / threshold / minimum were 398016/394036/394036,
  299430/296436/296436 and 299780/296783/296783 USDC units respectively.
- 1,000,000 local share units issued and burned; 997861 USDC units returned;
  duplicate claim rejected on-chain. Execution packets were 753–846 bytes.
- New OS process recovered the same intent/revision/signature; an uncertain leg
  reconciled read-only with no resend; competing workers and duplicate confirmation
  were rejected. Three malicious mutations of actual finalized evidence failed closed.

**This is cloned execution with synthetic input, not Mainnet acquisition, a real
user position, an external audit or production approval.** The independent reviewer
checked source/report but did not repeat the cycle or independently query its signatures.

### Preserved disabled artifacts and current costs

New ignored directory: `artifacts/c3-pilot-candidate/2026-10-02-recovery-disabled`.
Previous artifacts remain intact. Default Anchor build (no local feature flags):

- SO: 692864 bytes, SHA-256 `d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
- IDL: SHA-256 `7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`;
  plan remains schema 2/901 bytes. No mock/probe handlers. Macro/deprecation/toolchain
  warnings remain; a compile is not authorization to deploy this disabled artifact.
- APK preserved byte-for-byte: SHA-256
  `2279f28ff2112b9c862ee42a119699a6e0224b51fa0535f7f4c35f26e3d8df00`.
  Android signature reverified using the existing QA-only certificate. No new APK
  monetary implementation, installation, wallet chooser or physical Seeker QA this run.
- Current candidate Android export: 661 source-map modules; zero clone launcher,
  quote journal/external signer, pg or node-forge modules. Mobile tests 8/8, TypeScript,
  lint/format pass. Expo Doctor still 18/19: pinned 57.0.25 versus recommended 57.0.26;
  no unrelated upgrade. Metro dependency export fallback warning remains visible.
- Official public Mainnet genesis/rent checks at `2026-10-02T06:23:14.914Z`:
  persistent capital **3584366720 lamports (3.58436672 SOL)**;
  recoverable temporary buffer **3520587320 lamports (3.52058732 SOL)**;
  peak capital **7104954040 lamports (7.10495404 SOL)**. Deposit remains separate 1 USDC.
  Consumed deployment/priority/swap fees and service costs are **not measured/approved**.
  Six authorization/receipt pairs are included; additional recovery generations need
  additional retained accounts and an updated budget. No all-in budget is claimed.
  Estimator now accepts an exact preserved artifact directory and writes evidence
  exclusively; rent/IDL inspection alone does not prove binary execution capability.
- Service production npm audit: zero findings; Rust/service package boundaries pass.

### Exact remaining technical links — no fund authorization

1. Backend renewal is NOT connected: `capture-context.ts` still requires PostgreSQL
   chain revision to equal plan revision; `open-lifecycle.ts` fixes final revision at 3.
   A renewed plan needs a finalized owner-renewal checkpoint with before/after inventory,
   revision and expiry, persisted append-only and applied by CAS. Do not loosen equality
   without this evidence. Original authorization deadlines and signatures must remain.
2. Existing prepared leg fields and quotes are immutable. A crashed builder loses its
   memory-only envelope; safe replacement needs explicit authorization generations and
   a durable supersession proof, not resetting a leg or blindly signing/submitting again.
   Renewing before uncertain-signature reconciliation can invalidate historical evidence.
   Expired redemption requests before share locking also lack a complete backend path.
3. Productive capture/economic verification is not connected to a reviewed two-operator
   RPC pair or production c3_open enrollment. Agreement alone is not economic proof.
   HTTPS signer transport is tested, but no durable external provider enrollment exists.
4. Candidate mobile still supports connection-only MWA, disabled Buy/Sell and no productive
   backend position/monetary packet path. No real NAV or holding is displayed.

The next implementation is the append-only owner-renewal/attempt checkpoint, including
late/uncertain historical verification, then productive quorum and mobile monetary binding.
No owner decision or secret is needed to implement that code. Public authorities,
operators, governance and exact-budget approval remain required only after technical gates
close. Mainnet and user monetary actions remain disabled. `PHONE_REQUIRED_NEXT: NO`.

## Historical checkpoint preserved below

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
