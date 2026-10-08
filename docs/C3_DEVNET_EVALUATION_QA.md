# C3 Devnet evaluation — incomplete delivery

Checked 2026-10-08. Branch `delivery/c3-devnet-evaluation` only.
Mainnet and real funds remain disabled. This document is NOT a completed
hackathon acceptance record.

## Installed physical QA artifact

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

Official Devnet genesis verified. Deployer
`6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC` has zero Devnet SOL.
Program `2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg` and router
`F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7` are not deployed.
Current binary rent estimates require approximately 10.5 **free Devnet SOL**
for temporary deployment peak, persistent program accounts and operating
margin. This is not a request to buy/send real SOL. Faucet human verification
remains outstanding; no repeated 429 loop or CAPTCHA bypass is implemented.

Hosted PostgreSQL is reachable, with isolated private evaluation schema and
zero provisioned wallet vaults. The public site is
<https://cmarket-nine.vercel.app/> and correctly reports preparation rather
than a completed product. The new quote service/provider remain internal;
they have not been deployed as a working keeper.

Still to connect: program deployment; bounded test-mint/liquidity/faucet and
per-wallet vault provisioning; hosted plan/authorization/execution/recording
journals and finalized effect promotion; expired-operation renewal; mobile
deposit/share/redemption/claim/activity actions. `lifecycleReady` stays false.
No claim of simulated assets existing solely in PostgreSQL is permitted.

Final physical deposit → three TEST swaps → on-chain shares → restart → three
inverse swaps → burn → test-USDC claim is UNVERIFIED. Operation on an independent
network with the Mac disconnected is also UNVERIFIED. No final lifecycle video,
functional APK download or competition submission is published yet.

Expo Doctor: 18/19 checks; pinned Expo 57.0.26 versus recommended patch 57.0.27
remains a warning. The parent npm graph has build-tool advisories; those modules
were absent from the inspected Android release source map. This is not an
audit-clean claim and does not replace a protocol review.
