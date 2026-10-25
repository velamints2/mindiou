import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

const TEST_PORT = 8799;
const TEST_STORE = path.resolve("tmp/mvp0-api-test-store.json");
const TEST_AUTH_STORE = path.resolve("tmp/mvp0-api-test-auth.sqlite");
const TEST_REPAY_STORE = path.resolve("tmp/mvp0-api-test-repayment.sqlite");
const BASE = `http://127.0.0.1:${TEST_PORT}`;
let serverProcess: ReturnType<typeof spawn> | null = null;
let authCookie = "";

const SAMPLE_ARTIFACT = `
I'm building a React app with Vite. The AI suggested using TypeScript for type safety.
I agreed because I don't know TypeScript well. The AI set up the entire project structure.
It chose useState for state management and useEffect for data fetching.
I wanted to use Firebase, but the AI said Supabase was better for this use case.
The AI wrote all the database queries and API routes. I'm not sure how the auth flow works.
`;

function rolloutJsonl(entries: unknown[]) {
  return entries.map(entry => JSON.stringify(entry)).join("\n");
}

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
  await rm(TEST_AUTH_STORE, { force: true });
  await rm(`${TEST_AUTH_STORE}-wal`, { force: true });
  await rm(`${TEST_AUTH_STORE}-shm`, { force: true });
  await rm(TEST_REPAY_STORE, { force: true });
  await rm(`${TEST_REPAY_STORE}-wal`, { force: true });
  await rm(`${TEST_REPAY_STORE}-shm`, { force: true });
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      MVP0_STORE_PATH: TEST_STORE,
      AUTH_STORE_PATH: TEST_AUTH_STORE,
      COGNITIVE_REPAYMENT_V1: "1",
      COGNITIVE_REPAYMENT_STORE_PATH: TEST_REPAY_STORE,
      DAILY_ANALYSIS_LIMIT: "100",
      SPIRAL_DISABLE_AI: "1",
      // Production has a service token configured. Keep this enabled so
      // browser-session access cannot regress behind the compatibility gate.
      LEARNING_API_TOKEN: "test-service-token"
    },
    stdio: "pipe"
  });
  await waitForServer(`${BASE}/health`);
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "mvp0-api@example.com", password: "test-secret-1" })
  });
  authCookie = (register.headers.get("set-cookie") || "").split(";")[0];
});

afterAll(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!serverProcess.killed) serverProcess.kill("SIGKILL");
  }
  await rm(TEST_STORE, { force: true });
  await rm(TEST_AUTH_STORE, { force: true });
  await rm(`${TEST_AUTH_STORE}-wal`, { force: true });
  await rm(`${TEST_AUTH_STORE}-shm`, { force: true });
  await rm(TEST_REPAY_STORE, { force: true });
  await rm(`${TEST_REPAY_STORE}-wal`, { force: true });
  await rm(`${TEST_REPAY_STORE}-shm`, { force: true });
});

describe("MVP-0 API endpoints", () => {
  let createdReportId: string;
  let firstCardId: string;
  let createdDraftId: string;

  describe("POST /api/mvp0/timelines", () => {
    it("rejects anonymous requests with 401", async () => {
      const res = await fetch(`${BASE}/api/mvp0/timelines`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactText: SAMPLE_ARTIFACT, artifactType: "chatgpt" })
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "Authentication required" });
    });

    it("does not treat the service token as a Web account session", async () => {
      const res = await fetch(`${BASE}/api/mvp0/timelines`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-service-token"
        },
        body: JSON.stringify({ artifactText: SAMPLE_ARTIFACT, artifactType: "chatgpt" })
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "Authentication required" });
    });

    it("creates a draft with a collaboration timeline", async () => {
      const res = await fetch(`${BASE}/api/mvp0/timelines`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({
          artifactText: SAMPLE_ARTIFACT,
          artifactType: "chatgpt"
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.fallback).toBe(true);
      expect(data.draft.id).toBeTruthy();
      expect(data.draft.status).toBe("timeline");
      expect(data.draft.timeline.steps.length).toBeGreaterThanOrEqual(1);
      expect(data.timeline.steps.length).toBe(data.draft.timeline.steps.length);
      for (const step of data.draft.timeline.steps) {
        expect(step.id).toBeTruthy();
        expect(step.title).toBeTruthy();
        expect(step.userConfusion).toBe("");
      }
      createdDraftId = data.draft.id;
    });

    it("accepts a web session when the service bearer token is configured", async () => {
      const res = await fetch(`${BASE}/api/mvp0/timelines`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ artifactText: SAMPLE_ARTIFACT, artifactType: "chatgpt" })
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("returns 400 when artifactText is missing", async () => {
      const res = await fetch(`${BASE}/api/mvp0/timelines`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ artifactType: "chatgpt" })
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("artifactText");
    });
  });

  describe("GET /api/mvp0/drafts", () => {
    it("rejects anonymous requests with 401", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts`);
      expect(res.status).toBe(401);
    });

    it("lists drafts sorted by updatedAt descending", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts`, { headers: { cookie: authCookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.drafts)).toBe(true);
      expect(data.drafts.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < data.drafts.length; i++) {
        expect(data.drafts[i - 1].updatedAt >= data.drafts[i].updatedAt).toBe(true);
      }
    });
  });

  describe("GET /api/mvp0/drafts/:id", () => {
    it("rejects anonymous requests with 401", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`);
      expect(res.status).toBe(401);
    });

    it("returns the draft when found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, { headers: { cookie: authCookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.draft.id).toBe(createdDraftId);
    });

    it("returns 404 when draft not found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/nonexistent-id`, { headers: { cookie: authCookie } });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Draft not found");
    });

    it("returns 404 when draft belongs to another user", async () => {
      const otherRegister = await fetch(`${BASE}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "mvp0-other@example.com", password: "test-secret-2" })
      });
      const otherCookie = (otherRegister.headers.get("set-cookie") || "").split(";")[0];
      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, { headers: { cookie: otherCookie } });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Draft not found");
    });
  });

  describe("PATCH /api/mvp0/drafts/:id", () => {
    it("rejects anonymous requests with 401", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confusions: [] })
      });
      expect(res.status).toBe(401);
    });

    it("writes user confusions onto timeline steps", async () => {
      const draftRes = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, { headers: { cookie: authCookie } });
      const draft = (await draftRes.json()).draft;
      const stepId = draft.timeline.steps[0].id;

      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({
          confusions: [{ stepId, text: "我不理解这一步 AI 为什么这样做" }]
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const step = data.draft.timeline.steps.find((s: { id: string }) => s.id === stepId);
      expect(step.userConfusion).toBe("我不理解这一步 AI 为什么这样做");
    });

    it("returns 404 when draft not found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/nonexistent-id`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ confusions: [] })
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Draft not found");
    });

    it("returns 400 when confusions is not an array", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ confusions: { "step-1": "我不理解这一步" } })
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe("confusions must be an array of { stepId, text }");
    });

    it("returns 400 when a confusions entry is malformed", async () => {
      const res = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ confusions: [{ stepId: 123, text: "我不理解这一步" }] })
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe("confusions must be an array of { stepId, text }");
    });
  });

  describe("POST /api/mvp0/report", () => {
    it("generates a fallback report with all seven sections", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
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
      expect(data.report.sections.cognitiveProcessesOutsourced).toBeDefined();
      expect(data.report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(data.report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
      expect(data.report.sections.cognitiveStructure).toBeDefined();
      expect(data.report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
      expect(data.report.sections.feynmanCards.length).toBeLessThanOrEqual(5);
      expect(data.report.sections.nextActions.length).toBeGreaterThan(0);
      expect(data.report.research).toBeDefined();
      expect(data.report.confusionResolutions).toBeDefined();
      expect(data.report.sections.dangerousGaps.every((gap: any) => gap.sourceGapId && gap.cognitiveDebtId)).toBe(true);
      expect(data.report.sections.feynmanCards.every((card: any) => card.sourceGapId && card.gapRank && card.cognitiveDebtId)).toBe(true);
      createdReportId = data.report.id;
      firstCardId = data.report.sections.feynmanCards[0].id;
    });

    it("creates a zero-evidence capability domain when a new report is generated", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({
          artifactText: "我在学习 3D 打印与增材制造，比较 FDM 和树脂打印，并记录切片参数、首层附着和支撑结构的取舍。",
          artifactType: "ai_generated_document"
        })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const profileRes = await fetch(`${BASE}/api/repayment/profile`, { headers: { cookie: authCookie } });
      expect(profileRes.status).toBe(200);
      const profileData = await profileRes.json();
      const domain = profileData.profiles.find((profile: any) => profile.domain === "3D打印与增材制造");
      expect(domain).toBeDefined();
      expect(domain.source).toBe("report_inferred");
      expect(domain.dimensions.conceptualUnderstanding.score).toBe(0);
      expect(domain.dimensions.conceptualUnderstanding.stability).toBe("unverified");
    });

    it("attaches a newly generated report to the selected project and its debt links", async () => {
      const projectRes = await fetch(`${BASE}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ name: "自动归档测试项目", projectType: "software" })
      });
      expect(projectRes.status).toBe(201);
      const project = (await projectRes.json()).project;

      const reportRes = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({
          projectId: project.id,
          artifactText: SAMPLE_ARTIFACT,
          artifactType: "chatgpt"
        })
      });
      expect(reportRes.status).toBe(200);
      const reportData = await reportRes.json();
      expect(reportData.report.projectId).toBe(project.id);
      expect(reportData.projectMemory).toMatchObject({ ok: true });

      const memoryRes = await fetch(`${BASE}/api/projects/${project.id}/memory`, { headers: { cookie: authCookie } });
      expect(memoryRes.status).toBe(200);
      const memory = (await memoryRes.json()).memory;
      expect(memory.sessions).toHaveLength(1);
      expect(memory.counts.debts).toBeGreaterThanOrEqual(1);
    });

    it("links an existing report into project memory without re-importing or duplicating it", async () => {
      const projectRes = await fetch(`${BASE}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ name: "报告归档测试项目", projectType: "software" })
      });
      expect(projectRes.status).toBe(201);
      const project = (await projectRes.json()).project;

      const link = async () => fetch(`${BASE}/api/mvp0/reports/${createdReportId}/project-memory`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ projectId: project.id })
      });
      const first = await link();
      expect(first.status).toBe(200);
      const firstData = await first.json();
      expect(firstData.ok).toBe(true);
      expect(firstData.project.id).toBe(project.id);
      expect(firstData.session.id).toBeTruthy();
      expect(firstData.workItem.id).toBeTruthy();
      expect(firstData.artifacts.length).toBeGreaterThanOrEqual(1);

      const second = await link();
      expect(second.status).toBe(200);
      const secondData = await second.json();
      expect(secondData.idempotent).toBe(true);
      expect(secondData.session.id).toBe(firstData.session.id);

      const memoryRes = await fetch(`${BASE}/api/projects/${project.id}/memory`, { headers: { cookie: authCookie } });
      const memory = (await memoryRes.json()).memory;
      expect(memory.sessions).toHaveLength(1);
      expect(memory.workItems).toHaveLength(1);
      expect(memory.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(memory.counts.debts).toBeGreaterThanOrEqual(1);
    });

    it("requires authentication for report-to-project-memory linking", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports/${createdReportId}/project-memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-not-owned" })
      });
      expect(res.status).toBe(401);
    });

    it("generates a report from a draft and threads user confusions through", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ draftId: createdDraftId })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.report.draftId).toBe(createdDraftId);
      expect(data.report.input.confusions.length).toBeGreaterThanOrEqual(1);
      expect(data.report.input.confusions[0].text).toContain("我不理解这一步");

      // Draft is marked as reported and linked to the saved report
      const draftRes = await fetch(`${BASE}/api/mvp0/drafts/${createdDraftId}`, { headers: { cookie: authCookie } });
      const draft = (await draftRes.json()).draft;
      expect(draft.status).toBe("reported");
      expect(draft.reportId).toBe(data.report.id);
    });

    it("returns 404 when draftId does not exist", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({ draftId: "nonexistent-draft" })
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Draft not found");
    });

    it("returns 400 when artifactText is missing", async () => {
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
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
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({
          artifactText: "Some AI conversation text here.",
          artifactType: "claude"
        })
      });
      const data = await res.json();
      expect(data.report.input.artifactType).toBe("claude");
    });

    it("preserves JSONL line breaks so rollout input can be structurally compressed", async () => {
      const raw = rolloutJsonl([
        { type: "session_meta", payload: { id: "api-jsonl-test", cwd: "/workspace" } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "切到 API 26 VM 做最终验证。" }]
          }
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: "BUILD SUCCESSFUL\ninstall bundle successfully.\nstart ability successfully."
          }
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "input_text", text: "最终结果：API 26 VM 构建、安装和启动通过。" }]
          }
        }
      ]);
      const res = await fetch(`${BASE}/api/mvp0/report`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: authCookie },
        body: JSON.stringify({
          artifactText: raw,
          artifactType: "codex"
        })
      });
      const data = await res.json();

      expect(data.report.input.preprocess.strategy).toBe("rollout-jsonl-structured");
      expect(data.report.input.preprocess.didCompress).toBe(true);
      expect(data.report.input.preprocess.parsedEntries).toBe(4);
      expect(data.report.input.artifactText).toContain("BUILD SUCCESSFUL");
      expect(data.report.input.artifactText).toContain("start ability successfully");
    });
  });

  describe("GET /api/mvp0/reports", () => {
    it("lists reports sorted by createdAt descending", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports`, { headers: { cookie: authCookie } });
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
      const res = await fetch(`${BASE}/api/mvp0/reports/${createdReportId}`, { headers: { cookie: authCookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.report.id).toBe(createdReportId);
    });

    it("returns 404 when report not found", async () => {
      const res = await fetch(`${BASE}/api/mvp0/reports/nonexistent-id`, { headers: { cookie: authCookie } });
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
          headers: { "content-type": "application/json", cookie: authCookie },
          body: JSON.stringify({ answer: "This is my explanation of the concept." })
        }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.card.userAnswer).toBe("This is my explanation of the concept.");
      expect(data.card.aiFollowUp).toBeTruthy();
      expect(data.card.answeredAt).toBeTruthy();
      expect(data.fallback).toBe(true);
    });

    it("returns 400 when answer is missing", async () => {
      const res = await fetch(
        `${BASE}/api/mvp0/reports/${createdReportId}/cards/${firstCardId}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: authCookie },
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
          headers: { "content-type": "application/json", cookie: authCookie },
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
          headers: { "content-type": "application/json", cookie: authCookie },
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
        headers: { "content-type": "application/json", cookie: authCookie },
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
        headers: { "content-type": "application/json", cookie: authCookie },
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
      const res = await fetch(`${BASE}/api/spiral/today`, { headers: { cookie: authCookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toBeDefined();
    });
  });
});
