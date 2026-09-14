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
