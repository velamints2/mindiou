// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import {
  generateCollaborationTimeline,
  generateFallbackTimeline,
  getTimelineSystemPrompt,
  normalizeTimeline
} from "../mvp0-timeline.js";

const SAMPLE_TEXT = `
User: 帮我做一个认知欠条产品。先读取 report.html。
Assistant: 读取了 report.html，发现 state 纯内存，无恢复逻辑。
User: 修复刷新丢失的问题。
Assistant: 添加了 sessionStorage 存 report id，restoreReport() 调用 GET /api/mvp0/reports/:id。
User: 继续。
Assistant: normalizeGapArray pad 到 5、truncate 到 5，normalizeCardArray 强制 3-5 张。
User: 好的。
Assistant: 配置 Vite dev proxy /api 到 localhost:8793，181 项测试全绿。
`;

const MOCK_AI_TIMELINE = {
  steps: [
    { title: "读取现有报告页面", aiDid: "读取 report.html，诊断出 state 纯内存无恢复逻辑", keyActions: ["read report.html"], keyConcepts: ["state 管理"] },
    { title: "修复刷新丢失", aiDid: "添加 sessionStorage 恢复机制", keyActions: ["edit reportApp.ts"], keyConcepts: ["sessionStorage", "恢复边界"] },
    { title: "强制 schema 数量", aiDid: "normalizeGapArray 与 normalizeCardArray 增加 pad/truncate", keyActions: ["edit mvp0-fallback.js"], keyConcepts: ["schema 规范化"] },
    { title: "配置开发代理", aiDid: "Vite proxy /api 到 localhost:8793 并跑通测试", keyActions: ["edit vite.config.ts", "npm test"], keyConcepts: ["dev proxy"] }
  ]
};

describe("normalizeTimeline", () => {
  it("assigns stable step ids and defaults userConfusion to empty string", () => {
    const timeline = normalizeTimeline({
      steps: [
        { title: "第一步", aiDid: "AI 做了一件事" },
        { title: "第二步", aiDid: "AI 做了另一件事" }
      ]
    });
    expect(timeline.steps).toHaveLength(2);
    expect(timeline.steps[0].id).toBe("step-1");
    expect(timeline.steps[1].id).toBe("step-2");
    expect(timeline.steps[0].userConfusion).toBe("");
    expect(timeline.steps[0].title).toBe("第一步");
  });

  it("accepts a raw steps array", () => {
    const timeline = normalizeTimeline([{ title: "只有一步" }]);
    expect(timeline.steps).toHaveLength(1);
    expect(timeline.steps[0].title).toBe("只有一步");
  });

  it("caps at 10 steps", () => {
    const timeline = normalizeTimeline({
      steps: Array.from({ length: 15 }, (_, i) => ({ title: `步骤 ${i + 1}` }))
    });
    expect(timeline.steps).toHaveLength(10);
    expect(timeline.steps[9].id).toBe("step-10");
  });

  it("clamps keyActions to 6 and keyConcepts to 3", () => {
    const timeline = normalizeTimeline({
      steps: [{
        title: "步骤",
        keyActions: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"],
        keyConcepts: ["c1", "c2", "c3", "c4", "c5"]
      }]
    });
    expect(timeline.steps[0].keyActions).toHaveLength(6);
    expect(timeline.steps[0].keyConcepts).toHaveLength(3);
  });

  it("handles non-object steps and empty input", () => {
    const timeline = normalizeTimeline({ steps: ["纯字符串步骤", null] });
    expect(timeline.steps).toHaveLength(2);
    expect(timeline.steps[0].title).toBe("纯字符串步骤");
    expect(normalizeTimeline(null).steps).toEqual([]);
    expect(normalizeTimeline({}).steps).toEqual([]);
  });

  it("preserves a userConfusion already present (round-trip from store)", () => {
    const timeline = normalizeTimeline({
      steps: [{ title: "步骤", userConfusion: "我不懂为什么要用 sessionStorage" }]
    });
    expect(timeline.steps[0].userConfusion).toBe("我不懂为什么要用 sessionStorage");
  });
});

describe("generateFallbackTimeline", () => {
  it("produces 3-5 structural steps for multi-sentence text", () => {
    const timeline = generateFallbackTimeline(SAMPLE_TEXT);
    expect(timeline.steps.length).toBeGreaterThanOrEqual(3);
    expect(timeline.steps.length).toBeLessThanOrEqual(5);
  });

  it("labels steps as structural splits, not AI analysis", () => {
    const timeline = generateFallbackTimeline(SAMPLE_TEXT);
    for (const step of timeline.steps) {
      expect(step.title).toContain("结构性拆分");
    }
  });

  it("is deterministic for the same input", () => {
    const first = generateFallbackTimeline(SAMPLE_TEXT);
    const second = generateFallbackTimeline(SAMPLE_TEXT);
    expect(first).toEqual(second);
  });

  it("produces a single placeholder step for empty text", () => {
    const timeline = generateFallbackTimeline("");
    expect(timeline.steps.length).toBeGreaterThanOrEqual(1);
    expect(timeline.steps[0].aiDid).toBeTruthy();
  });

  it("initializes every step with empty userConfusion", () => {
    const timeline = generateFallbackTimeline(SAMPLE_TEXT);
    for (const step of timeline.steps) {
      expect(step.userConfusion).toBe("");
    }
  });
});

describe("generateCollaborationTimeline", () => {
  it("returns normalized AI steps on success", async () => {
    const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_TIMELINE);
    const timeline = await generateCollaborationTimeline(SAMPLE_TEXT, "chatgpt", mockChatFn);

    expect(timeline.generation).toEqual({ fallback: false, error: "" });
    expect(timeline.steps).toHaveLength(4);
    expect(timeline.steps[0].id).toBe("step-1");
    expect(timeline.steps[0].title).toBe("读取现有报告页面");
    expect(timeline.steps[1].keyConcepts).toContain("sessionStorage");
    expect(timeline.steps.every(step => step.userConfusion === "")).toBe(true);
  });

  it("calls chatFn with system prompt and JSON user payload", async () => {
    const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_TIMELINE);
    await generateCollaborationTimeline(SAMPLE_TEXT, "claude", mockChatFn);

    expect(mockChatFn).toHaveBeenCalledTimes(1);
    const [messages] = mockChatFn.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    const payload = JSON.parse(messages[1].content);
    expect(payload.artifactType).toBe("claude");
    expect(payload.artifactText).toContain("认知欠条");
  });

  it("preserves the AI note when input is not collaboration material", async () => {
    const mockChatFn = vi.fn().mockResolvedValue({ steps: [], note: "输入是百科词条，不是 AI 协作材料" });
    const timeline = await generateCollaborationTimeline("水是一种无机化合物。", "other", mockChatFn);
    expect(timeline.generation.fallback).toBe(false);
    expect(timeline.steps).toEqual([]);
    expect(timeline.note).toContain("百科");
  });

  it("falls back when chatFn is null", async () => {
    const timeline = await generateCollaborationTimeline(SAMPLE_TEXT, "chatgpt", null);
    expect(timeline.generation.fallback).toBe(true);
    expect(timeline.generation.error).toContain("not configured");
    expect(timeline.steps.length).toBeGreaterThanOrEqual(3);
    expect(timeline.steps[0].title).toContain("结构性拆分");
  });

  it("falls back when chatFn returns a fallback marker", async () => {
    const mockChatFn = vi.fn().mockResolvedValue({ __useFallback: true });
    const timeline = await generateCollaborationTimeline(SAMPLE_TEXT, "chatgpt", mockChatFn);
    expect(timeline.generation.fallback).toBe(true);
  });

  it("falls back with the provider error when chatFn returns __fallback", async () => {
    const mockChatFn = vi.fn().mockResolvedValue({
      __fallback: true,
      __fallbackError: "OPENAI_API_KEY is not set"
    });
    const timeline = await generateCollaborationTimeline(SAMPLE_TEXT, "chatgpt", mockChatFn);
    expect(timeline.generation.fallback).toBe(true);
    expect(timeline.generation.error).toContain("OPENAI_API_KEY");
  });

  it("falls back when chatFn throws", async () => {
    const mockChatFn = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const timeline = await generateCollaborationTimeline(SAMPLE_TEXT, "chatgpt", mockChatFn);
    expect(timeline.generation.fallback).toBe(true);
    expect(timeline.generation.error).toContain("Network timeout");
  });

  it("falls back when AI returns malformed output", async () => {
    const mockChatFn = vi.fn().mockResolvedValue({ unexpected: "shape" });
    const timeline = await generateCollaborationTimeline(SAMPLE_TEXT, "chatgpt", mockChatFn);
    expect(timeline.generation.fallback).toBe(true);
    expect(timeline.generation.error).toContain("malformed");
  });

  it("defaults invalid artifactType to other in the user payload", async () => {
    const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_TIMELINE);
    await generateCollaborationTimeline(SAMPLE_TEXT, "invalid-type", mockChatFn);
    const payload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
    expect(payload.artifactType).toBe("other");
  });
});

describe("timeline system prompt", () => {
  it("specifies the 3-10 step range", () => {
    expect(getTimelineSystemPrompt()).toContain("3-10");
  });

  it("forbids fabricating actions and requires real behaviors", () => {
    const prompt = getTimelineSystemPrompt();
    expect(prompt).toContain("不得编造");
    expect(prompt).toContain("真实发生的行为");
  });

  it("handles non-collaboration input with an explicit note", () => {
    const prompt = getTimelineSystemPrompt();
    expect(prompt).toContain('"steps":[]');
    expect(prompt).toContain("note");
  });

  it("limits keyConcepts to 1-3", () => {
    expect(getTimelineSystemPrompt()).toContain("1-3 个概念");
  });
});
