import { describe, expect, it } from "vitest";
import {
  credibilityLabel,
  credibilityNeedsReview,
  formatCoverage,
  groupNextActions,
  matchDangerousGap,
  parseStoredSession,
  recommendationLabel,
  researchModeNotice,
  routeLabel,
  sessionStateLabel,
  sourceTypeLabel,
  statusLabel,
  statusTone,
  storedSessionMatches
} from "./mvp1App";

const gaps = [
  { rank: 1, gap: "不理解 G2 眼镜的蓝牙回连策略", whyDangerous: "会导致现场演示断连", evidence: "报告证据一" },
  { rank: 2, gap: "无法验证 AI 生成的网关配置", whyDangerous: "错误配置会被直接部署", evidence: "报告证据二" }
];

describe("matchDangerousGap", () => {
  it("matches the gap whose text contains the card target, case-insensitively", () => {
    const hit = matchDangerousGap(gaps, "g2 眼镜的蓝牙回连");
    expect(hit?.rank).toBe(1);
  });

  it("returns null when no gap text matches the card target", () => {
    expect(matchDangerousGap(gaps, "完全无关的目标")).toBeNull();
  });

  it("returns null when the card target is blank", () => {
    expect(matchDangerousGap(gaps, "   ")).toBeNull();
  });

  it("returns null when there are no gaps to show", () => {
    expect(matchDangerousGap([], "任意目标")).toBeNull();
    expect(matchDangerousGap(undefined, "任意目标")).toBeNull();
  });
});

describe("statusLabel", () => {
  it("labels every known cautious status in Chinese", () => {
    expect(statusLabel("provisionally_cleared")).toBe("暂时清偿");
    expect(statusLabel("needs_practice")).toBe("需要练习");
    expect(statusLabel("needs_verification")).toBe("需要核实来源");
    expect(statusLabel("invalid_attempt")).toBe("无效尝试");
    expect(statusLabel("no_valid_attempt")).toBe("无有效回答");
  });

  it("falls back to the raw status for unknown values", () => {
    expect(statusLabel("something_else")).toBe("something_else");
    expect(statusLabel("")).toBe("未知状态");
  });
});

describe("statusTone", () => {
  it("maps statuses to badge tones", () => {
    expect(statusTone("provisionally_cleared")).toBe("cleared");
    expect(statusTone("needs_practice")).toBe("practice");
    expect(statusTone("needs_verification")).toBe("verification");
    expect(statusTone("invalid_attempt")).toBe("invalid");
    expect(statusTone("no_valid_attempt")).toBe("invalid");
  });
});

describe("sessionStateLabel", () => {
  it("labels session states in Chinese", () => {
    expect(sessionStateLabel("awaiting_answer")).toBe("等待首次回答");
    expect(sessionStateLabel("teaching")).toBe("教学中，可继续回答");
    expect(sessionStateLabel("ready_to_end")).toBe("AI 建议可以结束清偿");
    expect(sessionStateLabel("ended")).toBe("已结束");
  });
});

describe("source labels", () => {
  it("labels source types", () => {
    expect(sourceTypeLabel("official_doc")).toBe("官方文档");
    expect(sourceTypeLabel("ordinary_web")).toBe("普通网页");
  });

  it("labels credibility levels", () => {
    expect(credibilityLabel("high")).toBe("可信度高");
    expect(credibilityLabel("medium")).toBe("可信度中");
    expect(credibilityLabel("low")).toBe("可信度低");
    expect(credibilityLabel("unknown")).toBe("可信度未知");
  });

  it("flags low or unknown credibility for review", () => {
    expect(credibilityNeedsReview("low")).toBe(true);
    expect(credibilityNeedsReview("unknown")).toBe(true);
    expect(credibilityNeedsReview("high")).toBe(false);
    expect(credibilityNeedsReview("medium")).toBe(false);
  });
});

describe("researchModeNotice", () => {
  it("stays silent for live AI research", () => {
    expect(researchModeNotice("live_ai")).toBeNull();
  });

  it("marks curated fallback material transparently", () => {
    expect(researchModeNotice("curated_demo_fallback")).toContain("策展备用研究材料");
  });

  it("marks stub material transparently", () => {
    expect(researchModeNotice("stub")).toContain("占位研究材料");
  });

  it("names the mode for any other non-live value", () => {
    expect(researchModeNotice("custom_mode")).toContain("custom_mode");
  });
});

describe("formatCoverage", () => {
  it("formats a ratio as a percentage", () => {
    expect(formatCoverage(0)).toBe("0%");
    expect(formatCoverage(0.75)).toBe("75%");
    expect(formatCoverage(1)).toBe("100%");
  });

  it("clamps out-of-range values", () => {
    expect(formatCoverage(1.4)).toBe("100%");
    expect(formatCoverage(-0.2)).toBe("0%");
    expect(formatCoverage(Number.NaN)).toBe("0%");
  });
});

describe("recommendationLabel", () => {
  it("labels model recommendations", () => {
    expect(recommendationLabel("end")).toBe("AI 建议结束");
    expect(recommendationLabel("continue")).toBe("AI 建议继续");
  });
});

describe("routeLabel", () => {
  it("labels the four known routes", () => {
    expect(routeLabel("verify")).toBe("查证");
    expect(routeLabel("note")).toBe("记录");
    expect(routeLabel("task")).toBe("执行");
    expect(routeLabel("ask")).toBe("询问他人");
  });

  it("falls back to the raw route for unknown values", () => {
    expect(routeLabel("other")).toBe("other");
  });
});

describe("groupNextActions", () => {
  it("groups actions by route in a fixed order", () => {
    const groups = groupNextActions([
      { item: "问导师", route: "ask", reason: "需要人工判断" },
      { item: "核对官方文档", route: "verify", reason: "来源存疑" },
      { item: "记录心得", route: "note", reason: "沉淀" },
      { item: "重跑示例", route: "task", reason: "动手验证" }
    ]);
    expect(groups.map(group => group.route)).toEqual(["verify", "note", "task", "ask"]);
    expect(groups.map(group => group.label)).toEqual(["查证", "记录", "执行", "询问他人"]);
    expect(groups[0].items).toHaveLength(1);
  });

  it("skips empty groups and appends unknown routes at the end", () => {
    const groups = groupNextActions([
      { item: "核对官方文档", route: "verify", reason: "" },
      { item: "其他", route: "misc", reason: "" }
    ]);
    expect(groups.map(group => group.route)).toEqual(["verify", "misc"]);
  });

  it("returns no groups for missing or empty input", () => {
    expect(groupNextActions(undefined)).toEqual([]);
    expect(groupNextActions([])).toEqual([]);
  });
});

describe("parseStoredSession", () => {
  it("parses a well-formed stored session", () => {
    const raw = JSON.stringify({ sessionId: "s-1", reportId: "r-1", cardId: "c-1" });
    expect(parseStoredSession(raw)).toEqual({ sessionId: "s-1", reportId: "r-1", cardId: "c-1" });
  });

  it("rejects malformed JSON", () => {
    expect(parseStoredSession("not-json")).toBeNull();
  });

  it("rejects missing or empty fields", () => {
    expect(parseStoredSession(JSON.stringify({ sessionId: "s-1", reportId: "r-1" }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ sessionId: "", reportId: "r-1", cardId: "c-1" }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ sessionId: 1, reportId: "r-1", cardId: "c-1" }))).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession("")).toBeNull();
  });
});

describe("storedSessionMatches", () => {
  const stored = { sessionId: "s-1", reportId: "r-1", cardId: "c-1" };

  it("matches when report and card align with the URL", () => {
    expect(storedSessionMatches(stored, "r-1", "c-1")).toBe(true);
  });

  it("rejects mismatched report or card", () => {
    expect(storedSessionMatches(stored, "r-2", "c-1")).toBe(false);
    expect(storedSessionMatches(stored, "r-1", "c-2")).toBe(false);
    expect(storedSessionMatches(null, "r-1", "c-1")).toBe(false);
  });
});
