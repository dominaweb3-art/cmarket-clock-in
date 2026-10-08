# C Market Devnet evaluation — hosted foundation

Classification: SHARED. This is **not a completed C3 delivery**.

Public presentation: https://cmarket-nine.vercel.app

This isolated project uses the existing free Supabase resource through its
Vercel integration. Only the private `c3_eval` schema is used. PostgreSQL TLS
verification is required; the committed certificate is Supabase's **public CA**,
not a private credential. Runtime database credentials are encrypted server
environment variables and must never be bundled, copied into an APK or logged.

Implemented: short-lived wallet message challenges, signature verification,
durable replay protection and sessions, wallet-specific program-account
validation, unsigned owner-message compilation, pre-send signature journaling,
one-attempt submission and read-only finalized-effect reconciliation.
Authentication tests with ephemeral keys are **not physical Phantom/MWA tests**.
The effect verifier's offline fixtures are not proof of Devnet execution.

The monetary/lifecycle entry points fail closed with
`EVAL_OWNER_SETTLEMENT_AND_RECONCILIATION_NOT_CONNECTED`. Keep that guard until
the hosted keeper, token/vault provisioning, expiry recovery and full Devnet
lifecycle have been connected and verified. The intended assets and swaps are
simulated, use worthless Devnet tokens, and must never be described as real
cbBTC, ETH or Jupiter Devnet liquidity. No evaluation APK is published yet.

## Reproduction

First build the separate vault/router artifacts and the Anchor IDL with the
`devnet-evaluation` feature into `artifacts/c3-devnet-evaluation/`. The feature
cannot be combined with local experiment features. Do not overwrite the
reviewed candidate IDL or reuse Mainnet identities.

From `apps/c3-evaluation-web`, install the pinned lockfile with `npm ci
--ignore-scripts`, then run `npm run build:evaluation`. The build checks the
IDL program, excludes production asset/policy and local-harness markers, and
writes its dependency graph only to ignored generated artifacts.

Relevant tests from `services/c3-mainnet`:

    npm run typecheck
    node --experimental-strip-types --test tests/evaluation-*.test.ts

`scripts/c3-evaluation-hosted-auth-check.mjs` checks the actual hosted
challenge/authentication/replay boundary. It creates only an in-memory test
message signer, never authorizes a wallet or signs/submits a transaction.
`scripts/c3-evaluation-release-check.mjs` checks public hashes, registered
syscalls, Devnet genesis and rent without deploying or transferring funds.

Mainnet remains disabled. The full Seeker purchase/share/redemption/claim,
operation without the Mac, APK signature/hash, video, pitch and submission
acceptance remain unverified. Do not mark any of them PASS from these checks.
