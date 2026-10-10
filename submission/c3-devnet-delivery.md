# C Market C3 - Devnet evaluation delivery

Classification: CLOCKIN_ONLY. Checked 10 October 2026.
Status: technical hosted cycle passed; physical Phantom lifecycle pending.
Do not submit this draft until the owner approves and missing evidence is filled.

## Exact candidate

Site: https://cmarket-nine.vercel.app/
Source branch: https://github.com/dominaweb3-art/cmarket-clock-in/tree/delivery/c3-devnet-evaluation
APK: C Market Devnet 0.1.4 / code 5, package `com.dominaweb3.cmarket.c3evaluation`.
SHA-256: `1fda6bfde22e74eb9e661aa8e0932fc69b139ddc83873b44033075004c46f743`.
Certificate SHA-256: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
No private signing material is included. Stable apps remain separate.

## Judge instructions

1. Download the signed evaluation APK, compare its SHA-256, install it and open
   it without Metro. Use a compatible Android wallet such as Phantom.
2. Select Home, connect the wallet and verify ownership. The first approval is
   a message only: `C Market Devnet evaluation wallet proof v1`. It cannot spend.
3. Provision the evaluation wallet's vault and free test tokens. Only Devnet is
   allowed; never send real funds. Provisioning and processing are bounded hosted
   requests with durable PostgreSQL state, not a Mac process.
4. Review the exact 1-test-USDC deposit and approve it in Phantom. Continue the
   hosted test allocation until all three effects are verified, then explicitly
   approve issuance of the on-chain test shares.
5. Restart, reconnect and verify ownership; query the position and activity.
6. Explicitly approve redemption. Continue the three test sales, then review
   and approve burn/claim. Display only the USDC actually returned after verified
   effects. The technical test returned 0.99 test USDC, not guaranteed principal.
7. If a result is uncertain, reconcile the original signature. Do not prepare
   another operation or resend. If the plan expires, explicitly review renewal;
   existing minima, inventory, history and signatures are preserved.

One lifetime position per wallet-specific vault. The hosted free evaluation is
bounded to 50 provisioned wallets. Additional deposits are rejected.

## Three-minute recording script - not a completed video

- 0:00-0:20: show Seeker and permanent Devnet/test-liquidity banner. Say:
  "This is an on-chain product evaluation, not an investment or real BTC/ETH."
- 0:20-0:45: connect Phantom, authenticate and show the four languages. Do not
  record private wallet screens, seed phrases, other assets or authentication tokens.
- 0:45-1:30: show test provisioning, reviewed deposit, three confirmed allocation
  legs and actual share balance. Briefly cut to Explorer with Devnet visible.
- 1:30-1:50: restart the APK; recover the same wallet's position and activity.
- 1:50-2:35: show redemption, three confirmed sales, burn and actual test-USDC
  receipt. Waiting may be trimmed with an explicit "confirmation wait shortened"
  caption; do not fake a different transaction or an instant/atomic result.
- 2:35-3:00: show durable history and duplicate-claim protection. Say:
  "Jupiter executions on cloned accounts are separate technical evidence.
  Mainnet remains disabled. This recording uses a Devnet test router."

Do not replace the pending physical recording with the technical test-key run.
The technical evidence is in `docs/C3_DEVNET_EVALUATION_QA.md`.

## Ready-to-copy submission draft

Project: C Market C3.
Description: Android/Seeker vault evaluation with MWA authorization, program-held
test assets, 40/30/30 allocation, on-chain non-transferable shares, durable
activity, explicit redemption and realized test-USDC claim. English, Spanish,
Simplified Chinese and Brazilian Portuguese UI. All evaluation assets and swaps
are simulated; on-chain operations and signatures are genuine Solana Devnet.
Mainnet is disabled. This is not an audited production investment product.
Stack: React Native/Expo, Solana Mobile Wallet Adapter, Anchor/SPL Token,
PostgreSQL, HTTPS hosted services and a bounded test router.
Pre-existing work: Seeker-tested Devnet treasury payment and shared repository
history predate this evaluation. A treasury payment is not C3 share acquisition.
Website, source and artifact identifiers: see above; public links must be checked
again immediately before submission.

Owner must complete: team/project registration details, participant names and
contact, final video URL, physical acceptance evidence and any portal-specific
fields. Deadline/portal closure is unverified; do not invent a closing time.
No form has been submitted. Owner approval is mandatory.
