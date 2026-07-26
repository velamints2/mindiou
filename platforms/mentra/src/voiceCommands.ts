/**
 * 语音命令表。与 Rokid 端 platforms/rokid-aiui/utils/learning.js 语义保持一致：
 * 短指令用于导航，长句一律视为学习回答。
 */
export type VoiceCommand =
  | "next"
  | "previous"
  | "repeat"
  | "ask"
  | "known"
  | "skip"
  | "end"
  | "answer";

export function commandFromUtterance(value: string): VoiceCommand {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？,，]/g, "");
  if (!text || text.length > 12) return "answer";
  if (["下一个", "下一题", "下一张", "next"].includes(text)) return "next";
  if (["上一个", "上一题", "上一张", "previous"].includes(text)) return "previous";
  if (["重复", "再说一遍", "repeat"].includes(text)) return "repeat";
  if (["提问", "问我", "ask"].includes(text)) return "ask";
  if (["会了", "懂了", "got it", "known"].includes(text)) return "known";
  if (["跳过", "skip"].includes(text)) return "skip";
  if (["结束清偿", "结束学习", "完成清偿", "结束", "end", "stop"].includes(text)) return "end";
  return "answer";
}

export type ControlAction =
  | "continue"
  | "next"
  | "repeat"
  | "end"
  | "pageUp"
  | "pageDown"
  | "retry";

/** Mentra 触控手势（G2 电容触控条）→ 控制动作。未识别手势返回空串。 */
export function controlFromGesture(gestureName: string): ControlAction | "" {
  const gesture = String(gestureName || "").trim().toUpperCase();
  switch (gesture) {
    case "TAP":
      return "continue";
    case "DOUBLE_TAP":
      return "repeat";
    case "TRIPLE_TAP":
      return "next";
    case "PRESS_HOLD":
      return "end";
    case "SWIPE_UP":
      return "pageUp";
    case "SWIPE_DOWN":
      return "pageDown";
    default:
      return "";
  }
}

/** 语音命令 → 控制动作；answer 由调用方单独处理。 */
export function controlFromCommand(command: VoiceCommand): ControlAction | "" {
  switch (command) {
    case "next":
    case "skip":
      return "next";
    case "repeat":
    case "ask":
      return "repeat";
    case "known":
    case "end":
      return "end";
    default:
      return "";
  }
}
