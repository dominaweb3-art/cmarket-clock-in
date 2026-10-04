# C3: exact-mint valuation and concrete pilot decisions

Client date: 2026-10-04 (America/Bogota). Classification: SHARED.
Starting code: `5618baf31fa045b3751344a112103dc539df14d6`.
Status: PARTIALLY_COMPLETED; economic NAV and Mainnet activation BLOCKED.
This is the active **open vault**, not the historical Symmetry adapter.

## What this execution implements

`services/c3-mainnet/research/oracle-nav/exact-market-evidence.ts` reads the
official Mainnet RPC and GeckoTerminal. It decodes exact Orca pool PDAs,
ordered mint pairs, Q64.64 price ratios, pool custody, mint decimals, fee
limits and a same-batch finalized Clock. All arithmetic uses integers. It
records hashes, pool addresses, slot and observation time. Both data paths
are **research market observations, not production NAV or trade approval**.

An authenticated oracle must establish publisher identity, exact feed/mint
mapping, confidence and publication age. A market snapshot establishes a
current pool ratio, not the age of the last trade or manipulation resistance.
An executable quote additionally binds size, route, minimum output and expiry;
it is neither a NAV nor proof that a trade executed. This collector builds,
signs and submits no transaction and requests no wallet action.

The price contrast records each numerator/denominator pool explicitly, uses
observed USDC/USD rather than parity, and rounds divergence upward. It is
diagnostic: Gecko and Orca may describe the **same economic market**; distinct
websites/RPCs are not independent price sources. Missing/malformed observations
are unavailable, never zero, a stale fallback or an assumed USD peg.

The offline `scripts/open-pilot-budget.ts` verifies the exact disabled ELF,
IDL **and public rent-report hash**, rejects mixed evidence, and separates
capital, refundable buffer and consumed costs. It cannot approve or deploy.
The service template reuses `src/open-owner-entry.ts`; no new server,
configuration trust system, client-supplied policy or approval flag was added.

## Exact assets and discovered markets

| Asset      | Exact Mainnet mint                             | Read-only market candidate                                             | Production valuation status                                                                                                |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| cbBTC      | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij`  | Orca cbBTC/USDC `HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM`         | Pyth CBBTC/USD catalog candidate is not an enrolled exact-Solana-mint feed; second independent admissible source absent    |
| Portal ETH | `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs` | Orca PortalETH/WSOL `HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF`     | No authenticated exact Portal ETH/USD mapping with required confidence/freshness verified                                  |
| WSOL       | `So11111111111111111111111111111111111111112`  | Orca WSOL/USDC `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`          | SOL/USD reference does not establish a second independent economic source; wrapping/custody still require account evidence |
| USDC       | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | USD market observation for the exact quote token, never the base token | Pyth USDC/USD candidate; no second enrolled independent source; no USD parity assumption                                   |

Final corrected read-only probe: Orca decoding at finalized slot `453300070`,
collection started `2026-10-04T15:42:27.395Z`; GeckoTerminal returned HTTP 200
and available exact-mint pool price observations for all four assets. Diagnostic
cbBTC/PortalETH/WSOL contrasts were 6/39/5 bps, respectively. USDC/USD was
observed as `0.998668480407` after conservative integer truncation, not assumed
to equal one. These are shared-market contrasts with **unverified publication
age/confidence**, not independent-source acceptance. The CLI always writes/replaces
`results/oracle-source-discovery/exact-markets.json` in the ignored results
directory; importing its collector does not persist. This historical snapshot is not
a usable current quote or user position.
The Orca program binary/upgrade provenance is not authenticated by the new
research collector. A single official RPC cannot satisfy production quorum.

Sources checked: [Pyth feed definitions](https://docs.pyth.network/price-feeds/core/price-feeds),
[Solana push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana),
[official catalog](https://hermes.pyth.network/v2/price_feeds),
[Coinbase cbBTC mint](https://www.coinbase.com/cbbtc),
[Orca pinned account layout](https://raw.githubusercontent.com/orca-so/whirlpools/f4b99e79e7140f3917e4ce81a2e8ad06ccdf8ce4/programs/whirlpool/src/state/whirlpool.rs),
[fee bounds](https://raw.githubusercontent.com/orca-so/whirlpools/f4b99e79e7140f3917e4ce81a2e8ad06ccdf8ce4/programs/whirlpool/src/math/token_math.rs),
[GeckoTerminal API](https://api.geckoterminal.com/docs/index.html),
[Jupiter Price V3 methodology](https://developers.jup.ag/docs/price),
[Switchboard feed construction](https://docs.switchboard.xyz/docs-by-chain/solana-svm/price-feeds/basic-price-feed),
[Chainlink DEX report schema](https://docs.chain.link/data-streams/reference/report-schema-v3-dex).
No symbol-only match was promoted to exact-mint evidence. Finding no admissible
combination in these sources is not proof that no provider can ever supply one.

## Precise remaining code/policy link

`open-nav-collector.ts` authenticates raw Pyth PriceUpdateV2, including Full
verification, feed, authority, layout, age and confidence. Its policy remains
null and its evidence explicitly has **one economic oracle operator**.
`open-nav-position.ts` joins that evidence to finalized custody, excluded
reserves, supply, immutable PostgreSQL receipts and journal uncertainty. It
refuses production NAV with `INDEPENDENT_ECONOMIC_PRICE_SOURCE_NOT_PINNED`.

The missing implementation is a **second authenticated economic collector and
admission/divergence join for all four exact mints**. A generic API wrapper,
`authenticated:true`, zero confidence or changing `economicOracleOperators`
to 2 would be a false fix. PortalETH additionally lacks the required direct
USD feed mapping. Acquiring a Pyth/Birdeye key does not solve that policy gap.
Underlying BTC/USD, ETH/USD, a reserve attestation and a price quote cannot be
silently substituted. Existing direct-field policy enforces age <=60s,
confidence <=200bps; the candidate divergence bound is 100bps.

The accounting join remains in the existing owner-position service. Its
isolated tests exercise actual-priced USDC, donations, reserves, supply,
partial/closed lifecycle and uncertain signatures. No new client valuation
path was added. First-pilot shares are units, not a guaranteed USD/share price.
Full redemption remains based on **verified realized USDC**, not a USD mark;
do not lock already-held funds behind an oracle outage. Later deposits and
partial redemptions remain disabled.

Concrete alternatives for Product + independent Security + governance review:

1. Keep the exact assets, approve a **composite exact-mint market/oracle policy**:
   independently authenticated disjoint upstream market sets, real update/TWAP
   evidence, liquidity/manipulation floors, conservative confidence propagation
   and a separate USDC/USD leg. Switchboard is a possible publisher, **not by
   itself proof of source independence**. Pin jobs/accounts/upstreams; do not
   count a Pyth/Jupiter-derived job as an independent Pyth source. Development
   and economic review are still required; this is not an enabled fallback.
2. Separately scope the owner-only **first 1 USDC/full redemption** pilot to
   reconciled token inventory and realized USDC with USD NAV explicitly
   unavailable. This preserves on-chain shares but does **not close the current
   priced-NAV acceptance requirement**. It needs an explicit Product/Security/
   governance exception before code or gate changes. No public/second deposit,
   partial redemption, fees or SKR. This is the smallest operational alternative,
   not a recommendation to bypass review or claim an investment value.

No architecture or asset has been changed and neither alternative is active.

## One consolidated owner-input list

**A — public decisions/identities, no secrets:** choose valuation alternative
above; provide the pilot wallet's public address; nominate three real independent
Squads members, a proposed 2-of-3 threshold and 24h timelock; identify public
governance/upgrade, pause, keeper and quote-authority roles. Governance may be the
reviewed Squads vault authority; wallet, governance, keeper and quote signer
must be distinct under the existing validator. The pause operator must not gain
withdrawal, weight-change or upgrade rights. Do not create accounts/addresses or
claim approvals in this phase. Share only public addresses and decisions.

**B — procurement/hosting choice:** proposed backend 4GiB DigitalOcean VM,
separate signer 2GiB VM, managed PostgreSQL, Quicknode + Alchemy with independently
reviewed operator metadata, DNS name for direct HTTPS, and an agreed complete
budget. A second VM is process/network separation, **not an HSM**. A Vault Transit
Ed25519 endpoint is not plug-compatible with the current durable C3 signer
POST/lookup contract; a reviewed bridge would still be necessary. Do not buy an
HSM or oracle subscription on the assumption that their adapters are complete.
Single-node PostgreSQL has downtime risk; restore test and recovery approvals
are mandatory. HA/storage/SLA options require a separate quote.

Create Solana Mainnet endpoints in the official Quicknode and Alchemy dashboards
only after procurement approval. Store their full credential-bearing URLs on the
server, never paste them into chat, source, review receipts or APK. Current RPC
validation requires HTTPS:443 without query credentials; the providers' supported
path-auth style is a candidate, not enrollment evidence. Helius's usual
`?api-key=` URL is incompatible with this rule; it was not selected or grandfathered.
Provider IDs/operator IDs and review hashes must attest real independent
operators, not merely different labels. No account or provider was enrolled.

**C — secrets configured directly by the operator:** `DATABASE_URL`,
`C3_DATABASE_CA_FILE`, `C3_OWNER_TLS_KEY_FILE`, `C3_OWNER_TLS_CERT_FILE`,
`C3_JUPITER_API_KEY`, `C3_PYTH_API_KEY`,
`C3_MAINNET_RPC_PRIMARY_URL`, `C3_MAINNET_RPC_SECONDARY_URL`.
Use separate server identities, least privilege and root-owned 0600 environment
file outside the repository; do not use Expo-public variables. The signer key
stays in isolated signing infrastructure; only its public identity and reviewed
service contract enter C3 policy. API credentials are not governance approval.
Set the public `C3_OWNER_HTTPS_ORIGIN` and unprivileged listener port
`C3_OWNER_HTTPS_PORT` (default 8443) to the same owner-approved trusted HTTPS
origin/certificate. Do not put a proxy-derived origin into authentication.

I retain responsibility for feed research/collectors and pricing integration;
the owner is asked for policy, identities and spending decisions, **not feeds**.

## Reproducible preparation, no deployment executed

From `services/c3-mainnet`:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm run test:boundary
npm run c3:open:market-evidence
npm run c3:open:budget-review
npm run c3:open:server-check
```

Only applicable validation commands were executed here; no fresh dependency
install was required. Market/budget commands intentionally exit **2** because
requirements are unsatisfied. `server-check` must reject with
`C3_OPEN_PRODUCTION_NOT_APPROVED` **before** secret/config reads, database I/O
or listening. It was not used to start an enabled production service.

After the separately authorized release only: install the exact lockfile/build
under `/opt/cmarket`; compare reviewed hashes; configure server TLS/PG directly;
review migrations then run the existing `open-owner-entry` migrate/check/enroll
commands; verify genesis, program/IDL/roles and independent RPC observations;
review the non-root `deploy/c3-owner.service.candidate` template and only then
install/start it. TLS terminates in the existing listener; use a reviewed L4
443-to-8443 mapping if needed, not an unreviewed HTTP reverse proxy. No automatic
migration, enrollment, signing, monetary retry or service-restart loop exists in
the template. The isolated signer must independently enforce the existing
durable lookup/idempotency contract. A missing component blocks startup/operations.

## Component budget — not authorization

The offline estimate verifies disabled ELF `d4aca9ad…71beb1`, IDL
`7fdf9c35…7e5eeb` and public rent snapshot at `2026-10-04T00:00:32.535Z`.
The binary did not change; this is a verified reuse of that snapshot, not a new
RPC rent observation or the rent for an enabled future binary.

| Component                                                                           |             SOL | Treatment                                                                                   |
| ----------------------------------------------------------------------------------- | --------------: | ------------------------------------------------------------------------------------------- |
| Program + initial vault/share/intent/plan/6 authorization/6 receipt account capital |     3.584366720 | Persistent rent-backed capital; not all of it is withdrawable while the program is live     |
| Deployment buffer                                                                   |     3.520587320 | Temporary recoverable funding, only after verified successful deploy and authorized closure |
| Measured initial peak                                                               |     7.104954040 | Sum of the two preceding categories, not a fee                                              |
| Owner USDC account, if absent                                                       |     0.001488440 | Conditional account capital from the same 165-byte rent observation                         |
| Additional six-leg authorization/receipt generation allowance                       |     0.030540960 | Proposal only; not unlimited renewal funding                                                |
| Operating margin                                                                    |     0.050000000 | Unapproved reserve, not a measured deployment fee or permission to spend                    |
| Squads app one-time creation fee                                                    |     0.100000000 | Consumed app fee, not deployment buffer; extra account rent/transaction fees unresolved     |
| Proposed known peak, including the preceding allowances                             | **7.286983440** | **Incomplete, not approved**, plus separate **1 USDC** pilot capital                        |

[Squads pricing](https://docs.squads.so/main/getting-started/pricing) distinguishes
the Basic app's one-time fee from monthly plans. No SOL-to-USD conversion or
guaranteed amount returned after swaps is assumed.

Published monthly infrastructure subtotal: **110.95 USD**, composed of backend
24, isolated signer VM 12, proposed daily VM backups 10.80, PostgreSQL starting
plan 15.15, Quicknode monthly Build 49, Alchemy Free 0 within its quota.
This is **not an all-in production quote**: excludes oracle entitlement, HSM/
signer operation/adapter, extra database storage/HA, RPC overage/SLA, DNS,
taxes, egress, labor/security review. Paid Alchemy usage currently starts at
0.525 USD/million CU; a free quota is not guaranteed uptime. Confirm checkout
and restore capacity before buying. Additional PostgreSQL Standard storage is
0.215 USD/GiB/month; don't add base included storage twice. Announced Standard
plan changes on 15 October for new accounts and 30 November for all accounts
require rechecking HA options before purchase.

Primary cost sources: [DigitalOcean VMs/backups](https://www.digitalocean.com/pricing/droplets),
[database table](https://www.digitalocean.com/pricing/managed-databases),
[database pricing/plan changes](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/),
[Quicknode](https://www.quicknode.com/pricing), [Alchemy](https://www.alchemy.com/pricing).

Still unmeasured: exact deployment/base/priority fees until messages and fee payer
are concrete; current swap fees/slippage until fresh exact routes; governance
account rent; final enabled binary/upgrade headroom; source/HSM entitlements.
Those are explicit terms in the total, **not zero**. A final spending cap cannot
be approved against the 7.286983440 SOL/110.95 USD subtotals alone.

## Release and physical verification boundary

No mobile/Rust transaction code, ELF, IDL or APK changed. Existing candidate APK
hash remains `1a7b599578359d590f8289662b7f44783157fe81518ec9b73da2c00d2d7a735f`.
Physical MWA connection/signature result: **PENDING OWNER**, not PASS. No new
phone task is being requested by this pricing-only execution. Previously
prepared non-economic Devnet message QA remains separate from Mainnet signing.
Cloned/local six-leg evidence is not a Mainnet acquisition or redemption.
Mainnet capability remains immutable false; public operations, fees/SKR,
additional deposits and partial redemptions remain blocked.

Independent AI review found two LOW tool defects (Orca fee bounds; self-consistent
but unpinned rent evidence). They were reproduced, corrected and regression-tested.
This is not an external professional audit, governance approval or enablement.

Validation in this execution: TypeScript PASS; service lint PASS; service/docs
formatting PASS; 37 focused market/budget/NAV/collector/accounting tests PASS,
plus 5 compiled package-boundary tests PASS. After the final decimal-schema
change, the 7 directly affected market/budget tests, TypeScript and lint passed
again. Service `npm audit --omit=dev` reports 0 vulnerabilities; no dependency
version or lockfile changed. Changed-file secret-pattern scan found 0 matches
(this is not proof of a comprehensive repository security audit).
Server-check rejected before configuration reads as intended; budget/market
readiness returned blocked, not a false PASS. Existing APK SHA-256 was rechecked
and matches the value above. No phone, wallet, monetary transaction, deployment,
public service, new APK or push was executed. Rust/mobile sources and existing
artifacts were unchanged, so their full suites/builds were not repeated.
