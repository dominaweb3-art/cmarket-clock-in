# C3 Devnet threat model

Scope: the proposed Symmetry V3 Devnet simulation vault, its future isolated keeper/builder, read/index/reconciliation services, MWA mobile boundary, and C3 share accounting. Mainnet and real asset backing are out of scope and disabled.

| Threat                                            | Impact                                                 | Mandatory control                                                                                                               | Failure behavior                                        |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Malicious or changed vault configuration          | Wrong assets, weights, receivers, or fees              | Versioned config, Squads 2-of-3, timelock, pre/post-chain reconciliation                                                        | Pause; manual review                                    |
| TEST asset represented as BTC/ETH                 | Misleading product and unsafe migration                | Explicit simulation label, no backing claim, Devnet-only allowlist, production denylist                                         | Build/deployment fails                                  |
| Oracle substitution, stale price, wide confidence | Incorrect NAV, shares, or swaps                        | Exact feed/account owner, signed update, 60s freshness, 200 bps confidence, independent cross-check                             | Pause intent                                            |
| Jupiter quote/build substitution                  | Excess debit or wrong output                           | Exact mints/amounts/user destinations; bounded slippage/expiry; instruction, ALT, signer, fee-payer and route-program allowlist | Reject before wallet                                    |
| Keeper compromise                                 | Unauthorized stages, spam, bounty loss                 | Least privilege, capped bounty/rent, no configuration authority, monitored one-intent state                                     | Disable keeper; governance pause                        |
| MWA session substitution or replay                | User signs unintended operation                        | Exact Devnet chain, wallet identity, human-readable review, fresh blockhash, immutable intent id, no hidden retries             | Cancel; preserve evidence                               |
| Share-accounting mismatch                         | Insolvency or incorrect ownership                      | Executable test vectors, supply/NAV/balance reconciliation, six-decimal bigint math, explicit dust policy                       | Deployment NO-GO                                        |
| Fee conflict or rounding abuse                    | Overcharge and audit failure                           | One versioned Product candidate; collection disabled; exact bigint tests; governance/version gate                               | Fee remains zero                                        |
| Duplicate active intent                           | Double charge or ambiguous state                       | Protocol one-intent rule plus client/backend idempotency and on-chain reconciliation                                            | Block new intent                                        |
| Partial auction/execution                         | Shares/assets do not match UI                          | Explicit keeper states, no atomicity claim, preserve signatures, resume only after chain evidence and user approval             | `manual_review` or recoverable pending                  |
| Withdrawal liquidity failure                      | User cannot receive expected USDC promptly             | Disclose async conversion; quote expiry/slippage; direct proportional redemption fallback only if user explicitly approves      | Keep position/pending assets; never claim sale complete |
| Share transfer ignored by indexer                 | Wrong user shown as owner                              | Position follows current SPL token ownership and finalized balances                                                             | Reconcile before display/action                         |
| Unknown token/program/ALT                         | Arbitrary CPI or destination                           | Program and account manifest, active ALT content validation, no unknown instruction                                             | Reject                                                  |
| RPC or webhook lies                               | False success/failure                                  | Finalized read-only reconciliation through independent providers where required                                                 | Uncertain/manual review                                 |
| Emergency key abuse                               | Freeze or redirect funds                               | Separate emergency Squads role limited to pause; public runbook and audit trail                                                 | Pause only                                              |
| Dependency compromise                             | Malicious transaction construction or Android exposure | Pinned isolated tooling, lockfile review, production-bundle scan; Symmetry SDK excluded from APK                                | Build gate fails                                        |
| Secret leakage                                    | Loss of governance or keeper control                   | No keys/seeds/passwords in repository, logs, JSON output, mobile env, or APK                                                    | Rotate/pause/incident response                          |

## Trust boundaries

- The user wallet owns keys and signs only through MWA. C Market never receives keys.
- Symmetry's deployed program controls vault custody and share accounting; its upgradeability and global configuration remain protocol risks.
- Squads controls C Market configuration and emergency decisions; no individual developer key may substitute for governance.
- Jupiter and Pyth are untrusted inputs until their responses are cryptographically/semantically validated.
- Keeper and backend are operational actors, not asset owners. Their outputs are hints until finalized Solana state is reconciled.
- Mobile is an untrusted presentation and authorization client. It cannot hold deployment authority or decide success alone.

## Security invariants

Allocation totals exactly 10,000 bps. Mainnet is false. Fees and SKR are disabled. Every asset, oracle, program, signer, destination, amount, ALT and expiry matches the reviewed configuration. A user has at most one active intent per vault. No uncertain transaction is retried automatically. No submitted signature is discarded. No completed state is displayed without reconciled finalized evidence. Any unknown or incomplete evidence fails closed.
