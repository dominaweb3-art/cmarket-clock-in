# C Market C3 restricted pilot — delivery worksheet, 5 October 2026

Classification: SHARED. Draft only; no upload, submission or Mainnet approval.
The original CLOCK IN files/APKs/deck on `delivery/clock-in-verifiable` are
preserved. This worksheet reuses their mobile/evidence approach, not their
historical Devnet payment as basket ownership.

## Exact current delivery state

- Source: `feature/c3-open-pilot-vault`; use the commit containing the current
  [package manifest](c3-mainnet-pilot-candidate.json).
- Signed APK, ELF, IDL, backend tarball and public rent report:
  `artifacts/c3-pilot-candidate/2026-10-05-explicit-minimum-recovery-disabled/`.
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

The current affected cycle has already passed; do not repeat it without relevant
changes. Its reproducible command is:

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
  share-mint evidence. Otherwise label the separate terminal evidence “LOCAL
  CLONED JUPITER — SYNTHETIC FUNDING”, verbally distinguish it from Mainnet, and
  show the preserved report's six effects and reviewed-minimum recovery.
- 1:30–2:05: Verified position after app restart; target vs actual holdings and
  informational value. No guaranteed principal/NAV parity. Do not use a local
  report as the wallet's real Mainnet position.
- 2:05–2:40: Only after actual supervised Mainnet acceptance: sell acquired
  inventory, burn shares, claim exact realized USDC; show wallet and Explorer
  receipts. If not accepted, disclose that this remains pending and show only
  clearly labelled local burn/claim evidence.
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
ELF/IDL; rebuilding and approving the exact future artifact is still mandatory.
It does not build transactions, sign, submit, provision or turn on Mainnet.

Remaining human decisions: actual three governance members/Squads vault and
update authority; initial SOL and monthly USD spending ceilings. Actual provider
accounts, domain control/TLS and hardened signer enrollment still need access
and provisioning approval. Do not send funds to a program ID/share-mint address
or treat the previous partial capital estimate as approved funding.

1. Sole wallet: public address from Phantom “Receive”. Controls the one position
   and physically signs owner operations.
2. Authorities: actual program/update authority, share mint, Squads vault and
   member public keys, chosen threshold/delay, pause public key, keeper fee payer
   and isolated quote signer public key. Proposal: Squads 2-of-3/24 h for update
   and configuration; separate pause-only operator; four distinct owner,
   governance, keeper and quote identities. No member/key/approval is invented.
   Missing account creation requires separate permission, not chat secrets.
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

## Submission form / official portal

A six-page truthful review pitch is generated by
`submission/build-c3-review-pitch.py` at
`output/pdf/C-Market-C3-Review-Pitch.pdf`. It was rendered and visually checked;
it labels Mainnet acceptance as pending and is NOT a final functional submission.
No mobile behavior changed in this preparation, so the installed APK and its
hash were preserved rather than rebuilt.

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
- Verify backup restoration, enrollment, five artifact hashes, approved immutable
  source policy and spending ceilings before the explicit migrate/enroll/check/
  start commands. An unchanged disabled candidate must still fail before secrets
  are read. No automated transfer, blockchain retry or deployment is included.
