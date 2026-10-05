# Restricted C3 one-USDC candidate — 4 October 2026

Classification: SHARED. Product authorized implementation/testing in isolation,
NOT Mainnet deployment, funding, policy admission or governance approval.
Starting commit: `db3071a96d83feacb5dfbcd4377f08a6bcc3fb5f`.

## Scope and monetary formulas

This is explicitly **one allowlisted wallet, one lifetime deposit and one full
redemption per vault**. It is not the previously proposed pooled/multi-investor
NAV-priced product. A second deposit is forbidden even after closure; reopening,
partial withdrawals or new investors require a separately reviewed policy/program.
Rust already enforces the allowlisted owner, exactly 1,000,000 USDC base units,
monotonic deposit/redemption counters and full non-transferable share ownership.
The server compiler now corroborates those lifetime counters too.

`c3-single-position-realized/v1` in `open-restricted-pilot.ts` records the candidate.
Production requires a separate immutable approval binding policy hash, final
binary hash, Security and governance evidence. That approval remains `null`.
No environmental override grants approval. All monetary capabilities remain false.

- Deposit: exactly 1 USDC, split as 400,000 / 300,000 / 300,000 base units.
- Assets: the existing exact cbBTC, Portal ETH and WSOL mints. WSOL represents
  the vault's SOL exposure; users receive shares, not these underlying assets.
- After all three finalized/reconciled buys: mint exactly 1,000,000 share base
  units to the sole owner. This is a fixed ownership unit, NOT a dollar NAV.
- Owner fraction while active: owned share units / actual supply = 100%.
- Acquired inventory for asset i: recorded buy output_i minus recorded sell input_i.
- External donations: custody balance minus accounted inventory; never increase
  shares, sell budgets or the user's claim. Pending amounts remain reserved and
  are not an issued position. No second investor exists to dilute ownership.
- Full sell input_i: only the actual output acquired by this deposit's buy_i,
  not the entire token-account balance (which can include donations).
- Realized payout R: checked-u64 sum of the three actual finalized USDC sell
  outputs. Burn the full 1,000,000 share units and transfer exactly R to the
  authenticated owner's USDC ATA in the same claim transaction. Duplicate claim
  is rejected. R can be less or more than 1 USDC; principal is NOT guaranteed.
- C Market/SKR fees: disabled. Route fees/slippage affect actual swap proceeds;
  SOL transaction fees/rent are separate and cannot silently reduce R.

No client price, informational estimate, oracle confidence format or assumed
representation parity authorizes minting, selling or claiming. Mandatory monetary
evidence is exact mints/authorities, inventory/reserves/supply, ordered instructions,
bounded signed quote, budgets and verified finalized effects from independent RPCs.
The prior composite USD valuation remains optional informational research and is
not thereby approved for a pooled vault.

## Implementation and security boundaries

The restricted position reader reuses the existing PostgreSQL/finalized-account
join. It checks raw plan progress, execution receipts, issuance/burn, actual claim,
settlement IDs, input accounting and immutable enrollment. It rejects an uncertain
signature, a journal change during the read, incomplete/contradictory receipts,
stale custody Clock (>60 seconds skew) or collection lasting >8 seconds.
The latest finalized Clock anchors the account read's minimum context slot.
No database transaction is held across RPC work.

Claim receipts must bind the exact burn and USDC transfer accounts/data and exact
owner/vault deltas; a journal state label cannot certify payout. Only the economic
receipt writer is admitted to this restricted join; legacy message-only receipts
are not silently upgraded. Conflicting pre-existing economic proof/slot blocks
promotion and preserves the signed request.

Donations between preparation, execution and observation are not swap proceeds.
Verifiers use authenticated transaction pre/post balances for exact economic
effects, retain custody metadata and reject unauthorized withdrawals. A later
snapshot can contain additional donations, but cannot undercut the proved post
balance. This does not relax inner-instruction or authority validation.

Quote minimum = MAX(integer slippage floor, validated Jupiter threshold,
server-read committed plan floor), bounded by the fresh quoted output. This is
strictly stronger protection, never permission to lower a plan's minimum. All
compilers and durable signers use the same formula. If the committed floor exceeds
fresh quoted output, execution fails closed; renewal cannot secretly lower it.
Such a market-condition recovery must be reviewed before a live pilot is enabled.

The same isolated six-leg runner uses PostgreSQL enrollment, append-only plan
generations, isolated quote signer, real Jupiter CPI against cloned programs/pools,
the mobile lifecycle controller and economic receipts. Synthetic USDC/local keys
are test-only. Even a successful cloned cycle is NOT Mainnet asset acquisition or
physical MWA approval. Results are recorded below after completion, not inferred.

## Exact public input form (no secrets)

Supply actual values; placeholders cannot be approved as identities:

1. `wallet`: sole owner's Solana public address; authenticates and explicitly
   signs deposit/redemption/claim and recovery. No seed/private key by chat.
2. `programId`, `upgradeAuthority`: reviewed final program identity and upgrade
   authority. The current disabled ELF is not a deployable working pilot.
3. `governance`: actual Squads vault public address; member public addresses,
   threshold and delay. Candidate recommendation: 2-of-3 and 24-hour delay,
   NOT a recorded governance approval. Decide whether it also controls upgrades.
4. Emergency pause authority: public address and pause-only operational owner;
   recommend separate from keeper and owner. No discretionary fund withdrawals.
5. `keeper`: public execution/fee-payer identity, cannot sign for the user or hold
   PDA custody keys. `quoteAuthority`: public Ed25519 identity of the isolated
   durable signer. Its external request journal/context, not the client, is trusted.
6. Two RPC providers: public provider/operator IDs and reviewed endpoint metadata.
   Candidate independent operators: Quicknode and Alchemy. Exact HTTPS endpoints
   and credentials are provisioned only on the server, never chat/APK/repository.
7. HTTPS service origin, hosting region, database backup/restore and signer
   isolation choice; final Android release certificate fingerprint.
8. Approval of the restricted policy, limits, full funding budget and concrete
   hashes. Product's isolated permission does NOT fill Security/governance fields.

Wallet, governance, keeper and quote authority must be four distinct identities
(enforced). Separating pause/upgrade roles is an explicit governance decision;
do not claim separation that has not been configured. Vault/registry/quote-policy
addresses are derived from the reviewed program; the share mint is a separate
account and must be supplied/verified, not invented as a PDA.

Server secrets are configured directly in an isolated secret store/environment
with restricted filesystem/network access, TLS-verified PostgreSQL and HTTPS-only
RPC. Never embed database passwords, signer secrets, RPC tokens or keystore values
in public policy, mobile variables, build output or this form.

## Reproducible package and complete budget framework

Disabled ELF (unchanged, 692,864 bytes):
`d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
IDL (unchanged):
`7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`.
Both remain under `artifacts/c3-pilot-candidate/2026-10-03-production-factory-disabled/`.
No Rust instruction/layout changed in this task. An enabled final binary requires
a separately reviewed build, new hash and fresh rent/fee evidence.

Updated disabled APK:
`artifacts/c3-pilot-candidate/2026-10-04-restricted-single-position-qa/c-market-c3-mainnet-candidate-0.1.0-disabled.apk`.
The identical generated copy remains under
`apps/c3-pilot/dist/restricted-single-position-candidate/`.
SHA-256: `d189252e790a4056a04fbda2b076494f43aa07af9a4902baa429617c452f8795`.
Package: `com.dominaweb3.cmarket.c3candidate`; QA certificate SHA-256:
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
This certificate is NOT production signing/governance approval. Previous APKs,
stable app and signing material are preserved. Mobile changes add four-language
informational/fixed-position copy and display a claim only from reconciled effects.
This build has no approved backend configuration and cannot perform monetary QA.

Pinned public rent evidence, not a live deployment budget:

- Persistent capital: **3.584366720 SOL**, including the existing program/accounts.
- Recoverable temporary deployment buffer: **3.520587320 SOL**.
- Measured peak: **7.104954040 SOL** (persistent + temporary).
- Optional missing owner ATA: **0.001488440 SOL**.
- Six-leg renewal-account allowance: **0.030540960 SOL**.
- Operating reserve proposal: **0.05 SOL**, NOT an approved/consumed fee cap.
- Squads app creation proposal: **0.1 SOL**, consumed fee, NOT refundable rent.
- Known proposed peak including these allowances: **7.286983440 SOL + 1 USDC**.
  This is NOT the complete amount to approve.

Unknown/unapproved upfront amounts: final enabled-binary rent delta/upgrade
headroom; governance account rent; exact deployment/base/priority fees; actual
route fees/slippage; hardened signer setup, restore verification and security
review/labor. Do not treat them as zero or convert SOL to USD without a dated quote.

Candidate minimum infrastructure, not contracted or published:

- Backend VM 4 GiB: 24 USD/month; separate signer VM 2 GiB: 12 USD/month.
  Separate VM is NOT an HSM or audited signer service.
- Daily VM backups at 30%: 10.80 USD/month.
- PostgreSQL single node 1 GiB: current official starting price 15 USD/month;
  NOT high availability. HA minimum is 30 + 30 = 60 USD/month, subject to region,
  storage and upcoming plan availability. Downtime blocks operations, not retries.
- Quicknode Build monthly: 49 USD/month; Alchemy Free: 0 within 30M CU,
  without a paid SLA. Review workloads/limits and operator independence first.
- Corrected published subtotal: **110.80 USD/month**, or **155.80 USD/month**
  replacing the single PG node with the quoted minimum HA pair.
  Historical 110.95 USD/15.15 PG estimates in earlier documents are superseded
  price snapshots, not silently deleted provenance and never an all-in total.

Additional recurring terms remain unpriced: signer/HSM operation and hardening,
optional informational pricing quota, PG storage/HA/restore work, RPC overage/SLA,
domain/DNS, egress/taxes, security/operations labor. **Complete USD total: unknown**.
Budget components are the known SOL peak, additional persistent rent, consumed
chain/setup costs, the separate 1-USDC deposit and months multiplied by the chosen
published USD subtotal plus every recurring term. Do not add currencies without
a dated conversion or count the same capital twice.

Official price sources, inspected 4 October 2026:
[VMs](https://www.digitalocean.com/pricing/droplets),
[backups](https://docs.digitalocean.com/products/backups/details/pricing/),
[PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/),
[Quicknode](https://www.quicknode.com/pricing),
[Alchemy](https://www.alchemy.com/pricing).

## Deployment/QA sequence requiring separate authorization

1. Review the exact restricted policy, identities, roles, quote/route limits,
   RPC operators, signer/database recovery and unresolved findings.
2. Approve a complete budget and a concrete enabled ELF/IDL/APK manifest; no
   deployment/enablement follows from this document or candidate test permission.
3. Recalculate rent and exact-message fees; require code/governance approval.
4. Only after explicit separate permission: owner-supervised deployment,
   account/config/artifact checks, pause verification and a separately authorized
   1-USDC test. Stop on mismatched hashes/roles, missing quorum, changed routes,
   expiry, uncertain signatures, wrong mint or contradictory inventory/effects.
5. Uncertain outcome: preserve signature/generation/inventory; read-only reconcile,
   no automatic resend, repeat signature, reversal or principal promise.

Physical QA next: install only with compatible certificate and data-preserving
update, cold launch without Metro, four-language informational states, MWA wallet
selection/Phantom return/cancel/restart. No Mainnet transaction or signature request.
Connection is NOT evidence of a physical monetary signature. That remains untested.

## Verification record

COMPLETED in isolation: integrated runner
`programs/c3-pilot-vault/results/jupiter-cycle-32GKSS/report.json` returned
`PASS_LOCAL_CLONED_JUPITER_CYCLE`, with one PostgreSQL intent
`db998564-0d45-4c38-add0-ec4dfa746cb6`. Six finalized/reconciled Jupiter legs,
persisted authorizations/signatures and real local CPI effects were verified.
Buys acquired 461 cbBTC units, 10,992 Portal ETH units and 2,474,743 WSOL units;
the sell inputs were exactly those outputs. Sales yielded 398,178 + 299,677 +
299,939 = **997,794 USDC units (0.997794 USDC)**. Minted/burned share units:
1,000,000 each. The four donated units stayed in custody and were not paid out.
The report contains per-leg fresh quote outputs, thresholds, stronger sealed
minima, serialized sizes (753–846 bytes), signatures and finalized effect evidence.

COMPLETED in the same run: process restart on the same intent/signature,
uncertain-outcome read-only reconciliation without resend, concurrent lease
exclusion, actual expiry/append-only owner renewal, second deposit refusal and
on-chain duplicate-claim rejection. Restricted reads passed through funded,
buying, active, selling, claimable and redeemed states; an uncertain signature
temporarily blocked the position join. Initial funding/keys were synthetic.
No physical wallet signed; no Mainnet funds were acquired, redeemed or deployed.

Earlier attempt completed 5/6 cloned legs and stopped safely at
`C3_OPEN_BUILD_COMMITTED_PLAN_MINIMUM`. The correction strengthens the seal with
the committed floor; it never lowers it to the fresh Jupiter threshold.

Validation: 107 service focal tests, TypeScript, lint and formatting passed;
32 mobile tests, TypeScript, lint, formatting, Expo Doctor 19/19, Android export,
release build and APK v2 signature/identity checks passed. Production package
boundary 5/5 and Mainnet/provider boundary 7/7 passed. Existing Rust library
tests 9/9 and PostgreSQL generation/recovery tests 13/13 passed in this execution;
unchanged Rust was not rebuilt into another release ELF. Known Anchor/Gradle and
Metro `@noble/hashes/crypto.js` export-resolution warnings remain disclosed.

Separate read-only adversarial reviewer reproduced no new P1/P2 funds defect in
the reviewed diff and ran 67 focal tests plus independent malicious probes.
Donation timing, exact claim effects, receipt provenance, custody freshness and
stricter plan minimum were covered. This is an independent agent review, NOT
a professional external audit or a production/governance approval.

COMPLETED physical checks: ADB detected the Seeker as `device`. The installed
candidate and new APK have the same QA certificate; `adb install -r` succeeded
without uninstalling or clearing data. Cold launch succeeded with no Metro
listener on port 8081. The app displayed its disabled-candidate warning, the
40/30/30 target and four language options. The stable package was not updated.
The screenshot and UI hierarchy are preserved in the same ignored artifact
directory. This is not a physical MWA authorization/signature result.

UNVERIFIED: physical Seeker connection/return/cancel/restart on the exact new APK,
physical owner signatures, production signer/hosting/provider provisioning,
enabled binary and Mainnet economic effects. Mainnet remains BLOCKED.

Dependency check: server production audit returned zero advisories. Mobile npm
production graph returned 17 High propagated from two advisories (braces and
node-forge). Actual release source map (675 sources) contains neither package,
micromatch nor Metro file-map, and excludes `pilot-open-local`/clone runner. MWA
native code is present. These two root vulnerabilities are in Node/build tooling;
absence from this APK does NOT make them fixed or remove supply-chain risk.
Official advisories currently list no patched version:
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Do not force-downgrade Expo/RN/MWA to silence npm audit. Build only reviewed inputs
in isolation; no untrusted glob patterns or certificate/OTA verification workflow.
Explicit security disposition remains required before monetary release.
