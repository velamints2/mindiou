# Learn Coach

Learn Coach is now focused on a local-first understanding coach workflow for
desktop. The current MVP converts raw source text into small learning cards that
help the user explain, compare, restate, and recall content in their own words.

The current priority is not flashcards for memorization. It is a local learning
tool that turns mixed source material into cards that are stable enough to
preview, edit, save into a deck, and later review in a lightweight session.

See:

- [CARD_GENERATION.md](./CARD_GENERATION.md)
- [DESKTOP_APP.md](./DESKTOP_APP.md)

## What it does

- Accepts pasted text or `.txt` / `.md` files.
- Normalizes and chunks text locally.
- Generates candidate cards locally with no AI API.
- Scores card quality and keeps warnings visible for review.
- Lets the user edit, delete, keep, and export cards.
- Saves confirmed cards into local decks.
- Opens a minimal session view from saved decks.
- Keeps the desktop MVP focused on understanding, not memorization.

The longer-term direction is a daily learning reflection system, not a larger
flashcard interface. See:

- [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md)
- [PRODUCT_STRATEGY.md](./PRODUCT_STRATEGY.md)
- [DEV_GUIDE.md](./DEV_GUIDE.md)
- [ACCEPTANCE_CRITERIA.md](./ACCEPTANCE_CRITERIA.md)

## Run

```bash
cd evenhub-g2-learning
npm install
npm run test:cards
npm run test:desktop
npm run dev:desktop
```

`npm run dev:desktop` opens a local Electron window backed by the Vite dev
server.

## Testing

```bash
npm run test:cards
npm run test:desktop
```

The generator tests run fully locally and do not require any API keys.

## Desktop notes

More detailed desktop setup and constraints are documented in
[DESKTOP_APP.md](./DESKTOP_APP.md).

More detailed card generation rules are documented in
[CARD_GENERATION.md](./CARD_GENERATION.md).
- `POST /v1/reviews`: records a review outcome and schedules the card.
- `GET /api/spiral/today`: returns today's cards, atoms, metrics, and review report.
- `GET /api/g2/session?duration=15|60|180`: returns a time-bounded due-card queue.
- `POST /api/learn/import`: turns raw text into cards.
- `POST /api/learn/plan`: creates learning units from a subject and learner level.
- `POST /api/learn/tutor`: returns structured coaching feedback:
  `assessment`, `missingPoints`, `nextQuestion`, `summary`, and short `g2Text`.
- `POST /api/learn/transcribe`: accepts base64 PCM16 and returns transcript text.
- `POST /api/learn/events`: records bridge, G2 input, audio, transcript, and action events.
- `GET /api/learn/events`: returns recent in-memory telemetry.
- `GET /health`: checks server and AI configuration.

The text model uses provider-neutral `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`,
and `AI_MODEL` settings. Legacy `OPENAI_*` values remain supported. External
Responses web research and audio transcription use independent `RESEARCH_*`
and `STT_*` credentials, so a DeepSeek key is never sent to OpenAI-only APIs.
Without a text-model key, import and tutor endpoints return fallback content.

## MindIOU MVP-1 eval-first loop

MVP-1 starts from a persisted MVP-0 report card and runs one source-grounded
cognitive-debt clearance session. It is backend-only in this increment.

- `POST /api/mvp1/sessions`: starts from `reportId` + `cardId`, performs real
  web research, and returns a rewritten question with cited sources. The hidden
  explanation scaffold is not returned yet.
- `POST /api/mvp1/sessions/:id/answers`: analyzes a learner explanation against
  the cited scaffold, reveals the scaffold, and returns teaching or an end
  recommendation.
- `POST /api/mvp1/sessions/:id/end`: ends only on explicit user action and
  returns a cautious status with evidence and remaining gaps.
- `GET /api/mvp1/sessions/:id`: reads the current in-memory evaluation session.

Configure `OPENAI_RESEARCH_MODEL` for the Responses API `web_search` call. The
research request has a 45-second timeout and fails visibly when no cited source
is returned. Current sessions are intentionally in memory; durable persistence
is deferred until the eval-first quality gate is accepted.

With the API running, execute all three real-project fixtures:

```bash
npm run test:mvp1
```

Run one fixture while tuning quality:

```bash
MVP1_EVAL_SAMPLE=g2-webview-request npm run test:mvp1
```

Results are written to `tmp/mvp1-eval-results.json` by default.

## Package

Build and package the current version with:

```bash
npm run check
node -c server.js
npm run build
npm run check:release
npm run pack:ehpk
```

The current upload artifact is:

```text
release/learn-coach-0.3.3.ehpk
```

Version `0.3.3` repairs the G2 runtime after the desktop workbench was added.
The EHPK entrypoint is again isolated from `desktop.html`; legacy `apple`
sample cards are migrated to active-recall examples; phone network errors can
no longer become text inside the G2 concept image; image upload has a 6.5-second
timeout with a visible retry state; and persisted Spiral cards are migrated
from raw source-context prompts to `concept + recall question + answer`.

Version `0.3.2` makes the AI import result explicit. A successful import opens
the first generated card instead of leaving it behind the Capture panel,
fallback output is clearly labeled, browser-only runtime status is called
`phone` instead of the misleading `mock`, and Settings can test both the local
learning API and live OpenAI connectivity. The app also warns when an Even App
or phone build is configured with `localhost` instead of the Mac LAN address.
Direct material import is capped at eight cards to keep generation fast and
prevent a short source from expanding into a low-value card pile.

Version `0.3.1` fixes acceptance-test issues found on real G2: AI import now
surfaces fallback/error instead of pretending local fallback is AI output,
`/health?live=1` verifies real OpenAI reachability, local fallback cards are
normalized before rendering, and the G2 concept image wraps short titles to
avoid code or long text being clipped on the glasses.

Version `0.3.0` adds durable AI learning debts, debt severity and lifecycle,
no-AI micro exercises, daily debt/recall/practice metrics, and time-bounded
15-second, 1-minute, and 3-minute review sessions.

Version `0.2.1` is the current voice-test candidate. It starts buffering only
after local PCM speech detection, waits for trailing silence before sending one
utterance to STT, and treats an empty transcript as a recoverable no-speech
result instead of starting a five-second retry loop. Audio longer than 3.5
seconds cannot become a navigation command. After `ask` or an AI follow-up, the
next utterance is forced into learner-answer evaluation and G2 shows
`Answer now` or `Answer follow-up`.

Version `0.1.9` fixed the retry loop. Real G2 telemetry from
`0.1.8` confirmed 1,600-byte PCM chunks at roughly 50 ms each, but also exposed
a retry loop when STT configuration was missing. `0.1.9` stops the microphone
after one fatal configuration error, applies a five-second backoff to transient
errors, preserves the minimum 2.2-second batch interval after in-flight
requests, caps buffered PCM at 15 seconds, and aggregates audio telemetry once
per second instead of posting one network event for every 50 ms chunk.

Version `0.1.8` introduced observable voice testing. It keeps the `0.1.7`
navigation and image scheduler, but starts only one speech path at a time,
shows `Listening`, `Transcribing`, `Evaluating`, and STT failure states on G2,
and records PCM byte counts, estimated audio duration, and transcription
latency. `npm run test:voice` checks the local speech API contract; set
`VOICE_TEST_PCM` to a raw 16 kHz mono s16le file to exercise real transcription.

Version `0.1.7` is the display/navigation candidate verified on real G2: it renders the concept
and short coach prompt inside the same large image to avoid image/text mismatch,
uses swipe up/down for previous/next, ignores tap, immediately acknowledges
navigation in the footer, coalesces rapid swipes into the latest image target,
drops stale image updates, returns structured tutor feedback, conservatively
parses voice commands, dedupes repeated transcripts, and prevents concurrent STT
requests. Do not publish `0.1.5`; real-device feedback showed image/prompt
mismatch and delayed stale image updates. `0.1.6` is superseded by `0.1.7`
because rapid real-device swipes could leave the image stuck on an older card.
Keep
`release/learn-coach-0.1.2.ehpk` as the text-only stable fallback. Do not use
`0.1.1`; its four startup image transfers caused a real G2 BLE disconnection.

Increase both the manifest version and package filename after changing a
distributed build.

## Current Validation Priority

Do not treat browser mock behavior as hardware validation. Before expanding the
feature set:

1. Install the private package and verify stable G2 container rendering.
2. Verify list input and real G2 microphone events.
3. Confirm silence produces no STT loop and capture complete Mandarin and English utterances.
4. Measure speech-to-transcript and transcript-to-feedback latency.
5. Verify long answers cannot become commands and `ask` enters answer mode.
