# C3 candidate: exact-source evidence, dependency remediation and device QA

Classification: SHARED. Branch: `feature/c3-open-pilot-vault`.
Starting HEAD: `8a8177c776e5e0c7d8449321b5f0af5cb053df97`.
Execution date: 2026-10-03 America/Bogota (evidence uses UTC timestamps).
Result: **PARTIALLY_COMPLETED; monetary Mainnet gate BLOCKED**.

The existing six-leg cloned-Jupiter/PG/share/redemption cycle is preserved and
was NOT repeated. It is not Mainnet acquisition. This execution changes server
dependency resolution, adds read-only exact-mint source discovery, and prepares
a distinct non-economic physical MWA message test. Rust, custody, swaps, share
math, redemption and durable production transaction code were not changed.

## Exact pricing evidence and remaining code boundary

`npm run c3:open:oracle-discovery` in `services/c3-mainnet` performs only official
keyless HTTP reads. It loads no environment values, builds no transaction and
never authorizes NAV. Its generated result is ignored; exit **2 is intentional**
when required exact-mint economic source evidence is absent.

Observed `2026-10-04T00:55:34.880Z`: official Mainnet RPC finalized slot 453100887.
All four exact configured mints exist, are initialized, have SPL Token owner and
decimals USDC=6, cbBTC=8, Portal ETH=8, WSOL=9. WSOL native mint supply zero is
valid; it is not a claim that the vault holds SOL. This single-RPC discovery is
NOT the required independent production quorum or proof of custody.

Hermes full catalog HTTP 200 contains CBBTC/USD, WETH/USD, USDC/USD and SOL/USD.
No Portal/Wormhole-named feed was found in that catalog snapshot. This does not
prove a private/custom Portal feed cannot exist. Pyth does not provide a Solana
mint mapping in this response. Therefore CBBTC's exact Solana representation is
not certified; WETH must not be promoted to Wormhole Portal ETH. Underlying BTC
and ETH reference feeds remain forbidden as standalone wrapped-asset prices.
USDC parity is not assumed. SOL/USD also requires an approved WSOL backing and
account-policy mapping; mint existence alone does not establish it.

Jupiter Price V3 returned all four exact mints, HTTP 200 without a key in this
read. Its documented derivation includes external oracle anchors and swaps; its
response has no confidence interval. It is not accepted as independent of Pyth
or as an authenticated NAV source. No quoted or displayed price enters NAV.

Primary sources:

- https://hermes.pyth.network/v2/price_feeds
- https://docs.pyth.network/price-feeds/core/price-feeds
- https://dev-forum.pyth.network/t/solana-mint-account-to-pyth-oracle-price/214
- https://developers.jup.ag/docs/price
- https://docs.switchboard.xyz/docs-by-chain/solana-svm/price-feeds/basic-price-feed

**Exact blocker:** `PINNED_OPEN_NAV_COLLECTOR_POLICY` remains null and
`readProductionOpenNavPosition` rejects fewer than two economic source
operators. The current raw collector implements Pyth only. A reviewed second
raw-source decoder/collector is **not implemented** because its exact feeds,
layout, confidence semantics and upstream provenance have not been established.
No generic JSON response, caller flag, symbol, second RPC or source name can
substitute for this evidence. Existing raw custody/reserve/supply joins and
checked NAV math are tested, but not backed by live production price evidence.
First owner-only issuance remains fixed 1M share units; later proportional
issuance is disabled. Full redemption uses finalized realized USDC, never a
price estimate. No new issuance/redemption or oracle approval is claimed.

Product/access required: exact-mint/USD evidence from Pyth Core/Hermes plus an
independent reviewed source. If Switchboard managed quote feeds are proposed,
obtain canonical feed IDs, queue/program/account identities, reviewed jobs and
upstream vendor definitions, confidence/freshness semantics, signer/verification
layout and update service terms from Switchboard. Jobs reusing Pyth fail economic
independence. A Pyth API key alone does NOT fix missing representation coverage.
Do not subscribe, create feeds or change basket assets without owner review.

## Dependency findings and compatibility

Server production graph before: web3.js 1.99.0 → jayson 4.3.0 → stream-json 1.9.1
and uuid 8.3.2; four Moderate entries represent two leaf advisories plus parents.
The scoped official **jayson 5.0.0** override removes both vulnerable packages
(and obsolete eyes/stream-chain) without changing web3.js, Expo, RN or MWA.
The registry integrity is pinned in lockfile and checked by a regression test.
Runtime must use Node >=20. This is a major transitive override, not assumed
compatible merely because installation passes: tested web3 HTTP generated IDs,
batches, results/nulls and RPC errors using an isolated fetch adapter. TCP/TLS
jayson framing is not used or tested; its v5 framing change is not supported here.
Server `npm audit --omit=dev`: **0 findings**. Full graph: two High entries,
Anchor → toml tooling, retained and not suppressed.

Sources: https://github.com/tedeh/jayson/releases/tag/v5.0.0,
https://github.com/advisories/GHSA-528h-pc64-c93x,
https://github.com/advisories/GHSA-w5hq-g745-h8pq.

Mobile `npm audit --omit=dev`: **17 High package entries**, propagated from
node-forge 1.4.0 and braces 3.0.3 in Expo CLI / Metro build tooling. These existed
in the unchanged mobile lock graph; the only lock addition marks the existing
noble/curves 2.4.0 as a direct pinned dependency for public-key verification.
Latest official versions queried remain in affected ranges. No forced SDK
downgrade or unverified patch was installed. The actual Gradle release sourcemap
contains neither leaf and its Hermes output exactly matches the APK asset.
This narrows Android runtime reachability, **does not erase the advisories or
approve build-tool security**. Trusted repository inputs and isolated builds are
required; compatible official patches must be revisited before production.
Advisories: https://github.com/advisories/GHSA-86w9-cpqp-85rv and
https://github.com/advisories/GHSA-vfj7-8cjw-p6xm.

## Exact package and physical test

Final APK (ignored stable artifact, previous APKs retained):
`artifacts/c3-pilot-candidate/2026-10-03-device-message-qa-monotonic-disabled/c-market-c3-mainnet-candidate-0.1.0-disabled.apk`.
SHA-256: `1a7b599578359d590f8289662b7f44783157fe81518ec9b73da2c00d2d7a735f`.
Package `com.dominaweb3.cmarket.c3candidate`, version 0.1.0/code1.
One v2 signer, QA-only certificate SHA-256:
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
It is NOT the approved production signing certificate.
Hermes APK asset SHA-256:
`5b8ac2625fcf7ebbd92a3e72807e4b31733505341261b10303fb0240ef2f9b26`.
Actual release map excludes node-forge, braces, bigint-buffer, local-cycle
launcher, cloned validator and server-side signer. Mainnet monetary flags remain
false and approved configuration null. No production backend reads can succeed
without that configuration; unavailable position/NAV is expected, not zero value.

ADB detects Seeker as `device`. Matching installed/candidate certificates were
verified before `install -r`; no uninstall/data clear or stable-app replacement.
Cold launch without Metro, Home/Indices/Activity, four languages and process-
restart language persistence were exercised. Evidence is local and ignored.
Phantom authorization/return, cancel, reauthentication and physical message
signature remain **PENDING OWNER**, not inferred from synthetic tests.

Physical procedure: open Home, Connect (authorization only, candidate Mainnet
identity; no monetary signing), select Phantom and manually authorize connection.
Then Review non-economic QA message. The separate request authorizes
`solana:devnet` and signs ONLY the displayed `C Market DEVICE QA ONLY v1` text.
It is not a transaction, login, C3 permission or holding. Manually review and
approve; cancel if wallet presents a transfer or Mainnet transaction instead.
Record success or exact error, then test cancellation and explicit reconnect;
restart must not silently restore a wallet/session or signature. No automatic retry.

Message reviews are memory-only, one-use, expire after 120 seconds with both
wall/monotonic clocks and reject clock regression. Guard runs before signing and
after return. Exact bytes/public key and strict Ed25519 are verified locally;
only a message digest can be displayed, never a persisted signature/auth token.
Four crypto/clock/boundary tests use synthetic test keys and prove no physical
approval. Separate AI review reproduced a Low time guard gap; it was corrected
and rechecked 4/4. No new High/Medium observed in this delta. Not an external
professional audit, full protocol audit or governance approval.

## Inputs the owner must supply and how

1. Public wallet: send only base58 owner/allowlist address, never seed/key.
2. Public authorities: update, governance/pause, keeper and quote identities;
   provide existing Squads address/threshold/member public keys if chosen,
   recorded approvals and separation decisions. No invented members or keys.
3. Isolated signer: approved HTTPS service, public signing identity and durable
   idempotency contract; its authentication/HSM credentials only in server secret
   manager. No production key in app, Git or chat.
4. Two reviewed HTTPS RPC endpoints: distinct providers AND operators, evidence
   of operator identities and archive/finality capability. Store credential URLs
   only on server; provide public vendor/operator names for configuration review.
5. HTTPS hosting/PG: select vendor, region, TLS database, backup/restore and service
   origin. Configure DB/password/TLS/auth directly on server; no purchase/deploy
   is authorized by selecting them.
6. Economic feeds: request the precise per-mint products/evidence above, including
   independent upstream provenance. Keys, if required, remain server-only.
7. Limits: approve owner-only exactly 1 USDC, allowed route revision, bounded
   slippage, SOL fees, pause/recovery limits and emergency authority. Fees/SKR,
   subsequent deposits, partial redemptions and public access stay disabled.
8. Budget: approve SOL capital plus consumed network/swap costs and selected
   infrastructure charges; approval must identify the exact future enabled
   ELF/config/IDL/APK hashes, not this disabled QA candidate.

Unchanged disabled ELF: 692864 bytes, SHA-256
`d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
Unchanged IDL SHA-256
`7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`.
Baseline public rent read `2026-10-04T00:00:32.535Z`: persistent capital
3.58436672 SOL; temporary buffer 3.52058732 SOL; peak **7.10495404 SOL** plus
separate 1 USDC deposit. No new Rust change: no repeated rent calculation.
Temporary buffer recovery requires explicit safe closure; it is not a refund
performed here. Consumed deployment/priority/signature/swap fees, provider/PG/
hosting/signer charges remain unquoted: total budget **INCOMPLETE**, not approved.
A future enabled binary must be reviewed and its exact-size rent recalculated.

Before deployment: verify exact release hashes, roles and governed policy;
review source/oracle proofs and provider quorum; configure server-only secrets,
restore drill and signer health; separately authorize a budgeted supervised
deployment; verify deployed ProgramData/hash/authorities/accounts while paused;
only then consider a separate reviewed 1-USDC allowlisted test. Stop on missing
configuration, hash mismatch, price divergence/staleness, quorum disagreement,
uncertain signature or custody/effect mismatch. Recover by read-only reconciliation,
never blind resign/resend/reversal. No deployment or Mainnet operation here.

Legacy `c3:mainnet:deployment-readiness` still describes the frozen Symmetry
adapter and reports failure; it is NOT the active open-vault security gate.
This snapshot does not claim that obsolete diagnostics validate the open vault.

Validation: service TS/lint/format, 172 service tests, 34 focal oracle/NAV/HTTP
tests, 4 package-boundary tests; mobile TS/lint/format, 23 focal tests; Expo Doctor
19/19; Android export and signed release build; actual APK/bundle inspection.
No Rust/PG lifecycle code changed: no repeated six-leg/local PG cycle.
`PHONE_REQUIRED_NEXT: YES` — the exact installed APK above has a prepared
non-economic Devnet message request, awaiting explicit physical owner action.
