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
import type {
  BackendClient,
  ClearanceAnalysis,
  ClearanceAttempt,
  ClearanceEntry,
  ClearanceFinalResult,
  ClearanceSession
} from "./backendClient.js";
import { friendlyError } from "./backendClient.js";
import { FEEDBACK_PAGE_MAX, QUESTION_MAX, concise, paginate, statusLabel } from "./displayText.js";
import { commandFromUtterance, controlFromCommand, controlFromGesture } from "./voiceCommands.js";

export type FlowPhase =
  | "idle"
  | "loading"
  | "empty"
  | "starting"
  | "question"
  | "submitting"
  | "feedback"
  | "followup"
  | "ending"
  | "conclusion"
  | "error";

/** 屏幕描述：app.ts 负责映射到 SDK layouts。 */
export interface ScreenSpec {
  layout: "referenceCard" | "doubleTextWall" | "textWall";
  title?: string;
  text?: string;
  top?: string;
  bottom?: string;
}

export type FlowEffect =
  | { type: "show"; screen: ScreenSpec }
  | { type: "fetchEntry" }
  | { type: "startSession"; reportId: string; cardId: string }
  | { type: "submitAnswer"; answer: string }
  | { type: "endSession" };

export type FlowEvent =
  | { type: "start" }
  | { type: "entryLoaded"; entry: ClearanceEntry | null }
  | { type: "sessionStarted"; session: ClearanceSession }
  | { type: "utterance"; text: string }
  | { type: "analysisReady"; attempt: ClearanceAttempt; session: ClearanceSession }
  | { type: "endReady"; result: ClearanceFinalResult; session: ClearanceSession }
  | { type: "control"; action: string }
  | { type: "failed"; error: string };

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

export function initialState(): FlowState {
  return {
    phase: "idle",
    entry: null,
    sessionId: "",
    question: "",
    lastAnalysis: null,
    pages: [],
    pageIndex: 0,
    lastResult: null,
    referenceAnswer: "",
    error: "",
    busy: false,
    pending: null
  };
}

/* ---------- 屏幕构造 ---------- */

function cardTitle(entry: ClearanceEntry | null): string {
  return entry ? `欠条 ${entry.cardNumber}/${entry.cardCount}` : "认知欠条";
}

function questionScreen(state: FlowState, prefix = ""): ScreenSpec {
  return {
    layout: "referenceCard",
    title: `${prefix}${cardTitle(state.entry)}`,
    text: concise(state.question, QUESTION_MAX)
  };
}

function feedbackPages(analysis: ClearanceAnalysis): string[] {
  const parts = [analysis.feedback, analysis.teaching]
    .map(item => String(item || "").trim())
    .filter(Boolean);
  return paginate(parts.join("\n") || "已记录本次回答。", FEEDBACK_PAGE_MAX);
}

function pageScreen(state: FlowState, kind: "反馈" | "结算"): ScreenSpec {
  const total = state.pages.length || 1;
  const index = Math.min(state.pageIndex, total - 1);
  const label =
    kind === "反馈"
      ? statusLabel(state.lastAnalysis?.status || "")
      : statusLabel(state.lastResult?.status || "");
  return {
    layout: "referenceCard",
    title: `${kind} ${index + 1}/${total} · ${label}`,
    text: state.pages[index] || ""
  };
}

function followupScreen(state: FlowState): ScreenSpec {
  return {
    layout: "referenceCard",
    title: `追问 · ${cardTitle(state.entry)}`,
    text: concise(state.lastAnalysis?.nextQuestion || "", QUESTION_MAX)
  };
}

function conclusionPages(result: ClearanceFinalResult, referenceAnswer: string): string[] {
  const lines: string[] = [];
  if (referenceAnswer) lines.push(`参考答案：${referenceAnswer}`);
  if (Array.isArray(result.demonstrated) && result.demonstrated.length) {
    lines.push(`已体现：${result.demonstrated.slice(0, 2).join("；")}`);
  }
  if (Array.isArray(result.remainingGaps) && result.remainingGaps.length) {
    lines.push(`仍未覆盖：${result.remainingGaps.slice(0, 2).join("；")}`);
  }
  if (result.nextRecommendation) lines.push(`下一步：${result.nextRecommendation}`);
  return paginate(lines.join("\n") || "本次清偿已结束。", FEEDBACK_PAGE_MAX);
}

/** 参考答案来自后端结算会话中已揭示的 scaffold；缺失时回退到教学文本。 */
export function referenceFromSession(session: ClearanceSession | null, fallback = ""): string {
  const points = (session?.scaffold || []).map(item => String(item?.point || "").trim()).filter(Boolean);
  if (points.length) return points.join("；");
  return String(fallback || "").trim();
}

function textWall(text: string): ScreenSpec {
  return { layout: "textWall", text };
}

function hint(text: string): FlowEffect {
  return { type: "show", screen: textWall(text) };
}

function show(screen: ScreenSpec): FlowEffect {
  return { type: "show", screen };
}

/* ---------- 异步效果封装 ---------- */

interface AsyncStep {
  state: FlowState;
  effects: FlowEffect[];
}

function beginAsync(state: FlowState, effect: FlowEffect, ack: ScreenSpec): AsyncStep {
  return {
    state: { ...state, busy: true, pending: effect },
    effects: [show(ack), effect]
  };
}

function beginEndSession(state: FlowState): AsyncStep {
  return {
    ...beginAsync(state, { type: "endSession" }, textWall("正在结算…")),
    state: { ...state, phase: "ending", busy: true, pending: { type: "endSession" } }
  };
}

function beginNextCard(state: FlowState): AsyncStep {
  const entry = state.entry;
  if (entry?.nextCardId) {
    const effect: FlowEffect = { type: "startSession", reportId: entry.reportId, cardId: entry.nextCardId };
    return {
      state: { ...state, phase: "starting", busy: true, pending: effect },
      effects: [show(textWall("正在打开下一张欠条…")), effect]
    };
  }
  // 没有下一张：重新读取入口（后端会挑出下一张未答卡或给出空态）。
  return {
    state: { ...state, phase: "loading", busy: true, pending: { type: "fetchEntry" } },
    effects: [show(textWall("正在读取最新欠条…")), { type: "fetchEntry" }]
  };
}

/* ---------- 控制动作 ---------- */

function reduceControl(state: FlowState, action: string): AsyncStep {
  const noop: AsyncStep = { state, effects: [] };
  if (state.busy) return noop;

  switch (state.phase) {
    case "question":
    case "followup": {
      if (action === "end") return beginEndSession(state);
      if (action === "next") return beginNextCard(state);
      if (action === "repeat") return { state, effects: [show(questionScreen(state))] };
      return { state, effects: [hint("请直接说出你的解释；说「结束」结算，说「重复」再看问题。")] };
    }
    case "feedback": {
      const total = state.pages.length;
      if (action === "pageUp") {
        if (state.pageIndex <= 0) return { state, effects: [hint("已是第一页。")] };
        const next = { ...state, pageIndex: state.pageIndex - 1 };
        return { state: next, effects: [show(pageScreen(next, "反馈"))] };
      }
      if (action === "pageDown") {
        if (state.pageIndex >= total - 1) return { state, effects: [hint("已是最后一页，说「继续」前进。")] };
        const next = { ...state, pageIndex: state.pageIndex + 1 };
        return { state: next, effects: [show(pageScreen(next, "反馈"))] };
      }
      if (action === "repeat") return { state, effects: [show(pageScreen(state, "反馈"))] };
      if (action === "end") return beginEndSession(state);
      if (action === "next") return beginNextCard(state);
      if (action === "continue") {
        if (state.pageIndex < total - 1) {
          const next = { ...state, pageIndex: state.pageIndex + 1 };
          return { state: next, effects: [show(pageScreen(next, "反馈"))] };
        }
        if (state.lastAnalysis?.nextQuestion) {
          const next = { ...state, phase: "followup" as FlowPhase };
          return { state: next, effects: [show(followupScreen(next))] };
        }
        return beginEndSession(state);
      }
      return noop;
    }
    case "conclusion": {
      const total = state.pages.length;
      if (action === "pageUp" && state.pageIndex > 0) {
        const next = { ...state, pageIndex: state.pageIndex - 1 };
        return { state: next, effects: [show(pageScreen(next, "结算"))] };
      }
      if (action === "pageDown" && state.pageIndex < total - 1) {
        const next = { ...state, pageIndex: state.pageIndex + 1 };
        return { state: next, effects: [show(pageScreen(next, "结算"))] };
      }
      if (action === "repeat") return { state, effects: [show(pageScreen(state, "结算"))] };
      if (action === "continue" || action === "next") return beginNextCard(state);
      if (action === "end") {
        return {
          state: { ...initialState() },
          effects: [show(textWall("已结束。完整报告与结论请在 Web 端查看。"))]
        };
      }
      return noop;
    }
    case "empty": {
      if (action === "continue" || action === "retry" || action === "repeat") {
        return {
          state: { ...state, phase: "loading", busy: true, pending: { type: "fetchEntry" } },
          effects: [show(textWall("正在重新读取…")), { type: "fetchEntry" }]
        };
      }
      if (action === "end") {
        return { state: { ...initialState() }, effects: [show(textWall("已退出。"))] };
      }
      return noop;
    }
    case "error": {
      if (action === "retry" || action === "repeat" || action === "continue") {
        const pending = state.pending || { type: "fetchEntry" };
        return {
          state: { ...state, busy: true, pending },
          effects: [show(textWall("正在重试…")), pending]
        };
      }
      if (action === "end") {
        return { state: { ...initialState() }, effects: [show(textWall("已退出。"))] };
      }
      return noop;
    }
    default:
      return noop;
  }
}

/* ---------- 主 reducer ---------- */

export function reduce(state: FlowState, event: FlowEvent): AsyncStep {
  // 异步完成事件不被 busy 拦截；控制/回答事件在 busy 时忽略。
  switch (event.type) {
    case "start": {
      // 会话重入：任何时候都允许从头开始（仅重新读取入口，无副作用）。
      return {
        state: { ...initialState(), phase: "loading", busy: true, pending: { type: "fetchEntry" } },
        effects: [show(textWall("正在读取最新欠条…")), { type: "fetchEntry" }]
      };
    }
    case "entryLoaded": {
      const entry = event.entry;
      if (!entry) {
        return {
          state: { ...state, phase: "empty", busy: false, pending: null, entry: null },
          effects: [
            show({
              layout: "referenceCard",
              title: "暂无欠条",
              text: "后端还没有可清偿的卡片。请先在 Web 端生成报告。"
            })
          ]
        };
      }
      const effect: FlowEffect = { type: "startSession", reportId: entry.reportId, cardId: entry.cardId };
      return {
        state: { ...state, phase: "starting", entry, busy: true, pending: effect },
        effects: [show(textWall(`正在打开${cardTitle(entry)}…`)), effect]
      };
    }
    case "sessionStarted": {
      const session = event.session;
      const next: FlowState = {
        ...state,
        phase: "question",
        sessionId: session.id,
        question: session.clearanceQuestion || state.entry?.prompt || "请用自己的话解释这个问题。",
        lastAnalysis: null,
        lastResult: null,
        referenceAnswer: "",
        pages: [],
        pageIndex: 0,
        busy: false,
        pending: null
      };
      // 安全边界：session.scaffold 在此刻绝不进入显示文本。
      return { state: next, effects: [show(questionScreen(next))] };
    }
    case "utterance": {
      if (state.busy) return { state, effects: [] };
      if (state.phase !== "question" && state.phase !== "followup") return { state, effects: [] };
      const answer = String(event.text || "").trim();
      if (!answer) return { state, effects: [] };
      const effect: FlowEffect = { type: "submitAnswer", answer };
      return {
        state: { ...state, phase: "submitting", busy: true, pending: effect },
        effects: [show(textWall("已收到，正在分析…")), effect]
      };
    }
    case "analysisReady": {
      const analysis = event.attempt.analysis;
      const next: FlowState = {
        ...state,
        phase: "feedback",
        lastAnalysis: analysis,
        pages: feedbackPages(analysis),
        pageIndex: 0,
        busy: false,
        pending: null
      };
      return { state: next, effects: [show(pageScreen(next, "反馈"))] };
    }
    case "endReady": {
      const reference = referenceFromSession(event.session, state.lastAnalysis?.teaching || "");
      const next: FlowState = {
        ...state,
        phase: "conclusion",
        lastResult: event.result,
        referenceAnswer: reference,
        pages: conclusionPages(event.result, reference),
        pageIndex: 0,
        busy: false,
        pending: null
      };
      return { state: next, effects: [show(pageScreen(next, "结算"))] };
    }
    case "failed": {
      const next: FlowState = { ...state, phase: "error", busy: false, error: event.error };
      return {
        state: next,
        effects: [
          show({
            layout: "referenceCard",
            title: "出错了",
            text: concise(`${event.error}\n说「重试」或点击触控重试；说「结束」退出。`, FEEDBACK_PAGE_MAX)
          })
        ]
      };
    }
    case "control":
      return reduceControl(state, event.action);
    default:
      return { state, effects: [] };
  }
}

/* ---------- 运行时：执行效果并与外部端口交互 ---------- */

export interface FlowPorts {
  show(screen: ScreenSpec): void;
  fetchEntry(): Promise<ClearanceEntry | null>;
  startSession(reportId: string, cardId: string): Promise<ClearanceSession>;
  submitAnswer(
    sessionId: string,
    answer: string
  ): Promise<{ attempt: ClearanceAttempt; session: ClearanceSession }>;
  endSession(sessionId: string): Promise<{ result: ClearanceFinalResult; session: ClearanceSession }>;
}

export class ClearanceRuntime {
  private state: FlowState = initialState();

  constructor(private readonly ports: FlowPorts) {}

  getState(): FlowState {
    return this.state;
  }

  async dispatch(event: FlowEvent): Promise<void> {
    const { state, effects } = reduce(this.state, event);
    this.state = state;
    for (const effect of effects) {
      await this.run(effect);
    }
  }

  /** 语音入口：短指令走控制，长句走回答。 */
  async handleUtterance(text: string): Promise<void> {
    const command = commandFromUtterance(text);
    if (command === "answer") {
      await this.dispatch({ type: "utterance", text });
      return;
    }
    const action = controlFromCommand(command);
    if (action) await this.dispatch({ type: "control", action });
  }

  /** 触控手势入口。 */
  async handleGesture(gestureName: string): Promise<void> {
    const action = controlFromGesture(gestureName);
    if (action) await this.dispatch({ type: "control", action });
  }

  /** 物理按键：短按=继续，长按=结束。 */
  async handleButton(pressType: string): Promise<void> {
    if (pressType === "short") await this.dispatch({ type: "control", action: "continue" });
    else if (pressType === "long") await this.dispatch({ type: "control", action: "end" });
  }

  private async run(effect: FlowEffect): Promise<void> {
    switch (effect.type) {
      case "show":
        this.ports.show(effect.screen);
        return;
      case "fetchEntry":
        await this.guard(() => this.ports.fetchEntry(), entry => ({ type: "entryLoaded", entry }) as FlowEvent);
        return;
      case "startSession":
        await this.guard(
          () => this.ports.startSession(effect.reportId, effect.cardId),
          session => ({ type: "sessionStarted", session }) as FlowEvent
        );
        return;
      case "submitAnswer":
        await this.guard(
          () => this.ports.submitAnswer(this.state.sessionId, effect.answer),
          ({ attempt, session }) => ({ type: "analysisReady", attempt, session }) as FlowEvent
        );
        return;
      case "endSession":
        await this.guard(
          () => this.ports.endSession(this.state.sessionId),
          ({ result, session }) => ({ type: "endReady", result, session }) as FlowEvent
        );
        return;
    }
  }

  private async guard<T>(operation: () => Promise<T>, onSuccess: (value: T) => FlowEvent): Promise<void> {
    try {
      const value = await operation();
      await this.dispatch(onSuccess(value));
    } catch (error) {
      await this.dispatch({ type: "failed", error: friendlyError(error) });
    }
  }
}

/** 由共享后端客户端构造端口（app.ts 使用）。 */
export function portsFromBackend(backend: BackendClient, show: (screen: ScreenSpec) => void): FlowPorts {
  return {
    show,
    fetchEntry: () => backend.fetchClearanceEntry(),
    startSession: (reportId, cardId) => backend.startSession(reportId, cardId),
    submitAnswer: (sessionId, answer) => backend.submitAnswer(sessionId, answer),
    endSession: sessionId => backend.endSession(sessionId)
  };
}
