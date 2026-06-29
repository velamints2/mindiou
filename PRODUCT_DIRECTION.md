# Learn Coach Product Direction

## Product Definition

Learn Coach is an AI-native reflection and knowledge-internalization coach for busy
workers. It helps a learner turn daily work notes, AI conversations, technical
concepts, articles, and other fragmented inputs into ideas they can explain,
apply, and revisit.

It is not primarily a flashcard app, a course player, or a reading interface for
smart glasses. Even G2 provides low-interruption prompts. Spoken interaction
through the glasses, phone, or headphones carries the learning conversation.

## North Star Experience

A useful session should work while the learner is walking, commuting, doing
housework, or taking a short break:

1. AI introduces a small reflection goal.
2. G2 shows one concept or one short question.
3. AI explains through audio when explanation is needed.
4. The learner explains the idea in their own words.
5. AI evaluates the explanation, identifies the missing point, and follows up.
6. AI produces a concise summary and a future review item.

The learner should not need to read long text or repeatedly operate the phone.

## Product Principles

### Low Interruption

- Show one concept, question, status, or next step at a time.
- Keep G2 text short enough to understand at a glance.
- Do not put long explanations, history, settings, or dense menus on G2.
- Treat the phone as an import, configuration, and recovery surface.
- Treat audio as the main channel for explanation and feedback.

### Voice First

- Spoken learner answers are the default interaction.
- Explicit control commands must use conservative matching.
- Speech that is not clearly a command is treated as a learning answer.
- AI feedback should play through phone or headphones; G2 shows only its short
  status or conclusion.

### Feynman Learning

The primary evidence of understanding is whether the learner can:

- explain an idea to a beginner;
- give a concrete example;
- state what problem it solves;
- connect it to known concepts;
- recognize a common misconception;
- apply it in a small situation.

Recognition and memorization alone are not sufficient evidence of understanding.

### Daily Reflection

The long-term product loop is:

`learning source -> concept -> Feynman check -> review item`

- A Learning Source is raw input from the learner's day.
- A Concept is an idea worth internalizing.
- A Feynman Check records the question, answer, evaluation, gap, and follow-up.
- A Review Item records current mastery and what should be revisited.

These are product-domain objects, not a requirement to add a database now.

## G2 Display Boundary

G2 may show:

- a concept name;
- a very short question;
- `Listening`, `Evaluating`, or another short state;
- one key hint;
- a short feedback label;
- progress such as `2/5`.

G2 must not show:

- long AI explanations;
- full course material;
- complex Markdown;
- dense action menus;
- settings or content-management screens;
- detailed learning history.

## Current Product Stage

The current build is a working prototype with large-text cards, Even Hub
containers, list events, microphone event handling, import, course planning, and
AI tutor endpoints. It has not yet proven that its core experience works on real
G2 hardware.

Before broader product work, the project must validate:

1. G2 containers render and update reliably.
2. G2 microphone events provide usable audio.
3. Speech-to-AI feedback latency is acceptable for conversational learning.

## Explicit Non-Goals for the Current Stage

- FSRS or a complex spaced-repetition algorithm
- user accounts or cloud synchronization
- a production database
- a course marketplace
- extensive phone management screens
- recommendation engines
- analytics dashboards
- multi-provider AI abstractions
- broad production security architecture

These may become relevant after the real-device interaction path is proven.

## Next Product Milestones

### Milestone 1: Real-Device Evidence

Prove G2 display, list input, microphone audio, Mandarin and English
transcription, and end-to-end latency.

### Milestone 2: Learning Session State Machine

Replace card-centric behavior with an explicit path:

`idle -> session_intro -> concept_prompt -> ai_explaining ->
feynman_question -> listening -> evaluating -> feedback -> follow_up ->
summary -> review_scheduled`

### Milestone 3: Daily Reflection MVP

Accept one daily learning source, extract three to five concepts, conduct a
five-minute voice reflection, and leave a concise summary and review queue.

## Product Success Questions

- Can the learner complete a session without looking at the phone?
- Can the learner explain a concept through speech?
- Can AI distinguish real understanding from superficial familiarity?
- Is the G2 display calm and glanceable?
- Is the experience usable during a commute or short break?
- Does it turn "I used this" into "I understand and can explain this"?
- Has the behavior been observed on real G2 hardware rather than only in a mock?

See [PRODUCT_STRATEGY.md](./PRODUCT_STRATEGY.md) for the confirmed official
product gap, primary user, surface responsibilities, and milestone sequence.
