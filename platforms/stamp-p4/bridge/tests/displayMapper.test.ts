import { describe, expect, it } from "vitest";
import type { ScreenSpec } from "../../../mentra/src/clearanceFlow.js";
import { FEEDBACK_PAGE_MAX } from "../../../mentra/src/displayText.js";
import { screenToCard, textToPages } from "../src/displayMapper.js";

describe("clearanceFlow 输出 → display_card", () => {
  it("referenceCard 映射为卡片（2）", () => {
    const screen: ScreenSpec = { layout: "referenceCard", title: "欠条 1/3", text: "解释一下什么是索引" };
    const card = screenToCard(screen, "m-1");
    expect(card.type).toBe("display_card");
    expect(card.cardType).toBe("question");
    expect(card.title).toBe("欠条 1/3");
    expect(card.body).toBe("解释一下什么是索引");
    expect(card.messageId).toBe("m-1");
  });

  it("textWall 无标题映射为 status（1）", () => {
    const screen: ScreenSpec = { layout: "textWall", text: "正在读取最新欠条…" };
    const card = screenToCard(screen);
    expect(card.type).toBe("display_card");
    expect(card.cardType).toBe("status");
  });

  it("反馈标题映射为 feedback", () => {
    const screen: ScreenSpec = { layout: "referenceCard", title: "反馈 1/2 · 继续练习", text: "你漏掉了边界条件" };
    expect(screenToCard(screen).cardType).toBe("feedback");
  });

  it("结算标题映射为 reference", () => {
    const screen: ScreenSpec = { layout: "referenceCard", title: "结算 1/1", text: "参考答案：..." };
    expect(screenToCard(screen).cardType).toBe("reference");
  });
});

describe("长文本分页 → display_text", () => {
  it("长文本分页且 page/pageCount 正确（3,4）", () => {
    const longText = "这是第一句。".repeat(60); // 远超 FEEDBACK_PAGE_MAX
    const pages = textToPages("认知欠条", longText);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p, i) => {
      expect(p.type).toBe("display_text");
      expect(p.page).toBe(i + 1);
      expect(p.pageCount).toBe(pages.length);
      expect(p.text.length).toBeLessThanOrEqual(FEEDBACK_PAGE_MAX);
    });
  });

  it("短文本只有一页", () => {
    const pages = textToPages("标题", "短内容");
    expect(pages.length).toBe(1);
    expect(pages[0]?.page).toBe(1);
    expect(pages[0]?.pageCount).toBe(1);
  });

  it("超长文本不溢出单页上限（12）", () => {
    const huge = "字".repeat(5000);
    const pages = textToPages("标题", huge);
    expect(pages.every(p => p.text.length <= FEEDBACK_PAGE_MAX)).toBe(true);
  });
});
