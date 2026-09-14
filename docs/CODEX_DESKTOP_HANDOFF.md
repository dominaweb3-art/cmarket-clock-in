# C Market — Codex Desktop Handoff and Migration Brief

Date: 2026-09-14  
Project: C Market  
Hackathon target: Solana Mobile CLOCK IN

## 1. Purpose

This document gives Codex Desktop the complete context required to continue the C Market project without losing the current implementation, product decisions, hackathon requirements, or pending work.

All application-facing UI, repository documentation, demo materials, and submission materials must be written in English.

## 2. Product mission

C Market is a Solana Mobile dApp for Seeker users. It lets a user connect a mobile wallet, review a crypto-market basket, and buy exposure to a defined basket through a clear mobile-first experience.

The product must be presented as a transparent crypto basket prototype. It must not promise guaranteed returns, risk-free performance, or guaranteed profits.

The immediate hackathon goal is a polished, honest, working Android application with:

- A strong Seeker-first user experience.
- Mobile Wallet Adapter integration.
- A meaningful Solana transaction.
- A verifiable Devnet demo.
- A public GitHub repository.
- A signed Android APK.
- A concise demo video and pitch deck.
- Clear separation between working prototype features and planned production features.

## 3. Repositories and local paths

GitHub repository:

- Repository: https://github.com/dominaweb3-art/cmarket-clock-in
- SSH remote: git@github.com:dominaweb3-art/cmarket-clock-in.git
- Owner: dominaweb3-art
- Default branch: main

Seeker-tested local source:

- Local repository: /Users/juantorres/Projects/c10-pocket
- Current branch: cmarket-seeker-prototype
- Latest local commit: 9676c08
- Commit message: Sync Seeker-tested C Market prototype

The local repository contains the implementation tested on a Solana Seeker device. Treat it as the source of truth for the working wallet and purchase flow until the code is inspected and reconciled with GitHub main.

## 4. Important Git history warning

The local repository and the GitHub repository were initialized independently. Their histories must not be assumed to be directly compatible.

Never:

- Force-push the local branch to main.
- Run git reset --hard.
- Delete the original local repository.
- Replace GitHub main without reviewing its existing files.
- Blindly overwrite the GitHub documentation foundation.

Preferred approach:

1. Preserve the original local repository.
2. Open or copy it as a separate local project in Codex Desktop.
3. Work on a feature branch.
4. Compare the local Seeker-tested implementation with GitHub main.
5. Create a reviewed branch and pull request.
6. Merge only after the project builds and runs successfully.

## 5. Verified current functionality

The following flow has been tested on a Solana Seeker device:

1. The app launches through an Expo development build.
2. The user connects Phantom through Mobile Wallet Adapter.
3. The app reads the Devnet USDC balance.
4. The user selects a purchase amount.
5. The user approves the transaction in Phantom.
6. The app sends USDC on Solana Devnet to the configured C3 treasury.
7. The transaction is confirmed.
8. The app displays the transaction signature.

Verified transaction:

- Network: Solana Devnet
- Asset: USDC
- Amount: 5 USDC
- Explorer: https://explorer.solana.com/tx/4GNY8qQT6gPVKx1JHZUekfxyxjXHnWskeaBUy2RoRgvUvuH5jaNdnxcCKtHWqbHh4EkKLvmyZSu2Ssni44iPWTGk?cluster=devnet

Preserve this working purchase flow while reconciling the codebase.

## 6. Local files to inspect first

Inspect these files before changing architecture:

- app/(tabs)/account/buy.tsx
- app/(tabs)/account/index.tsx
- app/(tabs)/account/_layout.tsx
- app/(tabs)/_layout.tsx
- app/_layout.tsx
- components/account/account-feature.tsx
- components/account/account-ui-balance.tsx
- components/account/account-ui-token-accounts.tsx
- components/account/account-ui-usdc-balance.tsx
- components/account/use-get-usdc-balance.tsx
- components/app-providers.tsx
- components/auth/auth-provider.tsx
- package.json
- package-lock.json
- README.md

Verify before changing:

- The selected chain is solana:devnet.
- The RPC endpoint is the Devnet endpoint.
- The application identity has the app name and an absolute URI.
- The transaction flow uses the wallet adapter correctly.
- The USDC mint and treasury address are Devnet-only configuration.
- No private keys, seed phrases, or secrets are in source control.

## 7. Product truth

C3 is the current working prototype basket.

The intended C3 composition discussed during product design is:

- SOL: 50%
- USDC: 30%
- JitoSOL: 20%

However, the verified transaction currently sends USDC to the treasury. It does not yet prove that the treasury automatically performs the final C3 allocation.

Therefore:

- Do not describe the basket as automatically allocated unless allocation is implemented and verified.
- Use wording such as C3 purchase prototype or payment recorded for the C3 basket until settlement is real.
- If allocation remains pending, show that state clearly in the interface and documentation.
- Keep C10 and other baskets disabled or clearly marked as planned until implemented.
- Do not show completed distribution if only the treasury payment occurred.

This honesty is required for product trust, security, and hackathon credibility.

## 8. Migration plan to Codex Desktop

The destination folder path has not been provided yet. Represent it as:

<NEW_CODEX_FOLDER_PATH>

Do not delete the original folder.

If the new folder is empty, copy the current repository while preserving Git history:

    rsync -a --exclude node_modules --exclude .expo --exclude .DS_Store /Users/juantorres/Projects/c10-pocket/ <NEW_CODEX_FOLDER_PATH>/

Then inspect the new folder:

    cd <NEW_CODEX_FOLDER_PATH>
    git status
    git branch --show-current
    git log --oneline -5
    git remote -v

If the destination already contains another repository or files, do not overwrite them. Compare both folders first and report possible conflicts.

Codex Desktop must:

1. Inspect the original repository and the destination folder.
2. Confirm which folder contains the Seeker-tested code.
3. Copy the project without deleting either folder.
4. Preserve the .git directory and current branch.
5. Report every file that would be overwritten before doing so.
6. Run Git status after copying.
7. Avoid installing dependencies or modifying source code until the copy is verified.

Keep the original folder as a rollback copy until the new folder builds and runs successfully.

## 9. First Codex Desktop prompt

Use this prompt after opening the new local project:

You are taking over the C Market Solana Mobile project. Read this document first, then read README.md and the relevant files under docs/. Inspect the current Git branch, Git status, package configuration, Expo configuration, Solana Mobile Wallet Adapter setup, Devnet configuration, and the working purchase flow. Preserve the existing Seeker-tested wallet connection and 5 USDC Devnet transaction. Do not reset, delete, force-push, or overwrite main. Before editing code, report the current state, identify differences between the local implementation and GitHub main, and propose the next smallest safe task. All application and repository text must remain in English.

## 10. Recommended execution roadmap

### Phase 1 — Safe synchronization

- Confirm the new local folder contains the Seeker-tested source.
- Confirm the branch is cmarket-seeker-prototype.
- Confirm the working tree and commit history.
- Connect GitHub through Codex Desktop or the configured Git credential method.
- Push the feature branch only.
- Review the branch on GitHub.
- Create a pull request instead of force-pushing main.

### Phase 2 — Reconcile the codebase

- Compare the local implementation with the GitHub mobile foundation.
- Keep the strongest working implementation.
- Preserve the English README and hackathon documentation.
- Avoid duplicate app structures.
- Establish one canonical mobile app entry point.
- Update the README with actual build and demo instructions.
- Add AGENTS.md if Codex-specific project rules are useful.

### Phase 3 — Polish the purchase experience

Implement and verify:

- Wallet connection and reconnection.
- Devnet network visibility.
- USDC balance display.
- Amount validation.
- Insufficient USDC handling.
- Insufficient SOL fee handling.
- Wallet rejection handling.
- RPC failure handling.
- Double-submit prevention.
- Transaction confirmation state.
- Explorer link.
- Copy-signature action.
- Receipt with amount, network, destination, timestamp, and status.
- Activity history for successful and failed attempts.

### Phase 4 — Implement or explicitly scope basket settlement

Choose one honest path:

1. Implement a verifiable Devnet settlement flow that actually performs the planned C3 allocation; or
2. Keep the prototype limited to treasury payment and clearly label allocation as pending.

Before implementing settlement, define:

- Who signs the settlement transaction.
- Whether the flow is non-custodial or treasury-controlled.
- How SOL, USDC, and JitoSOL are acquired.
- How slippage and transaction failure are handled.
- How the app verifies final token balances.
- How users inspect each transaction.
- How production security differs from the Devnet demo.

Do not implement an unsafe custodial flow merely to make the interface appear complete.

### Phase 5 — Seeker UX

- Use a clear mobile-first hierarchy.
- Keep the primary action obvious.
- Use English copy consistently.
- Add loading, success, pending, and error states.
- Make wallet and transaction status understandable to non-technical judges.
- Test on the actual Seeker device.
- Capture a short demo path that can be repeated reliably.

### Phase 6 — Security and release

- Remove all secrets from source control.
- Add or verify .env.example without real values.
- Confirm Devnet configuration is explicit.
- Run dependency and type checks.
- Build a signed Android release APK.
- Test installation on a clean Seeker device.
- Verify the app does not depend on Metro or localhost.
- Prepare a reproducible release checklist.

### Phase 7 — Hackathon submission

Prepare:

- Public GitHub repository.
- Signed Android APK.
- Demo video.
- Pitch deck.
- Product description.
- Architecture summary.
- Compliance checklist.
- Security statement.
- Devnet transaction evidence.
- Clear statement of what is live, simulated, or planned.

## 11. Official references

Solana Mobile:

- Overview: https://docs.solanamobile.com/get-started/overview
- React Native quickstart: https://docs.solanamobile.com/get-started/react-native/quickstart
- React Native installation: https://docs.solanamobile.com/get-started/react-native/installation
- Mobile Wallet Adapter: https://docs.solanamobile.com/solana-mobile-stack/mobile-wallet-adapter
- dApp Store introduction: https://docs.solanamobile.com/dapp-store/intro
- Build and sign an APK: https://docs.solanamobile.com/dapp-store/build-and-sign-an-apk
- Submit a new app: https://docs.solanamobile.com/dapp-store/submit-new-app
- Publisher policy: https://docs.solanamobile.com/dapp-store/publisher-policy

CLOCK IN:

- Official announcement: https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon
- Official terms: https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf
- Registration and submission portal: https://solanamobile.radiant.nexus/
- Solana Mobile Discord: https://discord.gg/solanamobile

Always re-check the official terms immediately before submission.

## 12. Git and security rules

Never commit:

- Seed phrases.
- Private keys.
- Wallet JSON files.
- Real API keys.
- Production RPC secrets.
- Authentication tokens.
- Real .env files.

Never run:

    git reset --hard
    git push --force
    rm -rf /Users/juantorres/Projects/c10-pocket

Use normal feature branches and pull requests.

The local GitHub SSH authorization was being configured when this handoff was prepared. If Codex Desktop can connect GitHub through its integrated authentication, use that method. Otherwise, finish adding the local public SSH key to the dominaweb3-art GitHub account before pushing.

## 13. Definition of success

The project is ready for hackathon submission when:

- The app installs as a signed Android APK.
- It works on a Seeker device without Metro or localhost.
- Phantom and Mobile Wallet Adapter connect reliably.
- The purchase flow is understandable and repeatable.
- A Devnet transaction is confirmed and inspectable.
- The UI does not claim an allocation that has not occurred.
- The GitHub repository is public and reproducible.
- The demo video shows the complete user journey.
- The pitch explains the problem, C Market solution, Solana integration, Seeker advantage, and next steps.
- The repository contains no secrets.
- The final hackathon rules have been reviewed again.

## 14. Immediate next action

Do not continue changing the SSH setup inside the browser chat yet.

Open the new local folder in Codex Desktop, attach or add the original folder if needed, and ask Codex Desktop to inspect both folders using the first prompt in this document.

The first task is synchronization and verification, not new feature development.
