# C3V2 local-vault checkpoint

Classification: SHARED. Status: **partial**, not a deployable or investable C3 product.

## Reproduce the demonstrated local cycle

From `programs/c3-pilot-vault`, run `npm run c3:vault:e2e:local`. The runner starts an isolated Solana validator and builds the program with `local-mock`. It uses generated, ignored test keypairs and test mints; it does not use Mainnet funds or a production wallet. The test deposits exactly 1,000,000 base units of test USDC, executes three separately confirmed local buy legs of 400,000 / 300,000 / 300,000 units, records the completed plan, issues 1,000,000 non-transferable pilot share units, then executes three separately confirmed local sell legs. The test adapter deterministically returns 990,000 units of test USDC after its 10,000-unit mock loss. It is **not** Jupiter liquidity, a real price, or a product fee.

Each plan is a program-owned PDA keyed to its intent. It binds wallet, vault, share mint, token mints and vault accounts, 40/30/30 weights, route commitments, minimum outputs, expiry, bitmap and revision. The test rejects an out-of-order or duplicate leg, altered route, stale revision and settlement before all three legs. Rejected intermediate legs leave balances and bitmap unchanged. Shares stay in the owner's non-transferable account during redemption and are burned atomically with the final USDC claim, after all three sell legs are recorded. A paused vault still permits the already-proven claim.

Run `anchor build` without `local-mock`, followed by `npm run test:boundary`, to check that local mock and local plan-creation/settlement instructions are absent from the production IDL. The default artifact cannot create a deposit intent or execute a trade. It is not a functional production vault.

## Not yet demonstrated or safe to claim

- Jupiter V2 route semantics, CPI authority and ALT validation, actual 1,232-byte v0 size, reviewed router registry, six real economic swaps, and corresponding mainnet output custody.
- On-chain recovery after expired quotes or a failed leg; durable per-leg signatures, independent RPC reconciliation and PostgreSQL binding to this open-vault `SettlementPlan`.
- A separate C3 Android pilot app, signed APK, cold launch, or supervised MWA handoff. The existing CLOCK IN app remains unchanged.
- Live NAV, fee collection, SKR rewards, production oracle or any Mainnet capability.

The existing PostgreSQL durability tests exercise the older disabled pilot schema, **not** the new open-vault plan. The read-only Jupiter preflight only proves quote availability for a synthetic taker; see `C3V2_JUPITER_READ_ONLY_CHECKPOINT.md`. Neither result may be presented as end-to-end C3V2 readiness.

Next gate: design and test a locally isolated durable orchestrator that binds every plan leg and signature to the on-chain PDA, with restart and two-worker race tests; then add a reviewed execution adapter and an isolated Android package. Mainnet stays disabled throughout.
