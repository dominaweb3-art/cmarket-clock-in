# C Market workspace guidance

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
- Keep Devnet payment behavior separate from any future Mainnet capability.
- Prefer read-only checks before any external or repository mutation.

## Hackathon classification

Every task and commit must be classified as exactly one of:

- `SHARED`: common product, security, architecture, brand, truthful disclosure, or generic utility work.
- `CLOCKIN_ONLY`: Seeker, Android APK, Mobile Wallet Adapter UX, dApp Store, and CLOCK IN submission work.
- `WORLDSFAIR_ONLY`: index methodology, analytics, scalability, business model, and World’s Fair submission work.

Shared work is committed once on the shared branch and transferred through Git. Do not manually copy the same implementation between worktrees. Use `cherry-pick -x` only for an isolated historical fix that cannot be merged normally, and record the source SHA.

## Truthfulness and provenance

Disclose pre-existing code and concurrent hackathon development accurately. The World’s Fair boundary is `2026-09-14T13:00:00Z`. A retrospective tag created after that boundary must never be described as evidence that the tag existed before the event.
