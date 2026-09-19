# C3 Devnet deployment checklist

The automated source of truth is `npm run c3:devnet:deployment-readiness` from `apps/mobile`. Every mandatory line must pass. Nulls, placeholders, documentation-only claims, or Mainnet evidence cannot satisfy a check.

## Configuration and governance

- [ ] Versioned schema parses and allocation is exactly 40/30/30.
- [ ] Cluster is exactly Devnet and Mainnet capability is immutable false.
- [ ] Product fee candidate is 15/15/7.5 bps; collection and SKR discount are disabled.
- [ ] Historical 60/10 bps proposals remain marked obsolete.
- [ ] Creator/configuration, emergency, keeper and fee-destination addresses are concrete and reviewed.
- [ ] Immutable HTTPS metadata is reviewed and labels BTC/ETH assets as simulations.

## Programs, accounts, and assets

- [ ] Official Devnet RPC is healthy at finalized commitment.
- [ ] Symmetry program is executable and owned by the upgradeable loader.
- [ ] Global config PDA is program-owned and observed limits are accepted.
- [ ] Input USDC/Symmetry protocol-USDC mismatch is resolved with instruction-level evidence.
- [ ] C3 TEST BTC and TEST ETH mints exist with reviewed decimals, supply and Squads authority.
- [ ] Production builds reject TEST mints.
- [ ] WSOL mint, owner and decimals are verified.
- [ ] Current Jupiter routes exist for all three legs and required sizes.

## Prices and accounting

- [ ] Pyth account IDs and owners are verified independently from token mints.
- [ ] Official signed-price transport works without a secret in the APK.
- [ ] Freshness, confidence and price-deviation circuit breakers pass.
- [ ] Share mint/burn, protocol-fee ordering, rounding and dust have executable vectors.
- [ ] Direct and USDC-only withdrawal semantics are verified end to end.
- [ ] NAV reconciles token balances, prices, supply, fees and active intents.

## Operations and release boundary

- [ ] Isolated builder/keeper dependencies and generated instructions pass security review.
- [ ] Symmetry SDK and vulnerable SPL dependency paths are absent from the Android graph and bundle.
- [ ] Duplicate, partial, expired, stale, interrupted, restart and keeper-outage paths pass.
- [ ] Security approval and Squads governance approval are recorded.
- [ ] A supervised minimum deposit and withdrawal reconcile from finalized state.

## Decision

Current decision: **NO-GO**.

The concrete missing prerequisite is one complete, governed and executable Devnet input set: two clearly labelled TEST exposure mints, reviewed authorities and metadata, fresh official oracle-update transport, verified Jupiter liquidity from the selected USDC mint, and executable share-accounting/withdrawal vectors. Until that set exists, no vault deployment is permitted.
