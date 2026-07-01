import { describe, expect, it } from "vitest";
import { parseVoiceAction, TranscriptIntake, voiceActionForContext } from "./voice";

describe("voice action parser", () => {
  it("recognizes short explicit Chinese commands", () => {
    expect(parseVoiceAction("下一张")).toBe("next");
    expect(parseVoiceAction("下一章")).toBe("next");
    expect(parseVoiceAction("下一張")).toBe("next");
    expect(parseVoiceAction("帮我下一张")).toBe("next");
    expect(parseVoiceAction("我会了")).toBe("known");
    expect(parseVoiceAction("问我")).toBe("ask");
    expect(parseVoiceAction("再说一遍")).toBe("repeat");
  });

  it("recognizes short explicit English commands", () => {
    expect(parseVoiceAction("next")).toBe("next");
    expect(parseVoiceAction("please skip this")).toBe("next");
    expect(parseVoiceAction("got it")).toBe("known");
    expect(parseVoiceAction("quiz me")).toBe("ask");
    expect(parseVoiceAction("say again")).toBe("repeat");
  });

  it("does not treat explanatory answers containing command words as commands", () => {
    expect(parseVoiceAction("这个概念不是下一个问题，而是上下文的意思")).toBeNull();
    expect(parseVoiceAction("我觉得 resilient 是遇到困难也不会跳过")).toBeNull();
    expect(parseVoiceAction("I think next means the following item in a sequence")).toBeNull();
    expect(parseVoiceAction("I got it wrong because I forgot the example")).toBeNull();
    expect(parseVoiceAction("repeat means to say something one more time")).toBeNull();
  });

  it("disables commands while an answer is expected or an utterance is long", () => {
    expect(voiceActionForContext("下一张", { answerExpected: true })).toBeNull();
    expect(voiceActionForContext("下一张", { audioDurationMs: 8000 })).toBeNull();
    expect(voiceActionForContext("下一张", { audioDurationMs: 1200 })).toBe("next");
  });

  it("deduplicates repeated transcripts inside a short window", () => {
    const intake = new TranscriptIntake(3000);

    expect(intake.accept("下一张", 1000).accepted).toBe(true);
    expect(intake.accept("下一张", 2000)).toMatchObject({ accepted: false, reason: "duplicate" });
    expect(intake.accept("下一张", 4500).accepted).toBe(true);
  });

  it("allows different transcripts and ignores empty transcripts", () => {
    const intake = new TranscriptIntake(3000);

    expect(intake.accept("   ", 1000)).toMatchObject({ accepted: false, reason: "empty" });
    expect(intake.accept("next", 1000).accepted).toBe(true);
    expect(intake.accept("repeat", 1200).accepted).toBe(true);
  });
});
