// @ts-nocheck
import { describe, expect, it } from "vitest";
import { deriveReportDisplay, sessionLastActivityAt } from "../report-display.js";

describe("report display metadata", () => {
  it("prefers a stored task title over capability gaps", () => {
    const display = deriveReportDisplay({
      locale: "zh-CN",
      display: { title: "Nginx 磁盘 I/O 故障排查", domain: "系统运维" },
      input: { artifactText: "其他内容" },
      sections: { dangerousGaps: [{ gap: "用户无法解释 iowait" }] }
    });
    expect(display).toEqual({ title: "Nginx 磁盘 I/O 故障排查", domain: "系统运维" });
  });

  it("derives a stable historical title from the original material", () => {
    const display = deriveReportDisplay({
      locale: "zh-CN",
      input: { artifactText: "用户：系统故障玄学之 iowait 持续偏高，磁盘没爆满业务却卡死？\n后续排查记录" },
      analysis: { artifactKind: "ai_chat", userCapability: { currentDomain: "Linux 性能分析" } }
    });
    expect(display.title).toContain("iowait");
    expect(display.domain).toBe("Linux 性能分析");
  });

  it("uses the persisted update time as session recency", () => {
    expect(sessionLastActivityAt({
      createdAt: "2026-08-01T00:00:00.000Z",
      endedAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z"
    })).toBe("2026-08-03T00:00:00.000Z");
  });

  it("uses English fallback labels for an English report", () => {
    const display = deriveReportDisplay({
      locale: "en",
      input: { artifactText: "" },
      analysis: { artifactKind: "ai_coding_log", userCapability: { currentDomain: "unknown" } }
    });
    expect(display).toEqual({ title: "AI coding session", domain: "AI coding session" });
  });
});
