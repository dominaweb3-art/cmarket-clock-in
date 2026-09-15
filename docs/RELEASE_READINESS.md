# C Market Android Release Readiness

## Current verified capabilities

- Android package `com.dominaweb3.cmarket` opens on Seeker as C Market.
- Mobile Wallet Adapter connects a compatible Solana wallet on Devnet.
- The app reads SOL and Devnet USDC balances.
- The Buy screen validates a 5 USDC minimum, prevents duplicate submission, requests wallet signing, submits the signed payment, waits for confirmation, and links to Solana Explorer.
- English is the default and permanent fallback; English, Spanish, Simplified Chinese, and Brazilian Portuguese can be selected and persist across reloads.
- The interface states that the prototype records a USDC treasury payment on Solana Devnet and that basket settlement has not occurred.
- Approved C Market APP ICON and ICON ONLY assets are configured for the launcher, adaptive icon, splash screen, favicon, and sign-in brand area.
- A locally signed standalone APK has been signature-verified, installed on Seeker, and launched without Metro.

## Known prototype limitations

- C3 basket allocation and position tracking are not implemented.
- Activity/history is not implemented or persistent.
- C5, C10, C20, C50, and withdrawals are previews only.
- This prototype is Devnet-only and is not ready for mainnet funds or public financial use.

## Dependency audit

The Phase 3A `npm audit --omit=dev` review reported no critical vulnerabilities, three high-severity findings, and twenty-two moderate findings in the current Expo/Solana dependency tree. The suggested automatic fixes include incompatible major changes or downgrades, so they were not applied during release hardening. Review and retest these findings in a dedicated dependency-upgrade phase before any production or mainnet use.

## Required public environment variables

- `EXPO_PUBLIC_SOLANA_CLUSTER`
- `EXPO_PUBLIC_SOLANA_RPC_URL`
- `EXPO_PUBLIC_DEVNET_USDC_MINT`
- `EXPO_PUBLIC_USDC_DECIMALS`
- `EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY`
- `EXPO_PUBLIC_APP_NAME`
- `EXPO_PUBLIC_APP_IDENTITY_URI`

Copy the repository `.env.example` to `apps/mobile/.env`. Keep `.env`, `credentials.json`, keystores, passwords, private keys, seed phrases, and tokens untracked. The wallet identity URI must use HTTPS.

## Android validation and build commands

Run from `apps/mobile` with Node.js, JDK 17, and the Android SDK available:

```bash
npm ci
npm run typecheck
npm run lint:check
npm run doctor
npm run android:export
npm run android:release:validate
```

`android:release:validate` proves that the native release variant compiles, but Expo's generated local Gradle project uses a debug key unless final signing credentials are supplied. Its APK is not a submission artifact.

For the final locally signed APK, create an untracked EAS local `credentials.json` that references the dedicated release keystore, then run:

```bash
npm run release:android:apk
```

Never reuse a personal signing key or commit the credentials file, keystore, aliases, or passwords. Record the SHA-256 of the final APK separately for submission verification.

For an isolated local validation APK, run:

```bash
npm run release:android:apk:local
```

This command creates or reuses a dedicated keystore and password under the ignored `apps/mobile/release-signing` directory, regenerates the Android project, signs the release build, verifies its APK signature, and writes the standalone artifact under ignored `apps/mobile/dist/release`. Back up the signing materials securely before treating this key as the permanent update key.

## Seeker testing steps

1. Enable USB debugging, connect the Seeker, and confirm it with `adb devices -l`.
2. Install the final APK with `adb install -r path/to/c-market.apk`.
3. Launch the final standalone C Market build without Metro and confirm the app identity and Devnet label.
4. Verify English default/fallback and all four language selections after reload.
5. Connect a dedicated Devnet wallet through Mobile Wallet Adapter.
6. Verify account, SOL/USDC balances, Buy navigation, minimum validation, and a rejected wallet request.
7. In a controlled final test only, approve one intended Devnet payment and verify the receipt and Explorer link.
8. Repeat controlled tests for insufficient USDC, insufficient SOL, wrong network, RPC interruption, and rapid duplicate taps.

## Remaining blockers before final submission

- Back up the dedicated local signing key and password securely, then formally designate whether it will be the permanent Android update key.
- Preserve the verified standalone APK and its SHA-256 digest outside generated build directories before final submission.
- Complete controlled failure-path tests; code-level messages exist, but every wallet/RPC failure must still be exercised on-device.
- Review the currently reported npm vulnerabilities in a dedicated dependency-upgrade phase; do not apply npm's incompatible major downgrade suggestions blindly.
- Complete the demo video, pitch deck, team roster, compliance confirmations, and final official-terms review.
- Either implement and verify basket settlement later or continue presenting C Market strictly as a Devnet USDC payment prototype.
