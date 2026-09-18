# CLOCK IN release manifest

This is a non-secret identity record for the APK used in Seeker testing.

## Application

- Display name: C Market
- Android package: `com.dominaweb3.cmarket`
- Version name: `0.1.1`
- Version code: `2`
- Target device: Solana Mobile Seeker
- Network in this release: Solana Devnet
- Mainnet engine: disabled and excluded from the Devnet release

## APK

- Stable local artifact: `/Users/juantorres/Projects/cmarket-integration/artifacts/releases/c-market-0.1.1-release.apk`
- SHA-256: `09ef92848c97c7968ab6eb71d41fc1b458e54584d52746f6b457acae0c18146a`
- Committed digest record: `submission/releases/c-market-0.1.1-release.sha256`
- APK Signature Scheme v2: verified
- Signer certificate SHA-256: `bd7ab13b8b1be3f54fa1f5ebcfff58048a184f393c8a0515f123524f229882d5`

The keystore, passwords, aliases, and signing credentials are intentionally
not recorded here.

## Functional evidence

- Cold launch with Metro stopped: verified on Seeker
- MWA/Phantom Devnet connection: verified
- 5 USDC minimum validation: verified
- Successful supervised Devnet payment: verified
- Explorer signature:
  `4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HRVHud2NayLQyAJaobU8yz3wCp1bwJcja9UMjcf3Dd`
- Explorer URL: https://explorer.solana.com/tx/4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HRVHud2NayLQyAJaobU8yz3wCp1bwJcja9UMjcf3Dd?cluster=devnet
- Localized UI: English, Español, 简体中文, Português (Brasil)

## Reproduction

```text
adb install -r c-market-0.1.1-release.apk
```

Use the Seeker demo script with the wallet on Devnet. Never present this
artifact as a Mainnet basket or investment product.
