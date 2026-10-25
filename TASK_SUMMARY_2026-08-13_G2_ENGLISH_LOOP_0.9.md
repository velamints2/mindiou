# Task Summary — Even G2 English Loop 0.9.0

Date: 2026-08-13

## Outcome

Continued the 0.8.0 English Loop internal slice from recoverable state into a more reliable repeated-use loop:

```text
真实英语会话
  → 结构化 Speaking Profile
  → 本地可靠写入
  → 服务恢复后重放
  → 会话总结
  → 下一步练习
  → 干预反馈
```

This increment remains local-first and internal. It does not add MCP access, local-agent execution, ambient listening, workspace reads, or production deployment.

## Changes

### Durable offline outbox

The G2 WebView now writes English Loop state and intervention feedback to a bounded `localStorage` outbox before attempting the network request.

- state events are queued with stable IDs;
- duplicate retries do not create duplicate structured turns;
- failed requests remain on the device instead of being discarded;
- queued events replay on app restore and the browser `online` event;
- a failed service request schedules a bounded 30-second retry while the app remains open;
- the phone UI shows the number of pending items when the internal service is unavailable;
- only sanitized Profile/session/feedback payloads enter the outbox.

The outbox is intentionally bounded at 50 items. It is a recovery buffer, not a permanent transcript archive.

### Session summary

At the end of a speaking session, the client now records a structured summary:

- number of turns;
- number of evidence events;
- practice minutes;
- current Loop decision;
- decision reason;
- next practice type, title and task;
- completion time.

The phone view shows the latest summary under `上一次会话总结`. The summary is also persisted in the English Loop session record and restored on the next launch.

### SQLite migration

`english_loop_sessions` now has `summary_json`. Existing databases migrate in place by adding the column when it is missing. A subsequent session sync without a summary does not erase an existing completed summary.

### Privacy boundary

The summary and outbox contain no raw English transcript, recent-turn history, model reply, or transcript snippet. They contain only counters, controlled decision fields, practice text, and previously sanitized Profile signals.

## Internal use

1. Install `release/learn-coach-0.9.0.ehpk` in the Even App.
2. Open `英语 Loop` in the phone view.
3. Set a real speaking goal and a topic.
4. Start a 10–20 minute English conversation.
5. End the session from the phone view and read `上一次会话总结`.
6. If the service is unavailable, continue using the app. The status line will show `待同步 N 项`; when the service or network returns, the queue will replay automatically.
7. Mark a suggested intervention as `这次有帮助` or `没有帮助`. Feedback is queued with the same recovery behavior.

## Verification

- `npm run check` passed.
- `npx vitest run src/english-loop.test.ts src/english-loop-store.test.ts src/ops-api.test.ts` passed: 20 tests.
- `node --check english-loop-store.js` passed.
- `node --check server.js` passed.
- `npm run build` passed.
- `npm run check:release` passed with version `0.9.0`.
- `npm run pack:ehpk` passed and produced `release/learn-coach-0.9.0.ehpk` (103,803 bytes, SHA-256 `02dcf8b41fb0b2e3fa4a009eec14e45b5f3ce2357e0a70e6b3415eb5de7ed7cf`).
- Final Even Simulator regression passed against the rebuilt 0.9.0 WebView and an isolated local API: boot framebuffer, click reservation, up/down gestures, rapid input coalescing, tutor fallback, and console-error gate all passed.

## Remaining boundary

The summary is an evidence-bound session recap, not a full pedagogical evaluation. It does not claim pronunciation scoring, grammar diagnosis, CEFR/IELTS scoring, or causal proof that one intervention improved speaking. Those require a separate labeled evaluation model and real-user evidence.

Real G2 microphone/STT/device evidence remains separate from simulator evidence.

## Rollback

Install `release/learn-coach-0.8.0.ehpk` to return to the previous internal package. The 0.9.0 outbox uses the new `g2EnglishLoopOutbox` key and can be ignored by the older package.
