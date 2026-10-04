# C3: shared service-core acceptance and remaining production gate

Classification: SHARED. Execution date: 2026-10-03 (America/Bogota).
Starting commit: `ecb6213a4b49c706bb1530c1ffb4648cf25c4995`.
Branch: `feature/c3-open-pilot-vault`.

## Actual scope and result

The functional Jupiter compiler, trusted durable leg-context factory, quote
signer, keeper journal and economic reconciler now live in `services/c3-mainnet/src`.
Production source imports **no implementation** from `pilot-open-local`.
Historical SQL resources remain at their original paths; new migrations are
additive, byte-pinned, and never applied automatically by production constructors.
The isolated adapters reuse these cores. Cloning, synthetic funds and ephemeral
signers remain test-only. This is implementation plus verified isolated execution,
not a documentation-only milestone and not approval to enable Mainnet.

Mainnet capability remains immutable `false`; approved production policy remains
`null`. A missing source-reviewed policy stops production before database, signer
or transport callbacks. Buy/Sell remain blocked in the candidate APK.
Public production acquisition, ownership and redemption are NOT demonstrated.

## Single delivery matrix

| Function                                   | Implemented / tested                                                                                                                                                                                                                               | External input                                                                                                            | Exact remaining boundary                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trusted Jupiter plans and six leg contexts | Finalized raw configuration, intent, plan, registry, mint and reserve validation; CAS enrollment; compiler checks exact ordered duplicate metas, minimum, ALT contents, v0 size. All six legs executed and reconciled in one cloned bank.          | Reviewed role/configuration/registry identities and two independent HTTPS RPC operators.                                  | Production entrypoints intentionally reject absent approval; real Mainnet execution not performed.                                                                                                                                                     |
| Quote authorization and isolated signer    | Same `c3_open` intent/generation; immutable canonical 300-byte authorization before isolated signing; result durable before consumption; current PostgreSQL context reloaded. Real PG generation-change regression passes.                         | Server-only idempotent signer/HSM endpoint, public signing identity and approved policy.                                  | Ephemeral test signing is not evidence that the external production signer is configured or approved.                                                                                                                                                  |
| Keeper prepare, send journal and recovery  | Create/record packets, signature persistence before one-shot send attempt, exact finalized effects, immutable failed/expired outcomes, restart and same-intent locks. Close/reconcile in both orders and late-signature races pass.                | Authorized keeper/governance signers and operational worker wiring/configuration.                                         | Entry service returns unsigned role-review packets; no autonomous production worker or production signing/broadcast was enabled or exercised.                                                                                                          |
| Ownership and full USDC redemption         | Same-intent purchase, record, actual share issuance, full sell from purchased balances, burn and claim; duplicate claim rejected on-chain in cloned bank.                                                                                          | Approved owner wallet, deployment, governed limits and supervised acceptance.                                             | First owner-only exactly 1 USDC and full redemption only. Later deposits and partial redemption remain disabled.                                                                                                                                       |
| NAV and position accounting                | Checked integer math; raw Pyth decoding; freshness/confidence/layout checks; custody, reservations and share-supply joined with durable effect receipts; unverified/client prices rejected.                                                        | Reviewed direct asset/USD source/account pins for USDC, cbBTC, Portal ETH and WSOL; approved independent economic source. | `readProductionOpenNavPosition` fails closed. **Second economic-source adapter is not implemented**, and direct wrapped-asset feeds are not pinned. Two RPC operators do not fulfill two economic-source operators. No live production NAV is claimed. |
| Backend and Android/MWA                    | Existing authenticated owner prepare/review/persist/submit/reconcile/renew/position endpoints retained; shared mobile controller used in local HTTP cycle; optional NAV parser tested; standalone disabled candidate built and signature verified. | HTTPS service, reviewed public configuration/session scope and a prepared isolated wallet test.                           | Local owner callbacks used ephemeral test keys, not a physical user MWA signature. This candidate was not installed or cold-launched on Seeker during this execution.                                                                                  |

## One integrated cloned-Jupiter cycle

Ignored evidence: `programs/c3-pilot-vault/results/jupiter-cycle-sghc7C/report.json`.
Result: `PASS_LOCAL_CLONED_JUPITER_CYCLE`.
Intent: `2e80b5be-0964-45fa-84fa-df52515d8f51`.

| Leg               | Input base units | Quoted output | Validated threshold / authorized minimum | Unsigned transaction bytes |
| ----------------- | ---------------: | ------------: | ---------------------------------------: | -------------------------: |
| USDC → cbBTC      |           400000 |           471 |                                467 / 467 |                        753 |
| USDC → Portal ETH |           300000 |         11152 |                            11041 / 11041 |                        753 |
| USDC → WSOL       |           300000 |       2506339 |                        2481276 / 2481276 |                        846 |
| cbBTC → USDC      |              471 |        398376 |                          394393 / 394393 |                        784 |
| Portal ETH → USDC |            11152 |        299680 |                          296684 / 296684 |                        815 |
| WSOL → USDC       |          2506246 |        299956 |                          296957 / 296957 |                        846 |

Every leg finalized locally, retained its persisted quote authorization, and
passed economic reconciliation. Sell inputs were the actual preceding buy outputs,
not independently prefunded asset fixtures. WSOL buy execution output differed
slightly from quoted output; the actual received amount was used for sale.
The cbBTC threshold is from this exact fresh quote, not a historical 470 probe.
No minimum below the validated Jupiter threshold was authorized.

Issued/burned shares: 1000000 / 1000000 base units. Returned synthetic USDC:
997995 base units (0.997995 USDC); no gain or guaranteed exit amount is claimed.
New-process recovery retained the intent/revision/signature; three mutations of
actual validator transaction evidence were rejected. Duplicate promotions and
duplicate claim were rejected. Uncertain recovery did not resend.

Reproduction uses the already installed pinned validator, only for disposable
local execution, and requires the existing local PostgreSQL tooling:

```sh
cd services/c3-mainnet
C3_LOCAL_VALIDATOR_BIN=/Users/juantorres/.local/share/solana/install/releases/3.1.10/solana-release/bin/solana-test-validator npm run test:open-jupiter-cycle
```

This bank executes cloned Jupiter/Whirlpool programs with synthetic capital.
It is not Mainnet acquisition or physical MWA. Paired reads from this same local
validator do not prove independent production providers. Route discovery/cloning
is bounded and test-only; production does not use historical clone lists.

## Recovery review and validations

Separate AI reviewer inspected expiry/quorum corrections and deterministic races.
The reproduced Medium finding is corrected by inspection; the outcome-hash Low
and requested concurrency coverage were also closed. No new High/Medium identified
in that focused delta. This is NOT an external professional audit, not an
independent rerun of every test, and not Security/governance approval.

Negative execution evidence requires both operators' finalized post-expiry
barriers, unchanged custody, matching statuses, and transaction absence from both
when status is null. Finalized failure needs exact signed wire and fee-only
effects. Both positive and negative observations are bound into the outcome hash.
All signatures survive; no automatic resign, resend or reversal is introduced.

Checks completed: service TypeScript/lint/format; service unit tests (170/170);
PostgreSQL keeper tests (22/22 including three deterministic races);
owner/compiler PostgreSQL tests (7/7); shared CPI/ALT/v0 regressions (20/20);
service package-boundary tests (4/4); mobile TypeScript/lint/format,
owner-controller/position tests (12/12); Expo Doctor (19/19); Android production
export and signed APK verification. Rust source and the disabled program binary
are unchanged; program-boundary regression is run rather than rebuilding Rust.

Production source/bundle scans found no functional local-test import or APK
marker for the clone bank, test signer, server journal or server CPI compiler.
Changed non-ignored files were scanned heuristically for credentials and signing
material; no matches. This does not prove universal absence of secrets.

`npm audit` service production: 0 Critical, 0 High, 4 Moderate; full service graph:
0 Critical, 2 High, 5 Moderate. Production advisories are web3.js → jayson →
stream-json/uuid. Inspected calls use StreamValues/Verifier and uuid.v4, not the
reported filter or v3/v5/v6 paths. Advisories remain reported, not suppressed or
claimed fixed. Dev High findings are Anchor → toml tooling. No forced major
upgrade performed. Service/mobile production exclude the bigint-buffer chain;
historical local-validator test dependencies are separate and not an APK graph.
Android export retains an existing nested noble/hashes exports warning; export
succeeded. Node tests retain a package module-type warning; no product rewrite
was made to silence it.

## Concrete preserved artifact and costs

Ignored stable directory:
`artifacts/c3-pilot-candidate/2026-10-03-production-factory-disabled/`.

- APK: `c-market-c3-mainnet-candidate-0.1.0-disabled.apk`, SHA-256
  `e0bc2be318ebc3da8ef6202461f8259103e7c4c92ac58f2ecf753efb12981fee`.
- Package: `com.dominaweb3.cmarket.c3candidate`, version 0.1.0 / code 1;
  v2 APK signature verified; one signer; **QA-only** certificate SHA-256
  `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
- Unchanged disabled ELF: `c3_pilot_vault-disabled.so`, 692864 bytes, SHA-256
  `d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
- Unchanged disabled IDL: `c3_pilot_vault-disabled.idl.json`, SHA-256
  `7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`.

Public Mainnet rent reads at `2026-10-04T00:00:32.535Z` for this exact **disabled**
binary and explicit max-len: 3.58436672 SOL persistent account capital;
3.52058732 SOL temporary deployment buffer; 7.10495404 SOL peak capital, plus
the separate 1 USDC test deposit. Detailed account lengths/counts in ignored
`public-rent-estimate.json`. Buffer refund is conditional on its explicit safe
closure, not an executed refund. Transaction/priority fees, swap costs, hosting,
RPC, PostgreSQL and signer service costs are not budgeted: budget **INCOMPLETE**.
A reviewed enabled binary may have different rent; this is not a deployable package
or permission to spend. No keys, APKs, binary payloads or signing credentials are
committed. Previous APKs and protected workspaces are preserved.

## Required owner inputs and next implementation

Public decisions: owner allowlist; separate governance/keeper/quote/update/pause
authorities; reviewed limits, program/configuration/registry identities;
two HTTPS RPC provider/operator identities; oracle source review and budget.
Do not invent Squads members or approvals. Governance, Security and budget approval
must reference an exact reviewed release rather than labels supplied by a client.

Secrets: configure PostgreSQL TLS credentials, RPC credentials and idempotent
external signer/HSM authentication directly in an isolated server secret manager.
Never place them in chat, tracked env files, APK or EXPO_PUBLIC variables.

Code still required: second independently reviewed economic-source adapter and
its direct-token/USD pins; approved operational keeper role-signing integration
and separately prepared physical MWA acceptance. Do not mistake disabled wrappers
or local ephemeral callbacks for deployed services or a signed user acceptance.
The safest next implementation target is the missing independent NAV source,
without removing the fail-closed guard or assuming wrapped-token USD parity.

No Mainnet transaction was signed/submitted, no real funds moved, no program or
service was deployed, and nothing was pushed. Local ephemeral transactions in the
isolated cycle were signed/submitted only to its disposable validator.
`PHONE_REQUIRED_NEXT: NO` — no concrete isolated physical signing operation is
prepared in this execution; testing another disabled APK would not close that gate.
