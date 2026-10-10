# C3 Devnet evaluation — incomplete delivery

Checked 2026-10-10. Branch `delivery/c3-devnet-evaluation` only.
Mainnet and real funds remain disabled. This document is NOT a completed
hackathon acceptance record.

## Installed physical QA artifact

Current lifecycle candidate (not yet complete physical acceptance):

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
