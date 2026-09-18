# Three-minute CLOCK IN demo script

Target length: 2:45–3:00. Use the signed APK with Metro stopped. Keep the
system status bar, wallet network, and app identity visible. The bracketed
manual action is performed by Juan during the recording and is not automated
by Codex.

## 0:00–0:20 — Problem and promise

Say: “C Market makes a fixed C3 Core target understandable on a phone. The
target is Bitcoin 40%, Ethereum 30%, and Solana 30%. This release proves the
wallet and payment experience on Solana Devnet; it does not pretend that
settlement has already happened.”

## 0:20–0:45 — Cold launch on Seeker

Show: launch the signed `com.dominaweb3.cmarket` APK with Metro stopped.

Say: “This is a standalone Android release installed on a physical Seeker. It
opens as C Market, clearly labels Devnet, and keeps the wallet connection in
the mobile flow.”

## 0:45–1:05 — Connect the wallet

Show: tap the wallet connection entry point and choose Phantom.

Say: “Mobile Wallet Adapter hands the connection to the wallet. The user keeps
control of the keys; C Market never asks for a seed phrase or private key.”

## 1:05–1:25 — Explain C3 before payment

Show: dashboard, then C3 overview/details.

Say: “C3 is a target methodology: 40% Bitcoin, 30% Ethereum, 30% Solana.
These are target weights, not current holdings. The app explicitly says that
this Devnet prototype has not performed basket settlement.”

## 1:25–1:45 — Review the Buy screen

Show: Buy screen with 5 USDC and the disclosure card.

Say: “The Buy screen validates the minimum, shows the available USDC balance,
and tells the truth: the current flow records a USDC payment to the C3
treasury on Devnet. C3 Core settlement is planned for a later phase.”

## 1:45–2:05 — Supervised wallet approval

`[JUAN MANUAL ACTION — NOT AUTOMATED BY CODEX]` Verify Phantom says C Market,
Devnet, and 5 USDC; approve exactly one supervised Devnet payment. If the
wallet is not ready, show the prepared Buy screen and use the verified
Explorer evidence instead. Never approve a Mainnet transaction.

Say: “The user reviews and approves the Devnet payment in Phantom. No private
key leaves the wallet.”

## 2:05–2:25 — Verify, do not overclaim

Show: confirmation, Activity receipt if present, and the Devnet Explorer URL.

Say: “The receipt is tied to a public Devnet signature. This proves the
payment path, not basket ownership or settlement.”

Reference signature: `4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HrRVHud2NayLQyAJaaobU8yz3wCp1bwJcja9UMjcf3Dd`.

## 2:25–2:45 — Languages and retention

Show: language selector and one quick switch to Español, 简体中文, or
Português (Brasil), then return to English.

Say: “The same product is localized in four languages and the selection
persists across reloads. Activity gives the user a local, readable history.”

## 2:45–3:00 — Close with the roadmap

Say: “Today: signed Seeker app, MWA, Devnet USDC proof, and honest C3
methodology. Next: a separately reviewed non-custodial settlement release.
Mainnet is disabled here. C Market is building a mobile-native Solana index
experience with a clear security boundary.”
