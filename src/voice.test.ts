import { describe, expect, it } from "vitest";
import { parseVoiceAction } from "./voice";

describe("voice action parser", () => {
  it("recognizes short explicit Chinese commands", () => {
    expect(parseVoiceAction("下一张")).toBe("next");
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
});
