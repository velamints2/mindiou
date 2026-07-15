# Competition Brief: MindIOU on Rokid Glasses

## One-Line Pitch

MindIOU turns the understanding AI skipped for you into a source-grounded,
voice-first debt-clearance session on Rokid optical-waveguide glasses.

## User Problem

AI helps people finish coding, research, writing, and product work faster, but
completion does not prove understanding. Users can ship a result while still
being unable to explain the technical choice, verify the AI's fix, or recognize
an incomplete solution. Generic courses are too far from the work that created
the gap.

## Demonstrable Loop

```text
AI-assisted work or conversation
        |
        v
MindIOU cognitive-debt report
        |
        v
Latest Feynman debt selected for Rokid
        |
        v
External research with cited sources
        |
        v
One large question on the waveguide display
        |
        v
Learner explains aloud
        |
        v
AI checks reasoning + teaches one missing point + asks one follow-up
        |
        v
User explicitly ends with a cautious clearance status
```

## Why Optical-Waveguide Glasses

- One large question fits a glanceable, eyes-up display better than a course UI.
- Speaking an explanation is closer to the Feynman method than tapping a quiz.
- The answer is hidden before recall, so the display does not become a cheat sheet.
- The learner can repair an understanding gap immediately after AI-assisted work.

## AI-Native Behavior

The model does more than generate prose. It researches the minimum external
knowledge needed to judge one debt, cites the sources, builds a hidden checking
scaffold, analyzes the learner's demonstrated reasoning, and selects one useful
follow-up. The UI remains stable and developer-controlled.

MindIOU never declares permanent mastery. Its outcomes are intentionally
cautious: provisionally cleared, needs practice, needs verification, or no
valid attempt. Ordinary web sources that materially affect a positive result
trigger a verification requirement.

## 90-Second Demonstration

1. Show the public MVP-0 report from an AI-assisted server deployment.
2. Open MindIOU on Rokid Glasses; the pinned demo debt appears as one large question.
3. Point out the source count and that no answer or scaffold is visible.
4. Give an incomplete spoken explanation that merges reachability and CORS.
5. Show the AI recognizing the valid part, teaching one boundary, and asking one
   concrete follow-up.
6. Answer again in your own words, including how you would verify the AI's fix.
7. Say `结束清偿` and show the cautious final status.
8. Briefly show the same report and evidence on desktop to prove cross-device
   continuity.

## Implemented Evidence

- Current Rokid AIUI / Ink immersive-agent structure and ES module app entry.
- Shared MVP-1 source-grounded research and answer-analysis backend.
- Privacy-preserving report/card-scoped entry for the glasses.
- Hidden scaffold before first answer.
- Conservative whole-utterance command matching.
- API key isolation: secrets stay on the backend.
- Platform unit tests, backend contract tests, smoke tests, package checks, and
  640x480 plus 480x640 visual overflow checks.
- Browser acceptance harness for deterministic demos and real backend sessions.
- Public HTTPS deployment for judges outside the local network.
- Curated, source-cited server-diagnostics fallback when the demo server cannot
  reach the model provider; it never reports a heuristic result as cleared.

## Submission Documents

- [Technical Documentation](../../docs/competition/technical-documentation.md):
  workflow design, endpoint/cloud plugin usage, wearable-client integration,
  GPASS / 百宝箱 workflow mapping, API contract, security boundary, and validation
  status.
- [User Guide](../../docs/competition/user-guide.md): judge-facing usage flow,
  Rokid controls, voice interaction, GPASS workflow guidance, hardware
  acceptance checklist, and troubleshooting.

## Remaining Submission Work

- Import the clean `0.2.12` local source folder into the competition's Rokid Craft account.
- On glasses, verify the native four-control path: swipe up/down changes the white
  selection, click executes it, and exit returns to the previous view.
- Verify the log continues from `Speech recognition started` to
  `MindIOU received final ASR transcript` and `MindIOU submitting answer`, then
  confirm Chinese AI feedback uses the smaller teaching font and owns the large text
  area. The next follow-up question must appear only after clicking `继续`. End the
  card and confirm a concise reference answer appears before clicking the highlighted
  `下一张` action. Confirm progress changes from `2 / 4` to `3 / 4` without flashing
  the previous large feedback text or changing the bounded `896 x 300` page height.
- Confirm Craft logs no longer repeat `phase has no bindings` or
  `pendingQuestion has no bindings`; remaining QuickJS drop/memory lines are runtime
  lifecycle logs unless paired with a functional failure.
- Validate microphone Tool Rendering and layout on the exact target firmware.
- Add competition app ID, author metadata, icon, privacy URL, screenshots, and
  a 60-90 second hardware demo video.
