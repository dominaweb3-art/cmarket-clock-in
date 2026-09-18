# CLOCK IN final checklist

Official event reference: [CLOCK IN announcement](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon).
The published deadline is October 8, 2026; confirm the portal's exact closing
time and timezone immediately before submission because the announcement does
not publish a time here.

## Required submission package

- [ ] Final English project description from `SUBMISSION_COPY.md`.
- [ ] Public GitHub repository:
      https://github.com/dominaweb3-art/cmarket-clock-in
- [ ] Signed APK `c-market-0.1.1-release.apk`.
- [ ] Verify SHA-256 equals
      `09ef92848c97c7968ab6eb71d41fc1b458e54584d52746f6b457acae0c18146a`.
- [ ] Demo video following `DEMO_SCRIPT.md`.
- [ ] Use `DEMO_NARRATION_SIMPLE_ENGLISH.md` if a shorter reading guide is needed.
- [ ] Pitch deck following `PITCH_DECK_CONTENT.md`.
- [ ] Review `SCREENSHOT_MANIFEST.md` and `PLACEHOLDER_MATRIX.md`.
- [ ] Team name, team members, email, and any required public wallet field.
- [ ] Final review of the official portal's current fields and terms.

## Truth and safety gate

- [ ] Say C Market, never C10 Pocket.
- [ ] Say “Buy” or “payment,” never “invest.”
- [ ] Label every blockchain proof as Solana Devnet.
- [ ] Describe C3 as a target methodology: Bitcoin 40%, Ethereum 30%,
      Solana 30%.
- [ ] State that the current prototype records a USDC payment and has not
      performed C3 basket settlement.
- [ ] Do not claim current BTC/ETH/SOL holdings, returns, yield, Mainnet
      readiness, or automatic rebalancing.
- [ ] Do not authorize more than one supervised 5 USDC Devnet payment during
      recording.
- [ ] Do not show credentials, private keys, seed phrases, signing material,
      environment values, or full wallet secrets.

## Artifact and Seeker QA

- [ ] Install with Metro stopped and cold-launch on Seeker.
- [ ] Confirm C Market icon, package, version, and Devnet badge.
- [ ] Confirm Phantom/MWA connection and Devnet network before approval.
- [ ] Confirm 5 USDC minimum validation and insufficient-balance state.
- [ ] Confirm English default, all four language choices, and persistence.
- [ ] Confirm C3 details and truthful no-settlement disclosure.
- [ ] Confirm Activity empty state is not presented as a receipt unless a
      confirmed local receipt is actually present.
- [ ] Use the verified Explorer link only for the verified Devnet signature.

## Signing continuity

The safe signing-material location is maintained outside this worktree at:

`/Users/juantorres/Projects/cmarket-integration/apps/mobile/release-signing`

Before the final release, the team must confirm two encrypted offline backups
of the signing material and independently verify that they can be restored.
Do not place keystores, passwords, aliases, or credentials in Git, this
package, screenshots, or the submission portal.

## Portal completion

- [ ] Read the live official portal instructions and terms.
- [ ] Fill the bracketed fields in `SUBMISSION_COPY.md`.
- [ ] Upload the APK, video, and deck through the official portal.
- [ ] Confirm the GitHub URL is public and resolves to the intended branch or
      repository view.
- [ ] Save the portal confirmation outside the repository if it contains
      private account information.

No upload or portal submission is performed by this phase.
