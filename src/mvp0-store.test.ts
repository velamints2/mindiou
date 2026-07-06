import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createMvp0Store } from "../mvp0-store.js";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const tmpDir = path.resolve("tmp");
const storePath = path.join(tmpDir, "mvp0-store-test.json");

function makeReport(overrides = {}) {
  const report = {
    id: overrides.id !== undefined ? overrides.id : "report-001",
    createdAt: overrides.createdAt || "2026-07-06T10:00:00.000Z",
    input: {
      artifactText: overrides.artifactText || "Sample AI conversation text",
      artifactType: overrides.artifactType || "chatgpt",
      charCount: overrides.charCount ?? 28
    },
    sections: {
      aiCompleted: [
        { item: "AI chose React for the frontend", evidence: "user asked for a quick UI", isInference: false }
      ],
      userContributed: [
        { item: "User specified the target audience", evidence: "I need this for kids", isInference: false }
      ],
      dangerousGaps: [
        { rank: 1, gap: "React virtual DOM", whyDangerous: "Cannot judge performance", evidence: "inference" }
      ],
      cognitiveStructure: {
        facts: [{ item: "Project uses React 18", evidence: "package.json" }],
        hypotheses: [{ item: "SSR may be needed", evidence: "inference" }],
        questions: [{ item: "Is routing client or server side?", evidence: "unresolved" }],
        decisions: [{ item: "Use Vite as build tool", evidence: "AI recommended" }],
        tradeoffs: [{ item: "SPA simplicity vs SEO", evidence: "inference" }]
      },
      feynmanCards: [
        {
          id: "card-001",
          target: "React virtual DOM",
          prompt: "Explain how the virtual DOM works in your own words",
          userAnswer: "",
          aiFollowUp: "",
          answeredAt: null
        },
        {
          id: "card-002",
          target: "SSR vs CSR",
          prompt: "When would you choose SSR over CSR?",
          userAnswer: "",
          aiFollowUp: "",
          answeredAt: null
        }
      ],
      nextActions: [
        { item: "Verify React version in package.json", route: "verify", reason: "AI assumed version 18" },
        { item: "Note the SPA vs SSR trade-off", route: "note", reason: "Reusable decision pattern" }
      ]
    },
    corrections: [],
    status: overrides.status || "generated"
  };
  return report;
}

describe("MVP-0 store", () => {
  let store;

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    store = createMvp0Store(storePath);
    await store.load();
  });

  afterEach(async () => {
    try {
      await rm(storePath, { force: true });
      await rm(`${storePath}.tmp`, { force: true });
    } catch {
      // ignore
    }
  });

  describe("saveReport", () => {
    it("saves a new report and returns it", async () => {
      const report = makeReport();
      const saved = await store.saveReport(report);
      expect(saved.id).toBe("report-001");
      expect(saved.status).toBe("generated");
      expect(saved.sections.feynmanCards).toHaveLength(2);
    });

    it("generates an id when not provided", async () => {
      const report = makeReport();
      delete report.id;
      const saved = await store.saveReport(report);
      expect(saved.id).toBeTruthy();
      expect(saved.id.length).toBeGreaterThan(10);
    });

    it("overwrites an existing report with the same id", async () => {
      await store.saveReport(makeReport({ id: "r1", artifactText: "first" }));
      await store.saveReport(makeReport({ id: "r1", artifactText: "second" }));
      const reports = store.listReports();
      expect(reports).toHaveLength(1);
      expect(reports[0].input.artifactText).toBe("second");
    });

    it("truncates artifactText to 30000 characters", async () => {
      const longText = "x".repeat(40000);
      const saved = await store.saveReport(makeReport({ artifactText: longText, charCount: 40000 }));
      expect(saved.input.artifactText.length).toBe(30000);
    });
  });

  describe("getReport", () => {
    it("returns the report when found", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      const found = store.getReport("report-001");
      expect(found.id).toBe("report-001");
    });

    it("throws a clear error when report not found", () => {
      expect(() => store.getReport("nonexistent-id")).toThrow("Report not found: nonexistent-id");
    });
  });

  describe("listReports", () => {
    it("returns reports sorted by createdAt descending", async () => {
      await store.saveReport(makeReport({ id: "old", createdAt: "2026-07-01T00:00:00.000Z" }));
      await store.saveReport(makeReport({ id: "new", createdAt: "2026-07-06T00:00:00.000Z" }));
      await store.saveReport(makeReport({ id: "mid", createdAt: "2026-07-03T00:00:00.000Z" }));
      const reports = store.listReports();
      expect(reports.map(r => r.id)).toEqual(["new", "mid", "old"]);
    });

    it("returns empty array when no reports exist", () => {
      const reports = store.listReports();
      expect(reports).toEqual([]);
    });
  });

  describe("updateCardAnswer", () => {
    it("updates the card answer and aiFollowUp", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      const result = await store.updateCardAnswer(
        "report-001",
        "card-001",
        "Virtual DOM is a lightweight copy of the real DOM",
        "Can you explain what happens when two elements have the same key?"
      );
      expect(result.card.userAnswer).toBe("Virtual DOM is a lightweight copy of the real DOM");
      expect(result.card.aiFollowUp).toContain("same key");
      expect(result.card.answeredAt).toBeTruthy();
    });

    it("upgrades report status from generated to interacted", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      await store.updateCardAnswer("report-001", "card-001", "some answer", "follow-up");
      const report = store.getReport("report-001");
      expect(report.status).toBe("interacted");
    });

    it("does not downgrade status from corrected", async () => {
      await store.saveReport(makeReport({ id: "report-001", status: "corrected" }));
      await store.updateCardAnswer("report-001", "card-001", "some answer", "follow-up");
      const report = store.getReport("report-001");
      expect(report.status).toBe("corrected");
    });

    it("throws clear error when report not found", async () => {
      await expect(
        store.updateCardAnswer("nonexistent", "card-001", "answer", "follow-up")
      ).rejects.toThrow("Report not found: nonexistent");
    });

    it("throws clear error when card not found", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      await expect(
        store.updateCardAnswer("report-001", "nonexistent-card", "answer", "follow-up")
      ).rejects.toThrow("Feynman card not found: nonexistent-card");
    });
  });

  describe("addCorrection", () => {
    it("appends a correction to the report", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      const result = await store.addCorrection("report-001", {
        target: "gap",
        targetId: "gap-1",
        originalValue: "React virtual DOM",
        correctedValue: "React reconciliation",
        reason: "The gap is about reconciliation, not just virtual DOM"
      });
      expect(result.correction.target).toBe("gap");
      expect(result.correction.correctedValue).toBe("React reconciliation");
      expect(result.report.corrections).toHaveLength(1);
    });

    it("sets report status to corrected", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      await store.addCorrection("report-001", {
        target: "attribution",
        targetId: "ai-1",
        correctedValue: "fixed"
      });
      const report = store.getReport("report-001");
      expect(report.status).toBe("corrected");
    });

    it("generates an id for the correction when not provided", async () => {
      await store.saveReport(makeReport({ id: "report-001" }));
      const result = await store.addCorrection("report-001", {
        target: "card",
        targetId: "card-001",
        correctedValue: "updated prompt"
      });
      expect(result.correction.id).toBeTruthy();
    });

    it("throws clear error when report not found", async () => {
      await expect(
        store.addCorrection("nonexistent", { target: "gap", correctedValue: "x" })
      ).rejects.toThrow("Report not found: nonexistent");
    });
  });

  describe("persistence", () => {
    it("persists across store instances", async () => {
      await store.saveReport(makeReport({ id: "persisted-report" }));
      const store2 = createMvp0Store(storePath);
      await store2.load();
      const found = store2.getReport("persisted-report");
      expect(found.id).toBe("persisted-report");
    });

    it("starts with empty state when file does not exist", async () => {
      const freshPath = path.join(tmpDir, "mvp0-fresh-test.json");
      const freshStore = createMvp0Store(freshPath);
      await freshStore.load();
      expect(freshStore.listReports()).toEqual([]);
      await rm(freshPath, { force: true });
    });
  });
});
