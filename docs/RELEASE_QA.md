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

## Phase 4C corrected MWA payment verification

The supervised standalone signed APK payment completed successfully after the MWA submission fix. The valid Devnet signature is:

`4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HrRVHud2NayLQyAJaaobU8yz3wCp1bwJcja9UMjcf3Dd`

The official Devnet RPC reports slot `498959976`, no transaction error, and finalized status. The sender is `DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej`; the C3 treasury owner is `FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ`; and the destination token account is `EXPP2i58cX56m1A5cAvENJsSAmb2DL1PjEqqrnH83Z2Q`. The Devnet USDC mint is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. The transfer amount is 5 USDC (`5000000` base units, 6 decimals); the sender balance changed from 260 to 255 USDC and the treasury balance from 0 to 5 USDC.

Explorer: `https://explorer.solana.com/tx/4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HrRVHud2NayLQyAJaaobU8yz3wCp1bwJcja9UMjcf3Dd?cluster=devnet`

This is a Devnet USDC payment to the C3 treasury. It does not perform basket settlement; C3 settlement remains planned for a later phase.

The shared C3 Core methodology shown in the product is Bitcoin 40%, Ethereum 30%, and Solana 30%. These are target weights only; the verified Devnet payment does not create BTC, ETH, or SOL holdings.

The Activity screen stores only confirmed Devnet payment receipts. Each receipt is deduplicated by transaction signature and contains the schema version, signature, confirmed status, exact USDC amount, cluster, wallet public key, treasury public key, confirmation time, and a Devnet Explorer URL. Refresh is read-only and malformed records are ignored safely.

The signature text initially supplied for verification was 86 characters and was rejected by RPC as `WrongSize`; the canonical 88-character signature above is the finalized transaction returned by the sender's Devnet history.

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

## Phase 5G.2 recovery and persistence hardening

The disabled C3 Core Mainnet engine now uses a strict versioned AsyncStorage document with monotonic revisions, staged writes, duplicate-ID rejection, canonical 40/30/30 recomputation, and fail-closed diagnostics. It persists the current leg before any future wallet approval and distinguishes awaiting wallet, submitted-unconfirmed, confirmed, failed-on-chain, cancelled-before-submission, uncertain submission, and reconciliation-required states. Confirmed legs cannot be changed or resubmitted.

After a future wallet signature, later RPC, UI, or storage failures preserve the submitted signature and block retries. Recovery is read-only and bounded: it can accept exactly one fully matching recent wallet transaction, while zero or multiple matches remain blocked for explicit review. Final confirmation requires agreement from two independently configured Mainnet providers and complete semantic evidence; a signature or `meta.err: null` alone is not a success claim. No production Mainnet providers are configured, Mainnet remains disabled, and no wallet action was performed for this hardening phase.

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

## Phase 5E guarded Mainnet engine

The disabled C3 Core Mainnet engine is separate from the Devnet purchase screen. The shipped artifact uses an immutable source-controlled `false` capability constant; `EXPO_PUBLIC_ENABLE_C3_MAINNET`, route parameters, storage, and constructor values cannot enable it. The normal mobile UI does not expose Mainnet navigation, and the exact `mainnet-beta` runtime gate remains unreachable in this artifact.

The engine prepares three sequential non-custodial legs: 40% cbBTC, 30% Wormhole Portal ETH, and 30% native SOL. It requests fresh keyless Jupiter builds, applies 100 bps maximum slippage, validates the transaction before any wallet request, and persists no transaction payloads. Each future leg will require its own review and wallet approval. The current Devnet app and verified Devnet payment remain unchanged.

No Mainnet wallet authorization, signature, submission, transfer, or Seeker Mainnet test was performed in Phase 5E. The feature remains disabled and is not a release capability. Automated checks cover allocation rounding, minimum purchase, fail-closed flag and network guards, state transitions, cryptographically random intent IDs, duplicate submission locks, and transaction validation rules.

## Phase 5G.1 independent security remediation

The disabled Mainnet engine was hardened without changing the verified Devnet flow or requesting wallet authorization. The Mainnet flag has no caller override, accepts only the exact value `true`, and still requires the exact `mainnet-beta` cluster. Strict decimal parsing, base-unit `bigint` arithmetic, 50–500 USDC bounds, and exact 40/30/30 allocation are enforced before quote/build work.

The validator now requires exact Jupiter build metadata, official V2 discriminators, reviewed fixed route layouts, complete route-plan input/output accounting, fresh blockhash metadata, user-only signer and fee payer, user-owned output accounts, and no treasury or third-party destination. Unknown programs, unsafe instructions, approvals, delegates, authority changes, arbitrary SOL transfers, unrelated closes, unsupported route variants, and malformed or mismatched address lookup tables are rejected. WSOL cleanup is accepted only for the expected temporary user account with a user-only refund.

The test suite includes a sanitized valid Jupiter V2 fixture and malicious fixtures covering amount, mint, threshold, slippage, taker, mode, route-plan, program, signer, different fee payer, destination, token-instruction, close-account, unsupported-variant, fabricated/deactivated lookup-table, and third-party WSOL-refund attacks. A complete SOL fixture covers the expected WSOL lifecycle. RPC simulation remains advisory and environmental failures are not reported as successful execution. The read-only build harness validates lookup tables from Mainnet RPC and stops safely if that RPC is unavailable. No transaction was signed or submitted during this remediation.

Authoritative references used for the structural rules: https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml, https://github.com/jup-ag/instruction-parser, https://solana.com/docs/rpc/json-structures, and https://solana.com/docs/core/programs.
