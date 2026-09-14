# CLOCK IN Hackathon Compliance Matrix

This document maps the current C Market project against the official CLOCK IN terms. It is an internal delivery checklist, not legal advice.

The official terms control if any promotional page, repository note, or summary conflicts with them.

## Official references

- [Official CLOCK IN website](https://solanamobile.radiant.nexus/)
- [Official terms and conditions](https://solanamobile.radiant.nexus/legal/clock-in-terms.pdf)
- Organizer contact: hackathon@radiant.nexus

## Requirement matrix

| Requirement | Current status | Evidence or owner action |
| --- | --- | --- |
| Participant is at least 18 and legally able to participate | Participant confirmation required | Confirm truthfully during registration and any finalist verification. |
| Eligible country and sanctions compliance | Participant confirmation required | Confirm against the current official terms and provide accurate information if requested. |
| One accurate registration and one final team roster | Pending final submission | Do not use duplicate identities or registrations. Freeze the team roster at submission. |
| Project age satisfies the three-month rule | Participant confirmation required | Preserve dated development evidence. Confirm the project start date against the official launch date. |
| Significant mobile-specific development | In progress | Keep the Seeker/Android flow, Mobile Wallet Adapter integration, and mobile UX visible in the code and demo. |
| Functional Android APK | Not complete | Build, sign, install, and test a release APK on the Seeker before submission. |
| Solana Mobile Stack integration | Partially verified | Mobile Wallet Adapter is used in the current prototype. Document the exact package versions and integration path. |
| Meaningful Solana network interaction | Demonstrated on Devnet | The prototype reads Devnet USDC balance, requests wallet approval, sends a transaction, confirms it, and exposes Explorer verification. |
| GitHub repository with source code | Foundation created; source import pending | Import the complete Expo/React Native source before submission. |
| Demo video | Not complete | Record the exact flow in docs/DEMO_RUNBOOK.md. |
| Pitch deck or brief presentation | Not complete | Follow docs/PITCH_OUTLINE.md. |
| No malware or intentionally harmful code | Required before release | Review dependencies, permissions, wallet flow, and build artifacts. |
| Intellectual-property rights | Participant confirmation required | Use only code, assets, fonts, and media that the team has the right to submit. |
| No prohibited funding issue for a USDC prize | Participant confirmation required | Disclose funding truthfully if requested. Do not assume eligibility. |
| Finalist KYC/AML and sanctions screening | Future organizer process | Every person listed on the final roster must be prepared to complete required verification. |
| Nominated prize wallet | Not applicable until requested | If selected, provide an accurate compatible wallet address through the official process. |
| Mainnet safety and financial claims | Not ready | Keep the project on Devnet for the hackathon prototype and avoid guarantees or investment language. |

## Judging strategy

The official terms describe four equally weighted judging dimensions.

### 1. Stickiness and product-market fit

Show why a Seeker user would return:

- Browse multiple basket sizes.
- Understand the basket methodology at a glance.
- Review activity and previous confirmations.
- See transparent composition changes.
- Use the app as a repeatable mobile utility rather than a one-time transaction screen.

### 2. User experience

The final demo should show:

- A fast first-run experience.
- A clear connect-wallet path.
- A readable purchase summary.
- A visible network label.
- A deliberate approval step.
- Helpful errors and recovery actions.
- A transaction receipt with Explorer verification.

### 3. Innovation and X-Factor

The product story should emphasize:

- Basket discovery instead of a single isolated token interaction.
- A methodology that can scale from C3 to larger baskets.
- A mobile-native experience for Seeker users.
- Transparent, verifiable settlement rather than opaque backend bookkeeping.

Do not claim that an allocation or settlement mechanism exists until the code and on-chain evidence support that claim.

### 4. Presentation and demo

The video should be short and evidence-based:

1. State the user problem.
2. Show the basket selection.
3. Connect the mobile wallet.
4. Review the transaction.
5. Approve in the wallet.
6. Show the confirmed transaction.
7. Explain what is implemented and what is still being hardened.

## Submission gate

C Market is not submission-ready until all of these are true:

- [ ] Complete source code is in this repository.
- [ ] The repository builds from a clean checkout.
- [ ] A signed APK installs on the Seeker.
- [ ] The demo works without Metro or localhost.
- [ ] The current transaction flow is documented accurately.
- [ ] Any basket distribution claim is backed by code and test evidence.
- [ ] The demo video and pitch deck are complete.
- [ ] No secrets or private wallet material are present.
- [ ] The final team roster and registration information are accurate.
- [ ] The official website and terms have been checked again immediately before submission.
