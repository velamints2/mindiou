# Learn Coach Development Guide

## Development Objective

Develop Learn Coach as a low-interruption, voice-first learning reflection
system. Every change should strengthen one testable part of the learning loop,
especially the real G2 path.

## Required Pre-Change Judgment

Before editing code, state:

1. **Goal:** which product outcome the task serves.
2. **Out of scope:** what will not be changed.
3. **Minimum verifiable change:** the smallest change that tests the assumption.
4. **Risks:** likely SDK, audio, network, AI, or storage failure points.
5. **Deliverables:** files changed and evidence expected.

Do not start implementation until these points are clear.

## Engineering Boundaries

- Work on one product assumption at a time.
- Prefer small, reversible changes.
- Keep the current Even Hub integration path available.
- Do not add dependencies without a concrete need.
- Do not turn the phone UI into the primary learning experience.
- Do not put complete AI responses on G2.
- Do not add a feature without an acceptance condition.
- Do not report browser mock behavior as real-device validation.

## Architecture

- `src/main.ts`: phone WebView, local learning state, Even Hub bridge, G2
  rendering, speech input, and API calls.
- `src/styles.css`: phone WebView presentation.
- `server.js`: import, planning, tutor, transcription, and telemetry API.
- `app.json`: Even Hub package manifest.
- `dist/`: generated production WebView.
- `release/`: generated `.ehpk` packages.

The current implementation uses localStorage and in-memory server telemetry.
Neither should be mistaken for a final persistence architecture.

## Proposed Learning Session States

| State | G2 output | Phone output | Voice behavior |
|---|---|---|---|
| `idle` | Ready | Session setup | Start session command |
| `session_intro` | Session goal | Source and concept summary | AI introduces session |
| `concept_prompt` | Concept name | Concept context | Continue or ask for explanation |
| `ai_explaining` | Listening | Optional transcript | AI audio output |
| `feynman_question` | Short question | Full question if needed | AI asks learner |
| `listening` | Explain in your words | Listening state | Capture learner answer |
| `evaluating` | Checking understanding | Request status | No command except cancel |
| `feedback` | Correct / missing point | Detailed feedback | AI gives spoken feedback |
| `follow_up` | Short follow-up | Full follow-up | Capture another answer |
| `summary` | Reflection complete | Session summary | AI reads concise summary |
| `review_scheduled` | Review saved | Review recommendation | End or continue |

The current code implements this state-machine skeleton in `src/session.ts` and
connects answer evaluation to `feedback`, `follow_up`, and `summary` through the
structured tutor protocol in `src/tutor.ts`. Real-device microphone and latency
evidence are still required before treating the loop as hardware-validated.

## Voice Rules

Supported command intentions should eventually include:

- next;
- repeat;
- ask;
- understood;
- explain more simply;
- give an example;
- ask a different question;
- summarize;
- end today's reflection.

Command matching must be conservative. A phrase is a command only when it is a
clear command utterance; otherwise it is a learner answer.

The current command parser lives in `src/voice.ts`. It only treats short,
explicit Chinese or English utterances as commands. Longer explanatory answers
that contain words such as `next`, `repeat`, `下一个`, or `会了` must remain
learner answers and should be covered by tests before changing this behavior.
The same module owns transcript intake deduplication so repeated STT results do
not trigger repeated navigation or repeated tutor submissions.

For real-device testing, record:

- source device;
- event time;
- PCM byte count;
- assumed sample rate;
- chunk duration;
- utterance identifier;
- transcription start and end time;
- AI request start and end time;
- final response time;
- parsed command or answer classification.
- ignored transcript reason, if any;
- skipped transcription reason, if any.

## Local Run

```bash
cd /Users/macbookair/Documents/trae_projects/personal_os/evenhub-g2-learning
npm install
npm run api
npm run dev
```

Open:

```text
http://localhost:5175/?api=http://localhost:8793
```

With AI and API authentication:

```bash
export OPENAI_API_KEY="..."
export LEARNING_API_TOKEN="..."
npm run api
```

Then include the token in the launch URL:

```text
http://localhost:5175/?api=http://localhost:8793&token=...
```

## Verification Commands

```bash
npm run check
node -c server.js
npm run build
curl http://localhost:8793/health
```

Package:

```bash
npm run check:release
npm run pack:ehpk
```

`pack:ehpk` reads the manifest version and writes
`release/learn-coach-X.Y.Z.ehpk`.

## Real-Device Validation Order

1. Install the private package through Even Hub.
2. Confirm bridge startup and stable G2 container rendering.
3. Trigger every G2 list action repeatedly.
4. Request microphone permission and confirm raw audio events.
5. Capture PCM metadata before tuning recognition.
6. Test short Mandarin and English utterances.
7. Measure speech-to-transcript latency.
8. Measure transcript-to-AI-feedback latency.
9. Test conservative command-versus-answer classification.
10. Record failures and device/app versions.

## Change Completion Report

After every code change, report:

- what changed;
- why it changed;
- how to run it;
- how to accept it;
- how to revert it if the assumption fails.
