# C Market Pitch Outline

![C Market — Onchain indexes for a brighter tomorrow](../assets/brand/cmarket-wordmark.png)

## Slide 1 — The one-line idea

**C Market makes on-chain basket discovery and purchase understandable on a Solana Mobile device.**

## Slide 2 — The user problem

Crypto users who want diversified exposure often face:

- Too many separate assets and protocols.
- Poor mobile transaction context.
- Unclear destinations and fees.
- No simple way to understand the basket methodology.

## Slide 3 — The product

C Market provides:

- Basket discovery.
- Composition and methodology visibility.
- A focused purchase flow.
- Mobile wallet approval.
- On-chain confirmation and Explorer verification.
- Read-only activity receipts for confirmed Devnet payments.

## Slide 4 — Why Solana Mobile

- Mobile Wallet Adapter makes approval native to the wallet.
- Seeker users get a focused Web3 device experience.
- Fast transaction confirmation supports a simple interaction loop.
- The product is designed for a phone first, not a desktop site wrapped in a mobile shell.

## Slide 5 — Live demo

Show:

1. Open C Market.
2. Select C3.
3. Connect Phantom.
4. Review the amount and network.
5. Approve in the wallet.
6. Confirm the transaction.
7. Open Solana Explorer.

## Slide 6 — Technical architecture

Show the path:

```text
React Native mobile UI
  -> Mobile Wallet Adapter
  -> Mobile wallet approval
  -> Solana Devnet
  -> Confirmation and public verification
```

## Slide 7 — Trust and safety

- No seed phrases or private keys are handled by the app.
- Devnet is used for the prototype.
- Transaction state is shown honestly.
- The product does not promise profits or returns.
- Basket settlement claims will only be enabled after implementation and testing.

## Slide 8 — What comes next

- Versioned basket methodology.
- Transparent constituent and weight updates.
- Expanded activity analytics and history reconciliation.
- Robust settlement implementation.
- Signed release APK.
- Security and failure-mode testing.
