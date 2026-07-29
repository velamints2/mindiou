// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ENABLED_PORT = 8821;
const FAKE_PORT = 8822;
const DISABLED_PORT = 8823;
const ENABLED_BASE = `http://127.0.0.1:${ENABLED_PORT}`;
const DISABLED_BASE = `http://127.0.0.1:${DISABLED_PORT}`;
const TMP = path.resolve("tmp");
const MVP0_STORE = path.join(TMP, "repayment-api-mvp0.json");
const MVP1_STORE = path.join(TMP, "repayment-api-mvp1.json");
const AUTH_STORE = path.join(TMP, "repayment-api-auth.sqlite");
const REPAY_STORE = path.join(TMP, "repayment-api-store.json");
const TRAINING_STORE = path.join(TMP, "repayment-api-training.json");
const SPIRAL_STORE = path.join(TMP, "repayment-api-spiral.json");
const DISABLED_AUTH_STORE = path.join(TMP, "repayment-api-disabled-auth.sqlite");
const DISABLED_REPAY_STORE = path.join(TMP, "repayment-api-disabled-store.json");

const ARTIFACT = "Deploy failed twice last night. nginx restart did not fix the root cause because the upstream port was wrong. We fixed the port mapping and the service recovered.";
const EVIDENCE_SENTENCE = "nginx restart did not fix the root cause";

let modelMode = "valid";
let enabledProcess;
let disabledProcess;
let fakeOpenAi;
let alice;

function validEvaluation() {
  return {
    dimensions: {
      conceptualUnderstanding: { score: 85, evidence: "端口配置错误", feedback: "概念准确", uncertainty: "low" },
      causalExplanation: { score: 85, evidence: "所以重启无效", feedback: "因果链完整", uncertainty: "medium" },
      practicalReproduction: { score: 85, evidence: "用日志验证", feedback: "可复现", uncertainty: "medium" },
      boundariesAndRisks: { score: 85, evidence: "但是高并发", feedback: "边界清楚", uncertainty: "high" },
      transferAbility: { score: 85, evidence: "例如数据库", feedback: "能迁移", uncertainty: "medium" }
    },
    overallFeedback: "因果链正确，遗漏了验证指标，下一步补充监控证据。",
    nextQuestion: "什么指标能证明根因已修复？"
  };
}

function makeSeededReport(ownerId) {
  return {
    id: "repayment-seeded-report",
    userId: ownerId,
    createdAt: "2026-07-29T00:00:00.000Z",
    input: { artifactText: ARTIFACT, artifactType: "codex", charCount: ARTIFACT.length, preprocess: null, confusions: [] },
    analysis: { userCapability: { overall: "L2", currentDomain: "nginx deploy debugging", dimensions: [] } },
    sections: {
      aiCompleted: [],
      userContributed: [],
      cognitiveProcessesOutsourced: [],
      dangerousGaps: [{
        rank: 1,
        title: "Root-cause verification gap",
        gap: "Treated restarts as fixes without verifying the root cause",
        underlyingCapability: "Hypothesis verification",
        surfaceSignals: [EVIDENCE_SENTENCE],
        whyDangerous: "Repeated restarts mask the real fault.",
        transferScenarios: ["database failover"],
        confidence: 0.8,
        alternativeExplanations: [],
        diagnosticQuestion: "How do you confirm a restart actually fixed the root cause?",
        masteryCriteria: ["Verifies the root cause before restarting"],
        evidence: EVIDENCE_SENTENCE
      }],
      cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
      feynmanCards: [{ id: "repayment-card-1", target: "Treated restarts as fixes without verifying the root cause", prompt: "Explain verification" }],
      nextActions: []
    },
    corrections: [],
    status: "generated"
  };
}

function makeLegacyReport(ownerId) {
  return {
    id: "repayment-legacy-report",
    userId: ownerId,
    createdAt: "2026-07-28T00:00:00.000Z",
    input: { artifactText: ARTIFACT, artifactType: "codex", charCount: ARTIFACT.length, preprocess: null, confusions: [] },
    sections: {
      dangerousGaps: [{ rank: 1, gap: "No rollback plan was ever written", whyDangerous: "Failures become unrecoverable.", evidence: EVIDENCE_SENTENCE }]
    },
    status: "generated"
  };
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function waitFor(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

function serverEnv(port, repayStore, authStore, extra = {}) {
  return {
    ...process.env,
    PORT: String(port),
    MVP0_STORE_PATH: MVP0_STORE,
    MVP1_STORE_PATH: MVP1_STORE,
    AUTH_STORE_PATH: authStore,
    TRAINING_STORE_PATH: TRAINING_STORE,
    LEARNING_STORE_PATH: SPIRAL_STORE,
    COGNITIVE_REPAYMENT_STORE_PATH: repayStore,
    AI_PROVIDER: "deepseek",
    AI_API_KEY: "test-key",
    AI_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/v1`,
    AI_MODEL: "deepseek-v4-flash",
    OPENAI_CHAT_TIMEOUT_MS: "500",
    RESEARCH_PROVIDER: "openai",
    RESEARCH_API_KEY: "test-key",
    RESEARCH_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/v1`,
    RESEARCH_MODEL: "gpt-5.5",
    STT_API_KEY: "",
    LEARNING_API_TOKEN: "",
    ...extra
  };
}

async function startEnabled() {
  enabledProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: serverEnv(ENABLED_PORT, REPAY_STORE, AUTH_STORE, { COGNITIVE_REPAYMENT_V1: "1" }),
    stdio: "pipe"
  });
  await waitFor(`${ENABLED_BASE}/health`);
}

async function stopEnabled() {
  if (!enabledProcess) return;
  const exited = new Promise(resolve => enabledProcess.once("exit", resolve));
  enabledProcess.kill("SIGTERM");
  await exited;
  enabledProcess = null;
}

async function registerUser(email, password = "test-secret-1") {
  const response = await fetch(`${ENABLED_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  const cookie = (response.headers.get("set-cookie") || "").split(";")[0];
  return { data, cookie, user: data.user };
}

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
  for (const file of [MVP0_STORE, MVP1_STORE, REPAY_STORE, TRAINING_STORE, SPIRAL_STORE, DISABLED_REPAY_STORE]) {
    await rm(file, { force: true });
  }
  for (const file of [AUTH_STORE, DISABLED_AUTH_STORE]) {
    await rm(file, { force: true });
    await rm(`${file}-wal`, { force: true });
    await rm(`${file}-shm`, { force: true });
  }
  fakeOpenAi = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/chat/completions") {
      if (modelMode === "hang") {
        // Never answer: the client must hit its own chat timeout.
        return;
      }
      let output = validEvaluation();
      if (modelMode === "missing-dim") {
        delete output.dimensions.transferAbility;
      } else if (modelMode === "placeholder") {
        output.dimensions.causalExplanation.feedback = "TODO: 补充因果分析";
      }
      json(res, 200, { choices: [{ message: { content: JSON.stringify(output) } }] });
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(FAKE_PORT, "127.0.0.1", resolve));
  await startEnabled();
  alice = await registerUser("alice@example.com");
  await stopEnabled();
  await writeFile(MVP0_STORE, JSON.stringify({
    version: 1,
    clearanceReports: [makeSeededReport(alice.user.id), makeLegacyReport(alice.user.id)]
  }, null, 2));
  await startEnabled();
  disabledProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: serverEnv(DISABLED_PORT, DISABLED_REPAY_STORE, DISABLED_AUTH_STORE, { COGNITIVE_REPAYMENT_V1: "0" }),
    stdio: "pipe"
  });
  await waitFor(`${DISABLED_BASE}/health`);
});

afterAll(async () => {
  await stopEnabled();
  if (disabledProcess) {
    const exited = new Promise(resolve => disabledProcess.once("exit", resolve));
    disabledProcess.kill("SIGTERM");
    await exited;
  }
  fakeOpenAi?.closeAllConnections?.();
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  for (const file of [MVP0_STORE, MVP1_STORE, REPAY_STORE, TRAINING_STORE, SPIRAL_STORE, DISABLED_REPAY_STORE]) {
    await rm(file, { force: true });
  }
  for (const file of [AUTH_STORE, DISABLED_AUTH_STORE]) {
    await rm(file, { force: true });
    await rm(`${file}-wal`, { force: true });
    await rm(`${file}-shm`, { force: true });
  }
});

describe("cognitive repayment API (flag disabled)", () => {
  it("returns 404 for repayment routes and reports disabled status", async () => {
    const gaps = await fetch(`${DISABLED_BASE}/api/repayment/gaps`);
    expect(gaps.status).toBe(404);
    expect((await gaps.json()).error).toBe("Cognitive repayment V1 is disabled");

    const status = await fetch(`${DISABLED_BASE}/api/repayment/status`);
    expect(status.status).toBe(200);
    const data = await status.json();
    expect(data.ok).toBe(true);
    expect(data.enabled).toBe(false);
    expect(data.versions.evaluatorVersion).toBe("repayment-eval-v1");
    expect(data.versions.promptSchemaVersion).toBe("repayment-eval-schema-1");
    expect(data.versions.dataSchemaVersion).toBe("repayment-data-1");
  });
});

describe("cognitive repayment API (flag enabled)", () => {
  it("reports enabled status and requires authentication", async () => {
    const status = await fetch(`${ENABLED_BASE}/api/repayment/status`);
    expect((await status.json()).enabled).toBe(true);

    const unauthenticated = await fetch(`${ENABLED_BASE}/api/repayment/gaps`);
    expect(unauthenticated.status).toBe(401);
  });

  it("imports a gap with evidence bound to the artifact and deduplicates re-import", async () => {
    const response = await fetch(`${ENABLED_BASE}/api/repayment/gaps/import`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: "repayment-seeded-report", gapRank: 1 })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.gap.status).toBe("identified");
    expect(data.gap.title).toBe("Root-cause verification gap");
    const direct = data.gap.evidence.find(item => item.evidenceType === "direct_quote");
    const expectedStart = ARTIFACT.indexOf(EVIDENCE_SENTENCE);
    expect(direct.sourceLocation).toEqual({ kind: "artifact", start: expectedStart, end: expectedStart + EVIDENCE_SENTENCE.length });

    const again = await fetch(`${ENABLED_BASE}/api/repayment/gaps/import`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: "repayment-seeded-report", gapRank: 1 })
    });
    expect(again.status).toBe(200);
    const deduped = await again.json();
    expect(deduped.deduplicated).toBe(true);
    expect(deduped.gap.gapId).toBe(data.gap.gapId);
  });

  it("imports a legacy report whose gaps only have rank/gap/whyDangerous/evidence", async () => {
    const response = await fetch(`${ENABLED_BASE}/api/repayment/gaps/import`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: "repayment-legacy-report", gapRank: 1 })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.gap.status).toBe("identified");
    expect(data.gap.userCapabilityLevel).toBe("unknown");
    expect(data.gap.evidence[0].evidenceType).toBe("direct_quote");
  });

  it("runs the full repayment loop: two passes reach repaid with review + profile", async () => {
    modelMode = "valid";
    const listResponse = await fetch(`${ENABLED_BASE}/api/repayment/gaps`, {
      headers: { cookie: alice.cookie }
    });
    const { gaps } = await listResponse.json();
    const gap = gaps.find(item => item.reportId === "repayment-seeded-report");
    expect(gap).toBeDefined();
    expect(gap.latestAttempt).toBeNull();

    const answer = "因为 upstream 端口配置错误，所以 nginx 重启没有解决根因。我通过日志验证了这个假设，但是高并发时仍可能失败。例如数据库连接池也是同样机制。";

    // First pass: partiallyRepaid, never repaid directly.
    const first = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer, selfConfidence: 3, clientAttemptId: "client-attempt-1" })
    });
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.attempt.fallbackUsed).toBe(false);
    expect(firstData.attempt.errorCategory).toBeNull();
    expect(firstData.attempt.evaluatorVersion).toBe("repayment-eval-v1");
    expect(firstData.attempt.promptSchemaVersion).toBe("repayment-eval-schema-1");
    expect(firstData.attempt.dataSchemaVersion).toBe("repayment-data-1");
    expect(firstData.attempt.modelProvider).toBe("deepseek");
    expect(firstData.attempt.modelName).toBe("deepseek-v4-flash");
    expect(firstData.attempt.selfConfidence).toBe(3);
    for (const dimension of ["conceptualUnderstanding", "causalExplanation", "practicalReproduction", "boundariesAndRisks", "transferAbility"]) {
      expect(typeof firstData.attempt.evaluation.dimensions[dimension].score).toBe("number");
    }
    expect(firstData.attempt.evaluation.passed).toBe(true);
    expect(firstData.gap.status).toBe("partiallyRepaid");

    // Idempotent retry with the same clientAttemptId.
    const retry = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer, clientAttemptId: "client-attempt-1" })
    });
    expect(retry.status).toBe(200);
    const retryData = await retry.json();
    expect(retryData.deduplicated).toBe(true);
    const detail = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}`, { headers: { cookie: alice.cookie } });
    const detailData = await detail.json();
    expect(detailData.attempts).toHaveLength(1);

    // Second independent pass: repaid.
    const second = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: `${answer} 再次独立说明。`, clientAttemptId: "client-attempt-2" })
    });
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.gap.status).toBe("repaid");

    // Review queue: low-priority transfer scenario for the repaid gap.
    const queue = await fetch(`${ENABLED_BASE}/api/repayment/review-queue`, { headers: { cookie: alice.cookie } });
    const queueData = await queue.json();
    const item = queueData.items.find(entry => entry.gapId === gap.gapId);
    expect(item).toBeDefined();
    expect(item.priority).toBe("low");
    expect(item.nextQuestionType).toBe("transfer_scenario");
    expect(item.gapTitle).toBe("Root-cause verification gap");
    expect(item.gapStatus).toBe("repaid");

    // Capability profile contains the report domain with scored dimensions.
    const profile = await fetch(`${ENABLED_BASE}/api/repayment/profile`, { headers: { cookie: alice.cookie } });
    const profileData = await profile.json();
    const domainProfile = profileData.profiles.find(entry => entry.domain === "nginx deploy debugging");
    expect(domainProfile).toBeDefined();
    for (const dimension of ["conceptualUnderstanding", "causalExplanation", "practicalReproduction", "boundariesAndRisks", "transferAbility"]) {
      expect(typeof domainProfile.dimensions[dimension].score).toBe("number");
      expect(domainProfile.dimensions[dimension].level).toMatch(/^L[1-4]$/);
      expect(["one_shot", "stable"]).toContain(domainProfile.dimensions[dimension].stability);
    }

    // Dismiss keeps the item but removes it from the pending queue.
    const dismiss = await fetch(`${ENABLED_BASE}/api/repayment/review-queue/${item.reviewItemId}/dismiss`, {
      method: "POST",
      headers: { cookie: alice.cookie }
    });
    expect(dismiss.status).toBe(200);
    expect((await dismiss.json()).item.status).toBe("dismissed");
    const queueAfter = await fetch(`${ENABLED_BASE}/api/repayment/review-queue`, { headers: { cookie: alice.cookie } });
    expect((await queueAfter.json()).items.find(entry => entry.reviewItemId === item.reviewItemId)).toBeUndefined();
  });

  it("falls back with schema category when the model omits a dimension", async () => {
    modelMode = "missing-dim";
    const listResponse = await fetch(`${ENABLED_BASE}/api/repayment/gaps`, { headers: { cookie: alice.cookie } });
    const { gaps } = await listResponse.json();
    const gap = gaps.find(item => item.reportId === "repayment-seeded-report");
    const answer = "因为缓存没清所以配置没生效，我用接口返回验证过。";
    const response = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.attempt.fallbackUsed).toBe(true);
    expect(data.attempt.errorCategory).toBe("schema");
    expect(data.attempt.answer).toBe(answer);
    expect(data.attempt.modelProvider).toBe("deepseek");
    modelMode = "valid";
  });

  it("falls back with placeholder category when the model emits placeholders", async () => {
    modelMode = "placeholder";
    const listResponse = await fetch(`${ENABLED_BASE}/api/repayment/gaps`, { headers: { cookie: alice.cookie } });
    const { gaps } = await listResponse.json();
    const gap = gaps.find(item => item.reportId === "repayment-seeded-report");
    const response = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "因为依赖版本不一致所以行为不同。" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.attempt.fallbackUsed).toBe(true);
    expect(data.attempt.errorCategory).toBe("placeholder");
    modelMode = "valid";
  });

  it("falls back with timeout category when the model hangs", async () => {
    modelMode = "hang";
    const listResponse = await fetch(`${ENABLED_BASE}/api/repayment/gaps`, { headers: { cookie: alice.cookie } });
    const { gaps } = await listResponse.json();
    const gap = gaps.find(item => item.reportId === "repayment-seeded-report");
    const response = await fetch(`${ENABLED_BASE}/api/repayment/gaps/${gap.gapId}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "因为连接池耗尽所以请求排队。" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.attempt.fallbackUsed).toBe(true);
    expect(data.attempt.errorCategory).toBe("timeout");
    modelMode = "valid";
  });

  it("degrades gracefully for users without any capability profile", async () => {
    const bob = await registerUser("bob@example.com");
    const response = await fetch(`${ENABLED_BASE}/api/repayment/profile`, { headers: { cookie: bob.cookie } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.profiles).toEqual([]);
    expect(data.degraded).toBe(true);
    expect(data.note).toBe("暂无能力画像数据");
  });
});
