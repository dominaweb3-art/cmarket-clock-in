# Technical request: Symmetry V3 integration for C Market C3

Status: the project owner reports this request was **sent 2026-09-23 to the official Symmetry operations contact**; response pending. No acknowledgment or approval has been independently verified. Prepared 2026-09-22; updated with read-only evidence 2026-09-23. Mainnet execution remains disabled. Evidence and current NO-GO: [C3 Symmetry V3 evidence](C3_SYMMETRY_V3_EVIDENCE.md) and [public transaction decoder](C3_SYMMETRY_V3_TRANSACTION_EVIDENCE.md).

## Copy-paste message

Hello Symmetry team. C Market is evaluating a non-custodial, pooled C3 vault on Solana with target weights 40% BTC, 30% ETH and 30% SOL. Users would authorize a USDC deposit through Mobile Wallet Adapter, receive proportional vault shares, and later redeem shares. The product requires the final redemption asset to be **USDC only**, with no C Market custodial wallet. The controlled Mainnet pilot would start at 1 USDC with strict limits and Squads 2-of-3 governance. Could you provide the official V3 source/IDL, audited transaction examples and the exact supported USDC-only redemption path described below? We will not enable deposits or promise USDC redemption until that path and its security properties are verified. Thank you.

## Architecture and required evidence

C Market needs the underlying BTC/ETH/SOL representations to remain in the vault, while a user's position is represented by proportional shares. MWA authorizes the user's own wallet; it does not hold keys. Please identify the official BTC and ETH Solana mints and token-program variants supported for this use case, including any constraints on a 1 USDC minimum. Confirm whether the chosen basket weights are enforced on each deposit, after a keeper cycle, or only as rebalance targets, and how deviations and dust are reported.

Please answer each item with a versioned URL, source file/commit, IDL entry, account derivation, or finalized public transaction where applicable:

1. Official V3 program IDs on Mainnet and Devnet, with upgrade authorities.
2. Official source repository and exact source commit corresponding to `@symmetry-hq/sdk@1.0.22`.
3. Reproducible package provenance, integrity and build procedure for that artifact.
4. Complete official V3 IDL, version and provenance.
5. All relevant account layouts, discriminators and version migration rules.
6. PDA seeds, bump rules and owners for vault, shares, intent and keeper accounts.
7. Exact vault creation instructions and required governance authorities.
8. Exact USDC deposit instructions and account constraints.
9. Exact withdrawal/redemption instructions and account constraints.
10. Share mint, custody, transfer and burn semantics, including rounding and minimum deposit.
11. Intent lifecycle, expiry, cancellation, restart and partial-failure states.
12. Keeper duties, permissions, liveness assumptions and who pays transaction fees.
13. Rebalance steps, atomicity boundaries and possible temporary custody.
14. Bounty computation, payer, caps and failure recovery.
15. Oracle sources, freshness/confidence limits and manipulation defenses.
16. Supported asset mints and SPL Token versus Token-2022 behavior.
17. Every permitted outer and inner CPI program, including Jupiter/DEX routes.
18. Complete writable and signer account lists per instruction and their authority checks.
19. Versioned error codes and their interpretation for users and operators.
20. Events/logs for share issue/burn, asset movement, NAV and settlement.
21. A finalized public deposit transaction for a comparable multi-asset vault.
22. A finalized public withdrawal transaction, including all keeper transactions.
23. Independent security audits, scope, findings and remediation commits.
24. Upgrade authority, governance/timelock configuration and emergency powers.
25. Can a withdrawal settle **directly and exclusively in USDC**, to the user's own token account? Specify the exact supported instruction sequence and constraints.
26. If not, what is the officially recommended, verifiable route from redeemed underlying assets to USDC, and which wallet signs each step?
27. Can liquidation occur within a vault-authorized intent before user receipt, and what limits bound price, slippage and destination?
28. Must the user temporarily receive any BTC/ETH/SOL representation or approve additional swaps?
29. How are partially settled withdrawals or failed liquidations represented and reconciled without automatic duplicate execution?
30. Are custom vault withdrawal adapters supported? If yes, provide the audited interface, registry/allowlist rules, examples and governance process.

## Follow-up on public Mainnet evidence (2026-09-23 UTC)

Our independent `finalized` RPC checks found the documented V3 program executable at `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`, deployment slot `443194628`, programdata `5U2UnJKWK8woHwzud2soiJoD7nXxitNRLXBCAojeaETc`, and global config `BV49JWNeVnRjvMg4BHVoRFXNXHMFqgZFsfHg2QUekynd`. Programdata has an **active upgrade authority** `9A5V7smsUMRNNzvrawbDx3ZexZR3LY1bcEUXUiMJ2bxk`; please identify its controller, governance/timelock and incident/upgrade procedure. The npm registry gives `@symmetry-hq/sdk@1.0.22` a `gitHead` of `7f83eed9866c1833149fbfdcaa93bd5ba9eed0da` but no mapped public source repository or audited build. Please provide the exact source URL, commit and build provenance, and the audit report that matches the running program.

Public examples show a [20 USDC deposit](https://explorer.solana.com/tx/mHStwKXJJmzPVnxFnSJb1PeR7sCTGdqcsa3hCbRcvcnbRjYNKJuNbVccuLZkMbuRPxbBJpHQbgGWGK5vUQ2KN7x), [share mint](https://explorer.solana.com/tx/4pNx6EWqdAdz5r68XqVF2xZsHbRThW8KNdog3Mr2qXDuB15uA48i9oVaDs31nEiQG1U7U223uURdfYQXJeFFcKfE), [share burn](https://explorer.solana.com/tx/5Kn15SfEwkiDoBpBcT7bZ3dCZ8Jr2tkpmS5NLWEyGqdgyBYwFeN1N853id37JXsbDm7Y83pEsfnZzdYBd2w8UQAW) and [20 USDC redemption](https://explorer.solana.com/tx/FXcx1hLT7fc2wHMvF2GMZQ2V7XdqU3BgDQY54nooCF2ovW5RndwV3eXAgPC5wRWTvGo2EM2axzEPr3pMtuUF1kj) for a vault whose composition we cannot independently decode without the full official layout. Can you supply the vault's decoded composition and a comparable finalized sequence for a **cbBTC 40% / Portal ETH 30% / SOL or WSOL 30%** vault redeemed **exclusively to USDC**, including every keeper auction and output account? What setting controls the single output when `keep_tokens: []`, and can it be pinned to USDC? Can you prove no underlying token is skipped if the withdrawer lacks an ATA, especially when a keeper presents `redeemTokensTx`? Please provide exact share mint/burn/fee/bounty numbers, min-out/slippage, expiry/cancellation, partial-failure recovery and behavior at a 1 USDC deposit/redeem. Are the three asset oracles and auction routes actually available at this size? Which supported SDK integration avoids introducing a vulnerable `@solana/spl-token → @solana/buffer-layout-utils → bigint-buffer` path into our production graph?

Please also confirm fee support and authorization for the **Product-approved candidate only**: 15 bps buy, 15 bps sell and a proposed 50% discount for independently verified SKR staking (effective 7.5 bps). Fee collection and discount are **disabled** pending Security review and Squads approval. Prior 60 bps deposit and 10 bps withdrawal figures are obsolete proposals, not active values.

## Product decision gate

The [official overview](https://docs.symmetry.fi/) describes vault shares and withdrawal of underlying assets. The [official rebalance documentation](https://docs.symmetry.fi/concepts/rebalancing) describes a standard withdrawal auction and `redeemTokensTx` transferring underlying tokens; `keep_tokens: []` is described as swapping toward a single output, but it does **not** establish that output as USDC for C3, nor prove an exclusive USDC settlement path. Therefore `USDC_REDEMPTION_GATE = UNSUPPORTED_OR_UNVERIFIED` until Symmetry supplies reproducible official evidence. C Market will not fabricate an adapter or advertise guaranteed USDC redemption from incomplete information. No Symmetry adapter is implemented in this phase.
