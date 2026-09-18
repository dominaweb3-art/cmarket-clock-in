# Verified Devnet payment evidence

This file contains public on-chain facts only. It does not contain wallet
credentials, signing material, environment values, or private data.

## Canonical transaction

- Signature: `4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HrRVHud2NayLQyAJaaobU8yz3wCp1bwJcja9UMjcf3Dd`
- Cluster: Solana Devnet
- Confirmation: finalized
- Execution: successful; RPC `err` is `null`
- Slot: `498959976`
- Block time: `2026-09-15T21:18:14Z`
- Explorer: https://explorer.solana.com/tx/4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HrRVHud2NayLQyAJaaobU8yz3wCp1bwJcja9UMjcf3Dd?cluster=devnet

## Public transfer facts

- Sender and fee payer: `DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej`
- Source token account: `87B29Ue5b9R3wSLneJc9HW6cMPkFXynnw5UY71HcwoB3`
- Destination token account: `EXPP2i58cX56m1A5cAvENJsSAmb2DL1PjEqqrnH83Z2Q`
- Destination token-account owner, the C3 treasury: `FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ`
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Amount: `5,000,000` base units, or `5.000000 USDC` at 6 decimals
- Source balance change: `-5.000000 USDC`
- Destination balance change: `+5.000000 USDC`
- Instruction: SPL Token `transferChecked`

## Verification method

The facts above were checked with read-only `getSignatureStatuses` and
`getTransaction` requests against the official Devnet RPC:

`https://api.devnet.solana.com`

The Explorer link is provided for human review, but the RPC result is the
canonical verification because public Explorer pages can be rate limited.
