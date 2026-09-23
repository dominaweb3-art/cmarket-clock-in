# M4: durable state foundation and Symmetry review

Date: 2026-09-22 (America/Bogota). Classification: SHARED. Mainnet execution remains disabled.

## Track A — scope and limits

`services/c3-mainnet` now has a NodeNext TypeScript build, a clean ignored `dist/`, and a single package export: a read-only service-status facade. The PostgreSQL forward migration `0001_c3_state.sql` defines intents, immutable authorizations, idempotency, evidence, RPC observations, snapshots, manifest events, recovery attempts, transactional outbox and append-only audit records. It uses PostgreSQL `numeric` for raw monetary units and `timestamptz` for time. The internal server-only repository uses serializable transactions, revision-guarded compare-and-swap, database-time recovery limits, and a bounded outbox delivery lease. The generic state transition cannot mark an intent settled; only independently verified evidence can do that.

This is **not production-validated durable persistence**. No disposable PostgreSQL instance was available for migration or concurrency integration tests. The existing builder authorization context, vault snapshot registry, manifest lifecycle and reconciliation pipeline are still in-memory. The new repository is not yet wired into them, so a service restart cannot yet restore the entire C3 execution pipeline. The migration includes snapshot, RPC-observation and manifest tables, but reviewed write/read paths and integration tests for those aggregates remain to be implemented. `DURABLE_PERSISTENCE_READY = false`.

The outbox only delivers safe metadata; webhook delivery must be idempotent by event ID. It does **not** retry deposits, swaps, signatures or settlement. The audit log is append-only at the database trigger level, not independently tamper-proof against a privileged database operator.

The only environment variable this foundation reads is server-side `DATABASE_URL`. It must never be prefixed `EXPO_PUBLIC_`, committed, logged, or placed in an APK. No production database was contacted. The compiled package is private and must not be published. Internal compiled modules still exist for a future server process, but only `dist/public.js` is package-exported.

Before a production-readiness claim: provision a disposable PostgreSQL instance; apply migrations from an empty database; test restart/reload, immutable authorization verification, two-writer CAS, concurrent conflicts, key duplication, recovery attempts 1–4 and 24-hour expiry, signature preservation, rollback, outbox delivery and leases, snapshot/manifest provenance, corrupt rows, monetary boundaries and audit append behavior. Then wire the repository through builder, keeper and reconciliation without weakening sealed evidence, independently review the change, and repeat the tests. Do not connect to production merely to satisfy this checklist.

## Track B — official evidence and blocker

Official [Symmetry documentation](https://docs.symmetry.fi/) identifies V3 program `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`, the `@symmetry-hq/sdk` package and Mainnet/Devnet support. Its [rebalance lifecycle](https://docs.symmetry.fi/concepts/rebalancing) has a multi-stage deposit (intent, deposit, lock, price update, auctions, mint) and withdrawal (intent, auctions or fast path, redeem). Vault shares represent proportional ownership. Standard redemption sends underlying tokens; a C Market promise to return **USDC only** requires a separately verified USDC settlement route and end-to-end authorization/evidence. It is not native proof from `redeemTokensIx` alone.

The isolated npm artifact `@symmetry-hq/sdk@1.0.22` has published integrity `sha512-yopoVu6VnFiktGsjgeJ2dbFX8pdciePK7BUFNbUYb5wAto6DQqVq6a51qE33dRT6BRkL/ANBpKZEJgqpJX+KMA==`, license BUSL-1.1, and compiled deposit/withdraw instruction helpers and account layout files. Its published package has no repository metadata, verifiable source commit or complete official V3 IDL. The compiled helper is useful as a reference, but is insufficient to certify all outer/inner CPI variants, supply effects and authority semantics.

The isolated production graph resolves `@symmetry-hq/sdk@1.0.22 → @solana/spl-token@0.4.15 → @solana/buffer-layout-utils@0.3.0 → bigint-buffer@1.1.5`. The isolated `npm audit --omit=dev` reported one high-severity `bigint-buffer` finding ([GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg)) and two moderate findings. The SDK was **not** added to C Market production or mobile dependencies.

`SYMMETRY_OFFICIAL_SPEC_BLOCKER`: obtain a source commit and matching published artifact, full official V3 IDL/layout and discriminators, audited mint/burn/redeem and authority semantics, and a dependency-safe integration plan. Until these are reviewed against official public transactions, keep the adapter registry empty and reject CPI/share-evidence production readiness. `SYMMETRY_ADAPTER_REVIEWED = false`; `CPI_RECONCILIATION_READY = false`.

External vault/share mint, Squads governance, providers, deployment and Mainnet authorization remain missing or prohibited. None was created in M4.
