import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

const TEST_PORT = 8799;
const TEST_STORE = path.resolve("tmp/mvp0-api-test-store.json");
const BASE = `http://127.0.0.1:${TEST_PORT}`;
let serverProcess: ReturnType<typeof spawn> | null = null;

const SAMPLE_ARTIFACT = `
I'm building a React app with Vite. The AI suggested using TypeScript for type safety.
I agreed because I don't know TypeScript well. The AI set up the entire project structure.
It chose useState for state management and useEffect for data fetching.
I wanted to use Firebase, but the AI said Supabase was better for this use case.
The AI wrote all the database queries and API routes. I'm not sure how the auth flow works.
`;

async function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not start within ${maxAttempts} attempts`);
}

beforeAll(async () => {
  await mkdir(path.dirname(TEST_STORE), { recursive: true });
  await rm(TEST_STORE, { force: true });
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      MVP0_STORE_PATH: TEST_STORE,
      SPIRAL_DISABLE_AI: "1",
      LEARNING_API_TOKEN: ""
    },
    stdio: "pipe"
  });
  await waitForServer(`${BASE}/health`);
});

afterAll(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!serverProcess.killed) serverProcess.kill("SIGKILL");
  }
  await rm(TEST_STORE, { force: true });
});

describe("MVP-0 API endpoints", () => {
  let createdReportId: string;
  let firstCardId: string;

  describe("POST /api/mvp0/report", () => {
    it("generates a fallback report with all six sections", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactText: SAMPLE_ARTIFACT,
          artifactType: "chatgpt"
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.fallback).toBe(true);
      expect(data.report.id).toBeTruthy();
      expect(data.report.sections.aiCompleted).toBeDefined();
      expect(data.report.sections.userContributed).toBeDefined();
      expect(data.report.sections.dangerousGaps).toHaveLength(5);
      expect(data.report.sections.cognitiveStructure).toBeDefined();
      expect(data.report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
      expect(data.report.sections.feynmanCards.length).toBeLessThanOrEqual(5);
      expect(data.report.sections.nextActions.length).toBeGreaterThan(0);
      createdReportId = data.report.id;
      firstCardId = data.report.sections.feynmanCards[0].id;
    });

    it("returns 400 when artifactText is missing", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactType: "chatgpt" })
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("artifactText");
    });

    it("preserves artifactType in the report", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactText: "Some AI conversation text here.",
          artifactType: "claude"
        })
      });
      const data = await res.json();
      expect(data.report.input.artifactType).toBe("claude");
    });
  });

  describe("GET /api/mvp0/reports", () => {
    it("lists reports sorted by createdAt descending", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.reports)).toBe(true);
      expect(data.reports.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < data.reports.length; i++) {
        expect(data.reports[i - 1].createdAt >= data.reports[i].createdAt).toBe(true);
      }
    });
  });

  describe("GET /api/mvp0/reports/:id", () => {
    it("returns the report when found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports/${createdReportId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.report.id).toBe(createdReportId);
    });

    it("returns 404 when report not found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports/nonexistent-id`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Report not found");
    });
  });

  describe("POST /api/mvp0/reports/:id/cards/:cardId/answer", () => {
    it("updates the card answer and returns a follow-up", async () => {
      const res = await fetch(
        `${BASE}/api/mvp0/reports/${createdReportId}/cards/${firstCardId}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "This is my explanation of the concept." })
        }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.card.userAnswer).toBe("This is my explanation of the concept.");
      expect(data.card.aiFollowUp).toBeTruthy();
      expect(data.card.answeredAt).toBeTruthy();
      expect(data.shouldFollowUp).toBe(true);
    });

    it("returns 400 when answer is missing", async () => {
      const res = await fetch(
        `${BASE}/api/mvp0/reports/${createdReportId}/cards/${firstCardId}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("answer");
    });

    it("returns 404 when report not found", async () => {
      const res = await fetch(
        `${BASE}/api/mvp0/reports/nonexistent/cards/${firstCardId}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "test" })
        }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Report not found");
    });

    it("returns 404 when card not found", async () => {
      const res = await fetch(
        `${BASE}/api/mvp0/reports/${createdReportId}/cards/nonexistent-card/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "test" })
        }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Feynman card not found");
    });
  });

  describe("POST /api/mvp0/reports/:id/corrections", () => {
    it("appends a correction to the report", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports/${createdReportId}/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "gap",
          targetId: "gap-1",
          originalValue: "React virtual DOM",
          correctedValue: "React reconciliation",
          reason: "The gap is about reconciliation, not virtual DOM"
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.correction.target).toBe("gap");
      expect(data.correction.correctedValue).toBe("React reconciliation");
      expect(data.report.corrections.length).toBeGreaterThanOrEqual(1);
    });

    it("returns 404 when report not found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports/nonexistent/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "gap",
          correctedValue: "fix"
        })
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Report not found");
    });
  });

  describe("existing routes still work", () => {
    it("GET /health returns ok", async () => {
      const res = await fetch(`${BASE}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("GET /api/spiral/today returns dashboard", async () => {
      const res = await fetch(`${BASE}/api/spiral/today`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toBeDefined();
    });
  });
});
