# C3 Devnet evaluation — physical lifecycle verified

Checked 2026-10-10. Branch `delivery/c3-devnet-evaluation` only.
Classification: CLOCKIN_ONLY. Mainnet and real funds remain disabled.
The current physical record below supersedes pending historical records;
test assets/router pricing are simulated, not real BTC/ETH or Jupiter liquidity.

## Installed physical QA artifact

### Current update: 10 October 2026, physical Phantom lifecycle PASS

The historical 0.1.4 records below remain provenance, not the current APK.
Current signed candidate is 0.1.14 / Android code 15, installed with a matching
certificate using `adb install -r`; cold launch without Metro passed.

- APK: `apps/c3-pilot/dist/devnet-evaluation-lifecycle-v15/c-market-c3-devnet-evaluation-0.1.14.apk`.
- SHA-256: `849cff1a4bb5ebf59391353e7c38f91c02c3f1c8e811856b9d9f0e663d438563`.
- Certificate unchanged: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
- Physical ownership-message verification passed, including server Ed25519 proof
  verification; connection alone was not counted as authentication.
- Physical wallet-specific provisioning finalized on Devnet:
  `3JW6feUeZCV19mJQCVN5tQvoqQhdVpwTsHNLVBjvk3XiMVjq93A5FHkiSugeLPzc7VrUYacTRcTRjfGcm7JELWvJ`.
- Earlier deposit packets were rejected before broadcast because Phantom added
  compute-budget instructions. Both budget instructions are now pinned before
  persistence/review/signing: 400,000 units and zero priority price. Exact signed
  message/signature checks remain mandatory. Reconciliation also validates both
  budget instruction bytes and rejects altered limits/fees.
- A subsequent first submission hit Android DNS failure on wallet return; no
  durable submitted signature was observed. Expired unsigned requests are closed
  through the original recovery operation, not resent.
- Version 0.1.14 probes only public HTTPS GET after signing and before its first
  POST; DNS recovery is limited to three probes with bounded waits. A failed or
  uncertain POST is never automatically retried. Signed packets remain only in
  memory; original expiry is not extended. New requests allow 90 seconds for
  biometric review/network return; plan expiry (110 seconds), blockheight, CAS,
  custody and signature checks remain enforced independently.
- Focused service tests: 13 passed. Focused mobile transport/review/proof tests:
  7 passed. TypeScript, targeted lint, signed Android build and signature checks
  passed. Physical acceptance was checked separately below, not inferred from
  these automated tests.

## Physical Seeker lifecycle — 0.1.14

Completed 2026-10-10 at approximately 20:07 UTC using Phantom/MWA on the Seeker,
the published APK, public HTTPS services and hosted PostgreSQL. No ephemeral
test-owner signer was substituted for the physical wallet approvals.

- Wallet: `DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej`.
- Durable intent: `12978439-d76d-48ac-8d94-4f22662a992d`.
- Wallet-specific vault: `26PpBqkxeQuwbV1zggfWKF4H5XMiYzm3Rh6U5YJziGfG`.
- Share mint: `B5rqJJVafEU13MFEzEnu4spVCoPnZZqW5Z5XMu4xp2rD`.
- Physical ownership-message verification: PASS; server Ed25519 verification.
- Buy inputs: 400,000 / 300,000 / 300,000 TEST USDC base units.
  Verified acquired TEST balances: 40,000 / 30,000 / 30,000 base units.
- Issued shares: 1,000,000 base units (1.000000). Force-stop/cold launch,
  reconnection, physical reauthentication and position query recovered the same
  shares/intent. Spanish selection persisted. One reauthentication was rejected;
  a later fresh message succeeded. No economic signature was retried.
- The sales consumed exactly those acquired TEST balances and returned
  396,000 / 297,000 / 297,000 TEST USDC base units.
- Burn/claim finalized: shares decreased from 1,000,000 to zero; owner TEST USDC
  increased from zero to 990,000 (0.99). Vault TEST USDC decreased to zero.
  This test-router outcome is not a promise to return 1 USDC or a real-world fee.
- All six legs are `confirmed` with finalized effect receipts. All four owner
  operations have semantic effect receipts. Activity physically displayed
  finalized-effects labels and Devnet Explorer links.
- Repeat claim is disabled by the recovered position/action policy. The focused
  backend regression rejects a redeemed position with `NOT_CLAIMABLE`; the
  earlier hosted technical cycle also rejected a second claim. No deliberately
  duplicated physical on-chain claim was broadcast.
- Four-language navigation remains from prior physical QA, with no locale code
  changes. No new lifecycle video or pitch was created; the owner handles those.
- Independent-network check: Mac Wi-Fi was verified OFF during a fresh APK
  hosted-backend diagnostic. The APK returned “Base de datos alojada y Solana
  Devnet accesibles” before Mac Wi-Fi was restored. No Metro listener or ADB
  reverse mapping was present; USB was used only for screen/input QA.
- A display-only backend correction subtracts finalized `usdc_returned` from
  historical `usdc_claimable`. Redeemed positions show zero available to claim,
  while preserving the historical 0.99 TEST USDC entitlement/receipt on-chain.
  Transaction instructions, signatures, permissions and claim semantics did
  not change; no new APK was needed for this response-only correction.
  After a new physical message-only authentication, the installed 0.1.14 APK
  queried the updated hosted service and displayed 0.000000 shares, 0.000000
  available to claim and 0.990000 already returned. No further transaction ran.

Official `https://api.devnet.solana.com` independently returned `finalized`,
`err: null` for all ten economic signatures. The claim's parsed token deltas
independently verified the share burn and 0.99 TEST USDC receipt.
Explorer URL for every signature is `https://explorer.solana.com/tx/<signature>?cluster=devnet`.

| Operation          | Finalized signature                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Deposit            | `5BpfgMpA9Z2og8Bi7VUDwZyfLwhoYTAQu6XTYHiD7yErgmJg5QvEWsGushB4LyDAjNwZR8A4C4hsxyzkc3vh8RgU` |
| Buy TEST BTC       | `2WDD329GtU2yeJXpU9jKkW5HxXGiiWvG6c1GWPeM2TbXgcuoDXdYavHGpUBM5s34KyPUtHWY8t1ixwAyFUGiuD3E` |
| Buy TEST ETH       | `3ibLGNzHsztRsUWzmDbCinL9kFJ74DD6x14rTsQdFee7BMGYQr9qgepJCezP4rK4qediNLYfLQ1pWjc7Th9eqBDN` |
| Buy TEST SOL       | `5B22JK82yaaasLPRvwoCjKmrpuptnvt9dx9itRrCffUz2uZVDiPtukUt3t8FhCMhEnTpPTwGmWrDoQCEYs9XRjBx` |
| Issue shares       | `5zRpxjwSFgtpj47MckHjWxgTyvRELGxnVyQFqeEuHuKaosC458B1XcjzkuoQJFAsdFsvrkMEq5DokgHqVsCc87sy` |
| Request redemption | `4qoFeX13Rv5xHLnbur9HqC3wP87V5cpTfFM7YSER1vS7CXkNPqyPT5sTyPLkfUL3J5QMvyBW3m1cfHMKTUxpnAaw` |
| Sell TEST BTC      | `258MpuQsowTweiAFvtfnk64tCWM5HHTtCFSns3iuQwXosw4LjuAggFE9QGp1uocjZvHu6WD1UrUFJRoKoP2jU5GZ` |
| Sell TEST ETH      | `5MiBktmSnAaRh6a57FZ12kCffYTjYWeX26yMXyjPFhsMgzQRb4foxJ7SekkgehmeBBY6LPr96LotpBPREy3JLriJ` |
| Sell TEST SOL      | `5x73Ye7qo6zVmyowGWGQxPsYfATMpHJrocCzMKo7Hrg8kz69hbRx1zMkPosgwFFha27J56oLxBztoXrvqQDefKcH` |
| Burn and claim     | `3wKYHfRWH9n21R29gDKEmdgvksetA4RVDiMziJaCPhmkfEtJZMNFxPioZqo5UqbQHr3wDw3pSNhjnrkxRW1Ayk7H` |

## Historical preparation records (superseded, retained for provenance)

Historical lifecycle candidate (physical acceptance was pending at this stage):

- C Market Devnet 0.1.4, version code 5; same evaluation package below.
- APK: `apps/c3-pilot/dist/devnet-evaluation-lifecycle-v5/c-market-c3-devnet-evaluation-0.1.4.apk`.
- SHA-256: `1fda6bfde22e74eb9e661aa8e0932fc69b139ddc83873b44033075004c46f743`.
- Certificate SHA-256: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
- The installed previous certificate was independently inspected and matched.
  Update used `adb install -r`, without uninstalling or clearing data.
- Cold launch succeeded without Metro listening on port 8081. Permanent test
  token/liquidity disclosure and Mainnet-disabled notice were observed.
- Phantom chooser and return with a connected wallet were observed on Seeker.
  Authentication message signature and the full transaction cycle remain
  unverified until the owner performs the separate physical approvals.

Previous artifact (preserved, not replaced on disk):

- C Market Devnet 0.1.1, Android version code 2.
- Package: `com.dominaweb3.cmarket.c3evaluation` (separate from stable apps).
- APK: `apps/c3-pilot/dist/devnet-evaluation-auth-qa-v2/c-market-c3-devnet-auth-qa-0.1.1.apk`.
- SHA-256: `c90a77d48b5d35dd81a736da5349b5af694291dab5f75cc49602da6493af3e13`.
- Certificate SHA-256: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
- Signed APK verified and installed with data-preserving `adb install -r`.
  No stable app was uninstalled or replaced. Previous APKs remain preserved.
- Cold launch without Metro, Home/Indices/Activity, four languages, persisted
  language and hosted health were checked on Seeker. Observed Phantom connection
  and return to the app; wallet address is masked in app screenshots.
- Physical message signature is NOT yet verified. Connection is not a signature.
  The app presents a separate explanation and human approval for the bounded
  message beginning `C Market Devnet evaluation wallet proof v1`.
- No wallet transaction was requested, approved or sent. This APK has connection
  and authentication QA only. It is not a functional buy/sell C3 delivery.

## Backend work verified in isolation

The evaluation compiler now rejects missing or unexpected IDL argument names.
The record instruction binds the actual `settlement_id`, not an absent argument
silently encoded as a zero array.

Finalized account decoding, route derivation and unsigned v0 compilation cover
six deterministic TEST legs. Sizes are 483 bytes for plan creation, 1,088 for
quote authorization, 754 for execution and 443 for recording. Signers are
separated governance/keeper identities, not the user's wallet. The 300-byte
quote binds custody, mint, source, destination, amounts, minima, revision,
ordered metas, expiry and policy. No ALT is used by this test router.

The internal quote service loads its authenticated wallet and actual plan
context from the server, not from client economic fields. PostgreSQL stores
the immutable authorization before dispatch; the quote provider commits its
signature before returning. Existing append-only signing journals preserve
results, including a lost response. Read-only lookup cannot re-sign.

Validation: TypeScript, lint and formatting passed; 17 focused service tests,
two mobile protocol tests and the PostgreSQL suite passed (four reported tests,
including two imported account-fixture tests; not four independent database tests).
The PostgreSQL suite uses a disposable database, Borsh account fixtures and
an ephemeral quote key. It is NOT a validator, acquisition, Devnet settlement
or physical MWA signature test. Hostile custody/policy, stale revisions,
tampering, concurrency and reply-loss/restart were exercised.

## External state and unfinished links

Official Devnet genesis verified. The faucet funding was independently checked
by finalized RPC: the deployer had 13 free Devnet SOL before deployment.
Both programs are now executable, owned by the upgradeable loader, with the
expected evaluation upgrade authority and exact binary bytes:

- Vault: `2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg`.
  Binary SHA-256: `26ab2530ed0d986e6f938cae9253312727226dadee9774b01584dc567729261a`.
  Finalized deployment: <https://explorer.solana.com/tx/583mrfQjUQv69dM1XAUtvfLLvFSQwnete8St16mhsmfM3cF26sMwyLJsK4Ums1GWt2azvmqocC7DN44MVN3aLcjQ?cluster=devnet>.
- Test router: `F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7`.
  Binary SHA-256: `5ce781e0ac62380da84233765586a8bb1c54478d700ec45451d9c9608bf39473`.
  Finalized deployment: <https://explorer.solana.com/tx/uqQjBk5hbUisbWuTkHcoo7jwktrB1hJEZgdsJNgxvKUbNTMwJ2W3Gay9xwF5gkTCMx3kztp38YcdFTPMSQfQppn?cluster=devnet>.

Initial RPC-buffer writing hit rate limits. The same public buffer was inspected
and resumed using TPU transport; no duplicate buffer rent was funded, and no
Mainnet transaction or real-money expense occurred. Program deployment is not
evidence of completed shares, allocation or redemption.

Hosted PostgreSQL is reachable, with isolated private evaluation schema and
one provisioned technical evaluation wallet vault (not physical Phantom QA). The public site is
<https://cmarket-nine.vercel.app/> and correctly reports preparation rather
than a completed product. Provisioning and settlement services are now hosted;
their complete lifecycle is still under test, not yet delivery acceptance.

Confirmed technical progress: program deployment, four separately labelled test
mints, bounded test-router liquidity, per-wallet vault provisioning, a finalized
1-test-USDC deposit, explicit owner plan recovery and renewal, and finalized quote
authorization. These use the same hosted services and PostgreSQL journals as the
APK. The evaluation-only runtime gate is released; the public health acceptance
flag remains false. Mainnet remains disabled.

The public RPC returned HTTP 429 during the first attempt. Original signatures
were preserved and reconciled, not resent. A shared server transport now spaces
requests and never retries sends. Quote preparation/signing uses one private
server-owned finalized snapshot and retains CAS/expiry checks. Existing signed
operations go directly to reconciliation; no signer is called again. Expired
plans require explicit authenticated owner renewal, retaining history, minima,
inventory and signatures. The new private append-only expiry records are protected
by RLS and immutability triggers. Disposable PostgreSQL tests and fixture tests
are not presented as chain execution or physical wallet acceptance.

## Hosted technical cycle: PASS, not physical MWA acceptance

Completed at 2026-10-10T14:31:06Z using the existing evaluation test identity,
the public HTTPS backend, private PostgreSQL journals and actual Devnet programs.
There was no local validator or simulated database-only balance. The assets and
router pricing are explicitly tests, not real BTC/ETH or Jupiter liquidity.

Official Devnet RPC independently returned finalized, error-free status for
all ten economic transactions below. The hosted semantic verifier checked their
effects before advancing durable state. Explorer links use `?cluster=devnet`.

| Operation          | Finalized signature                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Deposit            | `aBv1YjhWYSEA7w1RfrahSWiGRmBiab3ykHAE7xrj2DggNyHLuoQHNahkFWoVwx4t85uj6FxEV4EbZR7J5ftKCKf`  |
| Buy TEST BTC       | `RDdmf35HcK41NBBueYwh8JwCSvsLm2cZ6gBGerjRURAxhZ1tdksibXD3oberruByhq9SfFKxY9eCFqkLgjq4r6B`  |
| Buy TEST ETH       | `weDx4oypoChgE16hP8XwP1uj7ZLaoLuYS5Tts69nSh9Qy8qapyKo271tk2fDXEnbyCXyPD348dF1tmU4MLKj8JX`  |
| Buy TEST SOL       | `35jLVganiuAWcXhoZdnJDxwX9PLuqaXHRdSeM6KWEoxUtovvTDHjFif9JPffs47WmRWXZaVhAgX9JbckdSrv2LmB` |
| Issue shares       | `zKGxH62vVnikDCNSxXLDSH6cdMrB6auUpacaYNC9ZB7uAmKgARPjSGRWfkocdF9PZP6afvtUsXvaa2ExLiyrfjk`  |
| Request redemption | `4zMxQhpKMZrS1RQoVkkyXRmNr1cqcPVn7u1xDKhp9D6e7wcpRBs3j3SZ1pMnGGF5kKF7ykkJXYp9MgvE2vSCegMh` |
| Sell TEST BTC      | `5da3PKp5Fj1VFFAZBKeKQSDS1377mGaXkbMd6JMVGSZtg9bxaQCifiEY9KQbjbGTxzydnHJPqHoFYGfbtDrXHPZp` |
| Sell TEST ETH      | `5yj9DTBdzJxRL67r77if8XPAuuPsh9t88fDMamePjPqpYjY3Fx689JuYtZFeUeEoNvErd8tQf9R3i5hyNqgAgPiT` |
| Sell TEST SOL      | `62YzHpc45RM49MtNuyxm42pQk99Fio8kXdZiSjXyK7MuSTfada3awLjDHEQqRMqvSaThfLgYJAHfDek1SomptrWb` |
| Burn and claim     | `2k2vpBPuJnV5EKHDoMPAkRkyS2SNuUx5aoLsMjwiWV9p3KA7Ruk8opZbwgX9JkLJJX1Sde5CVJCsE2K5CjPoL4EK` |

The vault's acquired test inventory was 40,000 / 30,000 / 30,000 base units;
the sales used those same acquired balances. Shares were 1,000,000 base units
while active and zero after burn. Final vault inventory is zero in all four
accounts. Actual returned test USDC is 990,000 base units (0.99), not a promise
to repay 1 USDC. Preparing another claim was rejected.

Restart recovery resumed the same durable intent, with original signatures and
history retained. The final absent authorization signature was NOT resent:
finalized blockhash/height barriers, exact remaining plan inventory and an
explicit test-owner renewal preceded a new generation. Historical failed and
expired attempts remain visible; they are not counted as successful swaps.
Physical restart and cancellation are still separate pending acceptance checks.

Evaluation quote slot ceiling is 128 slots while its time ceiling remains 30
seconds. The previous 60-slot ceiling expired after 16 seconds at observed
Devnet slot cadence. Tests retain both ceilings, registry/plan expiry and CAS.
The funded plan's current verified expiry controls continuation; the original
intent enrollment expiry remains immutable in PostgreSQL.

The complete physical Phantom cycle remains unverified.
No claim of simulated assets existing solely in PostgreSQL is permitted.

Final physical deposit → three TEST swaps → on-chain shares → restart → three
inverse swaps → burn → test-USDC claim is UNVERIFIED. Operation on an independent
network with the Mac disconnected is also UNVERIFIED. No final lifecycle video
or competition submission is published. The signed 0.1.4 supervised candidate,
SHA-256 and truthful pitch PDF are now published at
<https://cmarket-nine.vercel.app/>; downloading it does not certify physical
acceptance. The public APK bytes were downloaded and their hash matched the
installed candidate's expected hash. The pitch PDF's public bytes also matched.

On 10 October ADB again detected the authorized Seeker. Version 0.1.4/code 5
was already installed, so no reinstall or data wipe was needed. Cold launch
without Metro and Phantom connection/return were observed. The owner reported
accidentally cancelling authentication; a new message-only request was prepared.
The database still contained zero verified proofs for this physical wallet at
the check. Cancellation is not counted as successful signing or a payment.
No physical deposit or other monetary approval has been requested in this check.

Publication uses only the existing free Vercel project, not a paid service or
custom domain mutation. The official CLOCK IN portal URL was reached, but the
text fetch exposed no closing time. Deadline timezone and submission availability
remain unverified; no closing hour is inferred.

Expo Doctor: 18/19 checks; pinned Expo 57.0.26 versus recommended patch 57.0.27
remains a warning. The parent npm graph has build-tool advisories; those modules
were absent from the inspected Android release source map. This is not an
audit-clean claim and does not replace a protocol review.

## 11 October 2026 — purchase action and result visibility

Classification: CLOCKIN_ONLY. Version 0.1.23/code 24 moves the existing
state-authorized action above the composition. It does not enable another
deposit after lifetime redemption. Active/redemption states show verified C3
shares; claim and completed states show reconciled test-USDC amounts with units.
All four locales explain that synthetic Devnet holdings have no real market
value; shares are not dollars and no real NAV or profit is inferred.

APK: `apps/c3-pilot/dist/devnet-evaluation-ui-v24/c-market-c3-devnet-evaluation-0.1.23.apk`.
SHA-256: `5fcb1e21128c58ce256037104c72a32dd6d0a825f45a59aa0461efac52ea4bfe`.
Certificate SHA-256: `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
Installed certificate matched; installation preserved data. ADB cold launch
with no Metro listener and Indices navigation passed on Seeker. The visible
disconnected state displayed the purchase/manage heading and connect button.
Connected position/result rendering was not physically reverified in this run;
no authentication, deposit, sale or claim was requested.

TypeScript, lint, formatting, eight focused Indices tests and signed Android
release build passed. Tests verified unchanged reviewed wallet/payment/recovery
controller AST hashes. Expo Doctor remains 18/19: installed Expo 57.0.26 versus
recommended patch 57.0.27. Mainnet, backend transaction logic and protected
workspaces were unchanged. APK publication on the website was not performed
in this visual change; installation and local artifact are the new version.

## 11 October 2026 — historical purchase and explicit trading availability

Classification: CLOCKIN_ONLY; scope PARTIALLY_COMPLETED. Backend position now
returns historical deposit and issued shares from the finalized owner/vault-bound
DepositIntent, checked against VaultConfig issuance. These are separate from
the current share balance. Activity and Indices retain the historical purchase
after burn. Indices renders Buy and Sell explicitly, enabled only by the
existing reviewed lifecycle controls. No new monetary action was performed.

Official Devnet read-only snapshot at finalized slot 509975891 for the connected
evaluation wallet verified lifecycle 4, deposited 1000000 base units, historically
issued shares 1000000, current shares 0 and returned test USDC 990000. This is
an account-state check, not a new physical wallet or purchase test.

APK 0.1.24/code 25: `apps/c3-pilot/dist/devnet-evaluation-ui-v25/c-market-c3-devnet-evaluation-0.1.24.apk`.
SHA-256: `4ab62764b98fd14eea9e0d91a29b8791365b6e61cba3ab2bd9c66d3b88fd40ea`.
Certificate matches the preserved QA certificate. Installed with data-preserving
update. Standalone cold launch and Indices navigation showed both trading
buttons and availability explanation in the disconnected state. Connected
historical presentation requires reconnect/authentication and was not physically
verified in this execution. No Metro listener was present.

Backend deployment `dpl_ApLVeYY6SwC3foRnAtmqpaGa7gDN` is READY at the existing
`https://cmarket-nine.vercel.app`; health confirms database and Devnet, Mainnet
false. Server bundle isolation passed. Mobile TypeScript/lint and 16 focused
tests passed; service TypeScript/focused lint and 12 focused account/effect/history
tests passed. Formatting and signed release build passed. No program or database
schema was changed, and no blockchain transaction was signed or submitted.

The owner authorized repeat Devnet evaluations with separate vaults. This is
NOT implemented or enabled by this change. Exact remaining code boundary:
`InitializeVault` in `instructions.rs` accepts only owner-derived vault and
authority seeds; `constants.rs::vault_seed/authority_seed` have no round identifier.
The deployed program cannot initialize a second vault for the same wallet.
The durable database also has a wallet primary key in wallet_vaults and a unique
lifetime-wallet intent index. The next implementation must add compatible
round-scoped program accounts and append-only enrollment/session/intent selection,
then test replay/concurrency and deploy only the reviewed Devnet artifact.
Do not reset the old vault, erase signatures, reuse its burned shares, or claim
that visible disabled buttons make repeat purchases functional.

## 11 October 2026 — variable purchases and separate evaluation vaults

Classification: CLOCKIN_ONLY. The prior exact-one-unit/lifetime-wallet
restriction above is historical. This update permits 1–200 test USDC with six
decimals in rounds 2–10, one active position at a time and one position per
vault. Round 1 remains byte-compatible and restricted to its original limit.
Each new trial requires explicit action after finalized redemption; previous
vaults, shares, signatures and journal generations remain immutable.

Devnet vault upgrade finalized at slot 510026902, signature
`2t2gzkVmAKdcXhFCkzvtGpLGoLa3CpcWBzSHPErGDmMAdo6sjspkSP3Uo2mZ3SnACCLwGTMo46mZh6ZeWWWzZHds`.
Program `2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg` has verified
928400-byte code SHA-256
`a582571274157d7486e69a8bc89fd36abdc40fb52bf7430f28115343d885a703`;
existing allocation padding remains zero. Test router and Mainnet artifacts
were not upgraded. Migrations 0005/0006 preserve private row-level security,
append-only round enrollment and explicit, bounded expired-empty-vault recovery.
The same immutable recovery journal supports an explicitly requested replacement
of a missing vault ATA during setup only: original signature absent, finalized
blockhash expired, target ATA absent, vault not yet initialized, exact derived
ATA instruction and at most three generations. Funded/initialized vaults, token
minting and arbitrary instructions cannot use this setup-only recovery.

### Hosted technical acceptance, not physical MWA acceptance

The existing separate evaluation identity completed a second vault through the
same HTTPS preparation, signing journals, reconciliation and PostgreSQL used
by the APK. This is actual Devnet custody/shares/transactions with simulated
test assets and liquidity, not real BTC/ETH/SOL acquisition or Jupiter swaps.
The owner Phantom private key was never loaded by the technical script.

Vault `6tKv2mjsLtWuxirSmfap35dZgxdf5CK1bovSkhuCnPn3`, round 2:

| Verified action                        | Devnet signature                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Deposit 100 test USDC                  | `5FSz3ab4WWC1wGsPmKfhzKjPQSZnLv3XiBE12gdVGi7RoBNGNnqdukbh3jpEfGooBz9AtECacgiXWVDbV53wWhUT` |
| BTC test buy                           | `rFKxnyzjE8CviU8NYWJ1rWDbDrB8xz1uGnh27CFUUvpFCEtzSLZGWEVFgrp7sJa8t858QTZCEVuVk75GQvc4F5f`  |
| ETH test buy                           | `3F4zwGfhohhWBdSBhjzgN6s1eLYgkiWyVYgLCdN9dENRdPx35GqtKi9UNzRdYDtPLAq7LhGLhsZNV429sLaAz9mH` |
| SOL test buy                           | `3SPPAYsJBjyiY122zzCirzeXgw54ksSx8Q2L76xoYb1LDJGqSpkYBFKzrh4S917YeZQgTRo8tHBgNUZMM9qNfXxP` |
| Issue 100 C3 shares                    | `BMmo2wKcgA2Eph9XV6DCAPaoRPmkpaEJtPsrnPmBKhqEUNeiGMnST78692Hf5XDksjQM9ncjTaMk8PAsv3gcHLS`  |
| Request full sale                      | `5EwsJU48e54trJCrEdAPL84F9VJA2JS4wkHFnmkWu9uEWSmPh8AAUrYrY3ykKabVajUy8UGcHkFTj7oVd61hjN8q` |
| BTC test sale                          | `5yxmCiFkxvHF7p6DNeHpyKRyA4nWbGcF29KVmW9dMbRkHGX1jKT19VT14rXeUwrZMoAgGXw3exHFUSNs5bZafE8Q` |
| ETH test sale                          | `4NmVQKGa7UxsX6vufKRr7u81TFjjZEEQ5r1icxqEcEzaGyBC62bZdxAvgQb3wQfimYZzgyUwuLkAr9cZJfEWeGL`  |
| SOL test sale                          | `3ThMcuTrJYTW537iGo4XmY2wLeB4VR1bsvRZsYya7seEL5Upfj8o96KGdwAVDwYgXSXDjsD7iQCYrDWg1YTPr3S8` |
| Burn 100 shares and claim 99 test USDC | `3urvoYBoMDjSaRJMkWPo7BPom1tMAtDCLc3DoL15qFHrZe7qeNr7jCqDNjj7a57F6yPU6kzbktyWD67bju5W73sd` |

All listed economic effects were verified before promotion; a second claim
was rejected. Previous round-1 receipts remained visible. Missing/expired
service signatures were preserved, reconciled and explicitly renewed without
repeating the deposit or successful legs. Restart after share issuance
reconciled the original signature; it did not mint another set of shares.
The public RPC did not record several accepted requests; the exact transport
cause is unproven. The app retains uncertain states and requires explicit
renewal rather than silently resending. The 30-second signed quote policy and
minimum output safeguards remain enforced.

The live informational reference at 21:46:05Z was 99.642540 USD for the
100-unit illustration, using Coinbase Exchange BTC/USD, ETH/USD and SOL/USD
40/30/30 returns from closed pre-deposit candles. At sale it froze at
99.644243 USD. Actual redeemable proceeds were separately 99 test USDC.
Neither reference value authorized a transaction or changed shares/proceeds.
Missing or stale prices display unavailable, never an invented monetary NAV.

### Android artifact and physical scope

APK 0.1.27/code 28: `apps/c3-pilot/dist/devnet-evaluation-variable-v28/c-market-c3-devnet-evaluation-0.1.27.apk`.
SHA-256 `ad2a2c278aa87d218a594d9b6ace5820030502144bb1f21b4ca89a61785c6ae5`.
Certificate SHA-256 `58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
Installed with data-preserving update on Seeker; stable app unchanged. Cold
launch, navigation, balances, historical results and Phantom connection/owner
proof were observed. The new variable purchase/sale cycle from physical
Phantom is still unverified; technical signing is not a substitute.
Published at the existing website; downloaded APK hash independently matches.
The physical wallet's second round was requested from the APK, but one setup
ATA creation did not arrive on Devnet. Its original signature remains stored.
The explicit setup recovery above is implemented and adversarially tested;
physical continuation additionally needs telephone Internet restored. The APK
reported `EVAL_AUTH_CHALLENGE_REQUEST_NETWORK_DNS_ERROR` when resolving its
hosted authentication endpoint. No variable purchase was signed by Phantom in
this execution. Reconnect, verify ownership and explicitly resume New purchase;
do not treat the server test identity's 100-unit cycle as the user's purchase.

Validation: Devnet Rust 13 tests/default Rust 12 tests passed; service/mobile
TypeScript, targeted effect/custody/renewal/price/amount tests, changed-file lint,
formatting, signed Android build and bundle boundary checks passed. Expo
Doctor retains the existing 18/19 patch-version warning (57.0.26 versus
57.0.27); dependencies were not upgraded. Shared Mainnet share-layout checks
retain their default one-unit cap; only validated evaluation calls supply the
bounded variable cap. Mainnet remains disabled; no real funds were used.

## Amount-first position and larger evaluation units — 12 October 2026 UTC

APK 0.1.28 / version code 29 is signed with the existing compatible certificate,
installed with data-preserving `adb install -r`, and cold-launched without Metro.
SHA-256: `55f60e06b21bf9ba852af15613e3c907866d827dfe7198729ea0c993e8bb2148`.
Home and Indices now prioritize My C3 basket, deposited test USDC, illustrative
current USD reference and actual realized test proceeds. Technical share-token
details are in a closed accordion, not the primary position metric. Sold/burned
positions never display a nonzero current holding. Buy guides prerequisites or
a new vault; Sell remains gated by confirmed shares and unresolved requests.

Observed on the Seeker: wallet DEHxW5…YLVsej has an active 10-unit test deposit,
displayed USD reference 10.0242 at 2026-10-12T00:48:23Z, and an enabled green
Sell C3 button. Official finalized Devnet account inspection independently
confirmed the wallet-bound vault `BkQTwkkrffmLh8vzS1ayhzTWSjdBhCLyjTpCPyARu6tN`,
lifecycle 2, 10,000,000 issued base units and matching on-chain share supply.
No sale of this user's basket was initiated by this execution. This is observed
position/display evidence, not a claim that this execution performed its
physical purchase. Phone DNS access is restored; the previous DNS blocker is
historical, not the current result.

New evaluation vaults admit 1–1,000,000 test units with checked six-decimal
integers. Existing 1/200-unit vault limits, intents, signatures and histories
remain unchanged. The server returns the actual on-chain vault cap; both its
cap and the wallet balance still bound approval. The new fixed million-unit
faucet and pool grants have distinct immutable journal identities, not renamed
or reused 200-unit receipts. There remains one active basket per wallet and
ten distinct lifetime vault rounds. Additional pooled deposits are not enabled.

Evaluation program upgrade finalized at slot 510091010, signature
`3CyR41EgtBGEtQbTEg9Dc4jjecb3pgs1EnS68JE4Ux84g5aWTSka5bNpixnPYtvrZYXZ1iT449RGsam9dkdDCBud`.
Binary size 928424 bytes, SHA-256
`a9940b85a2ab60ea923ac2cfc421cc24eea497a8a8b74b9773043a9574460b44`.
Complete deployed bytes and zero padding were verified. The previous short
temporary buffer was closed to refund evaluation SOL, and bounded journaled
writes repaired the replacement buffer before upgrading. An initial RPC 429
stopped that attempt; no user assets or Mainnet material were involved.

Focused mobile tests (20), evaluation effect/renewal/history tests (19), other
focused service tests (12), Devnet Rust (13) and default Rust (12) pass, as do
TypeScript, changed-file lint, formatting and Android release build/signature.
Structural tests do not substitute for physical wallet signing. Expo Doctor
reports 17/19: existing Expo patch mismatch and an external Directory lookup
failure. No dependency upgrades or advisory suppression were performed.
The market reference remains informational, not monetary NAV or a redeemable
dollar entitlement; real-market prices do not make these Devnet assets real.

### Maximum-unit technical lifecycle: PASS (not physical MWA)

Using the same hosted compiler, PostgreSQL journals, signers and reconciliation
as the APK, the separate evaluation identity completed vault round 3
`8NLEJeq9pSsnFjHdBoRtS4fsLGczHDqVUMZX5Yo5JaZA`: 1,000,000 test USDC deposited,
three test buys, 1,000,000 on-chain share units issued, three test sales, full
burn and 990,000 actual test USDC claimed. Current shares are zero. All ten
economic signatures were independently checked finalized through official
Devnet RPC; duplicate claim was rejected. The active illustrative reference
was 998,717.129310 USD in one observation, NOT the 990,000 test-USDC claim.

Receipts (each Explorer URL must use `?cluster=devnet`):

- Deposit: `p7zvydjjqF6iQTPciS5eCEAs6GCiSMtvBz99uBHL1ciDriub2zHvqgRnX3Czx5kXi4GXdroaDEhihGGUzZgoF8M`.
- BTC test buy: `65Gwk8EwYpZZ48o9VsKEdfTSb8cr24BmJxKsR7PKzsTYLcBCrTBSPYRfhctnAgrQjGp27aRJkbVijxKL5JJa7rnH`.
- ETH test buy: `5YCZgb6aq2SCjmax8KqFPCNhmbheDamxDy2dXBzUja8hkTsgey9J8UdAMq2qDe1HQVAXSQ8x97GfYPRx5XJEjLuE`.
- SOL test buy: `GYJDtVLTLzhiyGPE3gyQPn26rKheCqUbaTDK4dPaaMVeykwjuKpGraPJBnWonVgVFT1dYX3aiz174VKBqh5x5CY`.
- Issuance: `27swWX6uyL3cJbzBx91DgrK7E7YWAaHXR3AbWg3FoLP9R43F4RZ4qKPRf5yUwbfWbfwnuDAiD9s3oJFH5mCXT11x`.
- Sale request: `5pzsPZVdCbv4fuPHBFkffQoNWHx5stMvt2nxDgaNv6WvBHBZuJYCM3C4DyTEjH8ybqzfmoBgVB84U9QpNrcuPjuG`.
- BTC test sale: `2RNtD6gtd2LQSJj3N2StVjiptZWvJiTLRtqDfAzsZzY5qvxS7RNGuMkGtSHJQ6BonRfN2AJSCt58tkvS4PGvjno9`.
- ETH test sale: `66sYyA2qG1UiF6cK7Wn5PSmnZWc29LaKy1PqmjZa6yv2B8X1QM5iBjaY4dJjyGXfiqCoE3YN7E3D82Hwyh1zpf8v`.
- SOL test sale: `2a9nQ8QgzLRsyJNiQP4tAQHcV9NHNjAjCTskpB9CvTakQ4xsj8BYapZ5T32aVWK7kAM7oBMbn16KU52tTiddTC7C`.
- Burn/claim: `5FHsyLbBiPSCvycoorT2zBfLNg5efwo8gV58FnRvpynRxppbpwMJSCrkb3QvKhtFSAxmdxBSxarFfA9qeEkECgdu`.

Transient uncertain execution responses reconciled the SAME stored signatures,
not replacements. The first technical provisioning driver stopped at its old
15-request boundary; its report is preserved and continuation used the existing
durable setup receipts. The driver now has a bounded 32-request bootstrap;
the APK's existing 80-request boundary was not changed. An earlier pre-promotion
request correctly rejected the new binary with `EVAL_PROVISION_PROGRAM_BINARY`.
These are honest stop/recovery records, not failed deposits hidden as success.
The maximum-unit journey was NOT signed through physical Phantom; the owner's
10-unit active basket was not sold or changed by this technical test.

## 12 October 2026 — basket performance display, APK 0.1.29

Classification: CLOCKIN_ONLY. Display-only improvement from commit
`d023a16f5ba641e49d636bc315051a3aae6f14df`. Home and Indices reuse the same
position component: deposited test USDC, verified deposit date, illustrative
current USD value, signed amount and percentage change. Positive, negative and
zero changes have green/red/neutral styling AND localized directional text.
All four existing locales are covered. Percentage uses checked bigint arithmetic,
relative to the deposited amount; nonzero changes below 0.01% retain their sign
and a less-than label. The existing read-only query refreshes every 60 seconds
while foregrounded and not processing an operation. No polling, wallet,
ownership verification, transaction controller, backend, program or signing
behavior changed. Missing, contradictory or stale reference evidence is not
displayed as current performance; the reference remains frozen at a sale request.

This is **informational simulated performance**, not a live monetary NAV,
investment gain/loss or redemption entitlement. Deposit basis remains the last
closed 60-second BTC/ETH/SOL candle before the reconciled deposit. Actual sales
pay only finalized, reconciled test USDC, independently of the displayed USD
estimate. Mainnet remains disabled.

Validation: ten focused reference/position/variable-purchase tests PASS;
TypeScript, lint, changed-file formatting, Android production export and signed
release build PASS. React review: no wallet/HTTP callbacks were added to the
display component; labels do not rely solely on color; the existing timer cleans
up on unmount. Expo Doctor 18/19: existing Expo 57.0.26 versus expected
57.0.27 patch mismatch, not suppressed or upgraded in a display-only task.

APK: `c-market-c3-devnet-evaluation-0.1.29.apk`, version code 30, package
`com.dominaweb3.cmarket.c3evaluation`, launcher label `C Market`.
SHA-256: `99f2ec56df4581d7eaff67fa404af61d73435941bfab6f97c0051f58071d3168`.
Certificate SHA-256:
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
The installed prior APK certificate was independently compared; `adb install -r`
succeeded without uninstalling or clearing data. Seeker cold launch without a
Metro listener and Home-to-Indices navigation PASS. Following cold launch the
wallet is disconnected; **authenticated physical performance display remains
pending** the owner's normal connection and ownership-verification flow. No
physical signature, buy, sale, claim or blockchain transaction was performed.
Unit tests cover both directions, zero, small changes, million-unit bounds,
stale reference rejection and frozen sale state; these do not substitute for
the pending authenticated visual check.

Published in the existing free Vercel project only. Staged health reports
`VERIFIED_DEVNET`, `SCHEMA_PRESENT`, `mainnetEnabled:false`; staged APK download
and SHA match the signed local artifact. Public download:
<https://cmarket-nine.vercel.app/downloads/c-market-c3-devnet-evaluation-0.1.29.apk>.
Prior APKs and all historical economic receipts are preserved. No monetary
cycle was repeated for this visual change.

## 12 October 2026 — compact Home and wallet balances, APK 0.1.30

Classification: CLOCKIN_ONLY. Starting commit
`4f970123508702a782e43d6fd94d959b70cf76a4`. The supplied design describes Home,
although the accompanying message names Indices; clarification was requested.
This implementation applies the explicitly specified Home layout and preserves
Indices and Activity. It does not implement a variable market-linked redemption.

Home alone has a compact brand header, permanent localized
"Demo Devnet · No real money" strip, two-line introduction and a smaller
40/30/30 C3 card with one primary navigation button. Explanations share one
container with five initially closed, flat accordion rows; only one may remain
open, including the separate coming-soon row. Pending operation hints still use
the original wallet-scoped state and navigation. Positions and market-reference
performance remain in Indices rather than overcrowding the explanatory Home.
SOL/evaluation-USDC balances and their original refresh action are available in
the shared wallet menu. The former Home balance cards are removed; Indices
retains its original cards. No mint, RPC, amount, accounting or processing changed.
The FAQ preserves the actual ten separate per-wallet vault rounds after finalized
redemption; it does not copy the obsolete instruction requiring a different wallet.
All copy has English/Spanish/Simplified-Chinese/Brazilian-Portuguese translations.
Approved images are reused, not redesigned. No dependency was added.

Validation: 37 focused mobile tests, TypeScript, lint, formatting, Android export,
signed release build and diff checks PASS. Eleven authentication/wallet/operation
controller initializers independently compared against starting HEAD have
identical canonical TypeScript AST output. Services, contracts, wallet/protocol
modules and Indices/Activity source are unchanged. React review confirms local
accordion state, accessible expanded states, text scaling, default-compatible
shared components and no monetary callbacks on expansion or navigation.
Expo Doctor remains 18/19: existing Expo 57.0.26 versus expected 57.0.27 mismatch.

APK `c-market-c3-devnet-evaluation-0.1.30.apk`, version code 31, package
`com.dominaweb3.cmarket.c3evaluation`, display name `C Market`.
SHA-256: `70bdfd3d87afd08bc4399c7f4844b3ff3edb743adfcb4bc166e3354feaa88bbc`.
Certificate SHA-256:
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
The actual installed previous certificate matched before data-preserving
`adb install -r`. Prior APKs were not overwritten. Seeker cold launch without
Metro, Spanish Home, expanded getting-started text, mutual exclusion when opening
another information row, wallet-menu opening, and Devnet balance rendering PASS.
The wallet was connected with ownership pending; no authentication or transaction
signature was requested or approved by the agent. Physical four-language review
was interrupted when a different app became foreground; UI interaction stopped.
Do not infer full physical multilingual acceptance from the locale unit tests.
No new blockchain cycle, deployment, funds transfer, service publication or push
was performed for this visual change; Mainnet remains disabled.

The requested market-linked test-USDC reserve remains **NOT IMPLEMENTED**.
Existing sale output and minimum in `evaluation-route.ts` and
`evaluation-settlement-client.ts` use the deterministic test ratio. The market
reference is deliberately excluded from quote and monetary authorization. Merely
holding or issuing more test USDC does not change redemption entitlement. A
separate, explicitly agreed Devnet-only policy must bind fresh market evidence,
sale plan, signed outputs/minima and actual reconciled reserve transfers, preserve
historical floors and uncertain signatures, and define both losses and gains.
Always paying more would not reproduce market performance. No client display
value or unauthenticated request was promoted into a payable amount.

## 12 October 2026 — compact Indices, APK 0.1.31

Classification: CLOCKIN_ONLY. Starting HEAD
`a4120c2c046246a4c10f6b69d6e43122b88fda4c`. Interface/copy only; no blockchain
cycle, program upgrade, backend change, wallet signature or monetary operation.
Home and Activity components remain unchanged. Indices now uses the same compact
header/Devnet strip as Home; general balances remain only in the shared wallet
menu, with their existing queries and refresh action.

C3 composition appears first with smaller approved icons and an exact 40/30/30
bar. One owned position summary separates deposited test USDC, verified C3
shares, pending issuance, actual sale proceeds and available claim. Missing or
wrong-wallet evidence never becomes zero. Decimal/group formatting uses bigint
and retains six-decimal precision without converting money to Number. A single
primary action dispatches to the existing reviewed controller: connect, verify,
prepare, buy, issue, continue, sell, claim, activity or next trial. Uncertain
operations, recovery, renewal, errors and Activity remain visible before details.
Verified current vault minimum/maximum/balance/round determine displayed limits;
legacy caps are preserved. The unchanged ten-round review limit is factored into
a shared constant, not duplicated or increased. Round ten or missing repetition
evidence shows Activity instead of advertising a new trial.

Market value remains informational and is separate from deposit/shares/proceeds.
Unavailable reference evidence yields one secondary line, not a large empty
valuation panel. Existing freshness, frozen sale reference, percentage arithmetic
and red/green/neutral performance remain unchanged. Details open in the same
single-expanded-section state as the flat About C3 rows. Oversized educational
artwork is no longer rendered but its original asset is preserved. Four-language
copy is concise; upcoming C5/C10/C20/C50 and ten global markets remain informational.
Europe is a region, and market names switch to one column with larger text/small
screens. No dependencies were added or upgraded.

Validation: 43 focused tests PASS, including scoped positions, missing shares,
legacy/million caps, round-ten behavior, exact large numbers and source-derived
primary labels/click guards in all four locales. Those inert presentation fixtures
are not native-device rendering or physical wallet acceptance. Eleven original
authentication/wallet/operation controller initializers are identical after
canonical TypeScript AST comparison. TypeScript, lint (no errors or warnings),
formatting, Android production export, signed build and diff checks PASS.
Expo Doctor remains 18/19: existing Expo 57.0.26 versus expected 57.0.27 mismatch.

APK `c-market-c3-devnet-evaluation-0.1.31.apk`, version code 32, package
`com.dominaweb3.cmarket.c3evaluation`, launcher name `C Market`.
SHA-256: `a204c5427485589a3a206f2f99de8794adde450e458d801dd4cb00a936080e95`.
Certificate SHA-256:
`58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016`.
The actual installed previous certificate matched; data-preserving installation
PASS without uninstall. All prior APKs preserved. Seeker cold launch without
Metro, Home-to-Indices navigation, Spanish/English rendering, one connect action,
no fictitious position values, composition expansion and wallet-menu/language
opening PASS. After the update no authenticated wallet position was present;
active/claim/completed layouts are covered by automated fixtures, not claimed as
physical acceptance. Phone focus subsequently changed to another application;
interaction stopped without reading unrelated UI. Physical Chinese/Portuguese,
authenticated-position review and restoration of the original Spanish selection
remain pending. The owner was asked only to keep C Market foreground, not to sign.

Mainnet and real funds stay disabled. Custody, transaction construction, signatures,
claim accounting, replay/recovery, current configurations and historical receipts
are unchanged. This version does not implement market-linked test-USDC payouts.
No service publication, deployment, paid action, signing-material change or push.

## 2026-10-11 — Restore available balances and confirmed settlement continuity

Classification: CLOCKIN_ONLY. Started from clean delivery/c3-devnet-evaluation
at 2eff65c540622807aca5a4558c53402bc57aeacf; prior local visual commits and
all previous APKs preserved. No changes to programs, backend, dependency versions,
Mainnet candidates, custody, transaction encoding or signing implementation.

Read-only diagnosis, not an executed sale: the authenticated Seeker screen showed
10 deposited test USDC, 10 C3 shares, "Venta en curso", renewal and an uncertain
status. Official finalized Devnet RPC independently decoded round-two redemption
FUCkeCSnFWvcbjMJ6Ld9ru8Q1by3kjAFG2bZZejMaGyw at slot 510139387: status 2,
share_amount 10000000, usdc_claimable 0, usdc_returned 0. Its settlement plan
7ZcpMfY8rq4tYhYkVhnZZtgtUZBFWCVn35hLLJ3dbguX, revision 2, was expired
at observation. Neither a completed sale nor received funds were demonstrated.
Recovery requires explicit owner-approved renewal; hiding this position or
inventing a wallet credit would be incorrect.

SOL and the single configured evaluation-USDC balance are restored once above
all three tabs, with existing token icons and Devnet labels. Finalized RPC reads
refresh on foreground, every 30 seconds while active, after economic position
changes, and manually. Missing or contradictory data stays unavailable, not zero.
Position polling now refreshes every 15 seconds and on foreground. Effect cleanup
and stale-wallet guards remain. SOL is not assumed to increase on sale.

After deposit, sale-request or renewal effects are reconciled by the hosted
service, the same bounded settlement controller continues the authorized trial
until an explicit owner action (issuance/claim), uncertainty, failure or limit.
It does not sign another owner packet, start another purchase, renew automatically,
retry a failed request or resubmit an uncertain owner signature. Claim still
atomically burns all shares and transfers only actual claimable test USDC.
Completed-position copy is distinguished from an active sale; Activity receipts
and original recovery signatures remain intact.

Purchase amount remains selectable within current on-chain cap and actual balance,
with an issuance estimate reflecting the existing test-only one-share-per-deposited-
USDC rule. Full-sale quantity is shown explicitly. Partial redemption is NOT
implemented: deployed create_redemption_intent requires shares == total_shares_issued
and claim_usdc requires the full owner balance and mint supply. Owner was asked
whether to authorize a separately reviewed Devnet contract/backend extension;
no amount slider, changed custody model or unsupported partial success was added.

Validation: 49 focused mobile tests PASS; TypeScript, lint, formatting, Android
production export, signed build and diff checks PASS. Six new tests exercise
bounded continuation, original uncertain/failed operations, expiry, restart,
wrong scope, explicit claim boundary and the actual source-derived owner-action
continuation guard with inert adapters. These tests are NOT physical signing or
a new on-chain sale. Original connection, refresh, account verification, recovery
and unit-display controllers retain their canonical AST hashes. The deliberately
changed settlement controller has dedicated behavioral tests rather than a new
unexplained snapshot hash. Expo Doctor: existing 18/19 patch-version mismatch
(Expo 57.0.26 installed; 57.0.27 expected), not suppressed or upgraded here.

APK 0.1.32 / version code 33:
apps/c3-pilot/dist/devnet-evaluation-balances-sale-v33/c-market-c3-devnet-evaluation-0.1.32.apk.
SHA-256: 6312be9865e998b8616e484eb5407fa2ff3660a34aa667d3304e6d1325d29577.
Certificate SHA-256: 58f880e44f7e9e28d3f4b4a5d5def9291b0244a1672eef9bcd4f5d745ec54016.
Actual previous installed certificate matched. adb install -r PASS, no uninstall
or data deletion. Device package version 0.1.32/code33 verified. Cold launch
without a Metro listener PASS; Spanish Home shows the restored balance area and
unchanged discovery/navigation. Physical Home → Indices → Activity → Home
navigation PASS, with the balance area visible in every tab in disconnected
state. This is not evidence of authenticated RPC amounts. Authentication is in memory, so the owner was
asked to reconnect for actual-wallet balance review. Authenticated physical
balance, renewal/claim and full-sale acceptance remain pending; no wallet
authorization or chain transaction was performed during this execution.

React review: one shared visible balance component, scoped refresh dependencies,
foreground-only polling, listener/timer cleanup, localized exact integer values
and explicit accessible recovery actions; no new UI framework or network provider.
No publication or push; Mainnet remains disabled. This is not a partial-redemption
release or a claim that the user's pending sale has been completed.
