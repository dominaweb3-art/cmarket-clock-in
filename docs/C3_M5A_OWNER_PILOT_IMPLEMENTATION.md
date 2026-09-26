# M5A · C3 owner pilot implementation checkpoint (SHARED)

Status: **PARTIALLY COMPLETED; Mainnet execution disabled.** The code in this checkpoint is a durable, fail-closed foundation and isolated screen preview, **not** a functional C3 purchase or redemption. No C3 vault or share mint exists in the checked-in configuration. No wallet authorization, signing, submission, transfer or deployment occurred.

## Product contract and limits

C3 targets 4,000 bps cbBTC, 3,000 bps Portal ETH and 3,000 bps SOL/WSOL, always 10,000 bps. A later supervised owner-only acceptance test would use exactly 1,000,000 USDC base units (1 USDC); this is not a commercial minimum. The pilot cap is 1 USDC aggregate TVL, one allowlisted wallet, one open deposit and one open redemption. Automatic retry, reversal, resubmission, public registration/navigation, SKR rewards and C Market fee collection are off. MWA would require explicit approval for **each** transaction; two approvals are not atomic.

The vendor response supplied by the owner states that users may redeem as underlying tokens or rebalance underlying tokens to USDC and claim USDC. This is `VENDOR_CONFIRMED_PRODUCT_BEHAVIOR`, **not** audited instruction evidence. The inspected SDK `sellVaultTx` has no explicit USDC output mint or minimum-USDC parameter. `keep_tokens: []` is a candidate for an owner-only, capped experiment, not proof of USDC delivery. A sell must not be called complete without independent, finalized, same-wallet USDC receipt reconciliation. If an outcome is uncertain, stop in manual review; never retry automatically.

## Implemented here

- `services/c3-mainnet/config/c3-pilot.template.json` defines only public candidate constants. Vault, share mint, wallet allowlist and two independent RPC provider identifiers are intentionally unset. Approval and deployment statuses are not approved.
- `src/pilot-config.ts` fixes limits in source and never enables Mainnet; even a filled template cannot override the immutable false capability.
- `migrations/0003_c3_owner_pilot.sql` is an **explicit, forward-only** migration for durable pilot intents, append-only events and outbox, with a first-pilot uniqueness cap. It does not auto-run at service bootstrap.
- `src/pilot-postgres.ts` can store a disabled draft and query durable metadata. It does **not** store signing payloads, fabricate shares, or mark a chain operation complete. Submitted signatures/reconciled effects remain in the schema for a future independently audited writer; the current API cannot write them.
- `src/pilot-state.ts` specifies ordered deposit/redemption stages and basic transition invariants. It is not an approved production reconciler.
- `src/pilot-service.ts` has the requested typed operation names but rejects build, approval, submission and reconciliation. Read responses explicitly mark NAV, share balance, current allocation, fees and USDC output unavailable. An intent in PostgreSQL is not an on-chain position.
- `apps/mobile/pilot/` contains an **unmounted**, disabled, localized owner-pilot preview (en/es/zh-CN/pt-BR) for dashboard, buy, sell, intent status and activity. It is not in `apps/mobile/app/` and has no wallet path or stable Devnet route. The stable Android export must be scanned to confirm absence.

## Deliberately not claimed as complete

The isolated Symmetry SDK builder, strict semantic validator of raw unsigned v0 transactions/ALT/inner effects, approved route/program manifest, independent two-provider finalized reconciler, actual share-balance read model, signed keeper/claim sequence, MWA multi-approval integration and a separate owner-pilot APK **do not exist yet**. The historical public-vault SDK example is not C3 evidence. Package `@symmetry-hq/sdk@1.0.22` was previously inspected only in an isolated research prefix, and its transitive SPL Token dependency is not approved for public production. Do not import it into the stable mobile app or call the current code an end-to-end flow.

## Supervised deployment preparation — not execution authorization

1. Independently review the Symmetry V3 on-chain program, upgrade authority, full instruction layouts and keeper privileges. Map the exact C3 vault creation/authority/share-mint instructions and raw account metas; do not infer these from names alone.
2. Obtain Security-approved policy for two deposit transactions, separate lock/mint/keeper steps and the experimental `keep_tokens: []` redemption/USDC claim. Reject unknown programs, writable accounts, signers, fee payer, ALTs, token/SOL debits, close-account instructions and destinations. Cap every serialized v0 transaction at 1,232 bytes and enforce fresh blockhash/expiry before each MWA approval.
3. Propose a versioned vault manifest with immutable 40/30/30 target, exact Mainnet mints, 1 USDC pilot cap, zero fee, one wallet and explicit authority mapping. Do not invent vault, share mint, wallet or Squads addresses. Record separate Security and Squads governance approvals before deploying.
4. Configure two independent HTTPS RPC providers/operators and a finalized, instruction-level reconciler. Record wallet-owned share ATA and USDC ATA baselines before any supervised action. Missing/disagreeing evidence must enter manual review.
5. Build a separate, isolated owner-only artifact and have it independently reviewed. Preserve the stable Devnet APK. Only a later explicit approval may connect Seeker, authorize the wallet, deploy the vault or risk 1 USDC.
6. For a later acceptance test, verify deposit signature(s), lock/keeper/mint effects, vault reserves, share supply and user share ATA before displaying an active position. Verify share burn/debit and actual finalized USDC credit to the same user before marking redemption complete. Zero/missing/inconsistent USDC is manual review.
7. Emergency stop: disable new owner-pilot intents in a separate reviewed release; preserve all signatures, evidence and unresolved positions. Never automatically retry or reverse. A failed/partial vault operation needs human reconciliation and an explicit new user authorization for any new action.

`PHONE_REQUIRED_NEXT: NO`. The next action is not a wallet tap: complete the raw Symmetry builder/validator and independent security review, then provide verified vault/share-mint and governance evidence. No external team contact or Pyth key is needed for this checkpoint.

## Local validation at this checkpoint

Service TypeScript, build, lint, formatting, 54 unit tests, 51 disposable-PostgreSQL checks (including a separate-process pilot reload), four package-boundary tests and 44 prior Symmetry research tests passed. The service production dependency audit reported zero findings; the SDK was not added to the service or the mobile package. Mobile TypeScript, lint, formatting, two isolated-preview tests and Android export passed; 32 exported files were scanned with no guarded Mainnet markers. Mobile Expo Doctor passed 20/21 checks and reported five pre-existing Expo SDK patch-version mismatches. The mobile production dependency audit reported 20 moderate findings, with no high or critical findings; no dependencies were changed in M5A. This is not an Android owner-pilot build or a wallet test.
