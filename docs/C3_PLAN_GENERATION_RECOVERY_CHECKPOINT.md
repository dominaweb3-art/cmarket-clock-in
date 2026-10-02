# Append-only C3 recovery checkpoint — 2026-10-02

Classification: SHARED. Starting commit `6dc7a486982fa6ac87a142dd101fc2257a5caa85`,
branch `feature/c3-open-pilot-vault`. Overall **PARTIALLY_COMPLETED**, not an
approved monetary release. This supersedes older current-result statements in
the candidate/durable-progress documents; historical evidence is preserved.

## Implemented boundaries

Additive isolated migration `0007_plan_generations.sql` stores immutable renewal
requests, owner-signature receipts, generations, terminal outcomes, original
quote-generation bindings and exact previous leg snapshots. It does not duplicate
intents, change original intent expiry, or reset signing attempts/deadlines. It is
excluded from production migrations.

Preparation loads PostgreSQL owner/revisions and finalized local config, plan and
clock. Renewal preserves inventory, budgets, completed effects and user rights;
only expiry/revision/active authorization change. Old seals cannot execute new
legs. Final lifecycle revision is three executed legs plus durable renewal count,
not a fixed three. Owner signature is verified and journaled before any possible
broadcast; helpers never sign or submit. Pending spend signatures and uncertain
signer dispatch prevent incompatible renewal. No blind retry/signature deletion.

Failed/unexecuted renewal resolution retains its signature. Expiry precedes
absence observations, with finalized context barriers and unchanged plan bytes.
Null alone is uncertain. Exclusive outcomes/generations write the common intent
revision, invalidating stale concurrent serializable snapshots. This adapter is
LOCAL only; it is not sufficient production evidence.

Reviewed Whirlpool V2 legacy-token semantics support exact 26-meta Jupiter
routes/15-account `swap_v2` CPI, with pool/reserve/mint/Memo identity, duplicate
occurrences, direction and amounts bound. Hooks, extra accounts, unexpected Memo
CPI/effects fail closed. This is not arbitrary Jupiter/Token-2022 route support.

Two reviewed independent HTTPS RPC operators can supply finalized evidence.
Missing/conflicting evidence fails closed. The result remains explicitly
`FINALIZED_QUORUM_REQUIRES_SEMANTIC_VERIFICATION`: it cannot issue shares or release
funds. Production semantic promotion is still missing; no operators/credentials
or approvals were invented.

## Actual renewed cloned execution

Ignored report: `programs/c3-pilot-vault/results/jupiter-cycle-TKtLGi/report.json`.
Intent `281dbb72-d70f-472d-99df-519785cb2a07`:
`PASS_LOCAL_CLONED_JUPITER_CYCLE`.

One persistent PostgreSQL intent, owner renewal, isolated quote signer, durable
signatures, Ed25519 verification and actual cloned Jupiter/Whirlpool CPI passed
all six legs. Sales used quantities actually obtained by this bank's purchases.

| Leg               | Input units | Expected output | Validated threshold/signed minimum | Bytes |
| ----------------- | ----------: | --------------: | ---------------------------------: | ----: |
| USDC → cbBTC      |      400000 |             470 |                                466 |   753 |
| USDC → Portal ETH |      300000 |           11167 |                              11056 |   753 |
| USDC → WSOL       |      300000 |         2501973 |                            2476954 |   846 |
| cbBTC → USDC      |         470 |          398341 |                             394358 |   784 |
| Portal ETH → USDC |       11158 |          299485 |                             296491 |   815 |
| WSOL → USDC       |     2499672 |          299368 |                             296375 |   815 |

Issued/burned 1,000,000 local share units; returned 997314 synthetic USDC units.
Duplicate claim rejected on-chain. A new OS process recovered the same intent,
revision and signature; uncertain recovery did not resend. Three hostile changes
to actual finalized evidence failed before journal promotion.

**Cloned execution with synthetic funded input is not Mainnet acquisition,
customer holdings or physical MWA approval.** Owner used an ephemeral local key.
Final database-only race fixes received focused tests, not another full cycle.

## Mobile and exact missing links

Candidate retains immutable false capability/null approval and disabled Buy/Sell.
Owner v0 inspection checks payer, signer, ordered metas/data, placeholders,
no ALT/extra accounts and 1232-byte size, copying mutable bytes before awaits.
Gated MWA uses `signTransactions`, verifies selected owner/returned message and
never sign-and-send. State primitives preserve uncertainty, rejecting null or
mismatched finalization.

PG renewal → mobile review → protocol-shaped wallet response → durable owner
receipt → finalized reconciliation passed in isolation. That adapter uses an
ephemeral key, **not Phantom or a real user signature**.

Still absent: reviewed client templates/policy and durable owner APIs for
deposit/share issuance/redemption/claim; connection of these APIs and renewal to
candidate screens; verified position reader; monetary-UI restart rehydration;
physical explicit MWA approval in an authorized isolated environment. Missing
implementation is not merely missing credentials. No capability override added.

## Preserved artifacts

New ignored APK:
`artifacts/c3-pilot-candidate/2026-10-02-plan-generations-disabled/c-market-c3-mainnet-candidate-0.1.0-disabled.apk`.
SHA-256 `4e225c4bdcf4993bb9038f0bdc38dab2b0597d97deda34110c59e8f66d2e1bbf`.
Package `com.dominaweb3.cmarket.c3candidate`, 0.1.0/code 1, signature v2 verified.
QA-only certificate SHA-256
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`;
NOT production approval. No installation or physical cold launch in this run.

Default no-feature SO unchanged: 692864 bytes, SHA-256
`d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1`.
IDL unchanged SHA-256
`7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb`.
Defaults restored after local feature build; unchanged bytes need no new rent
estimate. Separate local-cycle SO SHA-256
`b0eb7d7378f532f3850228fbb5af697d8eeba3dec2a292bb339dc47fc2157f9a`.
Old frozen local binary lacked renewal and was preserved before rebuilding the
local-only artifact, which is never a deployment candidate.

Previous candidate APK unchanged SHA-256
`2279f28ff2112b9c862ee42a119699a6e0224b51fa0535f7f4c35f26e3d8df00`.
Stable mobile/QA sources and protected worktrees untouched.

## Validation and separate review

- PG generation/race/owner tests 13/13: actual two-connection stale SERIALIZABLE
  snapshot, both signer/renewal orders, two generations, partial buy/sell, restart,
  owner/revision/old-signature rejection, history and uncertainty preservation.
- Existing PG quote/signer 2/2; economic recovery 1/1; focused route/lifecycle/
  effects/external signer/quorum 16/16; mobile 13/13; Rust vault 9/9.
- Service production boundary 4/4; program boundary 2/2. TypeScript, lint,
  formatting and default Anchor build passed.
- Android export/signed APK build passed. 662 mapped sources; zero experimental
  server/clone launcher/isolated signer modules. MWA may contain public Mainnet
  constants; do not claim zero Mainnet strings. Money gate remains false.
- Separate read-only agent review reproduced expiry-observation and null-signature
  defects; both corrected with regressions. It rechecked targeted source/in-memory
  behavior but did not independently rerun PG/the clone. **Not an external
  professional audit or governance approval.**
- Expo Doctor 17/19: remote React Native Directory response failed and Expo
  57.0.25 differs from recommended 57.0.26. No unrelated upgrade/suppression.
  Existing Anchor/Gradle, Node module-type and Metro export warnings remain.

## Remaining gate and next implementation

Mainnet, real Buy/Sell, fees and SKR remain disabled. Complete semantic two-RPC
promotion, production signer enrollment, mobile owner API/screens and physical
MWA verification before review/governance of an exact deployment package.
Owner inputs: reviewed RPC provider/operator metadata and server-side credentials,
signer public identity, actual governance/upgrade/pause/keeper authorities and
allowlisted wallet/budget. Inputs do not authorize deployment or fill code gaps.

Next: connect reviewed owner lifecycle API/client policy to candidate review and
recovery screens while preserving disabled Mainnet. `PHONE_REQUIRED_NEXT: NO`
for the incomplete monetary path.
