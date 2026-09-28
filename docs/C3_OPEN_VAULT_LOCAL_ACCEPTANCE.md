# C3V1 local acceptance

Run from `programs/c3-pilot-vault/` with an isolated local Solana validator:

```sh
npm ci
npm run c3:vault:e2e:local
```

The command is local-only, generates an ignored test wallet if needed, compiles the `local-mock` feature, starts a local validator through Anchor, deploys the test program there, and runs a deterministic buy/hold/full-redeem test. It must print mock-unit amounts and local transaction signatures. No real wallet, Mainnet RPC, Seeker or phone is required.

Acceptance requires: paused deposit rejection; exact 1-USDC deposit; vault-only 40/30/30 mock balances; 1,000,000 on-chain non-transferable shares in the owner ATA; no underlying asset ATA credited to the user; full share burn; 990,000 mock-USDC units returned to the same owner ATA even after governance pauses the vault; completed intent closure; duplicate and attacker-directed operations rejected. The deterministic 10,000-unit mock shortfall must be shown explicitly.

Run `cargo fmt --check`, `cargo check --features local-mock`, `cargo clippy --features local-mock`, `npm run typecheck`, `npm run test:boundary` and the production build boundary scan separately. A passing local test does not authorize Mainnet or prove Jupiter integration.

If any step fails, report which one failed; do not commit a completion claim. The program and test wallet keypair remain ignored local artifacts. The next step after acceptance is Jupiter settlement and application integration (C3V2), followed only later by a supervised 1-USDC real buy/sell test (C3V3).
