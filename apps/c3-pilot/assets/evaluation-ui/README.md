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
