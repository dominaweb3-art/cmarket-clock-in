# C3V2F partial checkpoint — 2026-09-29 UTC

Classification: SHARED. This checkpoint is **NO-GO for Mainnet execution**. It is not a completed Jupiter authorization or a production settlement proof. `ROUTER_EXECUTION_ENABLED` remains immutable `false` in the normal program build; mobile Buy/Sell remains disabled.

## Implemented and locally verified

- Governance initializes a versioned, empty, disabled route-program registry PDA. Only configured governance can replace or disable it. Replacement checks a canonical SHA-256 configuration hash, unique program IDs, activation/expiry slots and the reviewed router ID. Authorizations bind the registry revision and hash; execution rejects a changed or inactive registry. Local tests exercise unauthorized governance, an incorrect hash, disable/re-enable and six mock legs.
- Ordered account-meta hashing now includes each occurrence, including legitimate duplicate metas, position, signer/writable/executable flags and registry revision/hash. A local mock-router duplicate is accepted. The vault still rejects unauthorized signers, writable executables, wrong source/destination and unregistered executable programs. This is **not** proof of real Jupiter CPI semantics: Solana `AccountInfo` privilege flags can be coalesced for duplicate keys, and route data still comes from the caller.
- The vault independently derives `minimum_output = floor(quoted_output × (10,000 − slippage_bps) / 10,000)` with checked `u128` arithmetic and rejects zero, arbitrary or mismatched minima. `quoted_output` remains caller-supplied until a signed QuoteAuthorization is implemented; this calculation alone does not authenticate a quote.
- The isolated validator still completes one mock 1-USDC deposit, three mock buys, local share issuance, three mock sales, share burn and USDC claim. These synthetic tokens/prices do not establish Mainnet liquidity or compatibility. The disposable PostgreSQL/CPI restart test is a separate acceptance check.

## Read-only unsigned Mainnet v0/ALT sizing

At 2026-09-29 18:18 UTC, `npm run c3:jupiter:v0-six-route-probe` in `services/c3-mainnet` requested fresh Jupiter V2 builds for an unfunded synthetic public taker, resolved advertised lookup tables from finalized public RPC, serialized unsigned v0 transactions with signature placeholders and checked the 1,232-byte packet limit. The route output is volatile; these sizes do not authorize the vault to execute, nor do they prove PDA/CPI compatibility.

| Leg | Serialized unsigned bytes | Result |
| --- | ---: | --- |
| USDC → cbBTC | 721 | below 1,232 |
| cbBTC → USDC | 494 | below 1,232 |
| USDC → Portal ETH | 1,071 | below 1,232 |
| Portal ETH → USDC | 1,132 | below 1,232 |
| USDC → WSOL | 792 | below 1,232 |
| WSOL → USDC | 564 | below 1,232 |

The probe marks every route `executable=false`; its account allowlist is for measurement only. A different quote or route may exceed the limit. Portal ETH is **not proven executable** despite this snapshot fitting.

## Blocking gates still open

1. No server-only canonical QuoteAuthorization signed by a distinct quote authority, and no on-chain Ed25519 instruction-sysvar verification. Fingerprints and quoted output remain unauthenticated. This is a High/Critical release blocker.
2. No demonstrated real Jupiter CPI with vault PDA and governed executable/writable account policy. Duplicate-meta privilege coalescing and full instruction semantics require adversarial proof. The standalone unsigned v0 measurement is not a substitute for vault execution.
3. No raw finalized `getTransaction` semantic decoder that independently reconstructs every outer/inner instruction, ALT, token and lamport effect and permits confirmation only after complete evidence. The existing two-provider intake deliberately returns `MANUAL_REVIEW`; the production reviewed-provider registry remains empty.
4. No end-to-end signed-quote + Jupiter + uncertain-signature recovery test across PostgreSQL restart. Local mock success cannot close this gate.
5. The isolated Android APK was rebuilt for inspection, not for a supervised Mainnet pilot. It has no enabled trading path and has not been independently reviewed or installed on Seeker.

## Android inspection artifact

The isolated app's release Gradle task was forced to rerun on 2026-09-29. Its ignored local APK is `apps/c3-pilot/android/app/build/outputs/apk/release/app-release.apk`, package `com.dominaweb3.cmarket.c3pilot`, version `0.1.0`, SHA-256 `9eff68254b238e12c0a0635acf682ac7a70b034e225aee2c99ba656da2101731`. `apksigner` verified one **Android Debug** certificate with v2 APK signing; this is not a production release signature. The compiled bundle did not contain the checked Jupiter router ID, API hostname, mock-router marker, PostgreSQL variable name or route-registry seed strings. A string scan cannot prove the absence of all secrets or code paths. Expo Doctor reported 18/19 checks because `expo` 57.0.25 is one patch behind the SDK's expected `~57.0.26`; dependencies were not changed in this security checkpoint.

Production lifecycle instructions may exist in the IDL, but the immutable production swap gate remains closed. Do not deploy, connect a user wallet, enable mobile Buy/Sell or move funds. Next implementation should seal the quote authority and prove real Jupiter CPI/size semantics, then complete raw independent-RPC effect reconciliation and restart/concurrency tests before an independent security review.

Primary technical references: [Jupiter Swap V2 build](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis), [Solana versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions), [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction).
