# C3V2 local-vault checkpoint

Classification: SHARED. Status: **partial**, not a deployable or investable C3 product.

## Reproduce the demonstrated local cycle

From `programs/c3-pilot-vault`, run `npm run c3:vault:e2e:local`. The runner starts an isolated Solana validator and builds the vault with `local-mock` plus a separately loaded test router. It uses generated, ignored test keypairs and test mints; it does not use Mainnet funds or a production wallet. The test deposits exactly 1,000,000 base units of test USDC, executes three vault-PDA-signed CPI buy legs of 400,000 / 300,000 / 300,000 units, records the completed plan, issues 1,000,000 non-transferable pilot share units, then executes three CPI sell legs. The test router transfers real SPL test tokens between vault and pre-funded test-liquidity accounts. It deterministically returns 990,000 units of test USDC after its 10,000-unit mock loss. It is **not** Jupiter liquidity, a real price, or a product fee.

Each plan is a program-owned PDA keyed to its intent. It binds wallet, vault, share mint, token mints and vault accounts, 40/30/30 weights, route commitments, minimum outputs, expiry, bitmap and revision. A separate governance-signed, single-use authorization binds the CPI data and ordered account metas to the plan. The keeper cannot sign for vault-owned tokens: the program uses `invoke_signed` with the vault-authority PDA, then checks exact input debit and minimum output credit. The test rejects an out-of-order or duplicate leg, altered route/data/metas, stale revision, unauthorized governance, wrong destination and settlement before all three legs. Rejected intermediate legs leave balances and bitmap unchanged. Shares stay in the owner's non-transferable account during redemption and are burned atomically with the final USDC claim, after all three sell legs are recorded. A paused vault still permits the already-proven claim.

The additional command `npm run test:open-local-cpi-postgres` from `services/c3-mainnet` starts a **disposable** local PostgreSQL cluster and the local validator. It ties the six CPI legs to the isolated `c3_open` journal: prepared route fingerprints, signature persisted before a one-shot submission, restart read, a two-worker lease race, finalized local `getTransaction` checks and final activity. This is a local-only evidence adapter, not production RPC quorum.

Run `anchor build` without `local-mock`, followed by `npm run test:boundary`, to check that the separate local router and local plan-creation/settlement instructions are absent from the production IDL/binary. The default artifact includes a disabled CPI boundary but cannot create a deposit intent or execute a trade. It is not a functional production vault.

## Not yet demonstrated or safe to claim

- Executing an actual Jupiter V2 route, decoding its production-specific instruction semantics, independent ALT validation, actual 1,232-byte CPI-outer-v0 sizing, reviewed route-program registry, six real economic swaps, and corresponding Mainnet output custody. A read-only `/swap/v2/build` sample and official Jupiter program identity do not establish executable route safety.
- Production recovery after expired quotes or a failed leg, two **independent reviewed HTTPS RPC operators**, and secure PostgreSQL-to-chain authorization outside the disposable local harness. The local journal can prove restart and one-shot submission discipline; it must not self-certify Mainnet effects.
- A separate C3 Android pilot app, signed APK, cold launch, or supervised MWA handoff. The existing CLOCK IN app remains unchanged.
- Live NAV, fee collection, SKR rewards, production oracle or any Mainnet capability.

The read-only Jupiter preflight only proves route availability for a synthetic taker; see `C3V2_JUPITER_READ_ONLY_CHECKPOINT.md`. Neither result may be presented as Mainnet C3 readiness. The local six-leg CPI + disposable PostgreSQL harness does not authorize a real-asset test.

Next gate: independently audit the local CPI boundary and replace the test-only route assumptions with a verified Jupiter CPI account/ALT/size policy and two-operator production reconciliation, while retaining the immutable disabled release. Do not enable Android Buy/Sell or Mainnet before that gate.
