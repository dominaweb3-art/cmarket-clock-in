# C3 M4.1C disposable PostgreSQL verification matrix

Classification: SHARED. Date: 2026-09-22; count corrected 2026-09-23 (L-001 documentation only). Mainnet execution remains disabled. Run `npm --prefix services/c3-mainnet run test:postgres` from the repository root. Each `M01`–`M30` is one separately named real-PostgreSQL subtest in `services/c3-mainnet/tests/postgres-live.integration.ts` or `services/c3-mainnet/tests/postgres-matrix.ts`. The runner creates and removes its own localhost-only PostgreSQL 16 cluster, temporary role and database. The independent-process cases invoke `tests/postgres-process-worker.mjs` after the preceding writer process exits. The final M4.1 execution contained 30/30 numbered scenarios and 20 diagnostic checks: 50/50 PostgreSQL results total. Diagnostics are not counted toward the 30-case matrix.

| Case | Required scenario                                                                              | Result |
| ---- | ---------------------------------------------------------------------------------------------- | ------ |
| M01  | Clean application of versioned migrations                                                      | PASS   |
| M02  | Repository health and checksum verification                                                    | PASS   |
| M03  | State reload after a separate Node process restart                                             | PASS   |
| M04  | Authorization creation and reload                                                              | PASS   |
| M05  | Authorization update rejected                                                                  | PASS   |
| M06  | Authorization deletion rejected                                                                | PASS   |
| M07  | Corrupted authorization hash rejected                                                          | PASS   |
| M08  | Correct CAS revision succeeds                                                                  | PASS   |
| M09  | Stale CAS revision fails                                                                       | PASS   |
| M10  | Independent concurrent CAS clients have one winner                                             | PASS   |
| M11  | Concurrent duplicate idempotency has one operation                                             | PASS   |
| M12  | Recovery attempt one                                                                           | PASS   |
| M13  | Recovery attempt two                                                                           | PASS   |
| M14  | Recovery attempt three                                                                         | PASS   |
| M15  | Attempt four enters manual review                                                              | PASS   |
| M16  | Recovery after 24 hours rejected using database time                                           | PASS   |
| M17  | Submitted signature survives a separate process restart                                        | PASS   |
| M18  | Rollback leaves no related partial records                                                     | PASS   |
| M19  | Transition, outbox and audit commit atomically                                                 | PASS   |
| M20  | Failed transition leaves no orphan outbox event                                                | PASS   |
| M21  | Independent concurrent outbox workers have one lease owner                                     | PASS   |
| M22  | Expired outbox lease reclaimed                                                                 | PASS   |
| M23  | Bounded attempts reach dead letter                                                             | PASS   |
| M24  | Duplicate event delivery does not duplicate business state                                     | PASS   |
| M25  | Audit update rejected                                                                          | PASS   |
| M26  | Audit deletion rejected                                                                        | PASS   |
| M27  | Snapshot hash, numeric values and linked synthetic evidence survive a separate process restart | PASS   |
| M28  | Manifest predecessor order and revisions enforced by schema                                    | PASS   |
| M29  | Corrupted authorization row fails closed                                                       | PASS   |
| M30  | Exact u64/u128 round-trip and overflow rejection                                               | PASS   |

These are repository and database contract tests, not on-chain C3 settlement tests. M24 exercises the outbox delivery contract, not a deployed webhook consumer. M27 verifies synthetic linked evidence persistence; it does not implement the independent production snapshot service. M28 enforces ordering and revision at the database layer; it does not prove Security or Squads approval. Builder, keeper, reconciliation, Symmetry, USDC redemption, full lifecycle durability and deployment readiness remain separate fail-closed gates.
