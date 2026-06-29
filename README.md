# Learn Coach

Learn Coach is an AI-native reflection and knowledge-internalization coach for
Even G2. It uses the glasses for minimal prompts and uses voice for explanation,
Feynman questions, learner answers, feedback, and follow-up.

The current build is a prototype. Its immediate goal is to validate reliable G2
display, usable G2 microphone audio, and acceptable speech-to-AI latency on real
hardware. It is not yet a production learning system.

## What it does

- Shows one concept, question, status, or next step at a time on G2.
- Keeps the phone WebView focused on import, settings, and short controls.
- Switches cards from voice commands such as `next`, `下一个`, `会了`, `跟读`, and `提问`.
- Uses Even Hub SDK startup containers, text upgrades, list events, and MIC events.
- Converts pasted text or files into flashcards with an optional AI API.
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
npm run dev
```

Open:

```text
http://localhost:5175/?api=http://localhost:8793
```

With AI:

```bash
export OPENAI_API_KEY="..."
export LEARNING_API_TOKEN="..."
npm run api
```

Then open:

```text
http://localhost:5175/?api=http://localhost:8793&token=...
```

## Even G2 integration

The plugin follows the current Even Hub WebView pattern:

1. Wait for `waitForEvenAppBridge()`.
2. Call `createStartUpPageContainer(...)`.
3. Render four text containers: front, answer, coach prompt, progress.
4. Render one selectable list: `Repeat | Ask | Next | Known`.
5. Update text with `textContainerUpgrade(...)`.
6. Start voice with `audioControl(true, AudioInputSource.Glasses)`.
7. Send MIC PCM to `/api/learn/transcribe` when a backend is configured.

In a normal browser, it uses Web Speech API when available and keeps the G2 bridge in `mock` mode.

## API

- `POST /api/learn/import`: turns raw text into cards.
- `POST /api/learn/plan`: creates learning units from a subject and learner level.
- `POST /api/learn/tutor`: generates a brief question or feedback.
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
npx evenhub pack app.json dist -o release/learn-coach-0.1.4.ehpk
```

The current upload artifact is:

```text
release/learn-coach-0.1.4.ehpk
```

Version `0.1.4` is a controlled real-device experiment: it uses one serialized
`288x144` concept image for large text and replaces the clipped vertical list
with tap/up/down gestures. It ignores ambiguous system events, debounces gestures,
and skips unchanged image updates. Keep `release/learn-coach-0.1.2.ehpk` as the
text-only stable fallback. Do not use `0.1.1`; its four startup image transfers
caused a real G2 BLE disconnection.

Increase both the manifest version and package filename after changing a
distributed build.

## Current Validation Priority

Do not treat browser mock behavior as hardware validation. Before expanding the
feature set:

1. Install the private package and verify stable G2 container rendering.
2. Verify list input and real G2 microphone events.
3. Confirm PCM format and capture complete Mandarin and English utterances.
4. Measure speech-to-transcript and transcript-to-feedback latency.
5. Verify conservative command-versus-learning-answer classification.
