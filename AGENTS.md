# C Market workspace guidance

## Master product objective

The delivery objective is one functional, secure, verifiable C3 dApp for Android/Seeker before the hackathon deadline. All economic C3 implementation and acceptance work targets a controlled Solana Mainnet pilot with real assets. Devnet is not valid evidence of economic C3 settlement and may be used only for non-economic mobile, MWA, lifecycle, recovery, and regression checks. Do not lose time building parallel products before the real C3 vertical slice works end to end.

C3 is a tokenized Symmetry V3 vault with a fixed strategic allocation:

- 40% Bitcoin exposure.
- 30% Ethereum exposure.
- 30% Solana exposure.

The user buys, views, and sells a C3 position. The vault keeps the underlying assets; the user receives a C3 participation/share token and receives USDC after a confirmed sale. MWA only authorizes the user's wallet actions. C Market must never custody user private keys or sign on the user's behalf.

The canonical architecture is: Expo/React Native mobile app → MWA → C Market read/index/reconciliation backend → Jupiter allowed routes → Symmetry V3 vault and keeper → Solana base layer. Squads governs configuration, treasury, limits, and emergency controls.

The first release must focus on C3. C5, C10, Earn, MagicBlock, new reward systems, and extra chains are deferred until C3 purchase, NAV, activity, sale, USDC withdrawal, recovery, and security verification are complete.

Product direction recorded on 2026-09-20: the functional C3 target is a controlled Mainnet Symmetry V3 pooled vault using real USDC and independently revalidated BTC, ETH, and SOL representations. The controlled-pilot minimum purchase is exactly 1 USDC; every amount at or above that minimum receives C3 shares representing proportional exposure to the complete pooled vault. The immutable target is always 4,000 bps BTC, 3,000 bps ETH, and 3,000 bps SOL, regardless of purchase size. Never model a purchase as fixed dollar legs such as $0.40/$0.30/$0.30. Costs may be disproportionate at 1 USDC and must be disclosed, but they do not alter the target percentages. Mainnet public access remains disabled in current artifacts until a separate source-reviewed, allowlisted pilot release records Security and Squads approval.

## Canonical workspace

The canonical repository is `/Users/juantorres/Projects/cmarket-integration`.
The Seeker-tested historical workspace is `/Users/juantorres/Projects/c10-pocket`.
The current product is an Android Expo Router application under `apps/mobile`.

## Protected state

- Keep `main` and `migration/seeker-tested-app` stable unless a task explicitly authorizes a change.
- Preserve draft PR #1 and its reviewed commit relationship.
- Mainnet remains disabled and must not be enabled by environment values, routes, storage, or constructor arguments.
- Never force-push, rewrite history, rebase, squash historical work, or use destructive reset commands.

## Safe working rules

- Make small, reversible commits and validate before committing.
- Do not expose environment values, credentials, signing material, seed phrases, private keys, or tokens.
- Do not request wallet authorization or automatically sign, submit, reverse, or retry wallet transactions.
- Do not modify the historical `c10-pocket` source files when creating provenance records; Git tags and read-only inspection are allowed when explicitly requested.
- Keep Devnet behavior separate from Mainnet capability. Devnet is permitted only for non-economic mobile, MWA, lifecycle, recovery, and regression testing; do not build or present a Devnet basket as the C3 product.
- Prefer read-only checks before any external or repository mutation.

## Hackathon classification

Every task and commit must be classified as exactly one of:

- `SHARED`: common product, security, architecture, brand, truthful disclosure, or generic utility work.
- `CLOCKIN_ONLY`: Seeker, Android APK, Mobile Wallet Adapter UX, dApp Store, and CLOCK IN submission work.
- `WORLDSFAIR_ONLY`: index methodology, analytics, scalability, business model, and World’s Fair submission work.

Shared work is committed once on the shared branch and transferred through Git. Do not manually copy the same implementation between worktrees. Use `cherry-pick -x` only for an isolated historical fix that cannot be merged normally, and record the source SHA.

## Truthfulness and provenance

Disclose pre-existing code and concurrent hackathon development accurately. The World’s Fair boundary is `2026-09-14T13:00:00Z`. A retrospective tag created after that boundary must never be described as evidence that the tag existed before the event.

## C3 product workflow

The required user flow is:

1. Connect a compatible wallet through MWA.
2. Verify the exact cluster, wallet, USDC balance, and current C3 configuration.
3. Verify SKR eligibility only from official on-chain evidence when rewards are enabled.
4. Select a USDC purchase amount of at least 1 USDC.
5. Show NAV, share price, fee, slippage, minimum output, the immutable 40%/30%/30% target, current allocation, risks, and expected intent state.
6. Request an explicit wallet signature for the deposit.
7. Let Symmetry create the vault intent and issue proportional C3 shares. The least-privileged keeper may aggregate net flows and process permitted swaps/rebalancing for the pooled vault; it must not perform three micro-swaps for every individual deposit.
8. Reconcile the on-chain result before showing success.
9. Show the user's C3 position, NAV, composition, activity, and pending keeper state.
10. For a sale, request the user's explicit withdrawal authorization, liquidate the corresponding position, and return USDC only after on-chain confirmation.

“Automatic” means that a previously authorized intent can be processed by a constrained keeper. It never means hidden signing, hidden submission, unrestricted custody, or automatic reversal.

Required operation states:

```text
draft -> awaiting_wallet -> intent_submitted -> keeper_pending -> settled
```

Recovery states:

```text
cancelled | expired | failed_recoverable | manual_review | partially_completed
```

Every operation needs an immutable intent identifier, idempotency key, expiry, evidence, reconciliation, and duplicate-submit protection.

## Canonical C3 allocation and amount rules

- `BTC_TARGET_BPS = 4000`.
- `ETH_TARGET_BPS = 3000`.
- `SOL_TARGET_BPS = 3000`.
- `TOTAL_TARGET_BPS = 10000`.
- `MIN_PURCHASE_USDC = 1`.
- Reject any configuration whose target weights do not total exactly 10,000 bps.
- Reject any controlled-pilot purchase below 1 USDC.
- Use validated decimal strings and bigint-compatible integer arithmetic. Never use floating-point arithmetic for money, shares, NAV, fees, or allocation calculations.
- The target allocation and current allocation are distinct. The target is immutable; the current allocation may temporarily drift while a bounded authorized intent is pending.
- Rounding and dust handling must never change the canonical target weights.
- Dollar values may describe only the total purchase, total NAV, current derived asset values, fees, network costs, and total seed capital. Asset values must be derived at execution time from verified prices, vault balances, NAV, and the immutable basis-point target.
- A confirmed deposit issues C3 shares at independently reconciled NAV/share price. Underlying assets remain inside the Symmetry vault and are never delivered individually to the buyer.
- A sale redeems or burns the user's C3 shares and returns USDC only after verified vault accounting and finalized on-chain settlement.

## C3 user interface requirements

The first functional C3 release must include:

- C3 dashboard with NAV, TVL, target/actual allocation, freshness, and risk.
- Buy flow enforcing the 1 USDC minimum and showing USDC input, expected C3 shares, price, fees, slippage, and minimum received.
- Visible intent and keeper states; never hide asynchronous settlement.
- Sell flow showing C3 shares, estimated USDC, fees, liquidity, and settlement state.
- Activity screen with signatures, intents, rebalances, and correct Explorer links.
- MWA reconnect/reauthorize, wallet cancellation, wrong network, background/foreground, expired blockhash, RPC errors, and manual review states.
- English base copy with the existing localized UI preserved.

Do not display underlying BTC, ETH, or SOL as individually purchased user assets. Do not claim guaranteed yield, guaranteed returns, instant liquidity, or completed C3 allocation before evidence exists.
Do not display fixed per-purchase dollar allocations. Display the immutable percentage target separately from the vault's current derived values and allocation drift.

## SKR rewards guardrails

The proposed reward model is not active until its official mint, staking/delegation state, rules, fee policy, and authority are verified on-chain and approved by governance.

The proposed model is:

- checkpoint every 48 hours;
- 10 points for each 10 USDC active in C3;
- 1.10 activity multiplier when official SKR eligibility is proven;
- 50% C Market fee discount only when eligibility is proven;
- sale stops future accumulation from the next checkpoint;
- each wallet/C3/checkpoint/configuration tuple can be credited once.

Points must never alter C3 NAV, vault reserves, weights, or underlying assets. Each credit must record wallet, checkpoint, C3 position evidence, configuration version, SKR mint, and official on-chain eligibility evidence. A screenshot, client flag, or unauthenticated API response is not sufficient.

Product approved `c3-fees/product-candidate-v1` as the candidate C Market fee policy: 15 bps on buys, 15 bps on sells, and a 50% verified-SKR discount to 7.5 bps. This is not an active or governance-approved fee. Fee collection and the discount remain disabled until Security review and Squads governance approval are recorded. Historical proposals of 60 bps on deposits and 10 bps on withdrawals are obsolete provenance records; preserve them as obsolete and never implement or silently delete them.

## Mandatory implementation phases

### Phase 1 — foundations

- Revalidate final Mainnet USDC, BTC, ETH, SOL, Symmetry program, oracle, token-program, and C3 share-mint requirements from current official and on-chain evidence.
- Verify the Mainnet pooled-vault deposit, share issuance, redemption, intent, keeper, NAV, and withdrawal design without authorizing funds.
- Define share math, NAV, decimals, rounding, fees, slippage, and limits.
- Create versioned 4,000/3,000/3,000 configuration, 1 USDC minimum, threat model, and fail-closed readiness gate.

### Phase 2 — governance and security

- Create separate Squads governance, treasury, and emergency responsibilities where appropriate.
- Configure 2-of-3 approval, timelocks, limits, and emergency pause.
- Define keeper permissions, RPC providers, recovery, and incident runbooks.

### Phase 3 — isolated Mainnet implementation

- Implement the isolated builder, keeper, indexer, deposit, proportional share issuance, intent processing, pooled rebalance, NAV, sale, and USDC withdrawal paths with Mainnet disabled.
- Test duplicate submission, stale blockhash, RPC 429, wallet rejection, interruption, restart, partial completion, and keeper outage.
- Verify every claimed success from independently reconciled Solana state, not only a webhook, RPC assertion, or local state.

### Phase 4 — Seeker app

- Integrate MWA in an Expo Development Build.
- Implement C3 dashboard, buy, sell, activity, reauthorization, and lifecycle recovery.
- Use Mock MWA or Devnet only for non-economic UI/lifecycle regression. Test the real economic path only through the later allowlisted Mainnet pilot on a physical Seeker.

### Phase 5 — SKR rewards

- Verify official SKR eligibility on-chain.
- Implement checkpoint calculation and idempotent points.
- Implement the approved fee discount.
- Show evidence and rules in the app.

### Phase 6 — controlled Mainnet pilot and public gate

- Complete program, integration, dependency, and operational audits.
- Build a separate source-controlled Mainnet-capable artifact with public access disabled and explicit wallet allowlisting.
- Run supervised 1 USDC buy and sell acceptance tests with monitoring, pause tests, finalized reconciliation, and withdrawal recovery.
- Enable progressively and reversibly only after Security and Squads 2-of-3 governance approval; pilot success does not authorize public Mainnet access.

## Security boundaries

- No private keys, seed phrases, keeper keypairs, Squads keys, or privileged API keys in the APK, source repository, or client bundle.
- Pyth and Jupiter production credentials belong only in isolated keeper/builder services; keyless read-only quotes are not production authorization.
- MWA is authorization only; it is not custody.
- Symmetry owns the vault accounting and underlying-asset custody through its on-chain program.
- Jupiter supplies permitted quotes/routes; it is not vault authority.
- Backend stores only operational state, public metadata, deduplication records, and reconciled evidence.
- Keeper uses minimum privilege and cannot silently change weights, assets, receivers, or fees.
- Squads controls versioned configuration, treasury policies, limits, and emergency actions.
- Oracles require freshness, confidence, decimal, and circuit-breaker checks.
- RPC/webhooks are evidence sources; final success requires independent on-chain reconciliation.
- Never automatically retry an uncertain transaction, reverse a successful leg, delete a submitted signature, or report success without evidence.

## Scope exclusions until C3 is complete

Do not implement C5, C10, automatic Earn, an Earn Router, MagicBlock/Ephemeral Rollups, session keys with spend authority, internal custodial ledgers, or unverified SKR rewards before the C3 vertical slice is functional and tested.

## Workspace roles

- `/Users/juantorres/Projects/cmarket-integration`: canonical shared workspace.
- `/Users/juantorres/Projects/c10-pocket`: protected historical Seeker-tested source; never modify.
- `/Users/juantorres/Projects/cmarket-clockin`: protected stable CLOCK IN submission.
- `/Users/juantorres/Projects/cmarket-worldsfair`: protected World’s Fair submission.
- `/Users/juantorres/Projects/cmarket-mainnet-candidate`: read-only candidate; never treat it as a production release.
- `/Users/juantorres/Projects/cmarket-c3-app`: active C3 product worktree; economic product work targets the controlled Mainnet pilot only.

The stable Devnet CLOCK IN app, the read-only Mainnet candidate, and the future C3 production app must remain separately identifiable and separately buildable. Do not enable Mainnet in the stable Devnet release.

## Definition of done for a C3 milestone

A milestone is complete only when:

- the requested scope is implemented in the correct branch;
- TypeScript, lint, formatting, relevant tests, Expo Doctor, and Android validation are run;
- Devnet behavior remains unchanged unless explicitly authorized;
- wallet actions are supervised and no unauthorized signing/submission occurs;
- all amounts, mints, programs, authorities, destinations, and cluster values are validated;
- the immutable 4,000/3,000/3,000 target and 1 USDC minimum are enforced with integer arithmetic independently of purchase size;
- failure, retry, recovery, persistence, and duplicate-submit behavior are tested;
- no secrets or signing material are exposed;
- `git diff --check` and `git status` are clean before handoff;
- the commit and validation evidence are recorded truthfully.

## Focus rule

Before starting any task, ask:

> Does this directly help deliver a functional, safe, verifiable C3 purchase, dashboard, sale, USDC withdrawal, recovery path, or Seeker release before the deadline?

If not, defer it. Do not spend delivery time on C5, C10, speculative rewards, additional chains, or visual extras while the C3 vertical slice is incomplete.

## Mandatory execution report for the project manager

After every execution that inspects, changes, builds, tests, deploys, installs, or validates anything, the final response must include a detailed project-manager report. This report is mandatory even when the execution fails, is blocked, or makes no source-code changes.

The report must be written in clear Spanish unless the user explicitly requests another language. It must not assume that the project manager already knows the repository, previous phases, commands, acronyms, branches, protocols, or current status. Explain technical terms briefly when they affect a decision.

Every report must state:

1. The current project point: what C3 capability exists today and what capability does not exist yet.
2. The exact objective of the execution.
3. What was inspected, changed, built, tested, installed, deployed, or deliberately not executed.
4. The workspace, branch, commit, and worktree status used.
5. Files changed, files intentionally preserved, and whether any protected workspace was touched.
6. Validation performed, with a separate result for each relevant check.
7. Wallet, network, RPC, blockchain, or external-service actions. State explicitly whether authorization, signing, submission, transfer, deployment, or push occurred.
8. Security and product implications in plain language.
9. Errors, blockers, warnings, unverified assumptions, and their practical impact.
10. Decisions required from the project manager, if any, with the reason and available options.
11. The single recommended next action, including why it is the highest-priority step for the delivery deadline.

The report must distinguish clearly between:

- `COMPLETED`: verified and working in the stated environment.
- `PARTIALLY_COMPLETED`: some checks passed but required work remains.
- `BLOCKED`: progress cannot continue safely without a specific external condition or decision.
- `NOT_EXECUTED`: intentionally skipped because it was outside scope or unsafe.
- `UNVERIFIED`: claimed by documentation or configuration but not proven by the current execution.

Do not report a planned feature as implemented. Do not call a quote a purchase, a submitted intent a settled position, a webhook an on-chain confirmation, or a simulated asset a real C3 holding. Do not hide failures behind phrases such as “todo”, “pending” or “requires review”; explain what failed, why it matters, and what must happen next.

Use this report structure unless the user requests a different format:

```text
PROJECT MANAGER REPORT
Execution date:
Execution objective:
Classification:
Current project status:
Status of this execution:
Workspace and branch:
Commit and worktree:
Completed work:
Files changed:
Protected files/workspaces preserved:
Validation results:
Wallet/network/blockchain actions:
Security impact:
Product and hackathon impact:
Errors, blockers, warnings, and unverified items:
Decisions required:
Recommended next action:
```

If no decision is required, write `No decision required` explicitly. If no wallet or blockchain action occurred, write `No wallet authorization, signing, submission, transfer, or deployment occurred`. The report must be understandable on its own without relying on previous chat messages.
