import { describe, expect, it } from "vitest";
import type { ClearanceAnalysis, ClearanceEntry, ClearanceSession } from "../src/backendClient.js";
import { ClearanceRuntime, FlowPorts, ScreenSpec, initialState, reduce, referenceFromSession } from "../src/clearanceFlow.js";

const entry: ClearanceEntry = {
  reportId: "r1",
  cardId: "c1",
  nextCardId: "c2",
  createdAt: "2026-07-26T00:00:00.000Z",
  domain: "G2 WebView 网络",
  target: "CORS 与可达性",
  prompt: "解释为什么可达的 API 在 WebView 里仍可能失败。",
  cardNumber: 1,
  cardCount: 2
};

const SCAFFOLD_POINT = "可达性先于浏览器响应读取，CORS 决定 JS 能否读到响应";

function makeSession(overrides: Partial<ClearanceSession> = {}): ClearanceSession {
  return {
    id: "s1",
    reportId: "r1",
    cardId: "c1",
    state: "awaiting_answer",
    clearanceQuestion: "可达的 API 为什么在 WebView 里仍可能失败？",
    sources: [{ id: "source-1", type: "official_doc", title: "MDN CORS" }],
    scaffold: [{ id: "point-1", point: SCAFFOLD_POINT }],
    attempts: [],
    ...overrides
  };
}

function analysis(overrides: Partial<ClearanceAnalysis> = {}): ClearanceAnalysis {
  return {
    status: "needs_practice",
    coverage: 0.2,
    demonstrated: ["提到网络"],
    missing: ["CORS 边界"],
    misconceptions: [],
    evidence: [],
    feedback: "要把传输层和浏览器读取分开。",
    teaching: "服务器可以先响应，CORS 再决定 JS 能否读取。",
    nextQuestion: "CORS 具体控制什么？",
    recommendation: "continue",
    ...overrides
  };
}

interface Harness {
  runtime: ClearanceRuntime;
  screens: ScreenSpec[];
  calls: string[];
  failNext: Map<string, Error>;
}

function makeHarness(): Harness {
  const screens: ScreenSpec[] = [];
  const calls: string[] = [];
  const failNext = new Map<string, Error>();
  const maybeFail = (name: string) => {
    const error = failNext.get(name);
    if (error) {
      failNext.delete(name);
      throw error;
    }
  };
  const ports: FlowPorts = {
    show: screen => screens.push(screen),
    fetchEntry: async () => {
      calls.push("fetchEntry");
      maybeFail("fetchEntry");
      return entry;
    },
    startSession: async (reportId, cardId) => {
      calls.push(`startSession:${cardId}`);
      maybeFail("startSession");
      return makeSession({ cardId });
    },
    submitAnswer: async (sessionId, answer) => {
      calls.push(`submitAnswer:${answer.slice(0, 8)}`);
      maybeFail("submitAnswer");
      const good = answer.includes("JavaScript");
      return {
        attempt: {
          id: "a1",
          createdAt: "2026-07-26T00:00:00.000Z",
          answer,
          analysis: analysis(
            good
              ? { status: "provisionally_cleared", feedback: "边界讲清楚了。", teaching: "", nextQuestion: "", recommendation: "end" }
              : {}
          )
        },
        session: makeSession({ state: "answered" })
      };
    },
    endSession: async sessionId => {
      calls.push(`endSession:${sessionId}`);
      maybeFail("endSession");
      return {
        result: {
          status: "provisionally_cleared",
          sourceReviewRequired: false,
          evidence: ["回答覆盖两个边界"],
          demonstrated: ["区分传输与读取"],
          remainingGaps: [],
          nextRecommendation: "在真机复验一次"
        },
        session: makeSession({ state: "ended" })
      };
    }
  };
  return { runtime: new ClearanceRuntime(ports), screens, calls, failNext };
}

const lastScreen = (h: Harness) => h.screens[h.screens.length - 1];
const lastText = (h: Harness) => {
  const s = lastScreen(h);
  return `${s?.title || ""}\n${s?.text || ""}${s?.top || ""}${s?.bottom || ""}`;
};

describe("Mentra 清偿状态机 · 黄金路径", () => {
  it("启动→问题：显示欠条问题且不泄露 scaffold", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    expect(h.calls).toEqual(["fetchEntry", "startSession:c1"]);
    expect(h.runtime.getState().phase).toBe("question");
    expect(lastText(h)).toContain("欠条 1/2");
    expect(lastText(h)).toContain("WebView");
    expect(lastText(h)).not.toContain(SCAFFOLD_POINT);
  });

  it("入口为空显示空态", async () => {
    const screens: ScreenSpec[] = [];
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => null,
      startSession: async () => makeSession(),
      submitAnswer: async () => { throw new Error("unreachable"); },
      endSession: async () => { throw new Error("unreachable"); }
    });
    await runtime.dispatch({ type: "start" });
    expect(runtime.getState().phase).toBe("empty");
    expect(screens.at(-1)?.title).toBe("暂无欠条");
  });

  it("回答→先反馈：提交有即时确认，反馈先于追问", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("可能是网络不通导致的跨域问题吧");
    expect(h.calls.some(c => c.startsWith("submitAnswer:可能是网络不通"))).toBe(true);
    expect(h.runtime.getState().phase).toBe("feedback");
    // 显示序列：…「已收到，正在分析…」在反馈页之前
    const ackIndex = h.screens.findIndex(s => s.text === "已收到，正在分析…");
    const feedbackIndex = h.screens.findIndex(s => (s.title || "").startsWith("反馈"));
    expect(ackIndex).toBeGreaterThan(-1);
    expect(feedbackIndex).toBeGreaterThan(ackIndex);
    expect(lastText(h)).toContain("继续练习");
    // 反馈阶段不泄露 scaffold
    expect(lastText(h)).not.toContain(SCAFFOLD_POINT);
  });

  it("继续→追问→再答→结束→参考答案→下一张", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("网络问题");
    // 继续 → 追问（先反馈后追问）
    await h.runtime.handleGesture("TAP");
    expect(h.runtime.getState().phase).toBe("followup");
    expect(lastText(h)).toContain("CORS 具体控制什么？");
    // 再答（好答案 → recommendation end，无追问）
    await h.runtime.handleUtterance("服务器可达不代表 JavaScript 能读到跨域响应");
    expect(h.runtime.getState().phase).toBe("feedback");
    expect(lastText(h)).toContain("暂时清偿");
    // 继续 → 无追问 → 自动结算
    await h.runtime.handleGesture("TAP");
    expect(h.calls).toContain("endSession:s1");
    expect(h.runtime.getState().phase).toBe("conclusion");
    // 结算先给参考答案（来自已揭示的 scaffold）
    expect(lastText(h)).toContain(`参考答案：${SCAFFOLD_POINT}`);
    expect(lastText(h)).toContain("暂时清偿");
    expect(lastText(h)).toContain("在真机复验一次");
    // 继续 → 下一张欠条
    await h.runtime.handleGesture("TAP");
    expect(h.calls).toContain("startSession:c2");
    expect(h.runtime.getState().phase).toBe("question");
  });

  it("用户可在任意时刻主动结束（不问模型建议）", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("随便说说");
    expect(h.runtime.getState().phase).toBe("feedback");
    await h.runtime.handleGesture("PRESS_HOLD");
    expect(h.calls).toContain("endSession:s1");
    expect(h.runtime.getState().phase).toBe("conclusion");
  });

  it("语音命令导航：说「结束」与长按等价", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("结束");
    expect(h.calls).toContain("endSession:s1");
  });

  it("后端失败显示错误态，重试恢复", async () => {
    const h = makeHarness();
    h.failNext.set("fetchEntry", new Error("fetch failed"));
    await h.runtime.dispatch({ type: "start" });
    expect(h.runtime.getState().phase).toBe("error");
    expect(lastText(h)).toContain("出错了");
    expect(lastText(h)).toContain("网络");
    // 重试
    await h.runtime.handleUtterance("重复");
    expect(h.runtime.getState().phase).toBe("question");
  });

  it("异步进行中忽略新的控制（busy 守卫）", () => {
    // 直接用同步 reducer 验证：busy=true 时控制与回答均不产生效果。
    const busyState = { ...initialState(), phase: "submitting" as const, busy: true, pending: { type: "endSession" as const } };
    const viaControl = reduce(busyState, { type: "control", action: "end" });
    expect(viaControl.effects).toEqual([]);
    expect(viaControl.state).toBe(busyState);
    const viaUtterance = reduce(busyState, { type: "utterance", text: "继续解释" });
    expect(viaUtterance.effects).toEqual([]);
  });

  it("会话重入：再次 start 重新开始", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("回答一");
    await h.runtime.dispatch({ type: "start" });
    expect(h.runtime.getState().phase).toBe("question");
    expect(h.calls.filter(c => c === "fetchEntry").length).toBe(2);
  });

  it("物理按键：短按继续、长按结束", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("网络问题");
    await h.runtime.handleButton("short"); // 反馈页继续 → 追问
    expect(h.runtime.getState().phase).toBe("followup");
    await h.runtime.handleButton("long"); // 追问页长按 → 结束
    expect(h.calls).toContain("endSession:s1");
  });

  it("结算页结束 → 退出到初始态", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("结束");
    expect(h.runtime.getState().phase).toBe("conclusion");
    await h.runtime.handleGesture("PRESS_HOLD");
    expect(h.runtime.getState().phase).toBe("idle");
    expect(lastText(h)).toContain("Web 端");
  });
});

describe("referenceFromSession", () => {
  it("优先使用已揭示 scaffold", () => {
    expect(referenceFromSession(makeSession())).toBe(SCAFFOLD_POINT);
  });

  it("缺失时回退教学文本", () => {
    expect(referenceFromSession(makeSession({ scaffold: undefined }), "回退文本")).toBe("回退文本");
  });
});
