# Spiral v0.1 Architecture

Spiral v0.1 implements one complete path:

```text
Codex hook event
  -> local allowlist and redaction
  -> source event
  -> 0-3 deduplicated knowledge atoms
  -> scored AI learning debts
  -> source-linked review cards
  -> 15s / 1m / 3m session scheduler
  -> G2 active recall
  -> persisted review event
  -> updated due queue
```

## Runtime Components

- `agents/codex-collector/collector.mjs`: local allowlist, secret redaction, and
  compact event forwarding.
- `server.js`: HTTP API and cognitive compiler.
- `spiral-store.js`: atomic local JSON persistence, atom deduplication, review
  history, debt lifecycle, metrics, and session scheduling.
- `src/main.ts`: phone console, AI tutor, voice pipeline, and the stable G2
  rendering bridge.

The current repository remains a single deployable project to preserve the
validated Even Hub build and real-device behavior. The API contracts already
use the planned `/v1` boundary, so the collector, worker, contracts, and G2 app
can be split into a monorepo when PostgreSQL and background jobs become useful.

## API

- `POST /v1/events/codex`
- `GET /v1/review/next?mode=learn`
- `POST /v1/reviews`
- `GET /api/spiral/today`
- `GET /api/g2/session?duration=15|60|180`

## AI Debt Lifecycle

Each new atom creates one source-linked learning debt with a 0-100 score,
severity, delegated AI task, skill gap, and no-AI micro exercise. Reviews move
the debt through `open`, `training`, and `cleared`. Daily metrics include debt
creation, clearance, recall accuracy, and the rate of answers that contain an
independent learner explanation. Stores created by `0.2.x` are migrated on
load: existing atoms, cards, and reviews receive linked debt IDs without
discarding prior progress.

Existing `/api/learn/*` endpoints remain for card import, course planning, AI
tutoring, speech transcription, and simulator telemetry.

## Intentional v0.1 Boundaries

- Codex is the only automated source.
- A source event creates zero to three cards.
- Similar concepts are deduplicated within a project.
- Thought topics and `mode=think` start in v0.2.
- Always-on ambient recording is not required.
- G2 tap and double-tap actions remain disabled until their event distinction is
  proven on hardware. Verified swipe navigation and voice controls are retained.
