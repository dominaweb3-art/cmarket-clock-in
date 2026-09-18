# C Market — CLOCK IN submission package

C Market is an English-first Android application for Seeker. It gives a user a
mobile view of the C3 Core target methodology and a truthful Devnet payment
prototype using Mobile Wallet Adapter (MWA).

Official event reference: [CLOCK IN: The Solana Mobile Hackathon](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon).
The official announcement gives an October 8, 2026 deadline and requests a
functional Android APK, GitHub repository, demo video, and pitch deck. The
submission portal will be completed separately; this package does not upload
anything.

## What is verified

- Android package: `com.dominaweb3.cmarket`
- Release: `C Market` 0.1.1, version code 2
- Seeker-tested signed APK, installed and cold-launched without Metro
- Phantom/MWA wallet connection on Solana Devnet
- USDC balance display and a 5 USDC minimum purchase guard
- One supervised 5 USDC Devnet payment confirmed by the app and Explorer
- C3 Core target methodology: Bitcoin 40%, Ethereum 30%, Solana 30%
- Activity screen for confirmed Devnet receipts saved locally on the device
- English, Español, 简体中文, and Português (Brasil)

The verified payment signature is:

`4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HRVHud2NayLQyAJaobU8yz3wCp1bwJcja9UMjcf3Dd`

[View the verified Devnet transaction](https://explorer.solana.com/tx/4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HRVHud2NayLQyAJaobU8yz3wCp1bwJcja9UMjcf3Dd?cluster=devnet)

## Truthful product boundary

The current release records a USDC payment to the C3 treasury on Solana
Devnet. It does not acquire, hold, or distribute BTC, ETH, or SOL basket
assets; it does not perform C3 settlement; and it does not make Mainnet
transactions. The 40/30/30 percentages describe the planned C3 methodology,
not the user's current holdings or a guaranteed return.

The Mainnet engine is disabled and excluded from the Devnet release. A future
Mainnet release would require a separate reviewed security gate and explicit
release decision.

## APK and evidence

The release artifact is intentionally kept outside Git-generated build output:

- APK: `/Users/juantorres/Projects/cmarket-integration/artifacts/releases/c-market-0.1.1-release.apk`
- SHA-256: `09ef92848c97c7968ab6eb71d41fc1b458e54584d52746f6b457acae0c18146a`
- Committed digest record: `submission/releases/c-market-0.1.1-release.sha256`

Screenshots are in `submission/assets/screenshots/`. They are clean Seeker
evidence and use only a shortened public wallet address; no private keys,
seed phrases, credentials, or environment values are included.

## Install on a Seeker

```text
adb install -r c-market-0.1.1-release.apk
```

The package can be reviewed with Metro stopped. Connect Phantom through MWA,
confirm that the wallet is on Devnet, and use the demo script for the one
supervised payment action. Do not describe the payment as basket settlement.

Source repository: [github.com/dominaweb3-art/cmarket-clock-in](https://github.com/dominaweb3-art/cmarket-clock-in)

## Package contents

- `SUBMISSION_COPY.md` — ready-to-paste form copy with placeholders
- `JUDGING_MATRIX.md` — evidence mapped to the four official criteria
- `DEMO_SCRIPT.md` — a three-minute truthful walkthrough
- `DEMO_SHOT_LIST.md` — recording and screenshot checklist
- `PITCH_DECK_CONTENT.md` — eight-slide deck content
- `RELEASE_MANIFEST.md` — reproducible artifact identity
- `FINAL_CHECKLIST.md` — final review and user-owned submission actions
