# C3 real-network one-dollar pilot

Status: **NO-GO for wallet execution**. Product direction: Mainnet. Classification: **SHARED**.

## Decision

Devnet cannot truthfully reproduce C3 because it lacks the real liquidity and production assets required for cbBTC, Portal ETH, and SOL. The implementation target is therefore a separately reviewed Mainnet Symmetry V3 vault using real Mainnet USDC with fixed 40/30/30 weights.

The current Devnet APK and its verified payment remain preserved. The existing disabled non-custodial three-swap Mainnet engine is not the C3 vault: it returns three assets directly to the user and must not be enabled as a substitute. C3 uses Symmetry custody and issues the user a proportional six-decimal vault participation token.

## One-dollar evidence observed on 2026-09-20

Read-only Jupiter exact-input quotes and unsigned builds succeeded for a 1 USDC allocation:

- 0.40 USDC to cbBTC: 492 base units expected, 488 minimum at 100 bps slippage; HumidiFi route.
- 0.30 USDC to Portal ETH: approximately 11,388 base units expected and 11,275 minimum; Whirlpool route.
- 0.30 USDC to native SOL through WSOL: approximately 2,716,401 lamports expected and 2,689,237 minimum; HumidiFi route with cleanup/unwrap.

These results prove current route/build availability only. They do not prove a Symmetry deposit, vault settlement, share issuance, withdrawal, or profitability.

The returned one-dollar builds have not yet passed the repository's full instruction-level security approval. Until that separate review validates signers, fee payer, token accounts, route programs, address lookup tables, debits, outputs, WSOL lifecycle, transaction size, and expiry, the readiness gate fails closed before wallet use.

The inspected Symmetry Mainnet global configuration permits creation, deposits, and withdrawals and currently reports zero protocol deposit, withdrawal, and trade fees. For a three-token deposit, the SDK's documented bounty calculation produces approximately 2,224,999 lamports. At the observed SOL rate implied by the quote, that is approximately 0.246 USDC, before network priority fees or any account/rent cost not paid by the protocol rent-payer. It is about 24.6% of a 1 USDC pilot, 4.9% of 5 USDC, and 2.5% of 10 USDC.

Therefore:

- 1 USDC is technically useful only as a supervised real-network acceptance test with explicit cost disclosure.
- The public launch minimum is not yet approved. It must be selected after measuring a complete settled deposit and withdrawal.
- C Market fee collection remains disabled during the pilot. The Product-approved 15/15/7.5 bps candidate is not Security- or Squads-approved.

## Required architecture

1. The user connects through MWA and approves a Mainnet USDC deposit intent explicitly.
2. Symmetry V3 holds USDC and the resulting cbBTC, Portal ETH, and WSOL in its on-chain vault.
3. An isolated keeper obtains authenticated Pyth updates and approved Jupiter routes, then advances only the user's bounded intent.
4. Symmetry issues C3 vault shares to the user. C Market indexes finalized vault/share state and displays NAV, allocation, costs, and intent status.
5. A sale burns/escrows C3 shares, liquidates the proportional position, and returns USDC after finalized reconciliation.
6. Squads separately controls configuration and emergency pause. C Market never stores user keys.

## Mandatory blockers before a real test

- Create and approve separate Squads configuration and emergency authorities.
- Obtain a Pyth API key for the isolated keeper. Since 2026-08-26, Hermes requires authenticated requests; the key must never enter the APK or repository.
- Create and independently inspect the Mainnet Symmetry vault plan, real asset/oracle configuration, share mint, fee-zero settings, metadata, keeper limits, and withdrawal path.
- Re-audit the isolated builder/keeper dependency graph and every generated instruction. The Symmetry SDK remains excluded from the Android bundle.
- Record an independent instruction-level approval for the one-dollar unsigned Jupiter builds; route availability by itself is insufficient.
- Build a separate Mainnet-capable APK from an explicit reviewed source change; never enable it through environment, storage, deep links, or the existing Devnet release.
- Fund only a dedicated pilot wallet with exactly the capped test USDC plus sufficient SOL for disclosed bounty and network costs.
- Run one supervised 1 USDC deposit and one supervised withdrawal, each approved once, then reconcile finalized on-chain effects before changing the public minimum.

## Readiness command

From `apps/mobile`, run:

`npm run c3:mainnet:dollar-pilot-readiness`

It is read-only and exits nonzero while Mainnet capability is disabled, Pyth authentication is unavailable, or vault/governance approvals are unset. It never authorizes a wallet, creates a transaction, signs, submits, deploys, or moves funds.

Primary sources:

- <https://docs.symmetry.fi/concepts/vaults>
- <https://docs.symmetry.fi/concepts/intents>
- <https://docs.symmetry.fi/concepts/fees-and-oracles>
- <https://docs.symmetry.fi/sdk/reference>
- <https://docs.pyth.network/price-feeds/core/upgrade/preparing>
- <https://dev.jup.ag>
