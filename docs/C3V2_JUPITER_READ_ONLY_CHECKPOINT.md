# C3V2 read-only Jupiter checkpoint (2026-09-28)

Classification: SHARED. This is **partial implementation evidence**, not C3V2 completion or authority to execute a Mainnet trade.

## Verified in this checkpoint

- The official Jupiter Swap V2 Router `GET https://api.jup.ag/swap/v2/build` accepted keyless public read-only requests on 2026-09-28. `GET /swap/v2/program-id-to-label` also responded. Labels are informational; they do not authorize route programs.
- The official Solana Mainnet public RPC returned parsed mint accounts for the four reviewed configuration mints (USDC, cbBTC, Portal ETH and WSOL); all were owned by the expected classic SPL Token program, with parseable decimals and supply. The script explicitly checks that USDC has six decimals.
- `npm run c3:jupiter:pilot-preflight` in `services/c3-mainnet` obtained V2 `/build` responses for the three 1-USDC deposit legs (400,000/300,000/300,000 USDC base units) and hypothetical reverse legs. Requests used a **synthetic, unfunded public taker**, 100-bps slippage and `maxAccounts=32`. No wallet was invoked and nothing was signed, simulated with funds, submitted or deployed.
- Some unrestricted WSOL routes exceeded 64 Jupiter swap account metas. Setting Jupiter's `maxAccounts=32` produced six quotes, but a Portal ETH reverse quote still contained 60 `swapInstruction` account metas. The parameter is **not** a verified hard cap on the final instruction or transaction; this does **not** prove that a complete C3 leg fits 1,232 bytes or is CPI-compatible.

## Missing security-critical proof

The V2 `/build` result can include setup/cleanup instructions, intermediate route programs, account lookup tables and temporary WSOL accounts. The current read-only client validates structure, exact input, quote bounds and response size, but does **not** authorize a settlement plan. Before any execution, separately prove the actual route-program registry, token-program instruction semantics, ALT ownership/indexes, vault PDA signer privileges, exact vault source and destination, no third-party recipient, no fee/tip, serialized size, blockhash freshness, and post-CPI token deltas.

The C3V1 vault still uses `MOCK_LOCAL_ONLY` settlement. Production settlement plan PDA, Jupiter CPI, six-leg local mock proof, durable open-vault provider, two-provider reconciliation, isolated mobile app and candidate APK are not implemented in this checkpoint. Mainnet capability remains false. C3V1 and the frozen Symmetry adapter remain preserved.

## Source and reproduction

- Official Jupiter V2 Router: https://developers.jup.ag/docs/swap/build/index
- Official Solana CPI model: https://solana.com/docs/core/cpi
- Public RPC method: https://solana.com/docs/rpc/http/getmultipleaccounts
- Reproduce: from `services/c3-mainnet`, run `npm run c3:jupiter:pilot-preflight`. Quotes are volatile and must be revalidated; a successful command is **not** a GO decision for Mainnet execution.

Next implementation boundary: on-chain versioned settlement plan with exact per-leg accounts/bytes, fail-closed CPI checks and local mock Router adversarial tests. Do not enable Mainnet or sign until C3V3's independent security gate and supervised authorization.
