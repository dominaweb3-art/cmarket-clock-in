# Shared work and dual-hackathon Git policy

## One product, one shared history

C Market is one product. The shared branch is `shared/dual-hackathon-base`, created from the Phase 5 security checkpoint `a7e6f67`. The two delivery branches are:

- `submission/clock-in`: Seeker, Android APK, Mobile Wallet Adapter UX, dApp Store, and CLOCK IN materials.
- `submission/worldsfair`: index methodology, analytics, scalability, business model, and World’s Fair materials.

The shared branch and both delivery branches must retain common commit ancestry. Mainnet remains disabled in every current delivery branch.

## Commit classification

- `SHARED`: security fixes, common architecture, brand system, truthful disclosures, and generic utilities.
- `CLOCKIN_ONLY`: Seeker, APK, MWA mobile UX, dApp Store, and CLOCK IN submission assets.
- `WORLDSFAIR_ONLY`: index methodology, platform analytics, scalability, business model, and World’s Fair submission assets.

Use the classification in commit messages or the task record. If a change serves both submissions, commit it once on the shared branch and merge that commit into both delivery branches.

## Transfer rules

1. Develop shared work on `shared/dual-hackathon-base`.
2. Merge the shared branch into both submission branches through Git; never manually copy the implementation between worktrees.
3. If a truly isolated historical fix cannot be merged, use `git cherry-pick -x <source-sha>` and preserve the source SHA in the commit message or disclosure record.
4. Keep hackathon-specific documentation and assets on their corresponding submission branch unless both submissions need them.
5. Record branch, source SHA, author/committer timestamps, and validation results for every release candidate.

## Provenance and publication

The World’s Fair disclosure must distinguish pre-existing c10-pocket work from all during-event canonical work. A retrospective tag is an audit marker only. Do not squash, rebase, amend, rewrite timestamps, or force-push to make the history appear older or newer.
