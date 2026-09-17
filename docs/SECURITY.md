# Security Notes

## Never commit

Never commit any of the following:

- Seed phrases.
- Private keys.
- Wallet export files.
- Authentication tokens.
- Production RPC credentials.
- Cloud service credentials.
- Keystore passwords.
- Android signing keys.
- Personal identity documents.

## Wallet model

C Market is designed so that the mobile wallet signs transactions. The application should only receive public wallet information and signed transaction results through the supported wallet integration.

The application must never request a seed phrase or private key.

## Development network

Use a dedicated Devnet wallet and Devnet assets during development and judging.

Devnet tokens have no real-world value. Do not test experimental code with personal mainnet funds.

## Logs and screenshots

Before publishing logs, screenshots, or demo recordings:

- Remove wallet secrets.
- Remove local filesystem paths that reveal unnecessary personal information.
- Check transaction details for unintended data.
- Keep public addresses only when they are intentionally part of the demonstration.

## Reporting a vulnerability

Do not publish a vulnerability with exploitable details in a public issue. Contact the project owner privately first and include:

- A clear description.
- Reproduction steps.
- Affected version or commit.
- Impact assessment.
- Suggested mitigation, if available.

This repository is a hackathon project and has no guarantee of production security. A production deployment would require a substantially deeper security review.

## Guarded C3 Core Mainnet engine

The C3 Core Mainnet engine is implemented separately from the verified Devnet payment flow. The shipped build uses a source-controlled immutable `false` capability constant; environment variables, route parameters, storage, and constructor values cannot enable Mainnet. Runtime execution also requires the exact `mainnet-beta` cluster, but that gate is unreachable while the release capability is false.

The engine uses sequential Jupiter builds for 40% cbBTC, 30% Portal ETH, and 30% native SOL. It never embeds a Jupiter API key, requests fresh keyless builds immediately before each leg, caps slippage at 100 bps, validates mints, exact inputs, destinations, signers, fee payer, programs, and prohibited authority instructions, and rejects stale blockhashes or transactions over 1,232 bytes.

Only the connected wallet may sign and pay. C Market does not custody the purchased assets. Unsigned or signed transaction payloads are not persisted. Persistence contains only purchase metadata, leg states, public signatures, timestamps, and confirmed output amounts when available. A confirmed leg cannot be submitted again; failures are not automatically retried or reversed, and resumption requires a fresh quote and explicit approval.

### Phase 5G.1 validation controls

The Mainnet engine now fails closed at both route and execution boundaries. The feature flag is checked internally with an exact `true` comparison and cannot be overridden by a route caller. Runtime execution requires the exact `mainnet-beta` cluster. Strict decimal-to-base-unit parsing and bounded `bigint` arithmetic enforce the 50–500 USDC purchase range and exact 40/30/30 allocation.

Jupiter build metadata is checked against the requested leg, and the decoded route plan must consume the complete input and match the declared output. Raw build instructions and compiled v0 instructions are compared byte-for-byte for program, data, account order, signer, and writable requirements. Only official Jupiter V2 discriminators and reviewed fixed route-step layouts are accepted. Unknown or variable layouts fail closed.

The user is the only signer and fee payer; the validator rejects treasury or third-party destinations, unexpected transfers, token approvals, delegates, authority changes, unrelated account closures, unsafe compute/priority instructions, and unsupported executable programs. Jupiter labels are not sufficient by themselves: IDs are checked against the static reviewed registry. Real address lookup tables are fetched and validated for owner, active status, slot freshness, exact addresses, and every compiled index. Native SOL cleanup is limited to the expected temporary WSOL account and a user-only lamport refund.

Security tests include a valid sanitized Jupiter V2 fixture plus malicious fixtures for input/mint/threshold/slippage/taker/mode/route mismatches, unknown programs, unsupported route variants, extra signers, a different fee payer, third-party outputs, unauthorized token instructions, unsafe closes, fabricated or invalid lookup tables, and WSOL refunds to a third party. A complete SOL fixture covers the expected temporary WSOL account lifecycle. Simulation is advisory only and cannot convert an environmental missing-account failure into a success claim. The MWA flow and Devnet implementation remain unchanged. The read-only build harness also fetches and validates lookup tables from Mainnet RPC instead of trusting API address arrays.

### Phase 5G.2 recovery controls

The disabled engine's persisted document is schema-versioned and strict. It rejects unknown versions, extra fields, malformed public keys or signatures, unsupported clusters or mints, altered allocations, duplicate IDs, stale revisions, impossible transitions, incomplete confirmed records, missing authorization manifests, and legacy unversioned arrays. Allocations are recomputed from the original USDC base-unit total; persisted leg percentages, order, mints, and destinations are never trusted. Only approved diagnostic codes are retained, and transaction payloads or arbitrary provider error text are not persisted.

State writes are serialized by an asynchronous mutex, guarded by expected revisions, staged, and verified by read-back. A conflict or storage failure cannot produce a submittable state. `submitted_unconfirmed`, `submission_outcome_uncertain`, and `reconciliation_required` are never converted to an ordinary failure or retried automatically. Confirmed legs are immutable, and a later leg cannot reset them.

Before any future wallet approval, the immutable intent and current leg are persisted. After a wallet signature is returned, the signature is preserved immediately. Confirmation requires two independently configured Mainnet providers and complete semantic evidence, not a signature or status alone: exact wallet signer and fee payer, Jupiter program, USDC debit, output mint and user destination, minimum output, validated ALTs, no treasury or authority changes, and safe WSOL accounting. Missing, malformed, conflicting, or incomplete evidence blocks reconciliation. The current release config still contains no Mainnet providers and Mainnet remains disabled.
