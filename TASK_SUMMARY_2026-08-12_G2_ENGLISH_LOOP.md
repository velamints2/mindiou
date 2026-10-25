# Task Summary — Even G2 English Speaking Loop

Date: 2026-08-13

## Outcome

Added an internal-test English speaking mode to the existing Even G2 Learn Coach surface. It is a separate mode from the existing Spiral knowledge-card flow, and it now has a recoverable server-backed state loop rather than only a WebView-local profile.

The loop is:

`real English conversation → Speaking Profile → expression practice pool → next speaking experiment`

The completed internal slice is local-first with an optional authenticated persistence companion. The G2 WebView remains usable offline through `localStorage`; when the internal API is available, it persists a sanitized Speaking Profile, session summaries, structured evidence, and intervention feedback. The optional backend still returns a natural English reply and one next speaking prompt.

## Included

- `src/english-loop.ts`
  - personal Speaking Profile data model;
  - conversation signal extraction;
  - expression-debt practice pool;
  - next-practice selection for natural conversation, 30-second opinion, trade-off explanation, and expression reuse;
  - local fallback reply when the AI endpoint is unavailable.
- `src/main.ts`
  - English Loop mode and session lifecycle;
  - G2 microphone transcriptions are sent with `language: "en"`;
  - long English answers are treated as conversation turns, not as `next`/`known` commands;
  - short voice commands remain available: `repeat`, `ask`, `next`, `got it`;
  - English-mode telemetry avoids storing the transcript text in the event log;
  - G2 footer/image switches to a short, glanceable English Loop prompt.
- `english-loop-store.js`
  - SQLite-backed per-user/per-client profile, session, structured-turn and intervention-feedback storage;
  - idempotent turn writes so retries after WebView suspension do not inflate a session;
  - profile sanitization removes raw transcript snippets, recent transcript history, and model replies before persistence.
- `index.html` and `src/styles.css`
  - phone control tab for topic, session start, AI reply, next prompt, Speaking Profile, and expression pool.
- `server.js`
  - `POST /api/learn/english-loop` structured conversation endpoint;
  - `GET/POST /api/learn/english-loop/state` for restore and structured progress sync;
  - `POST /api/learn/english-loop/feedback` for intervention outcome feedback;
  - authenticated Web-user and G2 device-token ownership, with hashed client IDs for the local/internal package;
  - fallback behavior when the model is unavailable;
  - English language hint passed to OpenAI-compatible transcription.
- `src/english-loop.test.ts`
  - profile updates, expression debt creation, and 30-second opinion progression.
- `src/english-loop-store.test.ts` and `src/ops-api.test.ts`
  - persistence idempotency, owner isolation, sanitized storage, and API recovery behavior.

## Intelligence guardrails added

The Loop no longer lets the model decide the learner's next direction from raw conversation alone.

- Each turn becomes an `EvidenceEvent` with session ID, observable speaking signals, word count, and confidence.
- A user goal is stored alongside the profile, so a correct but irrelevant suggestion can be rejected.
- `lastDecision` is one of five controlled outputs: `update`, `debt`, `information`, `experiment`, or `nothing`.
- A single phrase cannot become a confirmed debt. The debt/experiment intervention gate requires at least five evidence events, three sessions, and computed confidence of at least 75%.
- The local planner selects one next speaking move: goal link, cause, example, trade-off, conclusion, Q&A, or free continuation.
- The model endpoint is now a response renderer. It receives the selected move and must keep it, refer to the learner's concrete topic, and return a specific next prompt.
- Generic/unanchored model replies are rejected on the client. The client also rejects a response when its next prompt does not satisfy the selected move contract. The deterministic local response remains the visible fallback.
- The phone view shows evidence count, cross-session count, confidence, and the reason for the current decision.
- Each non-`nothing` decision now gets a stable intervention ID plus a hypothesis and expected outcome, so a later outcome/eval layer can measure whether the experiment helped.

The internal package now has a bounded persistence companion, but it is not an ambient agent. It does not read MCP resources, execute Codex/local-agent tools, modify a workspace, or run in the background. It stores structured learning evidence only; raw English transcripts and model replies are intentionally not persisted. Cross-device history is available only when the same authenticated user/device identity is used; an unauthenticated internal package uses a hashed per-install client id.

## Use

1. Install `release/learn-coach-0.8.0.ehpk` in the Even App as the internal package.
2. In the phone WebView, open `英语 Loop`.
3. Set the topic, for example `AI, products, work, or something I genuinely care about`.
4. Press `开启英语 Loop`, then `开始本次口语`.
5. Speak naturally in English for 10–20 minutes. Good topics include today's work, an AI article, a product idea, a simulated meeting, or an investor conversation.
6. Use only short control phrases when needed:
   - `repeat` / `再说一遍` — repeat the current practice prompt;
   - `ask` / `问我` — show the current prompt;
   - `next` / `下一张` — switch topic;
   - `got it` / `会了` — acknowledge and continue.
7. Stop the session from the phone button. The next time you return, the profile and expression pool are restored from the internal API when available; if it is unavailable, the local profile remains usable and will be retried later.

The quiet sync line in the phone view indicates whether the state is synced or currently local-only. The package generates one non-secret client id per installation. For a shared profile across devices, configure the internal API with a per-user G2 device token or use the authenticated Web session; do not reuse one service token as the profile identity.

The G2 display intentionally shows only a short state such as `30-second opinion`, while the phone shows the AI reply, the reason for the next practice, profile signals, and recurring expressions.

## Verification

- `npm run check` passed after the persistence integration.
- `npx vitest run src/english-loop.test.ts src/english-loop-store.test.ts` passed: 8 tests.
- `npx vitest run src/ops-api.test.ts` passed: 12 tests, including English Loop state restore, owner isolation and sanitized storage.
- `node -c server.js` passed.
- `npm run build` passed for the 0.8.0 change.
- `npm run check:release` and `npm run pack:ehpk` passed; the new internal candidate is `release/learn-coach-0.8.0.ehpk` (102,905 bytes, SHA-256 `cb12e0617728db534cc04f13a5997ff7e201ff1d7689d4ed3891a225e36957fe`).
- `npm run test:simulator` passed against the final rebuilt 0.8.0 WebView and an isolated local API: boot framebuffer, click reservation, up/down gestures, rapid input coalescing, tutor fallback, and console-error gate all passed.
- Real-device installation and microphone evidence still require installing the package on the physical G2 and completing the existing hardware gates. Browser/mock success must not be treated as real G2 proof.

## Rollback

Install `release/learn-coach-0.7.0.ehpk` to return to the previous internal package. The new profile remains under the separate `g2EnglishSpeakingProfile` localStorage key and does not alter the existing knowledge-card data. If server-side state must be removed, delete only the English Loop tables from the configured internal SQLite database after taking a backup; do not delete the shared auth/database file wholesale.
