import { describe, expect, it } from "vitest";
import { FEEDBACK_PAGE_MAX, QUESTION_MAX, concise, paginate, statusLabel } from "../src/displayText.js";

describe("concise", () => {
  it("保留短文本原文", () => {
    expect(concise("为什么 CORS 会失败？", QUESTION_MAX)).toBe("为什么 CORS 会失败？");
  });

  it("优先在句子边界截断", () => {
    const text = "可达性先于 CORS。CORS 控制浏览器能否读取跨域响应，这一点非常关键。";
    expect(concise(text, 12)).toBe("可达性先于 CORS。");
  });

  it("无句子边界时加省略号", () => {
    const long = "这是一段没有任何标点符号的长文本用来验证硬截断行为是否会发生";
    const result = concise(long, 12);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("压缩空白", () => {
    expect(concise("  你好 \n 世界  ")).toBe("你好 世界");
  });
});

describe("paginate", () => {
  it("短文本只有一页", () => {
    expect(paginate("短文本")).toEqual(["短文本"]);
  });

  it("长文本按句子边界分页且不超页长", () => {
    const sentence = "这是用来凑长度的一句完整反馈。";
    const text = sentence.repeat(12);
    const pages = paginate(text, FEEDBACK_PAGE_MAX);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(FEEDBACK_PAGE_MAX);
  });

  it("空文本返回空数组", () => {
    expect(paginate("   ")).toEqual([]);
  });
});

describe("statusLabel", () => {
  it("映射四种允许状态", () => {
    expect(statusLabel("provisionally_cleared")).toBe("暂时清偿");
    expect(statusLabel("needs_practice")).toBe("继续练习");
    expect(statusLabel("needs_verification")).toBe("需要查证");
    expect(statusLabel("invalid_attempt")).toBe("本次无效");
  });

  it("未知状态保守显示", () => {
    expect(statusLabel(" mastered_forever ")).toBe("继续解释");
  });
});
