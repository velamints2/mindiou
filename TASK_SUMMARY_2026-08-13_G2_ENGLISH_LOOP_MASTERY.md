# Task Summary — English Loop Longitudinal Mastery

Date: 2026-08-13

## Outcome

Extended the internal English Loop from single-session planning and reflection into a conservative longitudinal learning loop:

```text
SessionPlan
  → TurnEvidence
  → action gate
  → SessionReflection
  → criterion-level mastery evidence
  → adaptive next practice
  → delayed review or transfer check
```

This is an internal 0.9.0 code increment. It does not deploy production, rebuild an EHPK, or claim real-G2 microphone evidence.

## Implemented behavior

- Added criterion-level states: `unknown`, `candidate`, `emerging`, `provisional`, `stable`, and `needs_review`.
- One successful conversation can only create `candidate` evidence.
- Success after a hint is recorded as prompted success and cannot promote independent mastery.
- `stable` requires at least three independent successful sessions across at least two dates and two topics.
- Conflicting evidence after `provisional` or `stable` changes the state to `needs_review`; it does not erase prior evidence.
- Overdue `provisional` or `stable` evidence becomes a review target without claiming that the learner forgot it.
- Session plans now carry `difficulty` and an optional `reviewCriterion`.
- The next practice adapts to the weakest or conflicting criterion and changes context for retrieval or transfer.
- First occurrence of an expression debt is now `candidate`; repeated occurrence activates it.
- Stuck, off-topic, and unclear-audio turns remain in the structured session trace but do not update long-term ability signals.
- Invalid turns cannot overwrite the previous valid evidence event.
- The user-facing profile shows evidence states and evidence counts instead of cold-start numeric scores.

## Persistence and privacy

The existing English Loop profile JSON stores bounded mastery records and sanitized topic/date keys. Raw transcripts, model replies, MCP content, and recent-turn text are still excluded from SQLite persistence.

Existing profile rows remain compatible: missing mastery records default to an empty list, old session plans default to `calibration`, and existing expression-debt states remain accepted.

## Verification

- `npm run check`: passed.
- `npx vitest run src/english-loop.test.ts src/english-loop-store.test.ts`: 19/19 passed.
- Focused Loop/API regression (`english-loop`, store, `ops-api`): 30/30 passed.
- `node --check server.js`: passed.
- `node --check english-loop-store.js`: passed.
- `npm run build`: passed.
- `git diff --check` for the changed Loop files: passed.

The complete serial repository suite is not green: 47 files / 658 tests passed, while 7 files / 43 tests failed. The failures are in the existing auth, MVP-0/MVP-1, device-token, project-hook-token, and cognitive-repayment fixtures. Their first failure is account creation returning `503`, followed by missing `user.id` and `401` cascades. No English Loop test failed. This task does not change those unrelated authentication fixtures, so the repository-wide gate remains an explicit unresolved issue rather than being reported as passed.

The focused tests cover cold start, prompted success, cross-date/cross-topic stability, conflicting evidence, overdue review, structured persistence, owner isolation, legacy SQLite migration, API fallback, and the no-overwrite rule for invalid turns.

## Remaining evidence boundary

- Current speaking criteria are deterministic text signals, not pronunciation or prosody assessment.
- No CEFR, IELTS, or permanent capability score is produced.
- Real G2 microphone, STT confidence, latency, and hands-free interaction still require a device run.
- A future labeled human-evaluation set is required to measure whether the selected tutoring action improves the learner's next response.
