# C3 integrated cloned-bank acceptance and deployment gate

Date: 2026-10-01. Classification: SHARED. Starting HEAD: `f54bba0b44c65a8acae934614737c518843ba002`.

## What is and is not implemented

One ephemeral local validator executes the canonical vault and actual cloned
Jupiter/Whirlpool programs. One PostgreSQL intent spans deposit, three buys,
Token-2022 non-transferable shares, redemption, three sells, burn and USDC claim.
The isolated Seeker APK can start and observe this test through USB loopback.

This is **actual execution in a cloned local bank with synthetic input USDC**,
not Mainnet acquisition, a user's real C3 position, or a deployed vault. Public
Mainnet execution and real mobile Buy/Sell remain immutable-disabled. Wallet
connection is MWA on Devnet; the test uses an ephemeral owner, not that wallet.
The keeper has no user's private key. No production signer is configured.

## Integrated path

1. Start a disposable PostgreSQL 16 cluster and a separate isolated Ed25519
   quote-signer process. Its private key stays in memory inside that process.
2. Read fresh official Jupiter exact-input builds and public Mainnet program,
   pool, token reserve and ALT accounts. Clone them **before** the bank starts.
   Only the owner receives synthetic 1,000,000 USDC base units. Vault BTC, ETH
   and WSOL balances start at zero; there is no prefunded sell inventory.
3. Execute deposit and settlement-plan creation locally; verify finalized outer
   and inner instructions, signatures, account ownership, balances and PDA state
   before promoting the existing `c3_open.intents` row.
4. For each leg reload vault/plan/registry/policy from trusted state, validate the
   fresh exact route and ordered duplicate metas, resolve ALTs, enforce the
   1,232-byte packet ceiling and persist the canonical 300-byte seal. The signer
   independently reloads that PostgreSQL record. Persist its verified signature
   under CAS before returning unsigned authorization/execution packets.
5. Authorize and execute only in the local bank with ephemeral governance/keeper
   keys. Preserve the execution signature in PostgreSQL **before** submission;
   send once with retries disabled. Independently reconcile finalized message,
   CPI effects, accounts, ALTs and plan before atomically consuming the seal and
   confirming the leg. Mock checkpoints cannot confirm enrolled cloned contexts.
6. After the three actual buy effects, issue 1,000,000 share base units. Redemption
   is bound to that active deposit and its actual recorded asset balances, not
   the former 40,000/30,000/30,000 mock constants. Sell exactly those acquired
   balances in the same bank; record returned USDC; burn all shares and claim.
7. Display only test counters in the APK, separately from the connected user's
   wallet journal. A local test result never creates a user-position object.

## Evidence and exact minima

Ignored reports contain each actual signature, input, fresh quote output,
Jupiter threshold, signed minimum, serialized size and finalized/reconciled
status. The minimum is never below the validated Jupiter threshold. Historical
`470` from an expired independent cbBTC probe is not reused as authorization.
Current quote data determines the checked integer minimum for that specific leg.

Two completed runs before the final restart/clone hardening:

- `programs/c3-pilot-vault/results/jupiter-cycle-0fslht/report.json`: six legs,
  shares issued/burned 1,000,000, USDC returned 998,530 base units.
- `programs/c3-pilot-vault/results/jupiter-cycle-wmXTsZ/report.json`: initiated
  from the Seeker APK; six legs, shares issued/burned 1,000,000, USDC returned
  997,779 base units. Finalized lifecycle and inner-effect checks passed.

Returns are observed test results, not fees, guaranteed returns, or Mainnet
prices. Whirlpool swap costs and quote/snapshot movement affect output. One
USDC does not cover setup rent or SOL network costs: test signers have synthetic
SOL separately. Production must preflight those costs and disclose them.

Final hardened run: `programs/c3-pilot-vault/results/jupiter-cycle-gAE6wd/report.json`,
intent `81f3e8e6-9375-4844-aa8d-3cdee430f312`. All six finalized/reconciled legs
passed after the tick/ALT clone fix. Buy outputs actually sold: 471 cbBTC,
11,087 Portal ETH and 2,536,644 WSOL base units. Execution packets measured
753/753/846/784/815/846 bytes. All signed minima matched or exceeded fresh API
thresholds. Shares issued/burned: 1,000,000; USDC claimed: 998,145 base units.
The actual-RPC hostile mutations, separate-process restart, uncertain recovery,
concurrent leases, duplicate promotion and duplicate claim checks also passed.

The Seeker started the live run through the APK button. After the test service's
three-minute result window and database shutdown, a separate **read-only** viewer
displayed that saved verified report as `archived-test-evidence` for multilingual
QA. It did not replay transactions or create a user position. Screenshot:
`programs/c3-pilot-vault/results/seeker-qa/cycle-archived-pass.png`.

## Recovery, hostile evidence and focused review

- Concurrent PostgreSQL leases permit one winner; every leg is CAS-bound to the
  immutable intent, revision and existing signature.
- A new operating-system process reads the same database between legs and
  verifies the preserved signature and revisions. The uncertain-signature case
  reconciles the original finalized local transaction without sending it again.
- Confirmation cannot be promoted twice; the second on-chain USDC claim fails.
- Reconciliation uses actual validator transactions, not only synthetic RPC
  fixtures. Separate negative tests mutate that observed metadata (missing
  owner, extra token debit, unknown CPI) and must fail before database promotion.
- Narrow lifecycle inner semantics reject approvals, unrelated transfers,
  burns, closures, extra instructions and wrong mint/authority/decimals/amount.
- Controller accepts one exact request/run at loopback only, rejects browser
  origins and caller-selected wallets, amounts or routes, and cannot restart a
  completed/failed run. The APK has a press lock, bounded requests and no auto-POST.
- Existing quote-authority tests cover stale/tampered bytes, signatures,
  concurrent requests, replay, revisions, expiry and 1,232/1,233-byte boundaries.
- A full keeper crash is not equivalent to the read-only process restart test:
  the ephemeral test signer stays alive. Production key continuity, monitoring,
  recovery authorization and independent RPC quorum still require review.

These are reproduced targeted adversarial checks, **not an independent external
security approval**. No self-certification authorizes deployment.

## Snapshot restrictions and reproducibility

Only narrow direct legacy-token Whirlpool routes are supported. Required fresh
accounts must already exist in the same bank. Missing accounts stop before
authorization; quote selection is bounded to three attempts, not a transaction
retry. There is no injection/overwrite of pool reserves or vault inventory after
deposit. Previously observed SOL pools, neighboring tick arrays and public ALTs
are validated/cloned in advance to reduce route churn. Both official fixed and
dynamic tick layouts are validated; malformed pool/index/bitmap/tag/length fails.
Absent **unused** neighboring arrays are not fabricated; selected route accounts
remain mandatory. A future unrecognized route still blocks rather than bypasses.

ProgramData deployment-slot and rent-epoch metadata are normalized for local
genesis only; program ELF, pool/reserve and ALT contents are not rewritten.
Agave 3.1.10 warp uses an epoch boundary so its Clock does not jump ahead and
expire fresh quotes. Quote lifetimes, signed timestamps and slippage stay intact.
The observed absent legacy read-only Whirlpool oracle is not a price source.

Primary sources: [official Jupiter build API](https://dev.jup.ag/),
[Orca fixed tick state](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/state/fixed_tick_array.rs),
[Orca dynamic tick state](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/state/dynamic_tick_array.rs),
[Agave bank warp](https://github.com/anza-xyz/agave/blob/v3.1.10/runtime/src/bank.rs).

Prerequisites: Node compatible with `--experimental-strip-types`, PostgreSQL 16,
Anchor 0.31.1, Agave/SBF 3.1.10, installed locked test dependencies. Build the
separate local artifact (never a deployment artifact):

```sh
cd programs/c3-pilot-vault
cargo build-sbf --manifest-path programs/c3_pilot_vault/Cargo.toml --sbf-out-dir target/local-jupiter-cycle --features local-jupiter-cycle
anchor-0.31.1 idl build -p c3_pilot_vault -o target/idl/c3_pilot_vault.json
cd ../../services/c3-mainnet
C3_LOCAL_VALIDATOR_BIN=/absolute/path/to/agave-3.1.10/solana-test-validator npm run test:open-jupiter-cycle
# Physical QA: start only the isolated test controller, then press once in Activity.
C3_LOCAL_VALIDATOR_BIN=/absolute/path/to/agave-3.1.10/solana-test-validator npm run c3:open:local-cycle:qa
adb reverse tcp:8787 tcp:8787
```

Reports/account clones/ledgers, APKs, unsigned packets and test signing material
are ignored and not committed. The controller holds a result for three minutes,
then closes the temporary bank/database. Stop/start creates a **new test**, not
an automatic retry of an uncertain operation. Production persistence is separate.

## Exact handset artifact and QA

Original requested APK SHA-256 was verified and installed unchanged first:
`0f3b4e3894dee925b06600224ae6d5159a828b68f3ec90f7f18ee6fc98bb7e84`.

Integrated QA APK: `apps/c3-pilot/dist/release/c-market-c3-pilot-0.1.1-local-cycle-qa.apk`.

SHA-256: `ba31784ec58c57a854b609864396fa0bf9a8ffe3d6d86ba9489fcef1dfd1430f`.

Package `com.dominaweb3.cmarket.c3pilot`, version 0.1.1, versionCode 2.
QA certificate SHA-256:
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
Original installed APK hash/certificate were checked before `adb install -r`.
No uninstall/data wipe or stable CLOCK IN package replacement occurred.

Physical Seeker: original cold launch without Metro, all three tabs, immutable
40/30/30 target, four locales and persisted language, real read-only backend,
MWA selector and Phantom selection/return passed without monetary signatures.
The updated APK cold-launched without Metro (339 ms), initiated/observed the
complete cloned cycle, and displayed the archived verified result in all four
languages across all tabs. Portuguese persisted across cold launch; English was
restored. Mainnet/Buy/Sell remain disabled; local result is explicitly labeled.
The exact updated APK also opened the MWA chooser (Wallet/Backpack/Jupiter
alternatives shown) and returned with a truncated connected account. No monetary
signature request was made. Phantom selection was independently observed during
the original exact-APK QA; no full wallet address is included in screenshots.

Android export/signature/build passed. Expo Doctor remains 18/19 (recommended
SDK patch 57.0.26 versus installed 57.0.25). No dependency upgrade was mixed in.
Pilot production audit retains ten Moderate Expo-toolchain findings and no
High/Critical; SPL Token/buffer-layout-utils/bigint-buffer is absent from its
production graph/bundle. Node-only SPL helpers are used by validator tests.
The official MWA library carries a public Mainnet endpoint constant; that is
not an enabled app RPC. Do not claim zero Mainnet strings. No Jupiter/open-vault
execution code or basket mint constants are included in Android.

## Concrete deployment candidate — BLOCKED, not approved

- Source program ID: `AFVCPVUExRgftDsE88NUewCnFyG3gRpEmkUiAdzs5qhb`.
- Default **disabled** SBF: `programs/c3-pilot-vault/target/default-check/c3_pilot_vault.so`;
  SHA-256 `54dc63832c8a96503c15c37bbc92d2620390d6f9391933f9cd1d8ff13f7e37b1`.
- Local-only enabled SBF: `programs/c3-pilot-vault/target/local-jupiter-cycle/c3_pilot_vault.so`;
  SHA-256 `79c12fb841fc97fd5ddba390cf049d43e7e02fc6c171731a47be3306ad695b44`.
  It is NOT eligible for Mainnet deployment. The features are mutually exclusive.
- Authorities: test governance, owner, emergency, keeper, share mint and quote
  signer are ephemeral, NOT approved production addresses. A reviewed Squads
  2-of-3 governance/upgrade authority, separately approved emergency authority,
  allowlisted pilot owner, constrained keeper and isolated signer are mandatory.
- Candidate scope: one owner, first deposit exactly 1 USDC, full redemption only,
  4,000/3,000/3,000 bps. Later deposits/partial redemption remain out of scope.
  Fees/SKR disabled. Slippage ceiling 100 bps, quote age 30 seconds and existing
  slot bounds, plan expiry 120 seconds; no weakening for slow settlement.
- Required configuration: reviewed USDC/cbBTC/Portal ETH/WSOL mints, Token-2022
  non-transferable share mint, PDA ATAs, immutable program hash, route registry,
  quote policy, authority addresses, exact Mainnet genesis and readiness gates.
  **None of these test authorities is a substitute for production approval.**
- RPC: loopback validator only for execution here; public Mainnet RPC is read-only
  cloning. Production requires two independently reviewed HTTPS RPC operators,
  finalized evidence quorum and monitored freshness; not configured by this QA.
- Costs: network fee, Token-2022 mint/ATA rent, vault/intent/plan/seal accounts,
  compute/priority fees and swap fees require a fresh estimate/reserve funded by
  an explicitly approved payer. Synthetic local SOL is not a Mainnet budget.
- Pause/recovery: governance/emergency pause and bounded route/quote policy;
  retain signatures/remaining assets, reconcile before manual authorized resume,
  never blindly resend or reverse. A new quote requires an explicit new approval.
- Release: current APK is QA-only with real-money controls off. A separate reviewed
  allowlisted MWA deposit/redemption release and trusted production signing are
  still required. This APK cannot authorize the Mainnet pilot.

Next gate: independent review of the exact fund-moving source/artifact and
production signer/recovery/quorum, approved authority/limit/cost configuration,
then a separately authorized deployment package and supervised pilot. No
Mainnet deployment, funds, production wallet signatures or push occurred here.
