/**
 * 阶段2：clearanceFlow 经 Stamp adapter 驱动真实清偿流程。
 * 用内存 BackendClient 桩 + MockDisplay，验证业务状态机未被复制、显示经 Stamp 协议输出。
 */
import { describe, expect, it } from "vitest";
import type {
  BackendClient,
  ClearanceEntry,
  ClearanceSession
} from "../../../mentra/src/backendClient.js";
import { MockDisplayBackend } from "../src/mockDisplay.js";
import { createStampRuntime, dispatchControl, showViaAdapter, startStampFlow } from "../src/stampFlow.js";

function makeEntry(): ClearanceEntry {
  return {
    reportId: "r1",
    cardId: "c1",
    nextCardId: "",
    createdAt: "2026-08-06",
    domain: "db",
    target: "索引",
    prompt: "解释索引",
    cardNumber: 1,
    cardCount: 1
  };
}

function makeSession(id: string): ClearanceSession {
  return {
    id,
    reportId: "r1",
    cardId: "c1",
    state: "active",
    clearanceQuestion: "用自己的话解释数据库索引为什么能加速查询？",
    sources: [],
    scaffold: [{ point: "B+ 树减少磁盘 IO" }],
    attempts: []
  };
}

function makeBackend(): BackendClient {
  return {
    async fetchClearanceEntry() { return makeEntry(); },
    async startSession() { return makeSession("s1"); },
    async submitAnswer() {
      return {
        attempt: {
          id: "a1",
          createdAt: "2026-08-06",
          answer: "因为快",
          analysis: {
            status: "needs_practice",
            coverage: 0.4,
            demonstrated: ["提到快"],
            missing: ["磁盘 IO"],
            misconceptions: [],
            evidence: [],
            feedback: "你提到了快，但没说清 B+ 树减少磁盘 IO 的原理。",
            teaching: "索引通过 B+ 树把随机磁盘读转为少量顺序读。",
            nextQuestion: "",
            recommendation: "end"
          }
        },
        session: makeSession("s1")
      };
    },
    async endSession() {
      return {
        result: {
          status: "needs_practice",
          sourceReviewRequired: false,
          evidence: [],
          demonstrated: ["提到快"],
          remainingGaps: ["磁盘 IO"],
          nextRecommendation: "再解释一次，说明磁盘 IO"
        },
        session: makeSession("s1")
      };
    }
  };
}

describe("clearanceFlow → Stamp MockDisplay 端到端", () => {
  it("show 端口经 adapter 输出（1,2）", async () => {
    const display = new MockDisplayBackend();
    const runtime = createStampRuntime({ backend: makeBackend(), adapter: display });
    await startStampFlow(runtime);
    // 启动后应显示问题卡
    expect(display.frames.some(f => f.kind === "card")).toBe(true);
    const lastCard = [...display.frames].reverse().find(f => f.kind === "card" && f.screen?.layout === "referenceCard");
    expect(lastCard?.screen?.text).toContain("索引");
  });

  it("完整清偿流程：问题→回答→反馈→结束→结论（E2E）", async () => {
    const display = new MockDisplayBackend();
    const runtime = createStampRuntime({ backend: makeBackend(), adapter: display });
    await startStampFlow(runtime);
    expect(runtime.getState().phase).toBe("question");

    // 模拟回答（走 utterance 入口）
    await runtime.handleUtterance("因为索引让查询变快，不用全表扫描。");
    expect(runtime.getState().phase).toBe("feedback");
    expect(display.lastText()).toContain("B+ 树");

    // 继续 → 无追问则结算
    await dispatchControl(runtime, "end");
    expect(runtime.getState().phase).toBe("conclusion");
    expect(display.lastText()).toContain("参考答案");
  });

  it("next/repeat 控制经 dispatch 进入状态机（5）", async () => {
    const display = new MockDisplayBackend();
    const runtime = createStampRuntime({ backend: makeBackend(), adapter: display });
    await startStampFlow(runtime);
    const before = display.frames.length;
    await dispatchControl(runtime, "repeat");
    expect(display.frames.length).toBeGreaterThan(before);
  });

  it("业务状态机来自 mentra，不在 stamp 内复制", async () => {
    // createStampRuntime 内部用 clearanceFlow 的 ClearanceRuntime
    const runtime = createStampRuntime({ backend: makeBackend(), adapter: new MockDisplayBackend() });
    expect(runtime.constructor.name).toBe("ClearanceRuntime");
    expect(typeof runtime.handleUtterance).toBe("function");
    expect(typeof runtime.getState).toBe("function");
  });

  it("showViaAdapter 把 textWall 分发到 showText", async () => {
    const display = new MockDisplayBackend();
    const show = showViaAdapter(display);
    show({ layout: "textWall", text: "正在读取…" });
    await new Promise(r => setTimeout(r, 10));
    expect(display.frames.some(f => f.kind === "text")).toBe(true);
  });
});
