# MindIOU User Guide

Product name: 认知欠条 MindIOU  
Subtitle: 把 AI 代劳转化为真实能力成长

## 1. What MindIOU Does

MindIOU helps users clear the understanding gaps left by AI-assisted work.

Instead of asking "did AI finish the task?", MindIOU asks:

- What did AI do for you?
- What did you truly contribute?
- Which concepts or technical decisions are still dangerous blind spots?
- Can you explain the key point in your own words?
- Can AI challenge your explanation and help you repair the gap?

The current demo focuses on one complete loop: a cognitive-debt report becomes a
Feynman question, the user answers aloud, AI gives feedback, and the user ends
with a cautious clearance result.

## 2. Recommended Demo Script

Use this script for judges or first-time users:

1. Open MindIOU on the glasses or workflow client.
2. Show that one large question is visible and the answer is hidden.
3. Explain aloud in your own words.
4. Read the AI feedback screen.
5. Continue once if there is a follow-up.
6. Choose end.
7. Show the final status and reference answer.

One-line explanation:

```text
MindIOU turns the understanding AI skipped for you into a voice-first clearance
session on smart glasses.
```

## 3. Rokid Glasses Version

### 3.1 Package To Use

Import this clean project folder in Rokid Craft:

```text
/Users/macbookair/Documents/trae_projects/personal_os/evenhub-g2-learning/platforms/rokid-aiui/release/rokid-craft-project-0.2.12
```

The source archive is:

```text
/Users/macbookair/Documents/trae_projects/personal_os/evenhub-g2-learning/platforms/rokid-aiui/release/learn-coach-rokid-aiui-0.2.12.zip
```

Backend address:

```text
https://114.67.169.78/mindiou-api
```

### 3.2 Basic Controls

Rokid glasses have four practical controls for this app:

| Action | Meaning |
| --- | --- |
| Swipe up | Move the white focus to the previous button. |
| Swipe down | Move the white focus to the next button. |
| Click | Run the focused button. |
| Exit | Return to the previous Rokid view. |

Mouse or pointer clicks can work in Craft preview, but final hardware acceptance
should use swipe up, swipe down, click, and exit.

### 3.3 Screen States

#### Question screen

You see:

- App name: `MINDIOU`
- Card progress, such as `2 / 4`
- Learning area, such as `服务器部署与运维`
- One large Feynman question
- Source count
- Three actions: `解释`, `重试`, `结束`

What to do:

- Answer the question directly.
- Do not look for the answer before speaking. The answer is intentionally hidden.

#### Feedback screen

After you answer, AI should show feedback first. The follow-up question should
not replace the feedback immediately.

You see:

- Whether your answer was too short, partially correct, or useful.
- One compact teaching point.
- A button to continue if there is a follow-up.

What to do:

- Read the feedback.
- Click `继续` only when you are ready for the next question.

#### Follow-up screen

You see:

- A follow-up question based on your previous answer.
- Actions such as `解释`, `重试`, `结束`.

What to do:

- Answer again in your own words.

#### End screen

After choosing `结束`, you should see:

- A cautious status.
- A concise reference answer or teaching summary.
- A next action.

The app should not only say "请复习教学反馈"; it should show an actual reference
answer or compact explanation.

### 3.4 Voice Use

Use natural speech. Good answer:

```text
D 状态说明进程在不可中断 I/O 等待里，重启 Nginx 只能重启服务进程，
不能修复磁盘、网络文件系统或内核等待。我要用 ps、iotop、dmesg 或
/proc 去确认根因。
```

Weak answer:

```text
我不太清楚。
```

Very short or meaningless text may be treated as an invalid attempt.

Command words such as "下一题" are only treated as commands when the whole
utterance is a short command. If the user says those words inside a longer
explanation, the app treats the speech as a learning answer.

### 3.5 Hardware Acceptance Checklist

Use this checklist on physical glasses:

1. Open MindIOU and confirm the first card appears.
2. Confirm the page fits the optical-waveguide display and does not scroll.
3. Swipe up/down and confirm the white focus moves between actions.
4. Click `解释` and answer aloud.
5. Confirm logs move from speech recognition to answer submission.
6. Confirm AI feedback appears first.
7. Confirm the feedback font is smaller than the question font and readable.
8. Click `继续` and confirm the follow-up appears only then.
9. Click `结束` and confirm a reference answer appears.
10. Click `下一张` and confirm the progress changes without old text flashing.
11. Press exit and confirm the app returns to the previous Rokid view.

Expected useful log fragments:

```text
Speech recognition started
MindIOU received final ASR transcript
MindIOU submitting answer
```

The following runtime lifecycle logs are not necessarily failures by themselves:

```text
QuickJS Memory Usage
JsRuntime drop
Dropping Ink instance
```

In version 0.2.12, these warnings should not repeat:

```text
phase has no bindings
pendingQuestion has no bindings
```

## 4. Web / Desktop Demo

The web version is used to show the report and cognitive-debt source material.
It is useful before opening the glasses because judges can see where the
question came from.

Suggested flow:

1. Open the public MindIOU demo page.
2. Show the AI debt report.
3. Point to the dangerous understanding gaps.
4. Show the Feynman compensation cards.
5. Switch to the glasses demo and clear one card aloud.

If the AI provider is unavailable, the controlled demo may use a transparent
source-cited fallback. It should still be described as a demo fallback, not as
live external research.

## 5. GPASS / 百宝箱 Version

百宝箱 version should use a workflow:

```text
Start -> HTTP request -> JSON deserialize -> output question
      -> collect user answer -> HTTP request -> JSON deserialize -> output feedback
      -> continue or end
```

### 5.1 Start The Session

The first HTTP node should call:

```text
POST https://114.67.169.78/mindiou-api/api/mvp1/sessions
```

Body:

```json
{
  "reportId": "c18ecc67-6725-4b60-bc0a-a73e53150d5e",
  "cardId": "card-2",
  "client": "gpass-tbox"
}
```

After JSON deserialize, output:

```text
{{question}}

请直接用自己的话回答。
```

### 5.2 Submit The User Answer

Second HTTP node:

```text
POST https://114.67.169.78/mindiou-api/api/mvp1/sessions/{{sessionId}}/answers
```

Body:

```json
{
  "answer": "{{userInput}}",
  "client": "gpass-tbox"
}
```

Output:

```text
反馈：{{feedback}}

补充：{{teaching}}

继续时回答：{{nextQuestion}}
```

### 5.3 End The Session

End HTTP node:

```text
POST https://114.67.169.78/mindiou-api/api/mvp1/sessions/{{sessionId}}/end
```

Output:

```text
本次状态：{{status}}

参考答案：{{teaching}}

下一步：{{recommendation}}
```

## 6. Troubleshooting

### 6.1 JSON deserialize says output type mismatch

Cause:

```text
sources is an Array, but the node output was defined as Object.
```

Fix:

- Do not map `$.session.sources` as Object.
- Map `$.session.sources[0].title` as Text if only one source title is needed.
- Or define the field as Array/List if the platform supports it.

### 6.2 Buttons work in preview but not on glasses

Use the hardware control model:

```text
Swipe up/down -> choose action
Click         -> execute action
Exit          -> return
```

Do not rely on pointer tap as the final acceptance path.

### 6.3 Voice wakeup starts but no answer is submitted

Check logs for:

```text
MindIOU received final ASR transcript
MindIOU submitting answer
```

If these do not appear, the issue is likely in ASR event delivery or transcript
parsing. Version 0.2.12 supports standard Web Speech `results`, Rokid
`alternatives`, direct `transcript`, and `detail`-wrapped events.

### 6.4 Request failed or fetch failed

Check:

- The phone connected to the glasses can reach
  `https://114.67.169.78/mindiou-api/health?live=1`.
- The workflow timeout is at least 30 seconds.
- The server model key is configured.
- The client is not pointing to `localhost` or a LAN-only address.

### 6.5 Do not paste API keys into client workflows

GPASS, Rokid AIUI, and web clients should call the MindIOU backend. They should
not contain DeepSeek, OpenAI, or other model-provider API keys.

## 7. What Success Looks Like

A successful demo should make the user notice:

```text
原来我刚才让 AI 跳过了这么多理解过程。
```

The product succeeds when the learner can explain one previously skipped idea
more clearly after the AI feedback loop than before it.
