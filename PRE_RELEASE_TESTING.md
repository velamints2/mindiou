# Learn Coach Pre-Release Testing

## Rule

Do not upload a new `.ehpk` until every local gate passes. A successful TypeScript
build is not evidence that the G2 experience works.

## Gate 1: Static

```bash
npm test
npm run check
node -c server.js
npm run build
```

Required:

- no type or syntax errors;
- session-state transition tests pass;
- voice command tests prove short explicit commands are recognized and long
  explanatory answers containing command words remain learner answers;
- manifest and package versions match;
- the package filename uses the same version;
- no unsupported container dimensions;
- exactly one event-capturing G2 container.

## Gate 2: API

Start the API and test fallback behavior:

```bash
npm run api
curl http://localhost:8793/health
```

Required:

- health responds;
- import, plan, and tutor fallback return structured data;
- missing AI/STT configuration is explicit;
- network failure leaves the learning session recoverable.

## Gate 3: Official Simulator

Install once:

```bash
npm install -g @evenrealities/evenhub-simulator
```

Run the app and simulator:

```bash
npm run dev
evenhub-simulator \
  "http://localhost:5175/?api=http%3A%2F%2Flocalhost%3A8793" \
  --automation-port 9898 --no-glow
npm run test:simulator
```

The automated test must:

- prove the framebuffer is nonblank and not overfilled;
- save a boot screenshot;
- send every supported input;
- assert that each input produces one intended action;
- assert that navigation changes the visible concept;
- save the simulator console;
- fail on console errors.

Raw simulator screenshots encode visibility in alpha. The test therefore counts
alpha pixels rather than judging RGB color.

## Gate 4: Interaction Contract

Before implementation, keep one authoritative table:

| Input | Meaning | Valid states | Feedback |
|---|---|---|---|
| Voice answer | Learner response | `listening` | `Evaluating` |
| Swipe down | Next concept | Stable concept/feedback | New concept + progress |
| Swipe up | Previous concept | Stable concept/feedback | Previous concept + progress |
| Tap | Reserved / ignored | Any | No state change |
| Double tap | Exit | Any | System exit |

Tap remains reserved until the SDK's omitted zero-value click event can be
distinguished reliably from unsolicited system events.

Do not assign Ask, Repeat, Known, and Next to hidden gestures. AI coaching actions
should arise from the session state or explicit voice commands.

## Gate 5: Package

Only after Gates 1 through 4 pass:

```bash
npx evenhub pack app.json dist -o release/learn-coach-X.Y.Z.ehpk
```

Retain the last known stable package. Experimental packages must be labeled and
must not replace the stable fallback.

## Gate 6: Private G2

Private testing should verify only hardware-specific risks:

- opening does not disconnect G2;
- one image update is stable;
- 20 navigation actions do not disconnect or duplicate;
- the visible safe area matches the simulator;
- microphone permission and PCM events work;
- Mandarin and English STT latency are recorded.

If a failure could have been found in the simulator, stop and improve the local
gate before asking for another device upload.
