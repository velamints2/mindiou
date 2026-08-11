/**
 * MindIOU 清偿流程状态机（纯逻辑，不依赖 @mentra/sdk，可单测）。
 *
 * 黄金路径：
 *   入口欠条 → 问题 → 语音回答 → AI 反馈（分页）→ 继续 → 追问/结算
 *   → 谨慎结论 + 参考答案 → 下一张欠条。
 *
 * 约束：
 * - scaffold 在用户首次回答前绝不进入显示文本；
 * - 先反馈后追问；结束先给参考答案再进下一张；
 * - 异步操作进行中（busy）忽略新的控制/回答事件；
 * - 每个被识别的控制都有即时显示反馈。
 */
import type { BackendClient, ClearanceAnalysis, ClearanceAttempt, ClearanceEntry, ClearanceFinalResult, ClearanceSession } from "./backendClient.js";
export type FlowPhase = "idle" | "loading" | "empty" | "starting" | "question" | "submitting" | "feedback" | "followup" | "ending" | "conclusion" | "error";
/** 屏幕描述：app.ts 负责映射到 SDK layouts。 */
export interface ScreenSpec {
    layout: "referenceCard" | "doubleTextWall" | "textWall";
    title?: string;
    text?: string;
    top?: string;
    bottom?: string;
}
export type FlowEffect = {
    type: "show";
    screen: ScreenSpec;
} | {
    type: "fetchEntry";
} | {
    type: "startSession";
    reportId: string;
    cardId: string;
} | {
    type: "submitAnswer";
    answer: string;
} | {
    type: "endSession";
};
export type FlowEvent = {
    type: "start";
} | {
    type: "entryLoaded";
    entry: ClearanceEntry | null;
} | {
    type: "sessionStarted";
    session: ClearanceSession;
} | {
    type: "utterance";
    text: string;
} | {
    type: "analysisReady";
    attempt: ClearanceAttempt;
    session: ClearanceSession;
} | {
    type: "endReady";
    result: ClearanceFinalResult;
    session: ClearanceSession;
} | {
    type: "control";
    action: string;
} | {
    type: "failed";
    error: string;
};
export interface FlowState {
    phase: FlowPhase;
    entry: ClearanceEntry | null;
    sessionId: string;
    question: string;
    lastAnalysis: ClearanceAnalysis | null;
    pages: string[];
    pageIndex: number;
    lastResult: ClearanceFinalResult | null;
    referenceAnswer: string;
    error: string;
    /** 有异步操作进行中时为 true，期间忽略控制/回答事件。 */
    busy: boolean;
    /** 最近一次异步效果，用于失败后的「重试」。 */
    pending: FlowEffect | null;
}
export declare function initialState(): FlowState;
/** 参考答案来自后端结算会话中已揭示的 scaffold；缺失时回退到教学文本。 */
export declare function referenceFromSession(session: ClearanceSession | null, fallback?: string): string;
interface AsyncStep {
    state: FlowState;
    effects: FlowEffect[];
}
export declare function reduce(state: FlowState, event: FlowEvent): AsyncStep;
export interface FlowPorts {
    show(screen: ScreenSpec): void;
    fetchEntry(): Promise<ClearanceEntry | null>;
    startSession(reportId: string, cardId: string): Promise<ClearanceSession>;
    submitAnswer(sessionId: string, answer: string): Promise<{
        attempt: ClearanceAttempt;
        session: ClearanceSession;
    }>;
    endSession(sessionId: string): Promise<{
        result: ClearanceFinalResult;
        session: ClearanceSession;
    }>;
}
export declare class ClearanceRuntime {
    private readonly ports;
    private state;
    constructor(ports: FlowPorts);
    getState(): FlowState;
    dispatch(event: FlowEvent): Promise<void>;
    /** 语音入口：短指令走控制，长句走回答。 */
    handleUtterance(text: string): Promise<void>;
    /** 触控手势入口。 */
    handleGesture(gestureName: string): Promise<void>;
    /** 物理按键：短按=继续，长按=结束。 */
    handleButton(pressType: string): Promise<void>;
    private run;
    private guard;
}
/** 由共享后端客户端构造端口（app.ts 使用）。 */
export declare function portsFromBackend(backend: BackendClient, show: (screen: ScreenSpec) => void): FlowPorts;
export {};
