import { describe, expect, it } from "vitest";
import { transitionSession } from "./session";

describe("learning session state machine", () => {
  it("completes a Feynman answer and feedback loop", () => {
    let state = transitionSession("idle", "START");
    state = transitionSession(state, "ASK");
    state = transitionSession(state, "START_LISTENING");
    state = transitionSession(state, "SUBMIT_ANSWER");
    state = transitionSession(state, "FEEDBACK_READY");
    expect(state).toBe("feedback");
  });

  it("supports follow-up and summary", () => {
    let state = transitionSession("feedback", "FOLLOW_UP");
    state = transitionSession(state, "START_LISTENING");
    state = transitionSession(state, "SUBMIT_ANSWER");
    state = transitionSession(state, "FEEDBACK_READY");
    state = transitionSession(state, "SUMMARIZE");
    state = transitionSession(state, "SCHEDULE_REVIEW");
    expect(state).toBe("review_scheduled");
  });

  it("ignores invalid transitions", () => {
    expect(transitionSession("concept_prompt", "FEEDBACK_READY")).toBe("concept_prompt");
    expect(transitionSession("idle", "SUBMIT_ANSWER")).toBe("idle");
  });
});
