# C Market Standalone Release QA

Date: 2026-09-15

Artifact: `artifacts/releases/c-market-0.1.0-release.apk` (intentionally ignored by Git)

Digest record: `submission/releases/c-market-0.1.0-release.sha256`

## Completed on Seeker

- Cold launch succeeded with Metro stopped.
- The approved launcher icon and ICON ONLY splash were verified.
- A fresh app-data state opened in English with the disconnected-wallet Connect entry point.
- English, Spanish, Simplified Chinese, and Brazilian Portuguese updated immediately and persisted after separate cold reloads.
- Wallet reauthorization returned to the account screen without a transaction request.
- SOL and USDC balances resolved on Devnet.
- The Buy screen opened and displayed the truthful Devnet prototype disclosure.
- A 4 USDC amount produced the localized 5 USDC minimum error without opening a wallet.
- A 221 USDC amount against 220 USDC available produced the localized insufficient-USDC error without opening a wallet.
- Two immediate Buy taps produced one wallet chooser; cancelling it returned one localized cancellation/rejection error.
- Wallet interruption/cancellation returned control to C Market without a crash.

## Pending safe wallet conditions

- Explicit signature rejection requires manually unlocking Phantom and rejecting the request.
- Insufficient SOL requires a wallet that already lacks enough Devnet SOL.
- Wrong-network handling requires a wallet that is already on a non-Devnet cluster.

No USDC transaction was approved, signed, or sent during this QA phase. Do not alter balances, drain funds, or change a wallet network only to manufacture these pending states.
