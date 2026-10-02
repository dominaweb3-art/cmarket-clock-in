# C3 open-vault implementation checkpoint — 2026-10-01

> Historical checkpoint through `f54bba0`. The independent-probe and missing-device
> statements below describe that earlier state, not today's integrated result.
> See `C3_INTEGRATED_CLONE_ACCEPTANCE.md` for the subsequent single-bank,
> PostgreSQL, physical-Seeker acceptance and the still-blocked Mainnet gate.
> Preserve this record; do not reinterpret earlier simulations as acquisitions.

Classification: SHARED. Starting commit: `270eac6a0066095bdae76b558af5bf1ff56b794e`.

## Verified boundaries (not a Mainnet purchase)

| Path                                                                                                 | Result                                                   | Scope                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| USDC → cbBTC → USDC                                                                                  | PASS, both directions                                    | Two independent real Jupiter CPI **simulations** against cloned public pools; synthetic vault funding      |
| USDC → Portal ETH → USDC                                                                             | PASS, both directions                                    | Same independent cloned-bank scope                                                                         |
| USDC → WSOL → USDC                                                                                   | PASS, both directions                                    | Same scope; WSOL is held by the vault, not delivered to the wallet                                         |
| Existing intent → PostgreSQL seal → isolated signer → persisted signature → Ed25519 verification     | PASS                                                     | Disposable PostgreSQL + deterministic mock-router local-validator cycle                                    |
| Six swaps → issue shares → lock/burn → USDC claim + recovery                                         | PASS                                                     | Mock router only; NOT Jupiter acquisition/redemption                                                       |
| Real Jupiter + enrolled on-chain context + PG seals + shares + redemption in **one persistent bank** | NOT VERIFIED                                             | Still the required end-to-end acceptance gap                                                               |
| Independent finalized-effects reconciler → durable journal                                           | PASS for synthetic finalized RPC fixtures                | Explicit local-only verification/CAS; real persistent Jupiter bank not yet exercised; no production quorum |
| Seeker APK                                                                                           | Signed standalone QA APK built; device test NOT EXECUTED | No ADB device; monetary actions immutable-disabled                                                         |

No Mainnet transaction, wallet authorization, real-fund transfer, deployment or push occurred. Ephemeral quote signing and fixture transactions occurred only in the isolated local tests. `C3V2D-03` is **not** declared fixed by these separate proofs.

## Durable authorization and namespace resolution

`services/c3-mainnet/pilot-open-local/migrations/0003_open_quote_authority.sql` is a reviewable forward migration. Contexts and authorizations reference the **existing** `c3_open.intents` / `c3_open.legs` through restrictive foreign keys. It neither copies nor reinterprets historical `c3.c3_pilot_intents` or Symmetry seals. Immutable context/payload/evidence, monotonic revisions, retained signatures, global quote identity and one active authorization per leg preserve CAS/idempotency.

`prepareOpenUnsignedLeg` reads program-owned configuration, plan, registry and policy through `captureContext`. The local-only builder obtains an official Jupiter exact-input build, validates narrow direct legacy-token Whirlpool routes, resolves actual RPC ALTs, binds ordered duplicate account occurrences and compiles both unsigned v0 packets. The max packet is rejected above 1,232 bytes.

`IsolatedOpenTestSigner` generates its Ed25519 key **inside a separate child process**, never exports/persists it and has no production key loader or fallback. It accepts only a durable quote ID and expected public payload hash, independently reloads the intent/context/300-byte payload through a read-only PostgreSQL connection and rejects stale, mismatched or substituted records. The orchestrator persists the verified signature under serializable CAS before returning any unsigned packet. No signer call occurs while holding a PG intent lock. Only a disposable loopback test database is accepted.

The mock six-leg regression first retains the original independently signed hostile-case tests, then rotates its **local** quote policy to the child-generated key. All six durable authorizations are consumed once; 1,000,000 synthetic share base units are issued and burned; 990,000 synthetic USDC base units are returned after the fixture's disclosed 1% slippage. These are not production balances or fees.

## Exact minimum and fresh-route evidence

Historical probe `jupiter-clone-2B5e3G` records input 400,000, expected cbBTC output 474, minimum 470 and 100 bps slippage. Integer floor is 469; 470 is the stricter floor. Its **original raw API threshold response and absolute expiry were not retained**, so that historical quote cannot be independently reauthenticated retrospectively. It is never reused for authorization.

Current `six-jupiter-clone.json` records BTC buy 400,000 → 476, minimum 472; ETH buy 300,000 → 11,106, minimum 10,995; WSOL buy 300,000 → 2,545,155, minimum 2,518,449. Independent reverse inputs are those observed cloned outputs. Every current probe preserves quote input, output, API threshold, signed minimum, slippage, actual fetch time, expiry and fingerprint. Minimum is `max(checked integer floor, validated Jupiter threshold)`; no weaker authorization is accepted.

The clone harness warms public program binaries, then obtains a **new** quote and clones its exact account, program-data and ALT dependencies before starting a new bank. Route/expiry churn rebuilds at most three times; structural errors stop. It never omits required metas or rebases expired timestamps. Local Agave deployment-slot/rent metadata normalization is disclosed; program ELF and actual pool/ALT contents are retained. The exact observed absence of the legacy readonly Whirlpool oracle is preserved, not fabricated oracle pricing.

Sources: [Jupiter developer platform](https://dev.jup.ag/), actual Jupiter Mainnet Anchor IDL read through official RPC (JSON SHA-256 `12a0856158b2b6927d683a2ba21566f82e39989aca476e23c02d845fc38cdca8`), and [official Whirlpool swap source](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/swap.rs). A program label is not authority. The actual IDL/ELF and instruction data, not a dynamic API-provided schema, determine allowed semantics.

## Focused adversarial verification

- Six cloned probes reject eight hostile variants each (48 negatives): raw bytes, occurrence signer flag, ordered metas, destination, ALT substitution, altered minimum, below-floor signed minimum and expired seal.
- Disposable PG tests cover 1,232/1,233-byte boundary, immutable records/signatures, original-intent binding, stale CAS, concurrent requests, expiry/future timestamps, slippage, restart and failed signer. Direct requests for non-persisted or substituted bytes are rejected by the child signer.
- Local mock cycle tests restart, uncertain signatures, concurrent workers, share ownership, replay and duplicate USDC claim without automatic resubmission.
- Finalized-effects tests reject reordered/extra CPI accounts, unknown programs, unrelated token debits, missing owner/balance/instruction evidence, approval/burn/close, changed authority, unexpected SOL effects, wrong amount, stale time/slot and altered outer message/signature.
- The actual cloned CPI exposed Jupiter V2 `SwapsEvent` (132 bytes, one `SwapEventV2`), distinct from legacy `SwapEvent`. Event `amm` is the Whirlpool **program**, not pool. Both decoders bind mints and exact amounts. The pool is separately bound by actual CPI accounts and reserve effects.
- The canonical codec regression caught timestamp/slot/ALT-count/hash offset mistakes: 268/276/235/236 respectively. Fixtures now use the actual canonical encoder instead of duplicating handwritten offsets. ALT reconciliation includes every ordered table supplied to the CPI, even an unused-by-compiler table, and rejects substitution, raw-content changes, inactive or malformed tables.
- `reconcileLocalJupiterLeg` independently reloads the immutable PostgreSQL authorization and finalized RPC message/effects/plan before a short serializable CAS. It binds exact outer fixed accounts and quote-derived PDAs, verifies the 877-byte Anchor v1 plan layout/next revision/current effects, and atomically confirms the leg, consumes the seal once and appends the outbox event. The commit hook is JavaScript-private. Public metadata/hashes only are recorded; no unsigned payload is added to the journal.
- The PostgreSQL recovery test uses explicitly **synthetic** finalized RPC effects with real v0/signature encoding. It rejects an unrelated token debit without changing journal state, preserves an uncertain signature across repository restart, prevents mock attestations from confirming `LOCAL_CLONE` contexts, and permits one confirmation under concurrent requests. It also covers a supplied ALT not used by message lookups. Source-IDL encoded plan fixtures test all six direction/revision combinations and hostile plan fields. These tests do not constitute real Jupiter execution.
- Reconciliation currently accepts only the observed legacy Whirlpool swap variant. Unreviewed V2 inner layouts deliberately fail closed even if a future builder returns them. This restriction must not be mistaken for universal Jupiter support.

These are focused implementation/adversarial checks, **not an independent external audit**. They do not authorize deployment or resolve the unified real-Jupiter cycle gap.

## Reproduction and evidence

Run inside `services/c3-mainnet`:

```sh
npm run test:open-quote-postgres
npm run test:open-jupiter-recovery
npm run test:open-local-cpi-postgres
node --experimental-strip-types --test pilot-open-local/jupiter-route-v2.test.ts pilot-open-local/open-reconcile.test.ts pilot-open-local/open-plan.test.ts
npm run test:jupiter-six-clone -- --validator /absolute/path/to/pinned/solana-test-validator
npm run typecheck
npm run lint:check
npm run format:check
npm run test:boundary
```

The cloned probe requires its separately built `local-jupiter-probe` binary and Agave 3.1.10 as recorded by the experiment. The PG mock cycle builds a `local-mock` artifact; restore default production artifacts using Anchor 0.31.1 `build` afterward and run the program boundary checks. Neither feature belongs in a production artifact.

Ignored evidence: `programs/c3-pilot-vault/results/six-jupiter-clone.json`, per-probe `evidence.json`, `durable-signer-cycle.log`, and `default-build-after-durable-cycle.log`. Reports and unsigned payloads are not committed. Builder payload retention is bounded to quote lifetime and consumed after returning packets; restart without its in-memory packets fails closed rather than silently reconstructing/submitting.

## Isolated mobile handoff

Package: `com.dominaweb3.cmarket.c3pilot`. Home, Indices and Activity show 40/30/30, durable backend journal states explicitly labeled **local simulation**, and no real position. Read-only wallet connection uses MWA on Devnet only; Buy/Sell are immutable-disabled. No RPC/Jupiter or vault execution implementation is imported into Android.

APK: `apps/c3-pilot/dist/release/c-market-c3-pilot-0.1.0-qa.apk`.

SHA-256: `0f3b4e3894dee925b06600224ae6d5159a828b68f3ec90f7f18ee6fc98bb7e84`.

QA certificate SHA-256: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`. QA certificate is NOT approved production signing identity. APK, signing material, passwords, generated Android files and reports are ignored.

Phone check still required: connect/unlock Seeker, authorize USB debugging, inspect any existing isolated package/certificate, install only data-preserving if compatible, cold launch without Metro, review all four languages/tabs and explicit MWA chooser without any monetary approval. Do not touch stable C Market/CLOCK IN. The read-only backend uses loopback port 8787 through USB forwarding; only the isolated server receives its PG configuration. No credentials belong in the APK.

## Remaining implementation and deployment gates

1. Enroll actual real-Jupiter vault/plan/registry/policy context, sign through PG and execute the canonical authorization/keeper packets in **one persistent cloned bank**. Diagnostic probe simulations and mock settlement are not interchangeable. The default canonical program still returns `SwapDisabled`; test-only probe success is not proof of that canonical lifecycle.
2. Integrate all six real CPI effects, share issuance, burn and USDC claim into that same recoverable journal. The distinct `reconcileLocalJupiterLeg` path now consumes independently checked local finalized evidence; mock attestations cannot confirm enrolled clone contexts. Its durable promotion/recovery tests pass on synthetic finalized RPC fixtures, but the complete six-leg real-cloned canonical lifecycle remains unexecuted. `recordLocalChainCheckpoint` still handles shares/claim checkpoints through a labeled mock-only hook; actual Jupiter issuance/burn/claim checkpoint verification is not yet connected.
3. Obtain real finalized evidence tests for ALTs, native/WSOL lamport effects and every supported inner route. Production reconciliation requires genuinely independent reviewed RPC operators; current module accepts local RPC only.
4. Complete physical Seeker QA, governance/limits/pause configuration, production signer design and independent review of the exact fund-moving code/deployment package before proposing supervised 1-USDC Mainnet acceptance.

Mainnet, public access, fees, SKR and real C3 Buy/Sell remain disabled. No basket acquisition, on-chain Mainnet position or real USDC redemption is claimed.

## Validation and warnings

Service and pilot TypeScript/lint/format checks passed; focused route/reconciliation/Anchor-plan tests (9), PostgreSQL isolated-signer and independent-recovery tests, six-leg mock PG/chain cycle, service production boundary (4), program production boundary (2), Rust unit tests (6), default Anchor build and pilot UI boundary tests (4) passed. The mock PG/chain cycle was rerun after the journal refactor and passed; the default program was restored afterward. Android production export and standalone signed release build passed. APK signature and hash were reverified; Android bundle contains no open-vault execution/Jupiter implementation. Stable `apps/mobile`, frozen Symmetry and sibling worktrees were not changed.

APK string inspection found the public Mainnet endpoint constant shipped by the official `@solana/wallet-standard-util/lib/cjs/endpoint.js`, imported by MWA. This is a library constant, not an application-configured Mainnet RPC or the experimental engine. The pilot source has no `Connection`, swap/sign/send method or Mainnet request; explicit MWA authorization is `solana:devnet`, and both capability constants remain false. Do **not** describe the APK as containing zero Mainnet strings. Jupiter URL, production basket mints and open-vault builder/probe implementation markers are absent.

Expo Doctor: 18/19 checks; installed SDK patch 57.0.25 differs from recommended 57.0.26. No unrelated upgrade was performed. Production service audit: zero findings. Pilot production dependency audit: ten Moderate findings in the Expo CLI/xcode/uuid family, zero High/Critical; this remains an outstanding dependency warning, not a clean audit. The pilot production graph has no SPL Token/buffer-layout-utils/bigint-buffer chain. Node-only test/Anchor tool dependencies are not shipped as that pilot chain. No force audit fix or vulnerability suppression was performed.

Visible/tracked-file and secret-pattern checks found no credentials, private-key files, environment files, APKs or signing artifacts to commit. APK and temporary signing material remain ignored. Physical device validation is blocked specifically by an empty `adb devices` list, not a claimed Seeker success.
