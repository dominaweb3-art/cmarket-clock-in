# C3 Mainnet trust boundaries

Status: internal security foundation implemented; external configuration missing; deployment not authorized. Classification: **SHARED**. Mainnet execution remains a source-controlled `false` constant.

## Closed server-owned registries

Production callers provide identifiers, never policy objects, program allowlists, destinations, decoders, provider identities, evidence flags, or expected hashes. The isolated service owns four versioned registries:

- Operation policy registry: resolves exact programs, accounts, instructions, effects, limits, cluster, product configuration, and vault identity. Its current entry is usable only for disabled validation.
- RPC provider registry: empty until two reviewed, independent HTTPS operators and raw-response adapters are pinned. Caller-created providers cannot enter reconciliation.
- Vault snapshot policy registry: empty until exact accounts, mints, decimals, oracle identities, freshness limits, and bootstrap evidence are independently pinned.
- Symmetry adapter registry: empty until official layouts, discriminators, validation rules, and dependency-safe decoding receive independent review.
- Squads registry: pins the official Squads v4 program and source commit, but remains disabled until account layouts, PDA rules, instruction discriminators, and a real C Market deployment are independently verified.

## Authorization lifecycle

The service creates an intent ID, nonce, idempotency key, issue time, and expiry before construction. The immutable context binds the user wallet, exact cluster, vault identifier, operation, input amount, policy version, and configuration version. Construction resolves policy solely from the sealed registry, decodes the complete canonical v0 message and lookup-table context, and stores the expected SHA-256 authorization and message hashes in trusted process storage. Verification loads those expected hashes by intent ID and compares them in constant time. A caller cannot authorize changed data by recalculating its own hash.

The current in-memory context repository is suitable only for deterministic security tests. A durable transactional implementation is mandatory before any deployment authorization, and readiness reports this as missing external configuration.

## Evidence and snapshot provenance

Finalized settlement can be branded only inside reconciliation after two registered independent providers return raw evidence that is parsed and reconstructed internally. Both providers must agree. Missing fields, malformed evidence, changed messages, unknown programs, unauthorized token effects, or disagreement fail closed.

Vault snapshots require non-forgeable quorum evidence and are inserted into an internal snapshot repository. NAV, deposit, and redemption APIs resolve snapshots by ID; they do not accept caller-created snapshots. A serialized object cannot preserve process-local provenance. After restart, a durable repository must verify the complete fingerprint and evidence chain or obtain a fresh reconciliation.

No real RPC providers are registered in this phase, so neither settlement evidence nor production snapshots can be created. This is intentional.

## Manifest lifecycle and recovery

Deployment starts at `proposed`. Advanced statuses cannot be established by submitting a complete object containing approvals or receipts. Repository transitions use revision compare-and-swap, bind the previous revision hash, require legal ordering, and require evidence IDs from trusted verifier-owned storage. That evidence registry is intentionally empty.

Intent recovery is enforced in the repository boundary: every `failed_recoverable -> keeper_pending` transition atomically increments the recovery count; three attempts and 24 hours are hard limits. Stale revisions, concurrent writes, expiry, terminal states, and a fourth attempt fail. Submitted signatures and prior evidence are immutable. There is no automatic retry, reversal, signing, or submission.

## Arithmetic and encoding

All monetary values use `bigint`, canonical decimal strings, explicit u64 bounds, checked add/subtract/multiply/divide behavior, deterministic floor or ceiling rules, and bounded intermediate products. Keeper partial deltas and aggregates are validated before planning. Solana shortvec parsing rejects redundant, truncated, overflowing, excessive, and trailing encodings by canonical re-encoding and byte comparison.

## Official-source pinning

Squads v4 program identity is pinned to `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, official repository <https://github.com/Squads-Protocol/v4>, and audited source commit `64af7330413d5c85cbbccfd8c27a05d45b6e666f`. The registry remains disabled because this phase did not independently pin every account layout and discriminator and no C Market Squad exists.

Symmetry remains fail closed. No official adapter is fabricated, and the Symmetry SDK is not added to the Android application.

## Readiness meaning

Readiness output distinguishes:

- `INTERNAL_SECURITY_READY`: local trust-boundary and adversarial tests pass.
- `EXTERNAL_CONFIGURATION_MISSING`: reviewed Symmetry, RPC, credentials, durable storage, or deployed governance are absent.
- `DEPLOYMENT_NOT_AUTHORIZED`: Security and Squads governance have not approved deployment.

Builder, keeper, and deployment commands must therefore remain **NO-GO** and exit nonzero even when internal security checks pass. Synthetic fixtures can exercise parsers but cannot satisfy production readiness.

Daybreak is not required for this implementation phase because no program, token, vault, wallet action, or transaction is being created or submitted. It may be evaluated later only if a separate deployment plan needs that service.
