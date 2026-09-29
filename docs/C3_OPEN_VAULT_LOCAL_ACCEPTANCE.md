# C3V1 local acceptance

Run from `programs/c3-pilot-vault/` with an isolated local Solana validator:

```sh
npm ci
npm run c3:vault:e2e:local
```

The command is local-only, generates ignored test keypairs if needed, compiles the `local-mock` feature and a **separate** local router, starts a local validator through Anchor, and runs a deterministic buy/hold/full-redeem test using six vault-PDA-signed CPI swaps. It prints mock-unit amounts and local transaction signatures. No real wallet, Mainnet RPC, Seeker or phone is required. The standalone router is not Jupiter and its test-token liquidity is synthetic.

For the additional disposable PostgreSQL + validator integration, run `npm run test:open-local-cpi-postgres` from `services/c3-mainnet`. This local test checks durable route/signature records, a process-restart read, a two-worker lease race, and finalized local transaction effects. It does **not** establish two independent production RPC providers.

Acceptance requires: paused deposit rejection; exact 1-USDC deposit; vault-only 40/30/30 mock balances; 1,000,000 on-chain non-transferable shares in the owner ATA; no underlying asset ATA credited to the user; full share burn; 990,000 mock-USDC units returned to the same owner ATA even after governance pauses the vault; completed intent closure; duplicate and attacker-directed operations rejected. The deterministic 10,000-unit mock shortfall must be shown explicitly.

Run `cargo fmt --check`, `cargo check --features local-mock`, `cargo clippy --features local-mock`, `npm run typecheck`, `npm run test:boundary` and the production build boundary scan separately. A passing local test does not authorize Mainnet or prove Jupiter integration.

If any step fails, report which one failed; do not commit a completion claim. The program and test keypairs remain ignored local artifacts. The next step after local acceptance is an independent security review and real Jupiter CPI/ALT/size validation. A supervised 1-USDC real buy/sell test requires separate security and governance gates.
