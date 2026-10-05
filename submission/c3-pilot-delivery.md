# C Market C3 restricted pilot — delivery worksheet, 5 October 2026

Classification: SHARED. Draft only; no upload, submission or Mainnet approval.
The original CLOCK IN files/APKs/deck on `delivery/clock-in-verifiable` are
preserved. This worksheet reuses their mobile/evidence approach, not their
historical Devnet payment as basket ownership.

## Current implementation delta and approval request

Starting source: `7225c25040324982a916410c0d8d50da703bf6d8`. This execution
connected mobile pre-intent enrollment to the existing HTTPS/PostgreSQL protocol.
Two explicitly signed **text** messages prove owner control, locally verified
with strict Ed25519, exact release policy/program/vault/revisions and expiry.
They are not transactions, login sessions, deposits or Mainnet execution approval.
An authenticated session is separately bound to the server-returned intent.

Restart restores a policy-bound **public intent locator** or a validated prior
receipt, never re-enrolls a funded vault. The server still verifies the consumed
proof: storage cannot certify enrollment. Pending receipts block prepare before
any wallet/HTTP enrollment callback; reads and recovery never sign automatically.
No payload, message signature or bearer token is persisted by enrollment.
The source approval remains null and the monetary capability false, so this
connected code cannot invoke owner signatures on the current artifact.

Independent scoped review found two restart/preflight issues, both corrected and
rechecked. Its differential mobile/server message comparison passed; this is
not an external professional audit or approval of the full vault protocol.
24 affected unit/regression tests passed; fixtures sign text only, no economic
simulation, wallet, RPC or transaction. No new Devnet/cloned/mock cycle ran.
The React checklist kept actions in explicit handlers, with a synchronous UI
lock and a separate bootstrap lock; no effect starts enrollment.

The Mainnet candidate no longer imports or displays the Devnet device-message
QA action; historical modules/APKs remain untouched. Four languages, monetary
guards and 40/30/30 composition remain. New APK (rebuilt because code changed):
`904ce657fcdcfdf0949798664004ba984c4796ca1b47eb04a484394d111c1bf2`.
QA certificate: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
ELF/IDL/backend/rent artifacts were reused, not rebuilt or relabelled as enabled.

The connected Seeker received this exact APK with `adb install -r` after matching
the existing QA certificate; application data and stable packages were preserved.
The pulled installed APK has the same SHA-256. A cold launch with Metro stopped
displayed English, 40/30/30, the one-wallet/one-lifetime-position restriction,
disabled Mainnet operations and no Devnet QA button. Screenshot is ignored at
`apps/c3-pilot/dist/owner-enrollment-reviewed-candidate/seeker-cold-launch.png`.
No Phantom action or wallet signature was requested. Full navigation/language
switching and physical MWA return/signature are not certified by this check.
TypeScript, lint, Android export and release build passed. Latest Expo Doctor
was 18/19: the external React Native Directory metadata request was unavailable;
do not report that remote check as passed.

`InitializeVault` uses `init` with `[VAULT_SEED]` and a singleton
`[AUTHORITY_SEED]`. There is one vault/config authority per program ID, **not**
independent owner vaults. Judges can view genuinely accepted public receipts;
another owner cannot create a second independent vault under this program.
That needs a separate reviewed program change, not a frontend toggle or another
intent. No multi-vault redesign is included here.

### One consolidated owner decision block — no secrets in chat

1. Numeric initial SOL ceiling and monthly USD ceiling. Suggested preparation
   caps are 7.25 SOL plus a separate 1 USDC and 200 USD/month, **not** owner
   approval, measured total, sufficient-funding claim or a transfer instruction.
2. Actual governance public members and addresses, or state that only one owner
   is available and request review of private 1/1 risks. Current policy requires
   2-of-3 real independent members and at least 24-hour delay. Self-controlled
   generated keys do not satisfy independence. Do not apply 1/1 automatically.
3. Confirm provider accounts and controlled DNS for `dominaweb3.com`: proposed
   DigitalOcean NYC3 separate API/signer VMs, managed PostgreSQL HA, Quicknode
   and Alchemy. Grant scoped panel access for later approved provisioning, not
   unrestricted tokens by chat. DB/RPC/Jupiter/TLS/signer credentials are entered
   directly on isolated servers after approval, never committed or in the APK.
4. Keep the public QA certificate above, or supply only the fingerprint of the
   chosen delivery certificate. Confirm the proposed `Fnkz...BJhAZ` owner in
   Phantom. Connect/return alone is not proof of a message/transaction signature.

### Budget observed on 5 October — incomplete, do not fund yet

Measured disabled package: 3.414654080 SOL persistent account capital,
3.350874680 SOL temporary recoverable buffer, 6.765528760 SOL peak rent.
The existing 6.947558160 SOL proposal additionally includes 0.001488440 SOL
potential owner ATA, 0.030540960 SOL six-leg renewal account allowance,
0.050000000 SOL proposed operating reserve and 0.100000000 SOL proposed Squads
application fee. Rent is not consumed transaction spend; buffer recovery needs
the authorized closing sequence. The 1 USDC economic deposit is separate and
its eventual sale proceeds are not guaranteed to equal 1 USDC.

Published monthly components: backend 24 USD, isolated signer VM 12 USD,
daily VM backup proposal 10.80 USD, PostgreSQL primary/standby 60 USD,
Quicknode Build monthly 49 USD, Alchemy Free quota 0 USD = **155.80 USD/month
subtotal**, not all-in. Sources:
[Droplets](https://www.digitalocean.com/pricing/droplets),
[daily backups](https://docs.digitalocean.com/products/backups/details/pricing/),
[PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/),
[Quicknode](https://www.quicknode.com/pricing),
[Alchemy](https://www.alchemy.com/pricing).
DigitalOcean's current PostgreSQL notice changes new-account Standard HA options
from 15 October 2026: confirm plan availability before procurement. Do not assume
the 60 USD HA pair remains available to a future new account.

Still unpriced: enabled ELF rent/upgrade headroom; exact deployment/owner/keeper
base and priority fees; governance account rent; current swap route fees/loss;
signer hardening/external adapter operation; restore rehearsal, extra storage,
RPC overages, DNS renewal, tax/egress and operational/security-review labor.
TLS certificates and existing domain access do not prove HTTPS provisioned.
No all-in sum or sufficient budget is declared. The proposed payer is not yet
an approved recipient; **do not send SOL now**. Final funding requires the
enabled package hashes, real authority decisions, bounded fee estimates and
the owner's signed-off action/budget list.

### Production conditions that still block acceptance

- Source-controlled approvals for restricted policy, wallet, authorities,
  budget, exact enabled ELF/backend/APK are absent.
- API/DB/keeper and isolated signing provider have not been provisioned; the
  signer transport/journal interface is not evidence of a running authenticated
  production signing service. Its concrete adapter must be configured/reviewed
  against the selected isolated provider before activation.
- Two production HTTPS RPC operators, least-privilege roles, restore, DNS/TLS
  and service checks have not been enrolled/proven on hosted infrastructure.
- Physical Phantom control/signature and Mainnet buy/shares/sale/USDC receipt
  are UNVERIFIED/NOT_EXECUTED. No test key or previous cloned cycle fills this gap.
- Official CLOCK IN portal returned HTTP 200 but exposed no date in initial
  HTML; further public-script reading failed with ECONNRESET. Closing hour and
  current submission availability are UNVERIFIED; no deadline is invented.

Only after exact deployment/spending approval: provision pinned services,
validate hosts/independence/restore, review the enabled artifacts, perform
preventive Mainnet simulation, then supervised owner MWA authorization and
real finalized acceptance. Simulation is neither acceptance nor acquisition.

## Exact current delivery state

- Source: `feature/c3-open-pilot-vault`; use the commit containing the current
  [package manifest](c3-mainnet-pilot-candidate.json).
- Signed APK, ELF, IDL, backend tarball and public rent report:
  `artifacts/c3-pilot-candidate/2026-10-05-owner-enrollment-reviewed-disabled/`.
  Binaries are intentionally ignored; release hashes are in the manifest.
- Mainnet acquisition, shares, redemption and receipt: NOT ACCEPTED. The current
  APK is disabled, QA-signed, has no approved HTTPS backend configuration and is
  not the final functional Mainnet submission.
- Verified isolated evidence: one PostgreSQL intent, six actual cloned Jupiter
  CPI legs, explicit economic amendment, shares minted/burned and 0.997766 USDC
  returned locally. Synthetic input/test keys are not real Mainnet funds.
- No video of an accepted Mainnet flow exists. Do not create that claim by editing
  a local recording or using the historical Devnet treasury payment.

## Reproduce/check without deploying

From the repository root, with existing pinned dependencies and tools:

```sh
git rev-parse HEAD
git status --short
cd services/c3-mainnet
npm run typecheck
npm run build
node --test tests/export-boundary.test.mjs
node --experimental-strip-types --test tests/open-minimum-resolution.test.ts tests/open-pilot-budget.test.ts
node --experimental-strip-types src/open-owner-entry.ts check
```

The final command must stop with `C3_OPEN_PRODUCTION_NOT_APPROVED` in this
candidate, before reading server secrets. This is an expected gate, not a deployed
service. The separate migration, enrollment and start commands in the manifest
require the reviewed source policy/configuration and owner approval first.
No startup migration or blockchain retry is automatic.

The following is preserved historical evidence, NOT the current acceptance
procedure. The owner now requires Mainnet real-asset acceptance only. Do not run
this command or a new Devnet/cloned/mock economic cycle in this execution:

```sh
cd services/c3-mainnet
C3_LOCAL_VALIDATOR_BIN=/Users/juantorres/.local/share/solana/install/releases/3.1.10/solana-release/bin/solana-test-validator node scripts/test-postgres-local.mjs --open-jupiter-cycle --resolve-minimum
```

This starts disposable local PostgreSQL/validator state and synthetic signatures,
not a Mainnet deployment. Existing report:
`programs/c3-pilot-vault/results/jupiter-cycle-RhWWf1/report.json`.

## Data-preserving APK installation

Verify SHA-256, package and APK signer certificate first. Compare with the
installed candidate certificate; only a matching certificate permits `adb
install -r`. Never uninstall/clear data to bypass incompatibility. Candidate
package is `com.dominaweb3.cmarket.c3candidate`; stable apps remain untouched.
Cold launch must work without Metro. Physical Phantom return/cancel/restart and
owner signatures remain unverified until performed and recorded on this exact
APK. Selecting a wallet is not proof of transaction signing.

## Three-minute narration / capture plan

This is a capture script, not evidence that its Mainnet steps have occurred.
Record an exact release only after each gate is actually verified.

- 0:00–0:25: Seeker, C Market branding, Home/Indices/Activity and language selector.
  Say: “One wallet, one lifetime deposit of exactly 1 USDC, one full redemption;
  the target is 40% cbBTC, 30% Portal ETH, 30% WSOL held by the vault.”
- 0:25–0:55: MWA/Phantom connection and review. If the release is still disabled,
  show the warning and say so; do not fabricate a deposit or position.
- 0:55–1:30: For a separately authorized, accepted Mainnet release only: owner
  approval, actual deposit signature and three finalized buys; show custody and
  share-mint evidence. Until acceptance exists, say that acquisition is not
  accepted. Historical local evidence is provenance only; do not run a new
  demonstration or substitute it for the Mainnet acceptance video.
- 1:30–2:05: Verified position after app restart; target vs actual holdings and
  informational value. No guaranteed principal/NAV parity. Do not use a local
  report as the wallet's real Mainnet position.
- 2:05–2:40: Only after actual supervised Mainnet acceptance: sell acquired
  inventory, burn shares, claim exact realized USDC; show wallet and Explorer
  receipts. If not accepted, disclose that this remains pending; do not substitute
  a historical burn/claim report for a real sale.
- 2:40–3:00: Restrictions, explicit recovery on changing prices, preserved
  uncertain signatures and next release gates. No multiuser/rebuy/return claim.

## Brief presentation (reuse approved C Market wordmark)

1. Problem: understandable mobile access to a transparent basket without placing
   user private keys in C Market.
2. Product: the restricted C3 vault; underlying assets stay in PDA custody;
   on-chain shares represent only the acquired inventory.
3. Workflow: explicit MWA deposit → constrained keeper/Jupiter → reconciled
   shares/position → three sales → burn and actual USDC claim.
4. Proof today: separate signed Android candidate plus six-leg cloned local
   evidence. Mainnet and physical signature acceptance are still pending.
5. Safety: sealed quotes, bounded minima/expiry, explicit owner amendment,
   immutable journal/generations, two independent operators and no blind retry.
6. Limits/roadmap: exactly one lifetime position, no guaranteed return, no active
   fees/SKR, no multiuser vault or subsequent deposit without another review.

The historical CLOCK IN PDF remains at
`/Users/juantorres/Projects/cmarket-clockin-delivery/submission/C-Market-CLOCK-IN-Pitch.pdf`.
It is historical Devnet material, not a verified Mainnet pitch. The brief above
is the current truthful content; final PDF/video must match actual acceptance.

## One owner form (public data/decisions only)

Update, 5 October: the owner authorized local operational-key generation and
selected `dominaweb3.com`. Seven distinct candidate identities were generated
outside this repository; their **public addresses only** are in
[c3-public-identities.json](c3-public-identities.json). Keys are unfunded and not
provisioned in isolated servers. The new owner wallet is not yet imported or
physically verified through Phantom. Three keys held by this agent are NOT three
independent Squads members, so no fictitious multisig was created.

[c3-owner-inputs.proposed.json](c3-owner-inputs.proposed.json) records public
selections, not approval. `c3-api.dominaweb3.com` and `c3-signer.dominaweb3.com`
are proposed subdomains; no DNS, TLS, VM, database or provider was provisioned.
DigitalOcean NYC3, separate backend/signer VMs, managed PostgreSQL HA and
Quicknode/Alchemy are the proposal, not contracted infrastructure. The existing
QA certificate remains proposed, not production-approved.

The offline check is now reproducible:

```sh
cd services/c3-mainnet
npm run c3:open:release-review
```

It verifies the five existing artifact hashes, validates only public decisions,
lists required server-variable names without reading values, rejects mixed roles
and malformed data, and **always exits 2** because collecting inputs never grants
execution. The new candidate program identity differs from the current disabled
ELF/IDL in the preserved previous snapshot only. The current Rust declaration,
Anchor localnet config, diagnostic PDA, rebuilt ELF/IDL and packaged backend
now agree on `HTc3na8WFnsExbV1oxutKhTxyWE9PEsVRhjjkXAhajwV`.
The candidate is still disabled and unapproved; a future enabled artifact needs
its own review, hashes and rent evidence. No local deployment key was generated
or promoted: old ignored local-test keypair files are not deployment material
for the new candidate ID. Future local-validator runs must load the reviewed
binary at its exact ID, not silently reuse the historical keypair's address.
It does not build transactions, sign, submit, provision or turn on Mainnet.

Remaining human decisions: actual three governance members/Squads vault and
update authority; initial SOL and monthly USD spending ceilings. Actual provider
accounts, domain control/TLS and hardened signer enrollment still need access
and provisioning approval. Do not send funds to a program ID/share-mint address
or treat the previous partial capital estimate as approved funding.

1. Sole wallet PROPOSAL: `FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ`,
   supplied by the owner. Canonical Base58, 32 bytes, on-curve format verified.
   Control is **UNVERIFIED**; connection/signature results in chat are placeholders.
   The proposal has NOT been enrolled, assigned to governance/update/payer or
   approved. The previously generated local owner key remains a provenance
   candidate, not this Phantom identity. See `c3-owner-wallet.proposed.json`.
   Enrollment requires a fresh server-bound challenge signed through MWA by
   this exact wallet and verified server-side; a device-QA message is not login
   or production enrollment.
2. Authorities: actual program/update authority, share mint, Squads vault and
   member public keys, chosen threshold/delay, pause public key, keeper fee payer
   and isolated quote signer public key. Proposal: Squads 2-of-3/24 h for update
   and configuration; separate pause-only operator; four distinct owner,
   governance, keeper and quote identities. No member/key/approval is invented.
   Missing account creation requires separate permission, not chat secrets.
   If the owner confirms only one real member, a private owner-controlled 1/1
   alternative may be reviewed separately, retaining a 24 h delay and pause-only
   identity. This is NOT independent multisig governance and creates a single
   compromise point for upgrades/configuration. No policy has been changed;
   the current checker still requires three members and 2/3. Explicit risk/model
   approval plus source-policy/tests/security review must precede any change.
3. Infrastructure: select independent Quicknode/Alchemy operators or reviewed
   alternatives, hosting region, HTTPS origin and PG single-node vs HA decision.
   Backend/signer separate VMs; server-only TLS/CA/DB/RPC/Jupiter/signer credentials.
4. Certificate: approve existing QA certificate for delivery or provide another
   public fingerprint. Never send keystore/password; incompatible updates stop.
5. Funding decision: initial SOL ceiling, recurring USD ceiling and treatment of
   currently unpriced terms. The measured disabled-binary proposal is 6.947558160
   SOL + separate 1 USDC; infrastructure subtotal is 110.80 USD/month or 155.80
   with the minimum HA pair. These are NOT complete totals or approved spending.

After these inputs, prepare ONE explicit approval request binding final enabled
hashes, derived accounts/configuration, exact actions, full budget and stop rules.
This worksheet does not authorize publishing, deployment or payment.

### Preserved 7225c25 package evidence (superseded mobile artifact)

The identity-only rebuild used `solana-cargo-build-sbf 2.1.0`, platform tools
v1.43 / rustc 1.79.0, default features disabled, offline; Anchor 0.31.1 generated
the IDL. ELF = 659,456 bytes. IDL economics match the previous IDL after
normalizing only the program address/its bytes. Prior six-leg cloned evidence
is explicitly tied to old `AFV...` in the manifest, not re-labelled as a cycle
under the new ID or as Mainnet asset acquisition. The build emitted existing
Anchor deprecation/syscall warnings; these do not authorize deployment.
An exploratory 3.1.10 build had a different size and is retained separately as
ignored measurement evidence, NOT the pinned delivery binary.
The proposed infrastructure has PostgreSQL HA selected, so its applicable
published subtotal is **155.80 USD/month**, not the 110.80 single-node alternative.
Neither is an all-in price or demonstrably within the owner's unknown ceilings.

Official read-only RPC rent, remeasured 2026-10-05T19:58:15.119Z:
persistent 3.414654080 SOL, temporary recoverable buffer 3.350874680 SOL,
measured peak 6.765528760 SOL. The 6.947558160 SOL proposal adds existing
allowances; it is not total consumed spend or a funding request. All-in costs,
government/authorities and owner caps remain unconfirmed. Literal `[number]`
placeholders are not spending limits. No affordability claim can be made.

At that earlier checkpoint the APK was not rebuilt; its SHA-256 was
`7c5151de935184a72982e45ddeaa8933789a4cb2226300d513af85f843d04dc6`.
ADB detected the Seeker as `device`; its installed `base.apk` has that exact
SHA-256. Local APK signature/certificate verification passed. The already-running
candidate was foregrounded without installation or data deletion. Cold launch,
visual QA and monetary tests were not repeated at that earlier checkpoint.
Its proposed Devnet device-message QA is now withdrawn from the current
Mainnet-only delivery. Do not execute that historical step. The current APK
removes the button/module import; its exact hash and Mainnet connection-only
physical step are in the manifest. Production enrollment remains separately
blocked until the exact reviewed policy and hosted service are authorized.

### Preserved 7225c25 server implementation and review

The public owner proposal now participates in the offline review fingerprint;
substituted wallets or false enrolled/control claims fail. Server enrollment
requires a fresh, exact Ed25519-signed policy-bound challenge before any RPC
account read, followed by transactional revalidation and one-use consumption.
Legacy rows without consumed proof cannot enter production signer, preparation,
reconciliation or position paths. Restricted pilot resource limits are durable:
three RPC attempts per challenge, three challenges per minute and sixty lifetime
challenges per configured wallet. Only a valid owner-signed, domain/policy-bound
issuance request can consume that budget; unsigned, substituted, stale or
replayed requests cannot issue a challenge. Reaching the lifetime cap requires review;
history must not be deleted or counters reset to bypass it. No automatic retry.

Focused disposable PostgreSQL tests cover malformed/domain/policy substitution,
expiry, replay, concurrent enrollment, restart, immutable rows, fresh-proof
idempotency, legacy rejection, invalid proof with zero RPC, concurrent issuance
and resource-budget exhaustion. Fixture keys prove server verification only,
not physical MWA control of the proposed wallet. The separate agent's code
review is not a professional external audit or Mainnet approval. The previous
six-leg cloned cycle was not repeated, relabelled or promoted to Mainnet.

Separate agent review closed the identified enrollment-control, proposal-binding
and anonymous-quota defects after inspecting the actual remediation. It checked
invalid issuance with zero pool connections and distinct messages for substituted
contexts. Focused PostgreSQL enrollment/quota and compiler integrations each
passed 7/7; TypeScript, lint, package-boundary tests and changed-file formatting
passed. Rust/Anchor builds passed for the identity-only binary rebuild, with the
existing warnings described above. No operational identities were regenerated,
no APK was rebuilt and no services were provisioned. Owner proof and physical
MWA acceptance remain UNVERIFIED; no Mainnet buy, position or redemption is
claimed. Public-role/governance selection and actual SOL/USD ceilings remain
required owner decisions, not assumed approvals.

## Submission form / official portal

A six-page truthful review pitch is generated by
`submission/build-c3-review-pitch.py` at
`output/pdf/C-Market-C3-Review-Pitch.pdf`. It was rendered and visually checked;
it labels Mainnet acceptance as pending and is NOT a final functional submission.
At the earlier server-only preparation mobile behavior did not change. The new
mobile enrollment/recovery implementation above did change code and therefore
produced a separate APK while preserving that historical package.

Project: C Market. Source candidate: public repository
`https://github.com/dominaweb3-art/cmarket-clock-in` plus the actual published
candidate commit/branch (currently not pushed). Team roster/representative,
funding disclosure, final APK download, accepted Mainnet evidence, recorded demo
URL and final presentation URL must be completed before manual submission.

Checked 5 October 2026: [official portal](https://solanamobile.radiant.nexus/)
and [official terms](https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf).
The terms require APK, source, demo and presentation, truthful eligibility and
functional mobile/network interaction. Public schedule code observed an October
8, 2026 “23:59” close entry; its timezone was not verified and the authenticated
submission screen was not accessed. Do NOT convert this into a Bogotá/UTC cutoff
or promise it is the account's final deadline. Confirm the current signed-in
portal before submission; no form was posted and no candidature was sent.

The official terms were rechecked: section 6 requires a functional Android APK,
source, demo and presentation. Section 9.3's 30 days concern winning-app dApp Store
publication, not permission to deliver unsafe/incomplete fund handling now.

## Server-only setup, after exact package approval

- Use the approved hosting accounts; no purchases/startup migrations are implied
  by these instructions. Keep backend, quote signer and custody roles separate.
- On the approved host, create `/etc/cmarket/owner-server.env` with root-only
  permissions and edit locally using `sudoedit`; do not paste credentials in chat
  or run commands containing their values in terminal history. Fill the names in
  `services/c3-mainnet/server-environment.example.json` from the provider consoles.
- Configure `DATABASE_URL` on server only, with the appropriate least-privileged
  DB role. Set `C3_DATABASE_CA_FILE` to the managed DB CA; verification must stay
  enabled. Migration/admin access and owner/signer roles are separate.
- Install the trusted certificate chain for the approved owner HTTPS origin and
  reference its private key by `C3_OWNER_TLS_KEY_FILE`; never copy it into Git or
  the APK. Firewall/public port routing must match the direct TLS service's
  reviewed origin and port. Do not disable TLS verification to make a test pass.
- Obtain the two RPC endpoints directly from independent provider dashboards;
  credentials remain on server. Provider/operator evidence must be reviewed, not
  inferred from two hostnames. Jupiter credentials also stay builder-side.
- Provision the signer adapter with its reviewed public identity, durable journal
  and authenticated server transport; mere local key creation does not complete
  this. Never place a quote/keeper key in the mobile app or an environment flag
  that supplies approval. Do not load the local key files into production before
  approving isolation, backup and access controls.
- Verify backup restoration, five artifact hashes, approved immutable source
  policy and spending ceilings before the explicit migrate/check/start commands.
  After approval, owner enrollment is a separate HTTPS message-only MWA flow:
  first explicitly sign the canonical non-monetary request produced by
  `enrollmentRequestMessage` for the reviewed policy/HTTPS origin, a public
  request-uniqueness value encoded as 64 lowercase hex characters and current
  Unix seconds. This value is not an authentication secret: request authentication
  requires the owner signature, and the server generates its own unpredictable
  control-proof challenge with a cryptographic random generator.
  Send `nonce`, `requestedAtUnix`, and canonical-base64 `signature` to
  `POST /v1/c3/owner/enrollment-challenge`. Anonymous requests cannot consume
  the wallet's budget. Then review the
  exact server challenge, then send `challengeId`, `message`, `signature` to
  `POST /v1/c3/owner/enroll`. Message/signature use canonical base64. The server
  binds wallet, HTTPS audience, program, vault, policy and revisions; verifies
  Ed25519 and database expiry; and atomically consumes the proof with enrollment.
  A DEVICE QA message, a connection-only result, or a legacy enrollment row is
  insufficient. CLI `enroll` is intentionally blocked. Fourteen pinned additive
  migrations preserve earlier history; no production migrations ran here.
  An unchanged disabled candidate must still fail before secrets
  are read. No automated transfer, blockchain retry or deployment is included.
