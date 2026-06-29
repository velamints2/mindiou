import { describe, expect, it } from "vitest";
import {
  localTutorResponse,
  tutorGlassesText,
  tutorPhoneText,
  tutorStateEvents,
  type TutorCard,
  type TutorResponse
} from "./tutor";

const card: TutorCard = {
  front: "cognitive dissonance",
  back: "认知失调",
  prompt: "Explain it in your own words."
};

describe("tutor protocol", () => {
  it("keeps glasses feedback short while phone feedback stays detailed", () => {
    const fallback = localTutorResponse("answer", card, "it is when beliefs and actions fight");
    const response: TutorResponse = {
      ok: true,
      assessment: "partial",
      message: "你抓到了冲突感，但还没有说清楚为什么人会想要降低这种不舒服。",
      missingPoints: ["补充心理不适", "补充改变信念或行为"],
      nextQuestion: "请举一个工作里认知失调的例子。",
      g2Text: "Add a work example",
      shouldFollowUp: true
    };

    expect(tutorGlassesText(response, fallback)).toBe("Add a work example");
    expect(tutorPhoneText(response, fallback)).toContain("理解度：部分理解");
    expect(tutorPhoneText(response, fallback)).toContain("补充心理不适");
  });

  it("moves answered sessions into follow-up when a question exists", () => {
    const response = localTutorResponse("answer", card, "belief and action conflict");
    expect(tutorStateEvents("answer", response)).toEqual(["FEEDBACK_READY", "FOLLOW_UP"]);
  });

  it("moves answered sessions into summary when no follow-up remains", () => {
    const response: TutorResponse = {
      ok: true,
      assessment: "correct",
      message: "回答到位。",
      summary: "认知失调是信念、行为或信息之间的不一致带来的心理不适。",
      shouldFollowUp: false
    };

    expect(tutorStateEvents("answer", response)).toEqual(["FEEDBACK_READY", "SUMMARIZE"]);
  });
});
