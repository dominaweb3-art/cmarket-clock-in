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

## Confirmed payment evidence

The earlier 5 USDC payment with signature
`5488cmumJ5Jj38VuVq8Dxw4qJA9scd5g5Fco3Lw9w7JvbRbCqewtdQyEJgRV5xxrNk3KDwgrzRBD4gkrKpNeay4g`
is finalized on Solana Devnet and is not present on Testnet. Official RPC data reports:

- Sender and token authority: `DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej`
- Source token account: `87B29Ue5b9R3wSLneJc9HW6cMPkFXynnw5UY71HcwoB3`
- Treasury owner: `FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ`
- Destination token account: `EXPP2i58cX56m1A5cAvENJsSAmb2DL1PjEqqrnH83Z2Q`
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Amount: 5 USDC (`5000000` base units, 6 decimals)
- Slot: `498822672`; status: finalized with no transaction error

The wallet cancellation/rejection path was also exercised without sending a transaction. C Market returned control to the Buy screen, displayed the localized cancellation/rejection message, and released the duplicate-submit lock.

## Wallet identity trust

The former wallet identity URI pointed to GitHub, which caused Phantom to identify the requester as `github.com`. The canonical identity URI is now `https://cmarket-identity.vercel.app`. The page identifies C Market as a Solana Devnet prototype and states that C3 basket settlement is not enabled.

Although Phantom displayed `Testnet` for the earlier request, the signed transaction is provably a Devnet transaction: it is available and finalized through the official Devnet RPC and absent from the official Testnet RPC. The app configuration requires `devnet`, passes `solana:devnet` to Mobile Wallet Adapter, and now exposes only Devnet in its canonical cluster list.

The rebuilt standalone APK contains the new identity URI and no longer contains the former GitHub identity URI. It was installed on Seeker, cold-launched with Metro stopped, opened the wallet entry point, returned to the C Market account, resolved Devnet balances, and passed the wallet-chooser cancellation test. Phantom was locked behind device biometrics, so visual confirmation of the domain on Phantom's transaction-review screen remains pending; no unlock, approval, signature, or transaction was attempted.

## Phase 4B payment-attempt diagnosis

At approximately 15:02 COT on 2026-09-15, Phantom displayed the new C Market identity and the user confirmed a 5 USDC request. C Market did not receive a transaction signature and displayed a Devnet availability error. Evidence collected afterward establishes that this attempt never reached Devnet:

- ADB recorded Phantom's Mobile Wallet Adapter failure for `sol_mwa_sign_transactions`: `Readable side is not in a state that permits enqueue`.
- The C Market and Phantom MWA sessions then closed without a signed payload reaching the app.
- The sender's official Devnet history contains no transaction after the previously confirmed 10:02 COT payment.
- The public Devnet RPC returned healthy responses for `getHealth`, finalized slot, version, latest blockhash, and address history.

The purchase screen had used the deprecated MWA 2.0 `signTransactions` path and then submitted the signed bytes itself with `sendRawTransaction`. The error classifier also treated the generic word `RPC` in Phantom's internal `RPC ROUTER` message as proof of a Solana RPC outage. This produced an inaccurate user-facing error.

The implementation now uses the MWA 2.0 `signAndSendTransactions` path recommended by Solana Mobile. The wallet signs and submits the unchanged transaction, C Market still confirms the returned signature against the same Devnet blockhash window, and no automatic payment retry was added. Wallet-response failures now tell the user to check wallet activity before trying again. No transaction was initiated while validating this change.
