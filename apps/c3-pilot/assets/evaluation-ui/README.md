# Evaluation UI assets

These assets are presentation only. They do not establish balances, asset
acquisition, transaction completion, market prices, or Mainnet capability.

## crypto-sprite-v1.png

User-provided transparent sprite, copied unchanged from
`Sprite transparente de cuatro íconos cripto.png` (2172 × 724).
`EvaluationVisuals.tsx` displays the first three cells through native clipped
views, preserving their pixels and proportions. The fourth cell is not used
as a replacement for the approved C Market brand. Percentage, symbol and TEST
labels are native localized text, not baked into an image.

## activity-empty-v1.png

Generated using the built-in imagegen tool with transparency. Used exclusively
for the empty/unloaded Activity state, never as evidence of a confirmed receipt.

Prompt: “Create a single small mobile app empty-activity illustration, on a
genuinely transparent background. Style: clean polished softly dimensional mint
green and deep navy, generous negative space, friendly restrained finish matching
a white C Market crypto dashboard. Subject: a small simple clock overlapping a
blank rounded receipt card with two short abstract horizontal lines. Centered
composition, no letters, no words, no numbers, no logos, no coins, no financial
values, no checkmarks suggesting any completed transaction. Clear at 96 pixels.
Not a UI mockup, only this isolated supporting illustration. Preserve transparency.”

## Navigation

Home, indices, activity, wallet and global-market glyphs are lightweight native
View geometry, not additional raster variants or a new dependency. The fixed
bottom navigation is outside the ScrollView. Upcoming products are noninteractive.
All four existing languages remain supported; English remains the default.

## c3-basket-explainer-v1.png

Generated with the built-in imagegen tool, with an actual transparent alpha
channel. Displayed only inside the closed “What shares represent” accordion on
Indices. It is conceptual artwork, never a position, balance, receipt or proof
of asset acquisition. Existing BTC/ETH/SOL sprite and approved C Market symbol
are reused unchanged. Composition percentages and all copy are native,
localized text rather than baked into the image.

Prompt: “Use case: stylized-concept. Asset type: small explanatory illustration
inside a collapsed C3 crypto-basket information accordion in a white mobile app.
Primary request: one restrained, softly dimensional mint-green and deep-navy
basket containing three plain rounded abstract tokens, subtly orange, lavender
and mint. Centered isolated object on a genuinely transparent background, clean
generous padding, readable at 96 pixels. It explains the concept of a basket, not
an actual wallet balance or completed transaction. No Bitcoin/Ethereum/Solana
logos: those approved icons are already separate UI assets. No text, letters,
numbers, percentages, prices, arrows, checkmarks, brand marks, monetary claims or
background scene. Polished minimal material finish consistent with a mint and
navy C Market dashboard. Not a screenshot or logo redesign.”

## Indices and shared wallet sheet

Information and languages use independent closed accordions (no nesting).
Operation status and recovery remain visible. One primary action is selected
from the existing reconciled lifecycle and allowed actions; a stored signature
alone never represents completion. The shared wallet sheet contains no monetary
actions and does not request authorization on opening. Disconnect clears only
the app's in-memory session, as explicitly disclosed; it never calls MWA
deauthorization or deletes backend history, and is blocked while a known request
is pending. Provider name and wallet balances are omitted because the existing
controller supplies only the public address and reconciled share/claim data.
Copy uses the native Clipboard module already in pinned React Native 0.86.3;
it is deprecated upstream but introduces no dependency or native build change.

This stage does not change app version, rebuild or install an APK. The installed
0.1.15 UI remains the previous version until the single build after Home and
Activity are completed. Physical UI/accessibility QA, including native clipboard,
will be performed on that final build; static checks are not physical evidence.
