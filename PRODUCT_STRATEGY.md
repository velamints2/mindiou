# Learn Coach Product Strategy

## Confirmed Market Gap

Even Realities currently provides:

- Even AI for general questions and multi-turn conversation;
- Conversate for transcription, summaries, and contextual meeting cues;
- Translate, Teleprompt, QuickList, notifications, and navigation;
- an Even Hub plugin surface, with AI Skills still described as upcoming.

Community learning and flashcard apps show that demand exists, but the official
product does not provide a complete understanding loop:

`daily source -> concept extraction -> spoken explanation -> AI evaluation ->
follow-up -> summary -> future review`

Learn Coach should own this loop. It should not compete as another card viewer.

## Positioning

**Learn Coach is an AI understanding coach for daily work knowledge.**

It helps busy workers turn material they encountered today into ideas they can
explain, apply, and remember during a five-minute voice reflection.

## Primary User

A knowledge worker who:

- uses AI, technical tools, or specialist concepts during the day;
- often recognizes terms without being able to explain them;
- has fragmented time during commuting, walking, or short breaks;
- wants learning to require less screen attention.

## Product Loop

1. Add one source from today's work.
2. AI extracts three to five concepts worth understanding.
3. Start a five-minute reflection.
4. Hear one short explanation or question.
5. Explain the idea in your own words.
6. Receive a correct / partial / missing-point evaluation.
7. Answer one targeted follow-up.
8. Finish with a summary and small review queue.

## Surface Responsibilities

### G2

- one concept;
- one short question;
- one session state;
- one short feedback label;
- progress.

### Voice

- AI explanation;
- learner answer;
- follow-up;
- simplify, example, repeat, summarize, and end commands.

### Phone

- `Session`: current concept, answer fallback, and recovery controls;
- `Sources`: import and course/source preparation;
- `Settings`: API, voice, and diagnostics.

## Input Contract

Current safe contract:

- swipe up: previous concept;
- swipe down: next concept;
- click: ignored and reserved until zero-value click events can be distinguished
  reliably from unsolicited system events;
- double click: system exit;
- coaching commands: voice or explicit phone controls.

No hidden gesture should mean Ask, Repeat, Known, or Simplify.

## Product Milestones

### M1: Stable Review Surface

- simulator gate passes;
- one large concept is readable;
- navigation never duplicates or moves without input;
- G2 does not disconnect during 20 navigation actions.

### M2: Voice Feynman Session

- explicit session state machine;
- G2 microphone capture;
- learner answer transcription;
- AI evaluation and one follow-up;
- measured end-to-end latency.

### M3: Daily Reflection MVP

- import one daily source;
- extract three to five concepts;
- complete a five-minute session;
- save understood and unresolved points locally.

### M4: Product Readiness

- first-run onboarding;
- clear offline and missing-AI states;
- privacy explanation;
- beta test with repeat users;
- retention measured by completed reflection sessions, not cards viewed.
