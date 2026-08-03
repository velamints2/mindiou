# MindIOU Landing Fix — Design QA

- Source visual truth:
  - `/var/folders/h1/dbfhmwjs7q3_p7xxhh4xjq300000gn/T/codex-clipboard-29c5f80c-7231-4d11-9254-2db649eceb19.png`
  - `/var/folders/h1/dbfhmwjs7q3_p7xxhh4xjq300000gn/T/codex-clipboard-b21f0f27-d908-465f-923a-827547ceb896.png`
- Implementation screenshots:
  - `/tmp/mindiou-landing-fixed-en-cta-viewport.png` (desktop hero)
  - `/tmp/mindiou-landing-fixed-en-cta-viewport-v2.png` (desktop CTA)
  - `/tmp/mindiou-landing-fixed-en-mobile.png` (mobile hero)
  - `/tmp/mindiou-design-qa-comparison.png` (combined source/implementation comparison)
- Desktop viewport: 1450 x 985 CSS px, device density normalized by using same browser viewport for both implementation captures.
- Mobile viewport: 390 x 844 CSS px.
- Source pixels: 1450 x 986 (hero), 1854 x 986 (CTA).
- Implementation pixels: 1450 x 985 (desktop captures), 390 x 844 (mobile capture).
- State: public Landing, English and Chinese language states.

## Full-view comparison evidence

The combined comparison at `/tmp/mindiou-design-qa-comparison.png` places each supplied reference beside the revised implementation. The desktop hero now keeps the skipped-reasoning chip, bottom trajectory label, debt card, and language switch in separate visible regions. The CTA now uses dark foreground colors throughout the light glass gradient.

## Focused-region evidence

- Hero: DOM bounds at 1450 px show the skipped-reasoning chip ending before the debt card begins; the public language switch is at the top-right and no longer intersects the card.
- CTA: computed colors are heading `rgb(17, 24, 39)`, copy `rgb(51, 65, 85)`, and note `rgb(71, 85, 105)` in both English and Chinese.
- Mobile: document `scrollWidth` equals viewport width (390 px); language control and debt card occupy separate vertical regions.

## Required fidelity surfaces

- Fonts and typography: Existing product type families, weights, sizes, and wrapping are preserved. Only foreground colors and collision-safe layout constraints changed.
- Spacing and layout rhythm: Public language control moved to a stable top-right safe area. Trajectory labels are bounded and the debt card retains its original scale/rotation without covering adjacent copy.
- Colors and visual tokens: CTA foregrounds changed from white-on-light to high-contrast slate/ink values while preserving the existing pastel glass background and white CTA button.
- Image quality and asset fidelity: Existing cognitive-trajectory raster asset is unchanged; no asset replacement, stretching, or approximation was introduced.
- Copy and content: Chinese and English wording is unchanged. Both locales share the corrected layout and color rules.

## Comparison history

### Iteration 1 findings

- P1: English skipped-reasoning metadata and bottom trajectory label were covered by the debt card; the fixed language control covered the card at the lower-right.
- P1: CTA heading, body copy, and note were white on a predominantly white/light gradient.

### Fixes made

- Added a public-route language-control placement at the top-right.
- Constrained and repositioned trajectory labels and debt-card bounds for desktop, tablet, and mobile breakpoints.
- Applied shared dark CTA foreground colors to both locales.

### Post-fix evidence

- Desktop hero screenshot and bounds show no intersection among the reported elements.
- Desktop CTA screenshot shows all three text levels visibly readable.
- Chinese CTA computed colors match English.
- Mobile screenshot has no horizontal overflow or language/card collision.
- Language toggle interaction works and browser console reports no errors.

## Findings

No actionable P0, P1, or P2 issues remain for the two reported defects.

## Follow-up polish

No P3 changes are required for this scoped correction.

final result: passed
