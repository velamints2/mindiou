# MindIOU for Rokid AIUI

MindIOU is the Rokid optical-waveguide client for the Learn Coach cognitive-debt
system. It turns an AI-assisted practice report into one source-grounded
clearance question, asks the learner to explain it aloud, analyzes the answer,
and returns cautious feedback instead of declaring permanent mastery.

This directory follows Rokid's AIUI / Ink agent structure:

```text
AGENTS.md
app.js
app.json
app.wxss
config.js
pages/
  clearance/index.ink
  index/index.ink
  voice-action/index.ink
  import/index.ink
  settings/index.ink
utils/
  api.js
  learning.js
```

## Product Surfaces

`pages/clearance/index.ink` is the default immersive glasses session. It gets
the newest cognitive-debt report, selects one Feynman card, starts MVP-1
external research, and shows one large question. The hidden explanation
scaffold is not returned before the learner's first answer.

`pages/voice-action/index.ink` is the Tool Rendering voice entry. When a
clearance session is active, long speech is submitted to the shared MVP-1
evaluator. `结束清偿` explicitly ends the session. Without an active clearance
session, the page falls back to the legacy card tutor.

`pages/index/index.ink` remains available as the legacy active-recall queue.
`pages/import/index.ink` imports short learning material, and
`pages/settings/index.ink` stores and diagnoses the backend URL.

## Backend

The Rokid client shares the MindIOU backend with desktop and Even G2:

```text
GET  /api/rokid/clearance-entry
POST /api/mvp1/sessions
POST /api/mvp1/sessions/:id/answers
POST /api/mvp1/sessions/:id/end
GET  /api/rokid/session?duration=60
POST /api/rokid/tutor
POST /api/rokid/review
POST /api/rokid/import
GET  /health?live=1
```

Start the local backend:

```bash
cd /Users/macbookair/Documents/trae_projects/personal_os/evenhub-g2-learning
npm run api
```

Set the glasses API URL to the Mac LAN address, for example:

```text
http://192.168.1.10:8793
```

During AIUI hardware use, Rokid proxies network traffic through the companion
phone over Bluetooth. The phone must be able to reach the Mac LAN URL.
`OPENAI_API_KEY` stays on the backend and is never packaged in the glasses
client. For distribution, deploy the backend behind HTTPS and replace the
local address in `config.js` or pass `api` in the launch query.

## Verify And Package

```bash
cd platforms/rokid-aiui
npm run check
npm test
npm run pack
```

The Craft-importable source archive is:

```text
release/learn-coach-rokid-aiui-0.2.0.zip
```

The package gate checks all manifest pages, required `.ink` sections, common
secret patterns, and the 5 MB wearable package target.

The implementation follows Rokid's current AIUI guidance for immersive agents,
Tool Rendering, Web-style APIs, `wx.request`, and local storage:

- https://js.rokid.com/AIUI/guide/quickstart
- https://js.rokid.com/AIUI/guide/quickstart-first-immersive
- https://js.rokid.com/AIUI/framework/structure-app
- https://js.rokid.com/blog/002-aiui-beta-overview
- https://js.rokid.com/

Craft import, microphone routing, and final optical-waveguide layout still need
the competition account, target glasses, and matching firmware.

## Voice Contract

```text
结束清偿 / 完成清偿 / end
下一题 / 下一张 / next
上一题 / 上一张 / previous
重复 / 再说一遍 / repeat
提问 / 问我 / ask
会了 / 懂了 / got it
跳过 / skip
```

Only a complete short utterance is treated as a command. A longer explanation
containing command words remains a learning answer.

## Local Preview

```bash
cd platforms/rokid-aiui
python3 -m http.server 5186
```

Open the deterministic visual harness or the real backend flow:

```text
http://localhost:5186/preview/?demo=1
http://localhost:5186/preview/?api=http://localhost:8793
```

## Optical-Waveguide Acceptance

1. Import `release/learn-coach-rokid-aiui-0.2.0.zip` into Rokid Craft.
2. Set `api` to a backend URL reachable from the glasses.
3. Open MindIOU and confirm a single large question fits without scrolling.
4. Confirm the screen shows a source count but no answer before recall.
5. Speak a full explanation and confirm it is analyzed as an answer.
6. Include `下一题` inside a long explanation and confirm it remains an answer.
7. Say `结束清偿` and confirm a cautious result appears.
8. Disconnect the backend and confirm a retryable error appears without any
   false cleared state.
