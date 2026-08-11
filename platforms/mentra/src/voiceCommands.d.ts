/**
 * 语音命令表。与 Rokid 端 platforms/rokid-aiui/utils/learning.js 语义保持一致：
 * 短指令用于导航，长句一律视为学习回答。
 */
export type VoiceCommand = "next" | "previous" | "repeat" | "ask" | "known" | "skip" | "end" | "retry" | "answer";
export declare function commandFromUtterance(value: string): VoiceCommand;
export type ControlAction = "continue" | "next" | "repeat" | "end" | "pageUp" | "pageDown" | "retry";
/** Mentra 触控手势（G2 电容触控条）→ 控制动作。未识别手势返回空串。 */
export declare function controlFromGesture(gestureName: string): ControlAction | "";
/** 语音命令 → 控制动作；answer 由调用方单独处理。 */
export declare function controlFromCommand(command: VoiceCommand): ControlAction | "";
