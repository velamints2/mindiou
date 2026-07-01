# Learn Coach

Learn Coach is the Even G2 learning surface for Spiral, a local-first cognitive
compiler. Spiral turns useful learning increments from Codex work into
source-linked knowledge atoms, active-recall cards, and a persisted review
queue. See [SPIRAL_ARCHITECTURE.md](./SPIRAL_ARCHITECTURE.md).

## What it does

- Shows one concept, question, status, or next step at a time on G2.
- Keeps the phone WebView focused on import, settings, and short controls.
- Switches cards from voice commands such as `next`, `下一个`, `会了`, `跟读`, and `提问`.
- Uses Even Hub SDK startup containers, text upgrades, list events, and MIC events.
- Accepts allowlisted, locally redacted Codex events.
- Compiles each event into zero to three deduplicated knowledge atoms.
- Preserves project context and source event IDs on every generated card.
- Records understood, partial, incorrect, and skipped review outcomes.
- Converts pasted text or files into direct flashcards with an optional AI API.
- Plans learning units from a subject and the learner's current level.
- Evaluates answers using Feynman-style questions and Socratic follow-up.
- Runs without AI keys using local fallback parsing and coaching.

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
npm run api
npm run test:spiral
npm run test:voice
npm run dev
```

Open:

```text
http://localhost:5175/?api=http://localhost:8793
```

Put local API configuration in the ignored `.env.local` file:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_STT_PROMPT=Learn Coach vocabulary study. Commands include 下一张, 下一个, 重复, 提问, 会了, next, repeat, ask me, got it.
OPENAI_BASE_URL=https://api.openai.com/v1
LEARNING_API_TOKEN=
LEARNING_STORE_PATH=tmp/spiral-store.json
SPIRAL_PROJECT_ALLOWLIST=/absolute/path/to/allowed/project
```

Never put the OpenAI key in the EHPK, phone Settings, Developer Portal, or
committed source. `npm run api` automatically reads `.env.local` and enables
Node's environment-proxy support for networks that require `HTTP_PROXY` or
`HTTPS_PROXY`. For the
current REST transcription and structured tutor implementation,
`gpt-4o-mini-transcribe` and `gpt-4o-mini` are the conservative defaults.

Then open:

```text
http://localhost:5175/?api=http://localhost:8793&token=...
```

## Even G2 integration

The plugin follows the current Even Hub WebView pattern:

1. Wait for `waitForEvenAppBridge()`.
2. Call `createStartUpPageContainer(...)`.
3. Render one large concept image and one short event-capturing text footer.
4. Update the footer with `textContainerUpgrade(...)`.
5. Update the concept image with serialized `updateImageRawData(...)` calls.
6. Treat swipe up as previous and swipe down as next.
7. Ignore tap until click events can be distinguished reliably from unsolicited system events.
8. Start voice with `audioControl(true, AudioInputSource.Glasses)`.
9. Send MIC PCM to `/api/learn/transcribe` when a backend is configured.

In a normal browser, it uses Web Speech API when available and keeps the G2 bridge in `mock` mode.

## API

- `POST /v1/events/codex`: compiles a filtered Codex event into zero to three atoms.
- `GET /v1/review/next?mode=learn`: returns the highest-priority due card.
- `POST /v1/reviews`: records a review outcome and schedules the card.
- `GET /api/spiral/today`: returns today's cards, atoms, metrics, and review report.
- `POST /api/learn/import`: turns raw text into cards.
- `POST /api/learn/plan`: creates learning units from a subject and learner level.
- `POST /api/learn/tutor`: returns structured coaching feedback:
  `assessment`, `missingPoints`, `nextQuestion`, `summary`, and short `g2Text`.
- `POST /api/learn/transcribe`: accepts base64 PCM16 and returns transcript text.
- `POST /api/learn/events`: records bridge, G2 input, audio, transcript, and action events.
- `GET /api/learn/events`: returns recent in-memory telemetry.
- `GET /health`: checks server and AI configuration.

The API uses `OPENAI_API_KEY` when present. Without it, import and tutor endpoints return fallback content; transcription returns an explicit missing-key error.

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
release/learn-coach-0.2.1.ehpk
```

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
