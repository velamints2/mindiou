# Competition Brief: Spiral Learn Coach

## One-Line Pitch

Spiral Learn Coach turns the work AI completed for you into the understanding
you can reproduce without AI, using short voice-first recall sessions on Rokid
glasses.

## User Problem

AI helps people finish work faster, but completion is not the same as learning.
After an AI-assisted coding, research, or writing session, users often cannot
explain the principle, reproduce the result, or recognize the same failure
later. Traditional courses and flashcard tools require manual organization and
are disconnected from the user's real work.

## Product Loop

```text
Real work or imported material
        |
        v
Spiral cognitive compiler
        |
        v
Knowledge atom + learning debt + source trace
        |
        v
One large Rokid recall question
        |
        v
Spoken explanation
        |
        v
AI evaluation + one missing point + one follow-up
        |
        v
Debt cleared or scheduled for review
```

## Why Glasses

- The prompt appears when the learner has 15 seconds to 3 minutes.
- The user answers aloud instead of opening a phone and typing.
- One-concept display reduces visual load and discourages passive reading.
- Voice and AI feedback create a complete learning loop without a course UI.

## AI-Native Behavior

AI is not used only to generate prose. It decides:

- whether a source contains a real reusable learning increment;
- which concepts deserve zero to three durable knowledge atoms;
- which AI-assisted task represents a capability gap;
- the learning debt score and no-AI micro exercise;
- whether the spoken explanation is correct, partial, or incorrect;
- the single best follow-up question for the current misunderstanding.

The UI remains controlled and predictable: the model supplies structured data,
while AIUI renders stable concept, feedback, and follow-up surfaces.

## 90-Second Demonstration

1. Explain the problem: AI fixed a CORS bug, but completion did not prove understanding.
2. Say: "把这段工作记录转成学习卡片：请求能发出但浏览器不能读取响应。网络白名单控制能否发送，CORS 控制浏览器能否读取跨域响应。"
3. Show the import tool producing a concise `CORS` card and reporting AI or fallback.
4. Say: "开始学习。"
5. Answer incorrectly: "CORS 就是允许请求发到另一个域名。"
6. Show a partial assessment, the missing idea, and one follow-up.
7. Answer the follow-up, then say: "这题我会了。"
8. Show the debt becoming cleared and the next concept appearing.

## Judging Evidence

- Real OpenAI import and tutor contracts run in the shared backend.
- Every generated knowledge card retains project and source identity.
- Review outcomes update an explicit scheduler and learning-debt lifecycle.
- Voice commands use conservative whole-utterance matching.
- AI fallback is visible and never presented as real AI output.
- The Rokid package has structure, secret, API, behavior, and size gates.
- The same cognitive system already has an Even G2 client, demonstrating a
  hardware-independent product rather than a one-device demo.

## Submission Assets Still Needed

- Craft import screenshot and target-device screenshot.
- A 60-90 second hardware demo video.
- Public HTTPS deployment of the Learn Coach backend.
- Competition-specific app ID, author metadata, icon, and privacy URL.
- Confirmation of whether the target contest expects AIUI Studio, GPASS
  workflow, or a native Glasses SDK APK.
