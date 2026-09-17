# C Market Mobile Application

This directory contains the initial Expo/React Native mobile foundation for C Market.

## Implemented in this foundation

- Android-first C Market interface.
- C3 and C10 basket discovery cards.
- Devnet labeling and prototype disclosures.
- Mobile Wallet Adapter provider.
- Wallet connect and disconnect controls.
- Devnet USDC balance lookup.
- C3 Devnet USDC purchase flow.
- Transaction confirmation and Explorer links.
- In-memory activity history for the current session.

## Install and run

Use a custom Expo development build. Mobile Wallet Adapter uses native Android modules and is not expected to work in Expo Go.

```bash
cd apps/mobile
npm install
npm run android
```

For an existing development-client workflow:

```bash
npm run start
```

Set the public Devnet values in a local `.env` file based on the root `.env.example`:

```text
EXPO_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
EXPO_PUBLIC_DEVNET_USDC_MINT=your_devnet_usdc_mint
EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY=your_devnet_treasury_public_key
```

Only use a dedicated Devnet wallet and test assets during development.

## Important implementation boundary

The current purchase implementation demonstrates wallet approval, Devnet USDC routing, confirmation, and public transaction evidence.

It does not yet implement production-grade basket settlement or constituent distribution. The UI intentionally describes this boundary instead of claiming that allocation has already happened.

## Reconciliation with the local prototype

The earlier local project at `/Users/juantorres/Projects/c10-pocket` contains the Seeker-tested implementation. Before final submission:

1. Compare the local implementation with this foundation.
2. Preserve the tested wallet configuration and error handling.
3. Merge the strongest code into this repository.
4. Run a clean install and build.
5. Update the root documentation with the exact release commands.

Do not commit local environment files, signing keys, seed phrases, or private keys.
