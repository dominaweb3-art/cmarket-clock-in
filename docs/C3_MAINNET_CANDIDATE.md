# C3 Core Mainnet read-only candidate

Phase 9A creates an isolated candidate for visualizing current Mainnet quotes. It is not the CLOCK IN release and it is not an executable Mainnet wallet flow.

## Provenance and identity

- Source: `shared/dual-hackathon-base` at `1f72f6b1461fd13520819d1a78af86298aaf4727`.
- Candidate branch: `candidate/c3-mainnet-ux`.
- Candidate worktree: `/Users/juantorres/Projects/cmarket-mainnet-candidate`.
- Stable CLOCK IN checkpoint: annotated tag `clockin-submission-ready-v0.1.1` points to `d7bbc76792a51b2962088bcfa189e84d39ec0dad`. The stable branch and APK were not modified.
- Android identity: `C Market Candidate`, package `com.dominaweb3.cmarket.candidate`, scheme `cmarket-candidate`.

## Read-only behavior

The candidate has an isolated Expo Router tree containing only the quote screen and a not-found fallback. It does not initialize `MobileWalletProvider`, import `useMobileWallet`, request authorization, create a transaction, call `signAndSendTransactions`, call `sendRawTransaction`, or submit a transaction. The execution button only displays `Execution is disabled in this candidate build.`

The quote screen uses Jupiter's public `https://api.jup.ag/swap/v2/quote` endpoint sequentially, without an API-key header. Requests are paced at one every 2.5 seconds and retry only HTTP 429 responses with a bounded delay. The screen displays 50, 100, and 500 USDC selectors and the fixed 40% cbBTC, 30% Portal ETH, 30% native SOL target. The quote response's `contextSlot` is shown; no quote is presented as purchased or owned.

Public asset references:

- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- cbBTC: `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij`.
- Portal ETH: `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs`.
- WSOL quote mint / native SOL final asset: `So11111111111111111111111111111111111111112`.

## Read-only validation observed

The 50, 100, and 500 USDC quote sets returned verified input/output mint, exact input amount, ExactIn mode, 100 bps slippage, route, and non-negative output thresholds for all nine quote legs. Jupiter quote responses exposed route labels but not route program IDs; program validation therefore remains a build-stage requirement and is not claimed as complete by the screen.

The existing hardened build harness was run against Jupiter Swap API v2 and Mainnet RPC without wallet credentials:

- 50 USDC: cbBTC 490 bytes, Portal ETH 526 bytes, SOL 1065 bytes; all under 1232 bytes. Combined measurement: 1355 bytes, rejected before simulation.
- 100 USDC: cbBTC 490 bytes and Portal ETH 526 bytes; SOL build stopped with `encoding overruns Uint8Array` before transaction serialization completed.
- 500 USDC: cbBTC 526 bytes, Portal ETH 526 bytes, SOL 1081 bytes; all under 1232 bytes. Combined measurement: 1403 bytes, rejected before simulation.
- The available public test address has no suitable Mainnet balance/token accounts, so read-only simulations that ran were classified as environmental failures. No simulation is represented as an execution success.
- No independent Mainnet RPC provider pair is configured in ignored local settings. The candidate is read-only and does not require RPC quorum; any future execution remains blocked until provider/operator independence is configured and reviewed.

Generated quote and build results remain under ignored `apps/mobile/dist/generated-results/`.

## Safety boundary

This candidate must not be used to claim that a C3 basket was purchased, that cbBTC or Portal ETH is owned, or that execution is ready. It is a reviewable quote preview only. The stable CLOCK IN submission remains on Solana Devnet with its previously verified USDC payment flow. Any future Mainnet execution requires a separate reviewed release, fresh route/build validation, wallet approval sequencing, and explicit security sign-off.
