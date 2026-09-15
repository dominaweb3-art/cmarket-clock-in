# C Market Release Checklist

## Source and build

- [x] Complete Expo/React Native source is present under apps/mobile.
- [ ] A clean checkout installs dependencies successfully.
- [x] Lockfile is committed.
- [x] TypeScript checks pass.
- [x] Linting passes.
- [x] No development-only localhost or Metro dependency remains in the release configuration.
- [x] The app name, package identifier, icon, and version are final.
- [x] A signed Android release APK is produced.
- [x] The APK installs on the Seeker from a clean device state.

## Wallet and Solana

- [x] Mobile Wallet Adapter is used through the supported integration.
- [x] Devnet is visible during judging.
- [x] The app never asks for a seed phrase or private key.
- [ ] The wallet approval screen shows the intended transaction.
- [ ] Wrong-network behavior is handled.
- [ ] Insufficient token and fee balances are handled.
- [ ] Rejected signatures are handled.
- [x] Duplicate taps cannot submit duplicate purchases.
- [ ] Confirmation waits for the correct signature and cluster.
- [ ] Explorer links use the correct cluster.
- [x] Treasury public addresses are configuration values, not secrets.

## Product truthfulness

- [x] Every screen describes only functionality that exists.
- [x] No guaranteed-return or profit language is present.
- [x] No investment-advice language is present.
- [x] The Devnet prototype limitation is visible in documentation.
- [ ] Basket allocation claims are supported by code and on-chain evidence.
- [ ] Any fee, weight, or constituent display matches the implementation.

## Security

- [x] No seed phrase is in source, logs, screenshots, or video.
- [x] No private key is in source, logs, screenshots, or video.
- [x] No production secret RPC key is committed.
- [x] Environment files are ignored.
- [x] Dependencies are reviewed.
- [x] Android permissions are reviewed.
- [ ] Test wallets are separate from personal wallets.
- [x] The final repository has been searched for accidental secrets.

## Submission

- [ ] GitHub repository is accessible to judges.
- [x] README explains how to build and run the project.
- [ ] Hackathon compliance matrix is complete.
- [ ] Demo video is complete.
- [ ] Pitch deck or brief presentation is complete.
- [ ] Final team roster is accurate and frozen at submission.
- [ ] Project-age and funding information can be supported if requested.
- [ ] Official terms and website were checked again immediately before submission.
