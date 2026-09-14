# C Market Demo Runbook

This runbook is for the CLOCK IN judging demo.

## Demo objective

Demonstrate a complete, verifiable mobile wallet flow on Solana Devnet:

- Connect a wallet.
- Review a C3 purchase.
- Approve the transaction in the mobile wallet.
- Show the confirmed signature.
- Open the transaction in Solana Explorer.
- Explain the current prototype boundary accurately.

## Pre-demo checklist

- [ ] Seeker is charged and connected to the development environment or has the signed release APK installed.
- [ ] The Seeker has a compatible mobile wallet installed.
- [ ] The wallet is switched to Solana Devnet.
- [ ] The dedicated test wallet has at least 5 Devnet USDC.
- [ ] The dedicated test wallet has enough Devnet SOL for fees.
- [ ] The app shows Devnet clearly.
- [ ] The app is connected to the intended Devnet treasury.
- [ ] No seed phrase, private key, or wallet export is visible on screen.
- [ ] Screen recording is ready.
- [ ] A backup transaction link is available for troubleshooting.

## Live demo script

### 1. Explain the problem

“Managing a basket of on-chain assets should not require users to navigate several protocols or guess what a transaction does. C Market is a mobile-first basket experience for Solana users.”

### 2. Show the basket

Open C Market and show:

- The C3 basket.
- Its constituent information.
- The amount input.
- The minimum purchase.
- The network label.
- The purchase summary.

### 3. Connect the wallet

Connect the mobile wallet through Mobile Wallet Adapter. Do not ask the user to share or paste any secret material.

### 4. Review before signing

Pause on the confirmation screen and show:

- Amount.
- Payment token.
- Network.
- Destination or settlement description.
- Estimated fee.
- The exact action that will be sent to the wallet.

### 5. Approve

Approve the transaction inside the wallet. Return to C Market.

### 6. Verify

Show:

- Confirmation state.
- Transaction signature.
- Amount.
- Network.
- Explorer button or link.
- The transaction on Solana Explorer.

Reference prototype transaction:

https://explorer.solana.com/tx/4GNY8qQT6gPVKx1JHZUekfxyxjXHnWskeaBUy2RoRgvUvuH5jaNdnxcCKtHWqbHh4EkKLvmyZSu2Ssni44iPWTGk?cluster=devnet

### 7. State the boundary

Use precise wording:

“The current Devnet prototype verifies the wallet approval, payment routing, confirmation, and public transaction evidence. The production-grade basket allocation and settlement module is the next release gate.”

Do not say that a basket allocation has occurred unless the transaction and code prove it.

## Failure recovery

### Wallet does not open

- Confirm the wallet is installed and unlocked.
- Confirm the app uses the expected Devnet cluster.
- Reconnect the wallet.
- Retry once.

### Signature is rejected

- Confirm the user is approving the intended transaction.
- Check the wallet network.
- Check the Devnet SOL balance.
- Do not repeatedly tap the purchase button.
- Inspect the app error state.

### Transaction is not confirmed

- Preserve the signature if one exists.
- Open the signature in Explorer.
- Check the selected cluster.
- Explain that the app is waiting for confirmation.

### Demo environment fails

Use the reference transaction only as evidence of the previously verified prototype flow. Do not present it as a new transaction.
