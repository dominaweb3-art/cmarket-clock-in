# Crypto World’s Fair pre-existing work disclosure

This is a factual provenance record for the Crypto World’s Fair submission. It is not a claim that any retrospective tag or branch existed before the event.

## Disclosure boundary

The official event boundary used for this audit is `2026-09-14T13:00:00Z` (`06:00 PDT`). The registration date of September 15 is not used as the development boundary.

## Pre-event work in c10-pocket

The historical workspace has its own disconnected Git ancestry. The following commits are the last clearly identified pre-event work:

| Commit | Author and committer time | Classification | Factual scope |
| --- | --- | --- | --- |
| `d787a28bcb2e09407a2b67bbcee9a2c7f2b5d6aa` | `2026-09-10T08:51:26-05:00` / `2026-09-10T13:51:26Z` | `PRE_WORLD_FAIR` | Initial C Market/Seeker prototype workspace and application foundation. |
| `b6fff287ae103bd4c06663c748de695b8256f650` | `2026-09-10T16:30:39-05:00` / `2026-09-10T21:30:39Z` | `PRE_WORLD_FAIR` | Wallet balance and early C10 dashboard changes. This is the final pre-event commit. |

Only the original prototype and early C10 dashboard are claimed as pre-existing. The tag `worldsfair-preexisting-baseline-2026-09-14` is a retrospective audit marker created after the event began and does not alter those timestamps.

## During-event work

| Commit | Author and committer time | Classification | Factual scope |
| --- | --- | --- | --- |
| `9676c08ff44938695c47407e3e1bc0c70a5011fa` | `2026-09-14T12:03:25-05:00` / `2026-09-14T17:03:25Z` | `DURING_WORLD_FAIR` | Seeker-tested prototype sync, including the Buy screen and Devnet USDC flow. |
| `772a80a7ca739fe24a2ed73f1e96d36c7656b558` | `2026-09-14T11:16:18-05:00` / `2026-09-14T16:16:18Z` | `DURING_WORLD_FAIR` | First canonical repository commit. |
| `6da4cb86e612c092c9744d722357d7fa78505dd6` | `2026-09-14T14:50:15-05:00` / `2026-09-14T19:50:15Z` | `DURING_WORLD_FAIR` | Seeker-tested Expo Router application migration into `apps/mobile`. |
| `a7e6f67ba8a153c5d6cc8f4309d4bc6e022f7563` | `2026-09-16T22:23:12-05:00` / `2026-09-17T03:23:12Z` | `DURING_WORLD_FAIR` | Final Phase 5 security checkpoint. |

All canonical repository commits from `772a80a` through `a7e6f67` occurred after the World’s Fair boundary. Release, branding, multilingual, Devnet QA, C3 architecture, Mainnet hardening, and security work are therefore during-event work.

## Interpretation limits

`c10-pocket` and `cmarket-integration` do not share Git ancestry. The migration commit documents when the code entered the canonical repository, but it does not create historical parentage from the c10-pocket commits. Code originating in c10-pocket must be disclosed as migrated pre-existing code; genuinely new repository, release, architecture, and security work must be disclosed as during-event work. No timestamps, parents, or historical commits are rewritten.
