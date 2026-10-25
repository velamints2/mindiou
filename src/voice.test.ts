import { describe, expect, it } from "vitest";
import { parseVoiceAction, voiceActionForContext } from "./voice";

describe("glasses voice commands for progress and debts", () => {
  it.each([
    ["看项目", "projects"],
    ["项目", "projects"],
    ["项目进度", "projects"],
    ["查项目", "projects"],
    ["show projects", "projects"],
    ["project status", "projects"],
    ["看欠条", "debts"],
    ["欠条", "debts"],
    ["认知欠条", "debts"],
    ["我的欠条", "debts"],
    ["my debts", "debts"],
    ["考我", "ask"],
    ["考我一下", "ask"],
    ["出题", "quiz"],
    ["问我", "ask"],
    ["test me", "quiz"],
    ["记录", "record"],
    ["提交", "record"],
    ["记下来", "record"],
    ["save evidence", "record"],
    ["继续这个", "focus"],
    ["继续推进", "focus"],
    ["就做这个", "focus"],
    ["去学习", "learn"],
    ["学习模式", "learn"],
    ["背单词", "learn"]
  ])("parses %s as %s", (input, expected) => {
    expect(parseVoiceAction(input)).toBe(expected);
  });

  it("keeps legacy learning commands intact", () => {
    expect(parseVoiceAction("下一张")).toBe("next");
    expect(parseVoiceAction("记住了")).toBe("known");
    expect(parseVoiceAction("再说一遍")).toBe("repeat");
    expect(parseVoiceAction("考我一下这道题")).toBeNull();
  });

  it("maps overlapping ask words to ask first; debt mode promotes them to quiz", () => {
    expect(parseVoiceAction("考我")).toBe("ask");
    expect(parseVoiceAction("问我")).toBe("ask");
    expect(parseVoiceAction("出题")).toBe("quiz");
  });

  it("suppresses command parsing while a spoken answer is expected", () => {
    expect(voiceActionForContext("看项目", { answerExpected: true })).toBeNull();
    expect(voiceActionForContext("看项目", { audioDurationMs: 5000 })).toBeNull();
    expect(voiceActionForContext("看项目", {})).toBe("projects");
  });
});
