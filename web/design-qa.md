# MindIOU Cognitive Trajectory Design QA

- Source visual truth: `web/public/qa/reference.png`
- Implementation URL: `http://localhost:5180/`
- Final desktop screenshot: `qa/implementation-desktop-final.png`
- Final mobile screenshot: `qa/implementation-mobile-final.png`
- Final combined comparison: `qa/source-vs-implementation-final.png`
- User-feedback hero screenshot: `qa/user-feedback-fix-final.png`
- User-feedback steps screenshot: `qa/user-feedback-steps-final.png`
- User-feedback side-by-side comparison: `qa/user-feedback-glass-comparison.png`
- State: landing page, authenticated-header variant (`进入工作区`)
- Desktop viewport: 1440 × 1024 CSS px, device scale factor 1
- Mobile viewport: 390 × 844 CSS px, device scale factor 1
- Source pixels: 1536 × 1024
- Implementation pixels: 1440 × 1024
- Density normalization: source was resized with `fit: contain` onto a 1440 × 1024 warm-paper canvas; implementation remained at native 1440 × 1024. The combined comparison is 2880 × 1024.

## Full-view comparison evidence

`qa/source-vs-implementation-final.png` places the normalized source on the left and the final browser render on the right. Both use the selected asymmetric hero structure: editorial title on the left, a semantic reasoning trajectory on the right, one dominant liquid-glass debt artifact, a supporting AI fragment, warm paper color, restrained cobalt gap state, and a compact glass navigation control.

The implementation intentionally uses live HTML for all product copy and controls instead of rasterizing the mock. The generated trajectory is the only decorative raster asset; it was post-processed to `public/assets/cognitive-trajectory-transparent-v2.png` so its original paper background does not appear as a rectangular patch.

## Focused comparison evidence

A separate crop was not required: at 2880 × 1024 the navigation, hero typography, CTA materials, gap chip, AI fragment, debt status, question copy, card edges, and trajectory nodes are all legible in the combined comparison. Mobile responsiveness was checked separately in `qa/implementation-mobile-final.png`.

## Required fidelity surfaces

- Fonts and typography: passed. Chinese display copy uses the available Songti/STSong serif stack, while navigation, body copy, state labels, and controls use the system sans stack. Hierarchy, wrapping, weights, line height, and letter spacing remain readable at 1440 px and 390 px.
- Spacing and layout rhythm: passed. The desktop keeps the source's asymmetric two-column composition and the mobile version collapses to a single readable sequence without horizontal overflow or CTA compression.
- Colors and visual tokens: passed. Warm ivory, near-black, muted gold, and cobalt are mapped to reusable tokens. Glass controls retain readable foreground contrast.
- Image quality and asset fidelity: passed. The generated trajectory matches the selected art direction, is sharp at the displayed size, and has a transparent background. No placeholder illustration, custom SVG, or CSS-drawn trajectory replaces it.
- Copy and content: passed. Brand, hero promise, CTA, gap state, debt prompt, and timing copy match the selected visual direction and remain real DOM text.
- Interaction and accessibility: passed for the implemented landing scope. Primary and secondary controls have visible focus styles and practical mobile target sizes. The debt artifact is keyboard reachable and responds to Enter/Space. Reduced-motion behavior remains defined globally.

## Comparison history

### Iteration 1

- [P1] The generated trajectory asset retained an opaque warm-paper rectangle that was visible against the page.
- [P2] The implementation rendered the entire header as one glass bar, while the source separates the brand from a compact functional glass capsule.
- Fixes: separated the brand from the controls and post-processed the trajectory artwork.
- Post-fix evidence: `qa/implementation-desktop-v4.png`.

### Iteration 2

- [P2] The first material pass read as thin borders on the warm paper instead of a volume-bearing glass surface.
- Fix: added a multi-layer material system with a specular top highlight, translucent fill, cobalt/coral edge refraction, inner shadow, elevation shadow, and stronger backdrop saturation. CTA controls were changed to pill geometry so the liquid material is visually distinct from ordinary bordered buttons.
- Post-fix evidence: `qa/implementation-desktop-final.png`, `qa/implementation-mobile-final.png`, and `qa/source-vs-implementation-final.png`.

### Iteration 3 — direct screenshot feedback

- [P1] The transparent trajectory treatment had not been applied by the winning CSS rule, so a large rectangular raster background remained visible.
- [P1] The three-step section used wide white rectangular backing plates that flattened the hierarchy.
- [P2] The full-width header backing plate competed with the compact glass control.
- Fixes: routed the hero to `cognitive-trajectory-transparent-v2.png`; made the public header itself transparent while keeping only its controls as glass; removed all borders, fills, shadows, and backdrop filters from `.how-step`; strengthened the CTA, control capsule, gap chip, and debt-card material layers.
- Post-fix evidence: `qa/user-feedback-fix-final.png`, `qa/user-feedback-steps-final.png`, and `qa/user-feedback-glass-comparison.png`.

## Interaction and runtime checks

- `看看它如何工作` navigated successfully to `#/how-it-works` and rendered the heading `MindIOU 的原理`.
- The page rendered without module/export errors.
- The in-app browser reported one third-party instrumentation request timeout; it belongs to browser instrumentation, not the MindIOU application.
- TypeScript check, 29 Vitest cases, and the Vite production build passed after the final visual changes.
- The browser full-page capture repeated a viewport tile, but DOM verification found exactly one `.page-landing` and one `.landing-hero`; this is a capture artifact rather than duplicated application markup. Viewport screenshots are used as the acceptance evidence.

## Findings

No actionable P0, P1, or P2 findings remain in the two user-reported regions. The hero no longer contains a rectangular raster plate, the header is no longer a full-width glass slab, the CTA surfaces show filled refractive material, and the three steps sit directly on the paper canvas.

## Follow-up polish

- [P3] A later motion pass can bind the missing cobalt trajectory segment and debt-card elevation to scroll progress while retaining the existing reduced-motion fallback.

## Implementation checklist

- [x] Match the selected cognitive-trajectory composition.
- [x] Apply liquid glass to functional controls and debt surfaces.
- [x] Preserve readable base-layer content.
- [x] Use a real generated trajectory asset.
- [x] Validate desktop and mobile viewports.
- [x] Validate the secondary navigation path.
- [x] Pass TypeScript, tests, and production build.

final result: passed
