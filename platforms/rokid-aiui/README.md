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

The competition package uses the public HTTPS backend:

```text
https://114.67.169.78/mindiou-api
```

It is pinned to one random-ID demonstration report and card, so the glasses do
not enumerate or read the newest anonymous visitor report. Launch queries may
override `reportId` and `cardId` for another report owned by the tester.

During AIUI hardware use, Rokid proxies network traffic through the companion
phone over Bluetooth. The phone must be able to reach the configured HTTPS URL.
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

The portable source archive is:

```text
release/learn-coach-rokid-aiui-0.2.11.zip
```

## Glasses controls

The immersive clearance page follows the four controls available on Rokid glasses:

- Swipe up: move the white selection highlight to the previous action.
- Swipe down: move the white selection highlight to the next action.
- Click: run the highlighted action.
- Exit: return to the previous Rokid view.

The three actions cycle in this order: `解释 -> 重试 -> 结束`; after settlement they
become `回顾 -> 重学 -> 下一张`. Pointer taps remain
available in Craft and the browser preview, but they are not the acceptance path for
the glasses build.

Version `0.2.11` uses the immersive Ink speech path directly. A `voicewakeup` event
creates `SpeechRecognition` immediately, and the final transcript is submitted to the
active MVP-1 clearance session. The transcript parser accepts both standard Web Speech
`results` and Rokid host `alternatives` events, including events wrapped in `detail`.
After an answer, the page enters a feedback-first state with a smaller teaching font,
so the AI's response can fit as a useful paragraph instead of one oversized headline.
The follow-up question appears only after the learner clicks `继续`. After settlement,
the page reveals a concise reference answer from the teaching feedback or revealed
scaffold before the learner advances. The third action becomes `下一张` and advances
through the configured report. The bounded `896 x 300` viewport is the primary layout
acceptance target; the page cannot grow or scroll when feedback, a reference answer,
or a follow-up appears.

Craft imports a local folder, a local `.aix`, or a publicly readable GitHub
subdirectory. This repository is private, so Craft's anonymous GitHub importer
returns `repository not found`. Use the clean extracted local folder:

```text
/Users/macbookair/Documents/trae_projects/personal_os/evenhub-g2-learning/platforms/rokid-aiui/release/rokid-craft-project-0.2.11
```

Craft generates the final `.aix` from the imported project.

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

## Local Ink Preview

Install the browser Ink runtime once, then start the real `.ink` bundle in the
official WebAssembly renderer:

```bash
cd platforms/rokid-aiui
npm install
npm run preview:ink
```

Open:

```text
http://localhost:5187/
```

This preview loads the same `app.json`, `.ink`, application modules, and utility
modules that are packaged for Craft. It supports page switching, 640x480 and
480x640 logical viewports, and a configurable Learning API URL. It is a much
stronger layout and runtime check than the legacy HTML harness, but Craft and
target glasses are still required for phone-proxied networking, voice routing,
and optical-waveguide acceptance.

## Legacy Visual Harness

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

1. Import `release/rokid-craft-project-0.2.11` as a local folder in Rokid Craft.
2. Set `api` to a backend URL reachable from the glasses.
3. Open MindIOU and confirm a single large question fits without scrolling.
4. Confirm the screen shows a source count but no answer before recall.
5. Speak a full explanation and confirm it is analyzed as an answer.
6. Confirm the large text area shows AI feedback first, not the next question.
7. Confirm the AI feedback uses the smaller teaching font and does not truncate after one short phrase.
8. Click `继续` and confirm the follow-up question appears only after that action.
9. Click `结束` and confirm the page shows a concise reference answer, not only a review instruction.
10. Click `下一张` and confirm no previous large feedback text flashes during the transition.
11. Include `下一题` inside a long explanation and confirm it remains an answer.
12. Disconnect the backend and confirm a retryable error appears without any
   false cleared state.
