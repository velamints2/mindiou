import test from "node:test";
import assert from "node:assert/strict";
import {
  assessmentToReview,
  clearanceStatusLabel,
  commandFromUtterance,
  conciseClearanceText,
  conciseFeedback,
  conciseQuestion
} from "../utils/learning.js";
import {
  fetchClearanceEntry,
  loadClearanceSession,
  saveClearanceSession,
  startClearance,
  submitClearanceAnswer
} from "../utils/api.js";

test("short explicit commands are classified conservatively", () => {
  assert.equal(commandFromUtterance("下一题"), "next");
  assert.equal(commandFromUtterance("上一张。"), "previous");
  assert.equal(commandFromUtterance("会了"), "known");
  assert.equal(commandFromUtterance("再说一遍"), "repeat");
  assert.equal(commandFromUtterance("结束清偿"), "end");
});

test("clearance feedback stays short and uses cautious labels", () => {
  assert.equal(clearanceStatusLabel("provisionally_cleared"), "暂时清偿");
  assert.equal(clearanceStatusLabel("needs_verification"), "需要查证");
  assert.equal(conciseClearanceText({ feedback: "a".repeat(120) }).length, 96);
});

test("glasses questions are compact without shrinking the display type", () => {
  const question = conciseQuestion(`  ${"问题".repeat(50)}  `);
  assert.equal(question.length, 48);
  assert.ok(question.endsWith("…"));
});

test("glasses questions prefer a complete sentence over a broken second clause", () => {
  const question = conciseQuestion("为什么会出现 D 状态？请继续解释 I/O wait、设备延迟、日志与请求尾延迟之间的完整关系。", 32);
  assert.equal(question, "为什么会出现 D 状态？");
});

test("Rokid clearance API uses the shared MVP-1 contract and local session storage", async () => {
  const calls = [];
  const storage = new Map();
  globalThis.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    async request(options) {
      calls.push(options);
      return { statusCode: 200, data: { ok: true, session: { id: "session-1" } } };
    }
  };
  const config = { apiBaseUrl: "http://127.0.0.1:8793", apiToken: "", duration: 60 };
  await fetchClearanceEntry(config);
  await startClearance(config, "report one", "card/one");
  await submitClearanceAnswer(config, "session/1", "我的解释");
  saveClearanceSession({ id: "session-1", state: "awaiting_answer" });

  assert.equal(calls[0].url, "http://127.0.0.1:8793/api/rokid/clearance-entry");
  assert.deepEqual(calls[1].data, { reportId: "report one", cardId: "card/one" });
  assert.match(calls[2].url, /session%2F1\/answers$/);
  assert.equal(loadClearanceSession().id, "session-1");
  delete globalThis.wx;
});

test("Rokid API accepts the browser Ink runtime Response shape", async () => {
  globalThis.wx = {
    async request() {
      return new Response(JSON.stringify({ ok: true, entry: { cardId: "card-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };

  const payload = await fetchClearanceEntry({
    apiBaseUrl: "http://127.0.0.1:8793",
    apiToken: ""
  });

  assert.equal(payload.entry.cardId, "card-1");
  delete globalThis.wx;
});

test("Interactive InkView falls back to fetch when wx is not injected", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  delete globalThis.wx;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, session: { id: "fetch-session" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const payload = await startClearance({
      apiBaseUrl: "https://demo.example/mindiou-api",
      apiToken: ""
    }, "report-id", "card-id");

    assert.equal(payload.session.id, "fetch-session");
    assert.equal(calls[0].url, "https://demo.example/mindiou-api/api/mvp1/sessions");
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      reportId: "report-id",
      cardId: "card-id"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Interactive InkView uses localStorage when wx storage is unavailable", () => {
  const values = new Map();
  const originalStorage = globalThis.localStorage;
  delete globalThis.wx;
  globalThis.localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };

  try {
    saveClearanceSession({ id: "browser-session", state: "awaiting_answer" });
    assert.deepEqual(loadClearanceSession(), {
      id: "browser-session",
      state: "awaiting_answer"
    });
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test("Rokid API accepts the callback-based wx.request shape", async () => {
  globalThis.wx = {
    request(options) {
      queueMicrotask(() => options.success({
        statusCode: 200,
        data: { ok: true, entry: { cardId: "callback-card" } }
      }));
    }
  };

  const payload = await fetchClearanceEntry({
    apiBaseUrl: "http://127.0.0.1:8793",
    apiToken: ""
  });

  assert.equal(payload.entry.cardId, "callback-card");
  delete globalThis.wx;
});

test("Rokid can load a configured report without using the global latest-report endpoint", async () => {
  const calls = [];
  globalThis.wx = {
    async request(options) {
      calls.push(options);
      return {
        statusCode: 200,
        data: {
          ok: true,
          report: {
            id: "private-report",
            createdAt: "2026-07-15T00:00:00.000Z",
            analysis: { userCapability: { currentDomain: "Server operations" } },
            sections: {
              feynmanCards: [
                { id: "private-card", target: "I/O wait", prompt: "Explain I/O wait." }
              ]
            }
          }
        }
      };
    }
  };

  const payload = await fetchClearanceEntry({
    apiBaseUrl: "https://demo.example/mindiou-api",
    apiToken: "",
    reportId: "private-report",
    cardId: "private-card"
  });

  assert.equal(calls[0].url, "https://demo.example/mindiou-api/api/mvp0/reports/private-report");
  assert.equal(payload.entry.cardId, "private-card");
  assert.equal(payload.entry.domain, "服务器部署与运维");
  delete globalThis.wx;
});

test("long explanations remain answers even when they contain command words", () => {
  assert.equal(
    commandFromUtterance("我认为下一题的核心不是切换，而是先解释当前概念"),
    "answer"
  );
  assert.equal(
    commandFromUtterance("Backpressure means the producer slows down when the consumer cannot keep up."),
    "answer"
  );
});

test("AI assessment maps to transparent review states", () => {
  assert.equal(assessmentToReview("correct"), "mastered");
  assert.equal(assessmentToReview("partial"), "partial");
  assert.equal(assessmentToReview("incorrect"), "incorrect");
  assert.equal(assessmentToReview("unknown"), "partial");
});

test("glasses feedback prefers the concise display contract", () => {
  assert.equal(
    conciseFeedback({
      display: { feedback: "补一个真实例子" },
      tutor: { g2Text: "unused" }
    }),
    "补一个真实例子"
  );
});
