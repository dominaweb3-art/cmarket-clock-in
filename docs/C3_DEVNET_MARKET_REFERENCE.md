# Devnet market-reference update — 11 October 2026

Classification: CLOCKIN_ONLY. This is a display-only implementation, not a
change to custody, deposit, allocation execution, issuance, burn or claim.

The server reads the verified Devnet deposit/redemption account timestamps.
The illustrative base is the test-USDC deposit expressed as hypothetical USD,
not an assertion of test-token parity or redeemable value. Fixed representative
quantities follow BTC 40%, ETH 30%, SOL 30% from the last completed one-minute
USD candle before the deposit. No automatic rebalancing is modeled.

`V = deposit × sum(weight × current USD price / entry USD price)`.
Arithmetic uses scaled checked positive decimals and bigint; each leg floors
to millionths of an illustrative dollar. Display-only inputs support 1–200
units; **that is not an on-chain deposit limit change**. The deployed program
still enforces exactly 1 test USDC and one lifetime position per wallet/vault.
Repeat vaults and variable deposits remain unimplemented.

For an active position, last-trade observations must be at most 120 seconds
old, with at most 5 seconds clock tolerance. The app reads position every
60 seconds while authenticated and foregrounded, never during a wallet
operation. Stale/incomplete prices render unavailable; they do not stop
claim or recovery. A late response cannot replace a newer position snapshot.
After redemption is requested, the reference freezes using historical prices
before that request. Burned shares remain zero, not a fictitious live position.
Historical values are reconstructed from the provider's closed candles, not
claimed as exact execution prices or immutable oracle attestations.

Source: public Coinbase Exchange USD pairs; single-provider informational
market data, not an on-chain oracle or independent monetary NAV.

- https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker
- https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles

Read-only reproduction:
`node --experimental-strip-types scripts/evaluation-market-reference-probe.ts PUBLIC_WALLET`
from `services/c3-mainnet`. No wallet authorization, signing or submission.

Observed finalized slot 509990267: historical deposit 1 test USDC, current
shares 0, actual test USDC returned 0.99; the frozen illustrative reference
was USD 0.999971. This is not an active position or redemption entitlement.

Validation: 16 focused service tests, 23 focused mobile tests, both TypeScript
checks, changed-file lint/format and server isolation build passed. Existing
wallet/transaction/provision/recovery controller AST hashes remain unchanged.
Expo Doctor: 18/19, existing pinned Expo 57.0.26 vs expected ~57.0.27 warning;
no dependency changes. No new end-to-end wallet purchase/sale was performed.

APK: 0.1.25, version code 26, package com.dominaweb3.cmarket.c3evaluation.
SHA-256: 3b61304623e4de978538b37e762b663f8e70b6d00e336cd3ef2b401f4dbf9e89.
Certificate SHA-256: 58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016.
Mainnet, protected worktrees, on-chain programs, IDL, database schema and
previous APKs were not changed. APK and signing material are excluded from Git.

Physical checks this execution: ADB detected the Seeker, installed certificate
matched the candidate, update used `install -r` without uninstall/data clearing.
APK 0.1.25/code 26 cold-launched with no Metro listener or ADB reverse tunnel;
Home, Indices and Activity navigation rendered the Devnet notice. No wallet
authorization or economic transaction was performed. Authenticated visual
market-reference QA requires the owner to reconnect and verify wallet ownership;
it is not credited by the read-only RPC/API probe.
