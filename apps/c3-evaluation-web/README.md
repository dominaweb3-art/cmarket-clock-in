# C Market Devnet evaluation — hosted foundation

Classification: CLOCKIN_ONLY. Functional **Devnet test-token evaluation**;
not a production/Mainnet investment product.

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

Hosted keeper, per-wallet provisioning, expiry recovery and lifecycle services
are connected. The physical Seeker/Phantom cycle passed with APK 0.1.14:
deposit, three TEST buys, on-chain shares, restart recovery, three TEST sales,
burn and claim of 0.99 test USDC. The assets and router pricing are simulated;
actual transactions, custody and shares are on Solana Devnet, not database-only
balances. Never describe them as real cbBTC, ETH or Jupiter Devnet liquidity.
The signed APK/hash and judge instructions are published at the site above.

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

Mainnet remains disabled. Physical authentication/lifecycle and signed APK/hash
were verified separately from these automated checks. See
`docs/C3_DEVNET_EVALUATION_QA.md` for signatures and the precise acceptance scope.
No new video, pitch or contest-form submission was created in this closeout.
