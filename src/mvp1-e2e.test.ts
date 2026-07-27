// @vitest-environment happy-dom
// @ts-nocheck
//
// DOM-level golden-path E2E for the MVP-1 Web clearance page.
// The real mvp1App module runs against a stateful in-memory backend emulator,
// so the full journey (question -> answer -> feedback -> follow-up -> end ->
// cautious result -> refresh recovery) is exercised through the actual UI code.
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPORT_ID = "r-e2e";
const CARD_ID = "c-e2e";
const PAGE_URL = `http://localhost/mvp1.html?reportId=${REPORT_ID}&cardId=${CARD_ID}`;

const report = {
  id: REPORT_ID,
  createdAt: "2026-07-27T00:00:00.000Z",
  sections: {
    dangerousGaps: [
      { rank: 1, gap: "不理解 CORS 与网络可达性的边界", whyDangerous: "会把传输问题误判为跨域问题", evidence: "桌面测试通过但设备仍失败" }
    ],
    nextActions: [
      { item: "核对 MDN CORS 文档", route: "verify", reason: "来源存疑" },
      { item: "记录边界判断心得", route: "note", reason: "沉淀" }
    ]
  }
};

const baseSession = {
  id: "s-e2e-1",
  reportId: REPORT_ID,
  cardId: CARD_ID,
  createdAt: "2026-07-27T01:00:00.000Z",
  endedAt: null,
  state: "awaiting_answer",
  originalCard: { id: CARD_ID, target: "CORS 与可达性", prompt: "为什么可达的 API 在 WebView 里仍可能失败？", targetLevel: "L2", difficulty: "intermediate" },
  clearanceQuestion: "网络可达和 CORS 分别在哪个阶段失败？",
  researchSummary: "两者是独立边界。",
  researchMode: "live_ai",
  sources: [
    { id: "source-1", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", title: "MDN CORS", claim: "CORS 控制浏览器端读取跨域响应", type: "official_doc", credibility: "high" }
  ],
  scaffold: [{ id: "point-1", point: "可达性先于浏览器读取权限", whyItMatters: "响应可达但不可读", sourceIds: ["source-1"] }],
  attempts: [],
  finalResult: null
};

function publicView(session) {
  const view = JSON.parse(JSON.stringify(session));
  if (session.attempts.length === 0) delete view.scaffold;
  return view;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// A stateful backend emulator. behavior hooks let individual tests inject
// failures (503, network throw, malformed payloads) at specific endpoints.
function createBackend(behavior = {}) {
  const sessions = new Map();
  const calls = { createSession: 0, answer: 0, end: 0, getSession: 0 };
  let sessionCounter = 0;

  const fetchMock = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();

    if (behavior.networkDown) throw new TypeError("fetch failed");

    if (method === "GET" && url.includes(`/api/mvp0/reports/${REPORT_ID}`)) {
      return json(200, { ok: true, report });
    }

    if (method === "POST" && url.endsWith("/api/mvp1/sessions")) {
      calls.createSession += 1;
      if (behavior.createFails) return json(503, { ok: false, error: "MVP-1 external research requires an active OpenAI API configuration" });
      sessionCounter += 1;
      const session = JSON.parse(JSON.stringify(baseSession));
      session.id = `s-e2e-${sessionCounter}`;
      if (behavior.researchMode) session.researchMode = behavior.researchMode;
      sessions.set(session.id, session);
      return json(200, { ok: true, session: publicView(session) });
    }

    const answerMatch = url.match(/\/api\/mvp1\/sessions\/([^/]+)\/answers$/);
    if (method === "POST" && answerMatch) {
      calls.answer += 1;
      const session = sessions.get(decodeURIComponent(answerMatch[1]));
      if (!session) return json(404, { ok: false, error: "Clearance session not found" });
      if (behavior.answerFails) return json(502, { ok: false, error: "模型超时，请稍后重试" });
      const body = JSON.parse(init.body || "{}");
      const isFirst = session.attempts.length === 0;
      const analysis = isFirst
        ? { status: "needs_practice", coverage: 0.3, demonstrated: ["提到了网络可达"], missing: ["CORS 读取边界"], misconceptions: ["把传输和读取混为一谈"], evidence: ["只描述了传输层"], materialSourceIds: ["source-1"], feedback: "把可达性和读取权限分开就接近了。", teaching: "服务器可以先响应，浏览器再按 CORS 决定 JS 能否读取。", nextQuestion: "CORS 具体控制的是哪一步？", recommendation: "continue" }
        : { status: "provisionally_cleared", coverage: 0.9, demonstrated: ["区分了两个阶段"], missing: [], misconceptions: [], evidence: ["回答覆盖了两个边界"], materialSourceIds: ["source-1"], feedback: "核心边界已经讲清楚。", teaching: "", nextQuestion: "", recommendation: "end" };
      session.attempts.push({ id: `a-${session.attempts.length + 1}`, createdAt: "2026-07-27T01:05:00.000Z", answer: String(body.answer || ""), analysis });
      session.state = analysis.recommendation === "end" ? "ready_to_end" : "teaching";
      return json(200, { ok: true, attempt: session.attempts.at(-1), session: publicView(session) });
    }

    const endMatch = url.match(/\/api\/mvp1\/sessions\/([^/]+)\/end$/);
    if (method === "POST" && endMatch) {
      calls.end += 1;
      const session = sessions.get(decodeURIComponent(endMatch[1]));
      if (!session) return json(404, { ok: false, error: "Clearance session not found" });
      const latest = session.attempts.at(-1)?.analysis;
      session.endedAt = "2026-07-27T01:10:00.000Z";
      session.state = "ended";
      session.finalResult = {
        status: latest?.status || "no_valid_attempt",
        sourceReviewRequired: false,
        evidence: latest?.evidence || [],
        demonstrated: latest?.demonstrated || [],
        remainingGaps: latest?.missing || ["No valid learner attempt was recorded."],
        materialSourceIds: latest?.materialSourceIds || [],
        nextRecommendation: latest ? "请在新的验证任务中应用这段解释，再把它视为稳定能力。" : "请先完成一次有效回答。"
      };
      return json(200, { ok: true, result: session.finalResult, session: publicView(session) });
    }

    const getMatch = url.match(/\/api\/mvp1\/sessions\/([^/]+)$/);
    if (method === "GET" && getMatch) {
      calls.getSession += 1;
      const session = sessions.get(decodeURIComponent(getMatch[1]));
      if (!session) return json(404, { ok: false, error: "Clearance session not found" });
      return json(200, { ok: true, session: publicView(session) });
    }

    return json(404, { ok: false, error: `unmocked ${method} ${url}` });
  };

  return { calls, sessions, fetchMock };
}

async function waitFor(assertion, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }
  throw lastError;
}

function query(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`selector not found: ${selector}\nDOM: ${document.body.innerHTML.slice(0, 800)}`);
  return node;
}

function typeAnswer(text) {
  const textarea = query("textarea.mvp1-answer-input");
  textarea.value = text;
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function bootApp(backend) {
  vi.resetModules();
  window.happyDOM.setURL(PAGE_URL);
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal("fetch", backend.fetchMock);
  await import("./mvp1App");
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("MVP-1 Web golden path (DOM E2E with controlled backend)", () => {
  it("walks question -> answer -> feedback -> follow-up -> end -> cautious result", async () => {
    const backend = createBackend();
    await bootApp(backend);

    // 1. Session created, question shown, hidden scaffold not rendered.
    await waitFor(() => query(".clearance-question"));
    expect(query(".clearance-question").textContent).toContain("网络可达和 CORS");
    expect(document.body.textContent).not.toContain("可达性先于浏览器读取权限");
    expect(document.body.textContent).toContain("首次回答前，系统不会显示任何参考要点");
    expect(document.body.textContent).toContain("MDN CORS");

    // 2. Empty answer must not hit the backend.
    query(".btn-submit-answer").click();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(backend.calls.answer).toBe(0);

    // 3. First answer -> feedback, teaching, follow-up question, cautious status.
    typeAnswer("请求先到服务器，但浏览器可能拦住 JS 读响应。");
    query(".btn-submit-answer").click();
    await waitFor(() => query(".feedback-panel"));
    expect(document.body.textContent).toContain("需要练习");
    expect(document.body.textContent).toContain("教学解释");
    expect(document.body.textContent).toContain("服务器可以先响应");
    expect(document.body.textContent).toContain("下一问");
    expect(document.body.textContent).toContain("CORS 具体控制的是哪一步");
    // Scaffold stays hidden before the session ends.
    expect(document.body.textContent).not.toContain("可达性先于浏览器读取权限");

    // 4. Follow-up answer -> second attempt recorded, comparison visible.
    typeAnswer("CORS 控制的是浏览器端 JS 读取跨域响应的那一步，与传输可达性无关。");
    query(".btn-submit-answer").click();
    await waitFor(() => expect(document.body.textContent).toContain("第 2 次回答"));
    expect(document.body.textContent).toContain("AI 建议可以结束清偿");
    expect(backend.calls.answer).toBe(2);

    // 5. End -> cautious status, disclaimer, reference scaffold, next actions.
    query(".btn-end").click();
    await waitFor(() => query(".final-panel"));
    expect(document.body.textContent).toContain("暂时清偿");
    expect(document.body.textContent).toContain("该状态仅代表本次会话证据，不代表长期掌握");
    expect(document.body.textContent).toContain("参考要点（清偿结束后可见）");
    expect(document.body.textContent).toContain("可达性先于浏览器读取权限");
    expect(document.body.textContent).toContain("核对 MDN CORS 文档");
    expect(document.body.textContent).toContain("请在新的验证任务中应用这段解释");
    expect(backend.calls.end).toBe(1);

    // 6. Session persisted for refresh recovery.
    const stored = JSON.parse(window.sessionStorage.getItem("mindiou-mvp1-session"));
    expect(stored).toMatchObject({ reportId: REPORT_ID, cardId: CARD_ID });
  });

  it("restores an in-flight session after refresh without leaking the scaffold", async () => {
    const backend = createBackend();
    // Pre-seed a session that already has one attempt.
    const restored = JSON.parse(JSON.stringify(baseSession));
    restored.id = "s-e2e-9";
    restored.state = "teaching";
    restored.attempts = [{ id: "a-1", createdAt: "2026-07-27T01:05:00.000Z", answer: "首次回答", analysis: { status: "needs_practice", coverage: 0.3, demonstrated: ["提到了网络可达"], missing: ["CORS 读取边界"], misconceptions: [], evidence: [], materialSourceIds: [], feedback: "继续", teaching: "", nextQuestion: "", recommendation: "continue" } }];
    backend.sessions.set(restored.id, restored);
    window.sessionStorage.setItem("mindiou-mvp1-session", JSON.stringify({ sessionId: restored.id, reportId: REPORT_ID, cardId: CARD_ID }));

    await bootApp(backend);
    await waitFor(() => expect(document.body.textContent).toContain("第 1 次回答"));
    expect(backend.calls.getSession).toBe(1);
    expect(backend.calls.createSession).toBe(0);
    expect(document.body.textContent).toContain("教学中，可继续回答");
    expect(document.body.textContent).not.toContain("可达性先于浏览器读取权限");
  });

  it("offers recreation when the stored session is gone (404)", async () => {
    const backend = createBackend();
    window.sessionStorage.setItem("mindiou-mvp1-session", JSON.stringify({ sessionId: "s-gone", reportId: REPORT_ID, cardId: CARD_ID }));
    await bootApp(backend);

    await waitFor(() => expect(document.body.textContent).toContain("之前的清偿会话已不存在"));
    expect(document.body.textContent).not.toContain("错误：");

    query(".btn-retry").click();
    await waitFor(() => query(".clearance-question"));
    expect(backend.calls.createSession).toBe(1);
  });
});

describe("MVP-1 Web degradation and error paths", () => {
  it("shows the backend error when session creation is unavailable (503)", async () => {
    const backend = createBackend({ createFails: true });
    await bootApp(backend);
    await waitFor(() => expect(document.body.textContent).toContain("错误：MVP-1 external research requires an active OpenAI API configuration"));
    expect(document.querySelector(".clearance-question")).toBeNull();
  });

  it("surfaces answer submission failures, recovers the submit button, and retries", async () => {
    const behavior = { answerFails: true };
    const backend = createBackend(behavior);
    await bootApp(backend);
    await waitFor(() => query(".clearance-question"));

    typeAnswer("网络错误场景下的回答");
    query(".btn-submit-answer").click();
    await waitFor(() => expect(document.body.textContent).toContain("错误：模型超时，请稍后重试"));
    expect(query(".btn-submit-answer").disabled).toBe(false);

    // Backend recovers: the same click path must now succeed.
    behavior.answerFails = false;
    typeAnswer("恢复后重新提交的回答");
    query(".btn-submit-answer").click();
    await waitFor(() => query(".feedback-panel"));
    expect(document.body.textContent).not.toContain("错误：模型超时");
  });

  it("surfaces network failure instead of hanging forever", async () => {
    const backend = createBackend({ networkDown: true });
    await bootApp(backend);
    await waitFor(() => expect(document.body.textContent).toContain("错误：fetch failed"));
  });

  it("labels curated fallback research transparently", async () => {
    const backend = createBackend({ researchMode: "curated_demo_fallback" });
    await bootApp(backend);
    await waitFor(() => query(".clearance-question"));
    expect(document.body.textContent).toContain("策展备用研究材料");
  });

  it("ignores duplicate submit clicks while a request is in flight", async () => {
    const backend = createBackend();
    await bootApp(backend);
    await waitFor(() => query(".clearance-question"));

    typeAnswer("快速连续点击提交按钮");
    const button = query(".btn-submit-answer");
    button.click();
    button.click();
    button.click();
    await waitFor(() => query(".feedback-panel"));
    expect(backend.calls.answer).toBe(1);
  });

  it("ends without attempts as no_valid_attempt with a visible gap note", async () => {
    const backend = createBackend();
    await bootApp(backend);
    await waitFor(() => query(".clearance-question"));
    query(".btn-end").click();
    await waitFor(() => query(".final-panel"));
    expect(document.body.textContent).toContain("无有效回答");
    expect(document.body.textContent).toContain("No valid learner attempt was recorded.");
  });

  it("shows an explicit error instead of a blank page when reportId/cardId are missing", async () => {
    const backend = createBackend();
    vi.resetModules();
    window.happyDOM.setURL("http://localhost/mvp1.html");
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", backend.fetchMock);
    await import("./mvp1App");
    await waitFor(() => expect(document.body.textContent).toContain("缺少 reportId 或 cardId 参数"));
  });
});
