# Fluency Loop 预告页视觉 QA

## Comparison target

Source visual truth:

- `/var/folders/h1/dbfhmwjs7q3_p7xxhh4xjq300000gn/T/codex-clipboard-1090171e-7463-41d2-9214-f02bac1da250.png` — English AI collaboration cards, source pixels `1728 × 1536`.
- `/var/folders/h1/dbfhmwjs7q3_p7xxhh4xjq300000gn/T/codex-clipboard-762ac2ff-d153-439a-be24-9260f667105e.png` — Chinese research evidence cards, source pixels `1696 × 1186`.

Implementation evidence:

- `/private/tmp/mindiou-fluency-english-dimensions-1600x1200.png` — English dimension-card viewport capture, `1600 × 1200` pixels.
- `/private/tmp/mindiou-fluency-chinese-research-1600x1200.png` — Chinese research-section viewport capture, `1600 × 1200` pixels.

Capture state:

- Route: `http://localhost:5180/mindiou/#/fluency-loop-preview`
- CSS viewport: `1600 × 1200` for desktop comparison; `560 × 1000` for the responsive regression check.
- Language: English for the dimension-card capture, Chinese for the research-section capture.
- Density normalization: the source attachments do not expose a usable device-scale-factor declaration. The source captures and implementation captures were therefore kept at their raw pixel dimensions and compared at the same desktop breakpoint by focused component region rather than as pixel-identical full-page images.

## Findings

- No actionable P0, P1, or P2 findings remain.
- The source English view showed four narrow columns. Long labels such as `DISCERNMENT`, `TASK DECOMPOSITION`, and `ITERATIVE COLLABORATION` could squeeze the score toward the card edge. The implementation uses three desktop columns and a fixed right-side score track; all seven scores (`48`, `71`, `39`, `63`, `55`, `66`, `44`) remain inside their cards.
- The source Chinese research view showed five tall, narrow cards. The implementation uses three desktop columns, producing wider evidence cards and two balanced rows instead of five compressed vertical bars.
- At `560px`, the dimension grid becomes one column. The browser check reported no horizontal overflow and every score remained inside its card.

## Comparison history

### Iteration 1 — fixed

- Finding: desktop AI collaboration cards were too narrow; the English score could be visually clipped by the long dimension name.
- Fix: changed `.fluency-dimension-grid` to three columns; changed `.fluency-dimension-top` to `minmax(0, 1fr) auto`; kept the score non-wrapping with tabular numerals; reduced the desktop minimum card height from `365px` to `340px`.
- Post-fix evidence: `/private/tmp/mindiou-fluency-english-dimensions-1600x1200.png`; DOM layout check confirmed each score rectangle was fully inside its card and the page had no horizontal overflow.

### Iteration 2 — fixed

- Finding: five research cards created a tall, narrow “vertical bar” rhythm and excessive line wrapping.
- Fix: changed `.fluency-research-grid` to three columns; retained two columns at medium widths and one column on small screens.
- Post-fix evidence: `/private/tmp/mindiou-fluency-chinese-research-1600x1200.png`; desktop DOM metrics reported three cards per row at `1600px`.

## Required fidelity surfaces

- Fonts and typography: existing MindIOU font stack, hierarchy, uppercase labels, score sizing, line-height, and letter-spacing were preserved; the score now has `white-space: nowrap` and `font-variant-numeric: tabular-nums`.
- Spacing and layout rhythm: card width increased through the column reduction; score alignment is stable; the mobile breakpoint avoids narrow two-column English cards.
- Colors and visual tokens: no color, border, radius, shadow, or accent-token changes were made.
- Image quality and asset fidelity: no image or illustration assets were changed; the existing CSS-native decorative treatment remains untouched.
- Copy and content: no copy or language content was changed in this pass.

## Verification

- `npm run check` — passed.
- `npm test` — 11 test files, 83 tests passed.
- `npm run build` — passed.
- `git diff --check` — passed.
- Browser checks — English scores complete at `1600px`; research cards three-up at `1600px`; dimension cards one-up at `560px`; no horizontal overflow.

final result: passed
