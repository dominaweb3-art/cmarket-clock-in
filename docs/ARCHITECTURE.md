# C Market Architecture

## Product layers

C Market is organized around four layers:

1. **Mobile experience** — basket discovery, purchase review, wallet state, confirmation, and activity.
2. **Wallet layer** — Mobile Wallet Adapter and a compatible Solana mobile wallet.
3. **Solana settlement layer** — Devnet transactions, token accounts, confirmations, and Explorer evidence.
4. **Methodology layer** — basket definitions, constituent rules, weights, caps, buffers, and rebalance policy.

## Current prototype flow

```text
User
  -> C Market Android UI
  -> Mobile Wallet Adapter
  -> Phantom mobile wallet approval
  -> Solana Devnet transaction
  -> Devnet USDC treasury destination
  -> Confirmation and Explorer link
```

The current prototype proves the payment-routing and confirmation path.

## Target basket flow

The target product flow is:

```text
User selects basket
  -> App loads a versioned basket definition
  -> App displays constituents and methodology
  -> User reviews amount and network
  -> Wallet signs a transaction or approved program interaction
  -> Settlement is confirmed on Solana
  -> App records the verified activity
  -> User can inspect the basket and transaction history
```

The target flow must only be described as complete after it is implemented, tested, and supported by on-chain evidence.

## Network policy

Development and judging prototypes should use Devnet:

- Cluster: Solana Devnet
- Assets: test assets only
- Wallet: a dedicated test wallet
- RPC: configured through environment variables
- Treasury: a dedicated Devnet public address

No private key is needed by the application. The user signs through the mobile wallet.

## Data and trust boundaries

### The mobile application may

- Read public wallet and token-account data.
- Display basket metadata.
- Construct a transaction.
- Ask the wallet to sign.
- Submit a signed transaction to the configured RPC.
- Verify confirmation.
- Display a public signature and Explorer link.

### The mobile application must not

- Request or store seed phrases.
- Request or store private keys.
- Pretend that an unconfirmed transaction is final.
- Hide the destination or network.
- Claim that treasury distribution happened without evidence.
- Use production funds during development.

## Reliability requirements

The release build should handle:

- Wallet not connected.
- Wallet connection rejected.
- Signature rejected.
- Wrong cluster.
- Insufficient USDC.
- Insufficient SOL for fees.
- Missing token account.
- RPC timeout.
- Transaction simulation failure.
- Confirmation timeout.
- Duplicate purchase taps.
- App backgrounding during wallet approval.
- A previously submitted transaction that is still pending.

## Future settlement module

Before any mainnet or real-asset use, the settlement design needs:

- A clearly specified basket methodology.
- Versioned constituent lists and weights.
- A transparent fee policy.
- Slippage and liquidity controls.
- Atomic or otherwise provable settlement behavior.
- Reconciliation between user payment and resulting basket position.
- Tests for partial failure and retries.
- Independent security review appropriate to the implementation.
