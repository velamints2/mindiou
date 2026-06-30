# Learn Coach Acceptance Criteria

## Purpose

The current prototype is accepted by evidence of a viable core learning
experience, not by feature count. Browser behavior is useful for development but
does not satisfy G2 hardware criteria.

## Gate 1: G2 Display

- [ ] The private `.ehpk` installs and opens from Even App.
- [ ] The bridge reports a successful startup on a real G2 connection.
- [ ] The startup page appears on G2 without a blank or loading-only state.
- [ ] Text updates at least 20 consecutive times without requiring a restart.
- [ ] List actions work at least 10 consecutive times each.
- [ ] Each screen contains only one concept, question, status, hint, or progress
      indicator.
- [ ] No long AI explanation is sent to the glasses.
- [ ] Text remains readable while standing and walking safely.

Evidence to retain:

- Even App and G2 firmware versions;
- package version;
- telemetry export;
- short video or timestamped observations;
- failures and recovery steps.

## Gate 2: G2 Microphone

- [ ] G2 microphone permission is granted and its result is recorded.
- [ ] Real `g2_audio_event` events are observed.
- [ ] PCM sample rate, channel count, bit depth, and byte order are confirmed.
- [ ] Chunk size and approximate chunk duration are recorded.
- [ ] A complete short utterance can be reconstructed without obvious truncation.
- [ ] At least 10 Mandarin utterances are captured.
- [ ] At least 10 English utterances are captured.
- [ ] Repeated utterances do not cause runaway duplicate requests.
- [ ] Stop and restart microphone capture works without reopening the plugin.

## Gate 3: Speech and AI Latency

Measure at least 10 attempts for each language.

- [ ] Speech end to completed transcript is recorded.
- [ ] Transcript to first usable AI feedback is recorded.
- [ ] Total speech end to usable feedback is recorded.
- [ ] Median and worst observed latency are reported.
- [ ] Failed and timed-out requests are visible to the learner.
- [ ] A network failure does not leave G2 permanently in `Listening` or
      `Evaluating`.

Initial product target:

- transcript median at or below 2.5 seconds;
- total feedback median at or below 5 seconds;
- no silent wait longer than 8 seconds without a status or recovery action.

These are prototype targets and may be revised from real-device evidence.

## Gate 4: Voice Classification

- [ ] Clear commands such as `下一张`, `重复`, and `总结一下` trigger the
      intended action.
- [ ] Normal explanatory answers containing a command keyword are not routinely
      misclassified.
- [ ] Unclear speech is treated as an answer or clarification request, not a
      destructive command.
- [ ] Command and answer classification is included in telemetry.
- [ ] The learner can recover from a wrong classification by voice or phone.

## Gate 5: Feynman Learning Loop

- [ ] AI asks a question that requires explanation in the learner's own words.
- [ ] The learner can answer without operating the phone.
- [ ] AI identifies at least one correct point or missing point.
- [ ] Partial answers receive a targeted follow-up.
- [ ] Incorrect answers receive a simpler explanation without punitive language.
- [ ] The loop reaches a concise spoken summary.
- [ ] G2 shows only short state and feedback text throughout the loop.

## Gate 6: Session State Consistency

This gate applies after the state machine is implemented.

- [ ] The session follows valid transitions from introduction through summary.
- [ ] Phone, G2, microphone, and tutor behavior agree on the current state.
- [ ] Duplicate SDK or network events do not skip required states.
- [ ] Cancel, timeout, and network failure return to a recoverable state.
- [ ] Long AI text is reduced to a short G2-safe summary.

## Gate 7: Daily Reflection MVP

This gate is intentionally deferred until Gates 1 through 5 pass.

- [ ] The learner can enter one item they encountered but did not fully
      understand today.
- [ ] AI extracts three to five concepts worth internalizing.
- [ ] The system conducts a voice-first reflection of about five minutes.
- [ ] The learner answers one to three Feynman questions.
- [ ] AI produces a daily summary of understood and unresolved points.
- [ ] The session leaves a small review queue.

## Current Status

| Area | Status | Notes |
|---|---|---|
| Browser WebView | Partial pass | UI and fallback paths have been exercised |
| Build and package | Pass | Type check, build, and EHPK package succeeded |
| Real G2 display | Not verified | Requires private installation and telemetry |
| Real G2 microphone | Not verified | PCM assumptions require device evidence |
| Real AI interaction | Not verified | No configured AI key in the last validation |
| End-to-end latency | Not measured | Requires real network, STT, and AI |
| Learning state machine | Partial pass | `src/session.ts` and `src/tutor.ts` connect answer evaluation to feedback, follow-up, and summary states |
| Feynman fallback loop | Partial pass | `/api/learn/tutor` returns structured fallback feedback without an AI key |
| Voice classification | Partial pass | `src/voice.ts` conservatively parses short commands; real STT transcripts still require device evidence |
| Daily reflection MVP | Deferred | Begins after hardware and latency gates |
