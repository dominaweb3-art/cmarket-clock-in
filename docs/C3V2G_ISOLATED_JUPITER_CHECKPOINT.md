# C3V2G — isolated Jupiter CPI checkpoint

Classification: SHARED. Observed 2026-10-01. Status: PARTIALLY_COMPLETED.
This checkpoint integrates the preserved C3V2G and unsigned-preflight work;
it does not close the durable end-to-end quote authorization requirement.
Mainnet execution, mobile Buy/Sell, production fees and SKR remain disabled.

## What actually executed

The excluded `local-jupiter-probe` build invoked the real cloned Jupiter
`RouteV2` program, then the real cloned Orca Whirlpool `Swap` program, using
the C3 vault PDA through `invoke_signed`. No mock router was used in this probe.
The same canonical `account_metas_hash` and Whirlpool pool-token role checker
used by `execute_swap_leg` ran before the CPI.

Successful evidence:
`programs/c3-pilot-vault/results/jupiter-clone-2B5e3G/evidence.json` (ignored).

- Official public Mainnet program/pool/ALT accounts were cloned read-only.
- Isolated Agave 3.1.10; runtime features cloned from official Mainnet.
- Full probe v0 packet: 1,069 bytes, including signature placeholders,
  compute budget, Ed25519 quote verification, vault wrapper and one ALT.
- Synthetic source USDC: 1,000,000 -> 600,000 base units.
- Synthetic cbBTC destination: 0 -> 474 base units; Jupiter minimum: 470.
- 99,809 compute units; all nested program calls succeeded.
- Eight substituted/expired inputs were rejected before entering Jupiter:
  instruction bytes, signer occurrence, account order, destination, ALT,
  unsigned minimum tampering, signed minimum below policy, expired quote.

This was **local RPC simulation**, not a submitted Mainnet transaction or a
persistent purchase. The payer, quote authority and vault token accounts were
isolated fixtures. No user wallet key was accessed. The only signature created
by the probe was an ephemeral Ed25519 signature over a 300-byte quote message.
API setup/cleanup instructions are not executed: the probe pre-seeds synthetic
vault accounts and inspects CPI compatibility only. This is not evidence that
a production account-initialization or native-SOL close lifecycle works.

Agave loader deployment slots were normalized to zero using its official
clone transformation; program ELF bytes and upgrade authorities were preserved.
Rent epochs were normalized for local genesis. A verified readonly Whirlpool
oracle PDA absent on Mainnet was represented as an empty system account, as
accepted by the legacy Whirlpool swap. These transformations are disclosed in
the ignored evidence; no pool prices/liquidity or ALT contents were invented.

## Implemented boundaries

- Canonical 300-byte Borsh quote codec, checked minimum output, freshness and
  single-use on-chain quote receipt. The authorized minimum may be stricter
  than integer-floor slippage; it must never weaken Jupiter's validated threshold.
- ALT seal binds table addresses, actual owner and complete raw table state,
  including authority and every resolved address. Inactive, malformed, warm,
  writable, signer or substituted tables fail closed at authorization/execution.
- Ordered-meta v3 binds every occurrence, its original inner signer/writable
  flags, effective outer writability and executable status. Duplicate addresses
  need not have identical inner roles; only the vault PDA can be an inner signer.
- Readonly executable Jupiter self-metas are permitted only by the exact registry.
- Legacy Whirlpool pool-token role validation checks program owner, discriminator,
  fixed layout, pool PDA seeds, pool authority, exact pool token-account addresses
  and mints matching the leg. Other writable pool-token roles fail closed.
  The `liquidity` mock PDA rule exists only in the separate `local-mock` build.
- PostgreSQL quote evidence is immutable, revisioned and transition guarded.
  These SQL primitives alone are not a signer authorization service.
- Default artifacts exclude the probe and mock entrypoints. No dependency
  versions, production activation, mobile transaction code or stable apps changed.

## Independent local lifecycle evidence — not real Jupiter settlement

`npm run test:open-local-cpi-postgres` passed the six-leg local mock cycle:
deposit 1,000,000 USDC units; three simulated purchases; 1,000,000 shares issued;
three simulated sales; shares burned; 990,000 USDC units claimed. The fixture
deducts simulated slippage. Replay, duplicate claim, quote tampering, concurrent
workers and signature preservation across restart are exercised in that test.
It must never be shown as actual BTC/ETH/SOL acquisition or Mainnet redemption.

## Exact remaining links / blockers

1. `src/quote-seal.ts::QuoteAuthoritySigner` is an interface, not a connected
   signer service. Migration `0005_c3_quote_seal.sql` references historical
   `c3.c3_pilot_intents`; the isolated open-vault journal lives in `c3_open.intents`.
   No server operation loads a trusted open-vault intent/config/registry/plan,
   validates a fresh real Jupiter result, persists the exact seal, invokes an
   isolated signer, transactionally persists its signature and returns a packet.
   Do not accept caller-defined trusted fields or bridge these schemas by copying.
2. The probe does not use a canonical durable intent, on-chain quote policy,
   settlement plan or replay receipt. Therefore C3V2D-03 is **not closed**.
3. ETH and SOL isolated probes obtained routes but stopped at
   `fresh-route-against-cloned-accounts` with `C3_FORK_FRESH_ROUTE_CHANGED`.
   Their refreshed builds required public accounts not present in the original
   clone. They did not invoke Jupiter or prove either purchase. This is not a
   finding that liquidity is unavailable. A bounded, fresh-account clone/restart
   path is needed; do not use an old quote or unverified placeholder to bypass it.
4. The other five real Jupiter legs, real-program reconciliation, share issuance
   after those effects, full USDC redemption and failure recovery remain unproven.
5. No backend-connected MWA C3 APK or physical Seeker C3 test exists. The current
   isolated mobile app remains disabled; no deployment, Mainnet signature,
   transaction, funds movement or push occurred. Independent review and governance
   approval are still required before proposing a supervised pilot.

## Reproduction / verification

From `programs/c3-pilot-vault`:

```sh
cargo build-sbf --manifest-path programs/c3_pilot_vault/Cargo.toml --sbf-out-dir target/jupiter-fork-probe --features local-jupiter-probe
```

From `services/c3-mainnet` (use the reviewed local Agave 3.1.10 executable path):

```sh
npm run test:jupiter-fork-probe -- --validator /absolute/path/to/solana-test-validator --dexes Whirlpool --asset btc
npm run test:open-local-cpi-postgres
npm run test:postgres
npm run test:open-cpi-inspection
```

Current checks: service tests 68/68; PostgreSQL 54/54; CPI inspection 5/5;
Rust vault unit tests 5/5; service package boundary 4/4; default vault artifact
boundary 2/2; local mock lifecycle 1/1; mobile configuration tests 2/2;
TypeScript, lint, formatting and Android export passed. Expo Doctor reports
18/19: Expo 57.0.25 vs recommended 57.0.26 patch. No dependency was upgraded
just to hide that warning. No signed C3 APK/Seeker QA is claimed.

Official implementation references:

- https://developers.jup.ag/docs/swap/build
- https://github.com/anza-xyz/agave/blob/v3.1.10/test-validator/src/lib.rs
- https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/state/whirlpool.rs
- https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/swap.rs
