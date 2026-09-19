# C3 Devnet deployment runbook

This runbook is ordered and fail-closed. It does not authorize deployment; Phase 1B remains NO-GO.

## A. Pre-deployment evidence

1. Freeze the reviewed commit and confirm the worktree is clean.
2. Run `npm run c3:devnet:deployment-readiness` in `apps/mobile`. Stop unless it exits zero with no placeholders.
3. Re-read the Symmetry program, global config, rent payer, allowed operations, protocol fees, lifetimes, and bounty mint at finalized commitment.
4. Record concrete C3 TEST BTC and TEST ETH mints; verify owner, decimals, supply, authorities, labels, and production rejection rules.
5. Resolve Circle Devnet USDC versus Symmetry SDK Devnet USDC. Prove the selected input mint is accepted by vault instructions and every swap route.
6. Verify Pyth account ownership and obtain fresh signed BTC, ETH, and SOL updates through an approved official transport.
7. Obtain current Jupiter Devnet quotes for 40/30/30 legs at 5, 10, 50, and 500 USDC. Validate mints, amounts, expiry, slippage, accounts, ALTs, programs, fees, and destinations.
8. Produce executable program tests for share mint/burn math, fee ordering, rounding, dust, direct redemption, and USDC-only redemption.
9. Record reviewed Squads public addresses for creator/configuration, emergency, fee destination, and operational keeper. No key material belongs in source or the APK.
10. Publish immutable HTTPS metadata labelled Devnet simulation and record its hash.

## B. Governance setup

1. Create separate reviewed 2-of-3 Squads roles for configuration and emergency pause.
2. Apply a delay to configuration changes; emergency may pause but may not redirect assets or change basket weights.
3. Fund only the minimum Devnet rent and keeper bounty budget.
4. Confirm the candidate C Market fees and SKR discount remain disabled. Set immutable Symmetry host deposit/withdrawal fees to zero.
5. Record every governance proposal and resulting signature in the deployment evidence bundle.

## C. Vault creation

1. Re-run the gate immediately before creation.
2. Build the unsigned Symmetry creation plan in isolated, pinned tooling outside `apps/mobile`.
3. Inspect vault id, 40/30/30 weights, mints, decimals, oracle types/accounts, host fees, creator/configuration authority, metadata, programs, PDAs, ALTs, rent, and all signers.
4. Require Squads approval and simulate against Devnet with signature verification disabled only for inspection.
5. Submit exactly once through the approved governance workflow; never retry an uncertain result.
6. Reconcile the finalized transaction and independently derive/verify the vault PDA, share mint PDA, metadata, ALTs, token accounts, mint authority, freeze authority, weights, and fees.

## D. Limited functional qualification

1. Keep mobile buy/sell disabled.
2. Use a capped fixture wallet and the minimum 5 USDC only after Security authorizes a supervised test.
3. Verify deposit intent, lock, price update, auction/swap, share mint, bounty, closure, and on-chain position evidence separately.
4. Verify interruption, duplicate intent, stale oracle, bad quote, keeper outage, partial execution, restart, and reconciliation paths.
5. Verify transfer of the share token changes the indexed owner.
6. Supervise one minimum withdrawal and verify burn, pricing, auctions, USDC return, dust, fees, and final balances.
7. Do not call the system functional until both directions reconcile from finalized chain state.

## E. Release gate

1. Re-run all tests, Android export, bundle isolation, dependency, secret, and signed APK checks.
2. Confirm TEST mints and all Mainnet capability are rejected by production builds.
3. Confirm the UI says simulation and exposes asynchronous keeper states.
4. Security and Squads must separately record approval. Product approval alone cannot enable fees or deployment.
5. Archive public configuration, hashes, transactions, balances, NAV vectors, threat-model results, and incident contacts without secrets.

At any failure, stop; preserve submitted signatures and evidence; do not retry, reverse, or reinterpret a partial result as success.
