# C3 Mainnet isolated services

Status: implementation foundation; **not production-ready**. Classification: **SHARED**. Mainnet execution is source-controlled `false`.

## Boundary

`services/c3-mainnet` is a server-only package. The mobile app does not import it. It contains deterministic accounting, a strict deployment manifest, semantic instruction validation, dry-run pooled rebalancing, persistence invariants, two-provider reconciliation, a deterministic unsigned deployment plan, and fail-closed readiness commands.

The package never connects a wallet, signs, submits, deploys, creates a token, creates a vault, or moves funds. It persists public fingerprints and evidence only. It does not store private keys, seed phrases, credentials, signed payloads, or unnecessary wallet data.

## Credential boundary

The file `server-environment.example.json` lists names and descriptions only. Jupiter and Pyth credentials belong to the isolated builder/keeper runtime. Two reviewed HTTPS RPC providers must have distinct endpoint, provider, and operator identities. Values must come from an external secret provider or the isolated runtime and must never enter Expo public variables, the APK, logs, snapshots, fixtures, generated reports, or Git.

Missing credentials are blockers. They are not requested, generated, or substituted in this phase. The server-only authenticated clients reject missing credentials, non-HTTPS URLs, credential-bearing URLs, unapproved hosts, redirects, oversized responses, and malformed Pyth feed IDs. Jupiter and Pyth response bodies remain untrusted until the existing semantic route, instruction, asset, and oracle validators accept them.

## Product and accounting model

C3 is one pooled Symmetry V3 vault. Its immutable target is 4,000 bps cbBTC candidate, 3,000 bps Portal ETH candidate, and 3,000 bps SOL/WSOL. A purchase amount never changes these weights. The user deposits at least 1 USDC and receives proportional six-decimal C3 shares calculated from reconciled NAV and share supply. Underlying assets stay in the vault.

The 1 USDC amount is an allowlisted supervised technical test, not an approved public commercial minimum. The cost object separates the inactive C Market fee, Symmetry bounty, network fee, priority fee, rent, DEX fee, slippage, and price impact. Fresh evidence near the previously observed 0.245 USDC bounty triggers the configured high-effective-cost warning.

Fee collection and the SKR discount remain disabled. The 15/15/7.5 rate schedule is disclosure-only until Security and Squads approve it.

## Builder responsibilities

The disabled builder accepts only canonical integer base-unit strings and a hash-bound deployment manifest. It validates cluster/genesis, operation-specific programs, signers, fee payer, writable accounts, debits, destinations, close-account semantics, lookup tables, quote/blockhash expiry, packet size, post-conditions, and two-provider reconciliation requirements. Its output is safe public authorization metadata and an unsigned transaction fingerprint, not a signed payload.

The typed `ReviewedSymmetryAdapter` boundary defines verified vault-state reads and decoded unsigned intent construction. The current adapter foundation still expects a separately reviewed concrete Symmetry integration; direct Symmetry SDK transaction construction has not yet been implemented or approved. Consequently, unit tests do not make the builder production-ready.

## Keeper responsibilities

The keeper is immutable dry-run/read-only. It may read authorized intents and verified state, calculate drift, aggregate net flows, propose bounded vault-level trades, simulate without funded credentials where safe, retain redacted evidence, and request manual review. It cannot sign, submit, retry uncertain operations, reverse successful operations, change assets/weights/fees/receivers, or hold user keys.

Deposits do not trigger three per-user swaps. The keeper proposes no trade while pooled value remains within drift and aggregation thresholds. All intermediate dollar values are execution-time derivatives, not product allocation rules.

## Manifest lifecycle

The proposed manifest contains exact Mainnet identity, reviewed candidate mints, Pyth feed IDs, program registry, immutable 4,000/3,000/3,000 weights, fee-disabled state, limits, future vault/share derivations, unresolved public authorities, approval states, credential names, and a deterministic SHA-256 configuration hash.

Lifecycle: `proposed → verified → security_approved → governance_approved → deployment_ready → deployed | paused`. Status cannot advance without evidence. Null unresolved public inputs are reported explicitly; placeholder addresses, wrong clusters, unknown programs, HTTP endpoints, duplicate authorities, active unapproved fees, or runtime capability toggles are rejected.

## Deployment order and Squads

The deterministic bundle keeps every step blocked and unsigned:

1. Verify exactly three member public keys and the reviewed Squads program.
2. Create 2-of-3 governance and its Vault; never confuse the Multisig configuration address with the Vault authority.
3. Apply the timelock, responsibilities, spending limits, and destination allowlist.
4. Verify treasury Vault and program authorities.
5. Initialize the Symmetry vault and derive/initialize the C3 share mint.
6. Register the immutable target, assets, oracles, routes, keeper limits, pilot limits, and pause authority.
7. Propose seed capital, complete independent review, collect two approved signatures, and reconcile every resulting account.

Proposer, voters, executor, treasury Vault, configuration, emergency pause, fee, and least-privileged keeper responsibilities must be separated where the protocol supports it. No member addresses are invented.

## Persistence, recovery, and reconciliation

Intent ID, idempotency key, configuration hash, authorization manifest, evidence fingerprints, submitted signature, state, and revision are immutable or transition-constrained. Duplicate IDs and stale writes fail. A submitted signature cannot be replaced or deleted. Uncertain outcomes move to manual review without automatic retry or reversal.

Settlement requires matching finalized effects from two reviewed, independent HTTPS RPC operators. Missing or disagreeing evidence fails closed.

## Readiness commands

From `apps/mobile`:

- `npm run c3:mainnet:builder-readiness`
- `npm run c3:mainnet:keeper-readiness`
- `npm run c3:mainnet:deployment-readiness`

All three are expected to exit nonzero now. They list missing public inputs and approval/credential names without values.

## Remaining gates

- Current on-chain evidence approval for every asset, program, oracle, and route program.
- Reviewed Symmetry instruction adapter and exact unsigned transaction packages.
- Three real Squads member public keys, reviewed Squads program, Vault derivation, separated authorities, limits, and timelock.
- Isolated Jupiter/Pyth credentials and two independent reviewed RPC providers.
- Seed-capital decision, Security approval, Governance approval, and independent adversarial review.
- Separate allowlisted Mainnet artifact and supervised creation only after all gates pass.

The next action is an independent security review of this builder, keeper, manifest, accounting, persistence, and deployment bundle before any supervised Mainnet creation.
