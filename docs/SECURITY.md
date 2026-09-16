# Security Notes

## Never commit

Never commit any of the following:

- Seed phrases.
- Private keys.
- Wallet export files.
- Authentication tokens.
- Production RPC credentials.
- Cloud service credentials.
- Keystore passwords.
- Android signing keys.
- Personal identity documents.

## Wallet model

C Market is designed so that the mobile wallet signs transactions. The application should only receive public wallet information and signed transaction results through the supported wallet integration.

The application must never request a seed phrase or private key.

## Development network

Use a dedicated Devnet wallet and Devnet assets during development and judging.

Devnet tokens have no real-world value. Do not test experimental code with personal mainnet funds.

## Logs and screenshots

Before publishing logs, screenshots, or demo recordings:

- Remove wallet secrets.
- Remove local filesystem paths that reveal unnecessary personal information.
- Check transaction details for unintended data.
- Keep public addresses only when they are intentionally part of the demonstration.

## Reporting a vulnerability

Do not publish a vulnerability with exploitable details in a public issue. Contact the project owner privately first and include:

- A clear description.
- Reproduction steps.
- Affected version or commit.
- Impact assessment.
- Suggested mitigation, if available.

This repository is a hackathon project and has no guarantee of production security. A production deployment would require a substantially deeper security review.

## Guarded C3 Core Mainnet engine

The C3 Core Mainnet engine is implemented separately from the verified Devnet payment flow and is disabled unless `EXPO_PUBLIC_ENABLE_C3_MAINNET` is exactly `true`. Runtime execution also requires the configured cluster to be `mainnet-beta`; missing, malformed, or ambiguous values fail closed. The tracked and local release configuration keeps the flag disabled.

The engine uses sequential Jupiter builds for 40% cbBTC, 30% Portal ETH, and 30% native SOL. It never embeds a Jupiter API key, requests fresh keyless builds immediately before each leg, caps slippage at 100 bps, validates mints, exact inputs, destinations, signers, fee payer, programs, and prohibited authority instructions, and rejects stale blockhashes or transactions over 1,232 bytes.

Only the connected wallet may sign and pay. C Market does not custody the purchased assets. Unsigned or signed transaction payloads are not persisted. Persistence contains only purchase metadata, leg states, public signatures, timestamps, and confirmed output amounts when available. A confirmed leg cannot be submitted again; failures are not automatically retried or reversed, and resumption requires a fresh quote and explicit approval.
