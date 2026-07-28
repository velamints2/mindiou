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

describe("Mentra 清偿状态机 · 异常与边界", () => {
  it("后端会话缺少 clearanceQuestion 时回退到入口卡片 prompt，且不泄露 scaffold", async () => {
    const screens: ScreenSpec[] = [];
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => entry,
      startSession: async () => makeSession({ clearanceQuestion: "" }),
      submitAnswer: async () => { throw new Error("unreachable"); },
      endSession: async () => { throw new Error("unreachable"); }
    });
    await runtime.dispatch({ type: "start" });
    expect(runtime.getState().phase).toBe("question");
    const text = `${screens.at(-1)?.title}\n${screens.at(-1)?.text}`;
    expect(text).toContain("可达的 API 在 WebView 里仍可能失败");
    expect(text).not.toContain(SCAFFOLD_POINT);
  });

  it("AI 反馈字段全部缺失时给出保守占位而非空白屏", async () => {
    const screens: ScreenSpec[] = [];
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => entry,
      startSession: async () => makeSession(),
      submitAnswer: async () => ({
        attempt: { id: "a1", createdAt: "", answer: "x", analysis: analysis({ feedback: "", teaching: "", nextQuestion: "" }) },
        session: makeSession({ state: "answered" })
      }),
      endSession: async () => { throw new Error("unreachable"); }
    });
    await runtime.dispatch({ type: "start" });
    await runtime.handleUtterance("任何回答");
    expect(runtime.getState().phase).toBe("feedback");
    expect(screens.at(-1)?.text).toContain("已记录本次回答。");
  });

  it("结算结果字段缺失时不崩溃，仍展示参考答案与谨慎状态", async () => {
    const screens: ScreenSpec[] = [];
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => entry,
      startSession: async () => makeSession(),
      submitAnswer: async () => { throw new Error("unreachable"); },
      endSession: async () => ({
        result: { status: "needs_verification" } as never,
        session: makeSession({ state: "ended" })
      })
    });
    await runtime.dispatch({ type: "start" });
    await runtime.handleUtterance("结束");
    expect(runtime.getState().phase).toBe("conclusion");
    const text = screens.map(s => `${s.title}\n${s.text}`).join("\n");
    expect(text).toContain(`参考答案：${SCAFFOLD_POINT}`);
    expect(text).toContain("需要查证");
  });

  it("结算会话未揭示 scaffold 时参考答案回退到教学文本", async () => {
    const screens: ScreenSpec[] = [];
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => entry,
      startSession: async () => makeSession(),
      submitAnswer: async () => ({
        attempt: { id: "a1", createdAt: "", answer: "x", analysis: analysis({ teaching: "教学回退文本" }) },
        session: makeSession({ state: "answered" })
      }),
      endSession: async () => ({
        result: { status: "needs_practice", sourceReviewRequired: false, evidence: [], demonstrated: [], remainingGaps: [], nextRecommendation: "" },
        session: makeSession({ state: "ended", scaffold: undefined })
      })
    });
    await runtime.dispatch({ type: "start" });
    await runtime.handleUtterance("回答一下");
    await runtime.handleUtterance("结束");
    const text = screens.map(s => `${s.title}\n${s.text}`).join("\n");
    expect(text).toContain("参考答案：教学回退文本");
  });

  it("反馈/结算阶段的语音不会变成新的回答提交", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("第一次回答");
    expect(h.runtime.getState().phase).toBe("feedback");
    const before = h.calls.filter(c => c.startsWith("submitAnswer")).length;
    await h.runtime.handleUtterance("这是一段很长的解释不应该被当作新回答提交因为当前不在问答阶段");
    expect(h.calls.filter(c => c.startsWith("submitAnswer")).length).toBe(before);
  });

  it("纯空白语音被忽略，不产生提交", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("   ");
    expect(h.calls.filter(c => c.startsWith("submitAnswer")).length).toBe(0);
    expect(h.runtime.getState().phase).toBe("question");
  });

  it("提交失败后重试会重新提交同一回答", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    h.failNext.set("submitAnswer", new Error("socket hangup"));
    await h.runtime.handleUtterance("网络层面的回答");
    expect(h.runtime.getState().phase).toBe("error");
    await h.runtime.handleUtterance("重试");
    expect(h.calls.filter(c => c === "submitAnswer:网络层面的回答").length).toBe(2);
    expect(h.runtime.getState().phase).toBe("feedback");
  });

  it("结算失败后重试会重新调用 endSession", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    h.failNext.set("endSession", new Error("503"));
    await h.runtime.handleUtterance("结束");
    expect(h.runtime.getState().phase).toBe("error");
    await h.runtime.handleGesture("TAP");
    expect(h.calls.filter(c => c === "endSession:s1").length).toBe(2);
    expect(h.runtime.getState().phase).toBe("conclusion");
  });

  it("没有下一张卡片时，结算后继续会重新读取入口", async () => {
    const screens: ScreenSpec[] = [];
    const calls: string[] = [];
    const singleEntry = { ...entry, nextCardId: null } as never;
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => { calls.push("fetchEntry"); return singleEntry; },
      startSession: async () => { calls.push("startSession"); return makeSession(); },
      submitAnswer: async () => { throw new Error("unreachable"); },
      endSession: async () => ({
        result: { status: "provisionally_cleared", sourceReviewRequired: false, evidence: [], demonstrated: [], remainingGaps: [], nextRecommendation: "" },
        session: makeSession({ state: "ended" })
      })
    });
    await runtime.dispatch({ type: "start" });
    await runtime.handleUtterance("结束");
    expect(runtime.getState().phase).toBe("conclusion");
    await runtime.handleGesture("TAP");
    expect(calls.filter(c => c === "fetchEntry").length).toBe(2);
  });
});

describe("Mentra 清偿状态机 · P0/P1 缺口补充", () => {
  // 局部辅助：从单个 ScreenSpec 拼出可断言文本（与外层 lastText 同语义，但不依赖 Harness）。
  const textOf = (s: ScreenSpec | undefined) =>
    `${s?.title || ""}\n${s?.text || ""}${s?.top || ""}${s?.bottom || ""}`;

  it("P0 缺口 1：AI 反馈多页翻页交互（pageDown/pageUp/边界提示/repeat）", async () => {
    const screens: ScreenSpec[] = [];
    // 构造超过 FEEDBACK_PAGE_MAX=92 的反馈，使 paginate 产生 2+ 页
    const longFeedback =
      "CORS 是浏览器同源策略的延伸，控制 JavaScript 能否读取跨域响应。服务器可达仅证明传输层通，CORS 决定浏览器是否把响应交给脚本。预检请求单独验证方法与自定义头部。这是传输层与浏览器策略的边界。";
    const runtime = new ClearanceRuntime({
      show: s => screens.push(s),
      fetchEntry: async () => entry,
      startSession: async () => makeSession(),
      submitAnswer: async () => ({
        attempt: {
          id: "a1",
          createdAt: "",
          answer: "x",
          analysis: analysis({ feedback: longFeedback, teaching: "" })
        },
        session: makeSession({ state: "answered" })
      }),
      endSession: async () => { throw new Error("unreachable"); }
    });
    await runtime.dispatch({ type: "start" });
    await runtime.handleUtterance("任意回答");
    expect(runtime.getState().phase).toBe("feedback");
    expect(runtime.getState().pages.length).toBeGreaterThanOrEqual(2);
    // 初始显示第 1 页
    expect(textOf(screens.at(-1))).toContain("反馈 1/");
    // SWIPE_DOWN（pageDown）→ 第 2 页
    await runtime.handleGesture("SWIPE_DOWN");
    expect(textOf(screens.at(-1))).toContain("反馈 2/");
    // SWIPE_UP（pageUp）→ 回到第 1 页
    await runtime.handleGesture("SWIPE_UP");
    expect(textOf(screens.at(-1))).toContain("反馈 1/");
    // 在第 1 页 SWIPE_UP → "已是第一页" 提示
    await runtime.handleGesture("SWIPE_UP");
    expect(textOf(screens.at(-1))).toContain("已是第一页");
    // SWIPE_DOWN → 第 2 页
    await runtime.handleGesture("SWIPE_DOWN");
    expect(textOf(screens.at(-1))).toContain("反馈 2/");
    // 在最后一页 SWIPE_DOWN → "已是最后一页" 提示（不进入追问）
    await runtime.handleGesture("SWIPE_DOWN");
    expect(textOf(screens.at(-1))).toContain("已是最后一页");
    // repeat（DOUBLE_TAP）→ 重新显示当前页（第 2 页）
    await runtime.handleGesture("DOUBLE_TAP");
    expect(textOf(screens.at(-1))).toContain("反馈 2/");
  });

  it("P0 缺口 2：startSession 失败后重试恢复到 question", async () => {
    const h = makeHarness();
    h.failNext.set("startSession", new Error("503 service unavailable"));
    await h.runtime.dispatch({ type: "start" });
    expect(h.runtime.getState().phase).toBe("error");
    expect(lastText(h)).toContain("出错了");
    // 重试 → 重新调用 startSession（pending 保留）→ 恢复到 question
    await h.runtime.handleUtterance("重试");
    expect(h.calls.filter(c => c === "startSession:c1").length).toBe(2);
    expect(h.runtime.getState().phase).toBe("question");
    expect(lastText(h)).toContain("欠条 1/2");
  });

  it("P0 缺口 3：后端 data 类异常进入 error 态且可重试", async () => {
    // 模拟 BackendClient 在 session.id 缺失时抛出的 data 类异常：
    // createBackendClient.startSession 校验 !session.id 时抛 BackendError("data", "后端未返回清偿会话")。
    // 状态机经由 guard 捕获后进入 error 态；friendlyError 对非网络错误给出"暂时无法继续：..."友好文案。
    // 这里用普通 Error 模拟（failNext 接受任意 Error），friendlyError 输出与 BackendError("data",...) 一致。
    const h = makeHarness();
    h.failNext.set("startSession", new Error("后端未返回清偿会话"));
    await h.runtime.dispatch({ type: "start" });
    expect(h.runtime.getState().phase).toBe("error");
    expect(lastText(h)).toContain("出错了");
    expect(lastText(h)).toContain("暂时无法继续");
    expect(lastText(h)).toContain("后端未返回清偿会话");
    // 可重试 → 恢复到 question
    await h.runtime.handleUtterance("重试");
    expect(h.runtime.getState().phase).toBe("question");
  });

  it("P1 缺口 4：question 阶段 next 直接跳过当前卡片打开下一张", async () => {
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    expect(h.runtime.getState().phase).toBe("question");
    // TRIPLE_TAP → next → beginNextCard（entry.nextCardId=c2）
    await h.runtime.handleGesture("TRIPLE_TAP");
    expect(h.calls).toContain("startSession:c2");
    expect(h.runtime.getState().phase).toBe("question");
  });

  it("P1 缺口 5：followup 与 error 阶段不泄露 scaffold", async () => {
    // followup 阶段：屏幕只显示追问问题，不含 scaffold
    const h = makeHarness();
    await h.runtime.dispatch({ type: "start" });
    await h.runtime.handleUtterance("随便说说"); // → feedback（needs_practice，有 nextQuestion）
    await h.runtime.handleGesture("TAP"); // continue → followup
    expect(h.runtime.getState().phase).toBe("followup");
    expect(lastText(h)).not.toContain(SCAFFOLD_POINT);

    // error 阶段：屏幕只显示错误文案与提示，不含 scaffold
    const h2 = makeHarness();
    h2.failNext.set("submitAnswer", new Error("提交失败"));
    await h2.runtime.dispatch({ type: "start" });
    await h2.runtime.handleUtterance("回答");
    expect(h2.runtime.getState().phase).toBe("error");
    expect(lastText(h2)).not.toContain(SCAFFOLD_POINT);
  });
});
