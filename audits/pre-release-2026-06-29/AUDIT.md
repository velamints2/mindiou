# Learn Coach Pre-Release Audit

Date: 2026-06-29

## Audit Scope

Current phone start screen and the G2 flow for boot, click, swipe up, and swipe
down. Evidence was captured from the local WebView and Even Hub Simulator 0.7.3.

## User Goal

Complete a short, voice-first learning interaction without looking at the phone
or memorizing a complicated gesture map.

## Steps

### 1. Phone Start

Evidence: `01-phone-start.png`

Health: Needs restructuring.

- Strength: the current concept is visually prominent.
- Risk: learning controls, import, course setup, and AI settings share one long
  surface. The primary task is unclear and secondary tools fall below the fold.
- Accessibility risk: controls depend heavily on position and visual grouping;
  device status such as `bridge 1` is not explained.

### 2. G2 Boot

Evidence: `03-g2-start.png`, `03-g2-start-visible.png`

Health: Visually renders, interaction not ready.

- Strength: one large concept is readable and the framebuffer is only 4.02% lit.
- Risk: the footer asks the learner to memorize three gestures and mixes
  instructions with progress.
- Risk: the prompt is longer and visually denser than the concept.

### 3. Tap

Evidence: `04-g2-after-click.png`, `04-g2-after-click-visible.png`

Health: Fails.

- The simulator emits click as a zero-value system event whose `eventType` is
  omitted.
- The current strict handler ignores it, so the concept does not change.
- Earlier treating every omitted type as click caused spontaneous navigation.
- Tap cannot safely mean Next without a stronger input contract.

### 4. Swipe Up

Evidence: `05-g2-after-up.png`, `05-g2-after-up-visible.png`

Health: Technically responds, conceptually confusing.

- Swipe up currently means Ask.
- This conflicts with the common expectation that up/down navigate content.
- Asking should come from the learning state or voice, not a hidden gesture.

### 5. Swipe Down

Evidence: `06-g2-after-down.png`, `06-g2-after-down-visible.png`

Health: Technically responds, feedback is weak.

- Swipe down currently means Repeat.
- The concept remains unchanged while the prompt changes, making the result easy
  to miss.
- The action performs an AI request even though the learner may expect navigation.

## Main Findings

1. There is no authoritative learning-session state machine.
2. Inputs invoke feature commands directly instead of advancing a coherent
   learning state.
3. Tap is protocol-ambiguous because protobuf omits the zero-valued click type.
4. Ask and Repeat are hidden gesture mappings with poor discoverability.
5. The phone combines learning and administration in one long page.
6. Image rendering is viable only as a low-frequency, serialized operation.
7. The current build must not be published: the simulator click gate fails.

## Recommended Product Contract

- Tap starts or stops listening, where current state makes the intent clear.
- Swipe down moves to the next concept.
- Swipe up moves to the previous concept.
- Double tap exits.
- Ask, simplify, example, repeat, and summarize are voice commands or AI-driven
  state transitions.
- G2 shows only concept, state, short question, short feedback, and progress.
- Phone separates `Session`, `Sources`, and `Settings`.

## Evidence Limits

- Simulator rendering is not pixel-identical to hardware.
- Simulator does not reproduce BLE congestion or permissions.
- The phone mobile viewport capture timed out, so only the accepted desktop-sized
  start screenshot is included.
- Microphone, STT, and AI latency were not part of this audit.
