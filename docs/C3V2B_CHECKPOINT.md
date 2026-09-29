# C3V2B checkpoint — isolated local pilot, not release-ready

Classification: SHARED. This checkpoint starts from `334fbfc` and does not alter the stable CLOCK IN mobile app, protected worktrees, published APKs, or Mainnet configuration.

## Demonstrated locally

- The existing Anchor `local-mock` six-leg cycle still deposits exactly 1 test USDC, performs three mock 40/30/30 buys, issues 1,000,000 C3 shares, performs three mock sales, burns shares, and returns 990,000 test-USDC base units after the explicit 10,000-unit mock slippage. These are local-validator fixtures, not real Jupiter swaps or market prices.
- A separate, explicitly applied `c3_open` PostgreSQL migration journals one pilot intent, six legs, database and plan revisions, route/instruction/authorization hashes, signatures, effects, immutable events, and an outbox. Disposable PostgreSQL tests demonstrate one worker winning a race, stale-revision rejection, expired unsigned lease recovery, at-most-once submission markers, signature survival across process restart, six locally attested stages, and an uncertain submission entering manual review without losing its signature.
- The read-only Jupiter V2 measurement module compiles unsigned v0 messages and rejects a synthetic 60-account route that exceeds the 1,232-byte packet budget. The bounded 64→48→32 sequence exists for fresh, unsigned measurements only. This is not a transaction authorization validator.
- The separate Expo package `apps/c3-pilot` has Android identity `com.dominaweb3.cmarket.c3pilot`, four translated languages, English default, exact 1-USDC target copy, and a permanently closed trade gate. It displays no invented share balance, NAV, holdings, signatures, or success state. Its wallet entry point explains why authorization is unavailable. Its release export and APK are isolated from the stable app.

## Unclosed security and functional gates

1. **Vault execution boundary:** Jupiter's V2 swap build requires a signing `taker`. Assets held by the C3 vault PDA cannot be spent by an externally signed keeper transaction. The current Anchor production build excludes `local-mock` plan creation/execution and lacks a reviewed, atomic CPI or equivalent vault-authorized swap path. Therefore real BTC/ETH/SOL settlement, share issuance against real reserves, and USDC redemption are not functional. Do not substitute a keeper-controlled token account or self-declared route evidence.
2. **Reconciliation:** The new PostgreSQL test uses explicit `MOCK_LOCAL_ONLY` attestations. It is not connected to the local-validator test process, and it does not independently reconstruct two-provider finalized RPC token/SOL effects, ALT contents, inner CPI, and vault authority. The existing service read-only RPC collector remains manual-review-only. No API may promote a leg using a submitted signature alone.
3. **Mobile:** No reconciled backend API or MWA signer is wired. Buy/Sell have no handlers and remain disabled even if all public pilot variables are present. No live position, activity, fees, or market NAV can be displayed. No cold-launch test was possible because no emulator or device was attached; do not install this APK on Seeker yet.
4. **Signing:** Gradle built an APK with APK Signature Scheme v2, but its certificate is `Android Debug`. It is a local QA artifact, not a release/distribution signer. A separately reviewed pilot signing identity and secure backup are required before distribution.
5. **Dependencies:** The isolated app's `npm audit --omit=dev` reports moderate `uuid` findings through Expo → config plugins → xcode build-tooling dependencies. No `@solana/spl-token`, `@solana/buffer-layout-utils`, or `bigint-buffer` appears in the isolated app production dependency graph; the finding is not suppressed and needs a compatible upstream/remediation review. The existing service production audit reports zero vulnerabilities.

## Fail-closed configuration

The isolated app accepts only version `local-pilot/v1` and cluster `local-validator`. Required public variable names: `EXPO_PUBLIC_C3_PILOT_CONFIG_VERSION`, `EXPO_PUBLIC_C3_PILOT_CLUSTER`, `EXPO_PUBLIC_C3_PILOT_PROGRAM_ID`, `EXPO_PUBLIC_C3_PILOT_VAULT`, `EXPO_PUBLIC_C3_PILOT_SHARE_MINT`, `EXPO_PUBLIC_C3_PILOT_USDC_MINT`, `EXPO_PUBLIC_C3_PILOT_BACKEND_URL`, `EXPO_PUBLIC_C3_PILOT_OWNER_ALLOWLIST`, `EXPO_PUBLIC_C3_PILOT_CONFIG_HASH`. Missing/malformed values disable data configuration; the source-controlled execution constants remain `false` regardless. No values, credentials, keypairs, or signing material are committed.

## Next implementation gate

Design and independently review a vault-authorized swap mechanism that never grants the keeper unrestricted custody; specify account metas, CPI permissions, vault PDA seeds, destination restrictions, exact debits/minima, WSOL lifecycle, ALT handling and recovery. Then wire signed-before-submit durable orchestration to raw on-chain reconciliation and exercise the **same** process across PostgreSQL plus local validator restarts. Only after that, expose a read-only reconciled API and prepare MWA actions for a separate supervised release. Mainnet remains disabled throughout.
