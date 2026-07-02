# Learn Coach for Rokid AIUI

Learn Coach is the Rokid client for Spiral, a cross-device active-recall and
cognitive-debt system. It turns AI-assisted work and imported material into
small, source-linked questions, then asks the learner to explain each concept
in their own words.

This directory follows Rokid's current AIUI / Ink agent structure:

```text
AGENTS.md
app.js
app.json
app.wxss
config.js
pages/
  index/index.ink
  voice-action/index.ink
  import/index.ink
  settings/index.ink
utils/
  api.js
  learning.js
```

## Product Surfaces

`pages/index/index.ink` is the persistent glasses session. It shows one large
concept, one active-recall question, progress, and compact actions. It loads a
15-second, 1-minute, or 3-minute queue from Spiral.

`pages/voice-action/index.ink` is a Tool Rendering entry. The Rokid host agent
can pass the user's exact utterance into the page. Short explicit commands are
navigation; longer speech is evaluated as a learner answer.

`pages/import/index.ink` accepts source material from the conversation, calls
the Learn Coach AI import endpoint, and renders the first generated card. It
shows whether the result came from AI or fallback parsing.

`pages/settings/index.ink` stores the backend URL locally and calls
`/health?live=1`. API keys remain on the backend.

## Backend

The Rokid client uses the same server and Spiral store as the Even G2 client:

```text
GET  /api/rokid/session?duration=60
POST /api/rokid/tutor
POST /api/rokid/review
POST /api/rokid/import
GET  /health?live=1
```

For local glasses testing, start the backend:

```bash
cd /Users/macbookair/Documents/trae_projects/personal_os/evenhub-g2-learning
npm run api
```

Then set the Rokid API URL to the Mac LAN address:

```text
http://192.168.1.10:8793
```

The Mac and glasses must be on the same network. The address can change after
switching Wi-Fi. For competition distribution, deploy the backend behind HTTPS
and replace the local address in `config.js` or pass `api` in the launch query.

## Verify And Package

```bash
cd platforms/rokid-aiui
npm run check
npm test
npm run pack
```

The importable source package is:

```text
release/learn-coach-rokid-aiui-0.1.0.zip
```

The package gate checks:

- all pages referenced by `app.json` exist;
- each `.ink` page contains configuration, controller, page, and style blocks;
- no common API key or private-key pattern is present;
- the generated archive remains under Rokid AIUI's 5 MB wearable target.

The project uses documented AIUI structures and APIs: `.ink` single-file
pages, `wx.request`, `wx.getStorageSync`, and `wx.setStorageSync`. Actual Craft
import and Rokid hardware behavior still require the competition account and
target glasses firmware.

## Voice Contract

Supported commands:

```text
下一题 / 下一张 / next
上一题 / 上一张 / previous
重复 / 再说一遍 / repeat
提问 / 问我 / ask
会了 / 懂了 / got it
跳过 / skip
```

Only short utterances are treated as commands. A longer explanation containing
words such as `next` or `会了` remains a learning answer.

## Local Preview

The `preview/` directory is a browser-based acceptance harness for the data
contract and interaction flow. It is not the Rokid runtime.

```bash
cd platforms/rokid-aiui
python3 -m http.server 5186
```

Open:

```text
http://localhost:5186/preview/?api=http://localhost:8793
```
