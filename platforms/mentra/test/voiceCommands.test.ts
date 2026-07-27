import { describe, expect, it } from "vitest";
import { commandFromUtterance, controlFromCommand, controlFromGesture } from "../src/voiceCommands.js";

describe("commandFromUtterance", () => {
  it("识别导航短指令", () => {
    expect(commandFromUtterance("下一个")).toBe("next");
    expect(commandFromUtterance("上一张")).toBe("previous");
    expect(commandFromUtterance("重复")).toBe("repeat");
    expect(commandFromUtterance("结束")).toBe("end");
    expect(commandFromUtterance("会了")).toBe("known");
  });

  it("容错标点与大小写", () => {
    expect(commandFromUtterance("下一个。")).toBe("next");
    expect(commandFromUtterance("Next!")).toBe("next");
    expect(commandFromUtterance("结束清偿，")).toBe("end");
  });

  it("长句一律视为学习回答", () => {
    expect(commandFromUtterance("因为 CORS 是浏览器层面的响应读取控制，和网络可达性是两回事")).toBe("answer");
  });

  it("空文本视为回答（由上层忽略）", () => {
    expect(commandFromUtterance("   ")).toBe("answer");
  });
});

describe("controlFromGesture", () => {
  it("映射 G2 触控手势", () => {
    expect(controlFromGesture("TAP")).toBe("continue");
    expect(controlFromGesture("DOUBLE_TAP")).toBe("repeat");
    expect(controlFromGesture("TRIPLE_TAP")).toBe("next");
    expect(controlFromGesture("PRESS_HOLD")).toBe("end");
    expect(controlFromGesture("SWIPE_UP")).toBe("pageUp");
    expect(controlFromGesture("SWIPE_DOWN")).toBe("pageDown");
  });

  it("未识别手势返回空串", () => {
    expect(controlFromGesture("QUAD_TAP")).toBe("");
    expect(controlFromGesture("")).toBe("");
  });
});

describe("controlFromCommand", () => {
  it("语音命令映射为控制动作", () => {
    expect(controlFromCommand("next")).toBe("next");
    expect(controlFromCommand("skip")).toBe("next");
    expect(controlFromCommand("repeat")).toBe("repeat");
    expect(controlFromCommand("known")).toBe("end");
    expect(controlFromCommand("end")).toBe("end");
  });

  it("answer/previous 不产生控制动作", () => {
    expect(controlFromCommand("answer")).toBe("");
    expect(controlFromCommand("previous")).toBe("");
  });
});
