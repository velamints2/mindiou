// @ts-nocheck
/**
 * 项目认知所有权地图 — API + 权限测试
 *
 * 覆盖规格第十六节"API 和权限"用例：
 * - 用户 A 不能访问用户 B 的项目所有权
 * - 无权限用户不能触发重新计算
 * - 重新计算后快照保存
 * - 模块详情能够打开
 * - 空项目显示合理空状态
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8813;
const BASE = `http://127.0.0.1:${API_PORT}`;
const OWNERSHIP_STORE = path.resolve("tmp/ownership-api-test-store.json");
const TRAINING_STORE = path.resolve("tmp/ownership-api-test-training.json");
const MVP0_STORE = path.resolve("tmp/ownership-api-test-mvp0.json");
const MVP1_STORE = path.resolve("tmp/ownership-api-test-mvp1.json");
const AUTH_STORE = path.resolve("tmp/ownership-api-test-auth.sqlite");
const SESSION_SECRET = "test-secret-for-ownership-api-tests-32chars!";

let appProcess;

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

function extractCookie(response) {
  const header = response.headers.get("set-cookie") || "";
  return header.split(";")[0];
}

async function loginEarlyAccess(code) {
  const response = await fetch(`${BASE}/api/access/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();
  return { response, data, cookie: extractCookie(response) };
}

// ─── 测试数据 ───

const ALICE_USER_ID = "early-access:alice";
const BOB_USER_ID = "early-access:bob";

const ALICE_PROJECT_ID = "proj-alice-test";
const BOB_PROJECT_ID = "proj-bob-test";

function makeTestOwnershipData() {
  return {
    version: 1,
    projects: [
      {
        id: ALICE_PROJECT_ID,
        userId: ALICE_USER_ID,
        name: "Alice 测试项目",
        description: "Alice 的项目",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: BOB_PROJECT_ID,
        userId: BOB_USER_ID,
        name: "Bob 测试项目",
        description: "Bob 的项目",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    workItems: [
      {
        id: "wi-alice-auth",
        projectId: ALICE_PROJECT_ID,
        title: "登录与鉴权",
        description: "Alice 的鉴权模块",
        moduleType: "security",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "wi-alice-empty",
        projectId: ALICE_PROJECT_ID,
        title: "空模块（无决策）",
        description: "无重要决策的模块",
        moduleType: "feature",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "wi-bob-feature",
        projectId: BOB_PROJECT_ID,
        title: "Bob 的功能模块",
        description: "Bob 的模块",
        moduleType: "feature",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    agentSessions: [
      {
        id: "session-alice-auth",
        projectId: ALICE_PROJECT_ID,
        workItemId: "wi-alice-auth",
        source: "codex",
        title: "实现鉴权",
        implementationSummary: "AI 实现了完整鉴权流程",
        importedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    artifacts: [],
    decisionRecords: [
      {
        id: "dec-alice-cookie",
        projectId: ALICE_PROJECT_ID,
        workItemId: "wi-alice-auth",
        sessionId: "session-alice-auth",
        title: "使用 HttpOnly Cookie",
        decision: "使用 HttpOnly Secure Cookie 管理会话",
        rationale: "防止 XSS",
        decisionType: "security",
        importance: "critical",
        decisionMaker: "agent",
        userParticipation: "accepted",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "dec-alice-low",
        projectId: ALICE_PROJECT_ID,
        workItemId: "wi-alice-empty",
        title: "低重要性决策",
        decision: "不重要的决策",
        decisionType: "other",
        importance: "low",
        decisionMaker: "agent",
        userParticipation: "none",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    evidenceRecords: [],
    decisionDebtLinks: [],
    decisionArtifactLinks: [],
    ownershipSnapshots: [],
  };
}

async function removeStores() {
  await rm(OWNERSHIP_STORE, { force: true });
  await rm(TRAINING_STORE, { force: true });
  await rm(MVP0_STORE, { force: true });
  await rm(MVP1_STORE, { force: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
}

beforeAll(async () => {
  await mkdir(path.dirname(OWNERSHIP_STORE), { recursive: true });
  await removeStores();

  // 写入预置 ownership 数据
  await writeFile(OWNERSHIP_STORE, JSON.stringify(makeTestOwnershipData(), null, 2));
  // 写入空的 training store
  await writeFile(TRAINING_STORE, JSON.stringify({
    version: 1,
    trainingAttempts: [],
    masteryProfiles: [],
    reviewTasks: [],
    cognitiveDebts: [],
    capabilities: [],
  }, null, 2));

  appProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      OWNERSHIP_STORE_PATH: OWNERSHIP_STORE,
      TRAINING_STORE_PATH: TRAINING_STORE,
      MVP0_STORE_PATH: MVP0_STORE,
      MVP1_STORE_PATH: MVP1_STORE,
      AUTH_STORE_PATH: AUTH_STORE,
      MINDIOU_EARLY_ACCESS_CODES: "alice:code-alice,bob:code-bob",
      MINDIOU_SESSION_SECRET: SESSION_SECRET,
      AI_PROVIDER: "deepseek",
      AI_API_KEY: "test-key",
      AI_BASE_URL: "http://127.0.0.1:18999/v1",
      STT_API_KEY: "",
      LEARNING_API_TOKEN: "",
    },
    stdio: "pipe",
  });
  // 全量并行运行时多个测试文件同时拉起 server.js 子进程，
  // CPU 竞争会把启动+健康轮询挤过默认 10s hook 超时，这里放宽到 30s。
  await waitFor(`${BASE}/health`, 120);
}, 30000);

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 500));
  await removeStores();
});

// ─── API + 权限测试 ───

describe("项目所有权 API — 基础访问", () => {
  it("未登录用户不能访问项目列表", async () => {
    const res = await fetch(`${BASE}/api/projects`);
    expect(res.status).toBe(401);
  });

  it("登录后可以列出自己的项目", async () => {
    const { cookie } = await loginEarlyAccess("code-alice");
    const res = await fetch(`${BASE}/api/projects`, {
      headers: { cookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].id).toBe(ALICE_PROJECT_ID);
  });
});

describe("项目所有权 API — 跨用户隔离", () => {
  let aliceCookie;
  let bobCookie;

  beforeAll(async () => {
    const aliceLogin = await loginEarlyAccess("code-alice");
    const bobLogin = await loginEarlyAccess("code-bob");
    aliceCookie = aliceLogin.cookie;
    bobCookie = bobLogin.cookie;
  });

  it("用户 A 不能访问用户 B 的项目所有权", async () => {
    // Bob 尝试访问 Alice 的项目
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership`, {
      headers: { cookie: bobCookie },
    });
    expect(res.status).toBe(404);
  });

  it("用户 B 不能访问用户 A 的项目详情", async () => {
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}`, {
      headers: { cookie: bobCookie },
    });
    expect(res.status).toBe(404);
  });

  it("用户 A 可以访问自己的项目所有权摘要", async () => {
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership`, {
      headers: { cookie: aliceCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.project.id).toBe(ALICE_PROJECT_ID);
    expect(data.summary).toBeTruthy();
    expect(data.modules).toHaveLength(2);
  });

  it("用户 A 的项目摘要正确统计重要决策", async () => {
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership`, {
      headers: { cookie: aliceCookie },
    });
    const data = await res.json();
    // 1 个 critical 决策（dec-alice-cookie），1 个 low 决策（不计入重要决策）
    expect(data.summary.importantDecisionCount).toBe(1);
    // critical 决策无证据 → high_risk_unowned
    expect(data.summary.highRiskUnownedCount).toBe(1);
  });

  it("用户 B 不能触发用户 A 项目的重新计算", async () => {
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/recalculate`, {
      method: "POST",
      headers: { cookie: bobCookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});

describe("项目所有权 API — 模块详情", () => {
  let aliceCookie;

  beforeAll(async () => {
    const login = await loginEarlyAccess("code-alice");
    aliceCookie = login.cookie;
  });

  it("用户可以获取模块详情", async () => {
    const res = await fetch(
      `${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/modules/wi-alice-auth`,
      { headers: { cookie: aliceCookie } }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.module).toBeTruthy();
    expect(data.module.workItemId).toBe("wi-alice-auth");
    expect(data.module.title).toBe("登录与鉴权");
    expect(data.module.aiWork).toBeTruthy();
    expect(data.module.aiWork.decisions).toHaveLength(1);
  });

  it("不存在的模块返回 404", async () => {
    const res = await fetch(
      `${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/modules/nonexistent`,
      { headers: { cookie: aliceCookie } }
    );
    expect(res.status).toBe(404);
  });

  it("空模块（无重要决策）显示 owned 状态", async () => {
    const res = await fetch(
      `${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/modules/wi-alice-empty`,
      { headers: { cookie: aliceCookie } }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.module.status).toBe("owned");
    expect(data.module.importantDecisionCount).toBe(0);
  });
});

describe("项目所有权 API — 高风险模块", () => {
  let aliceCookie;

  beforeAll(async () => {
    const login = await loginEarlyAccess("code-alice");
    aliceCookie = login.cookie;
  });

  it("返回高风险无人负责模块", async () => {
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/high-risk`, {
      headers: { cookie: aliceCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.highRiskModules).toHaveLength(1);
    expect(data.highRiskModules[0].workItemId).toBe("wi-alice-auth");
  });
});

describe("项目所有权 API — 重新计算与快照", () => {
  let aliceCookie;

  beforeAll(async () => {
    const login = await loginEarlyAccess("code-alice");
    aliceCookie = login.cookie;
  });

  it("重新计算是幂等的", async () => {
    // 第一次重新计算
    const res1 = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/recalculate`, {
      method: "POST",
      headers: { cookie: aliceCookie, "content-type": "application/json" },
      body: "{}",
    });
    const data1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(data1.ok).toBe(true);
    expect(data1.snapshotSaved).toBe(true);

    // 第二次重新计算 — 结果应该一致
    const res2 = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/recalculate`, {
      method: "POST",
      headers: { cookie: aliceCookie, "content-type": "application/json" },
      body: "{}",
    });
    const data2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(data2.summary.importantDecisionCount).toBe(data1.summary.importantDecisionCount);
    expect(data2.summary.highRiskUnownedCount).toBe(data1.summary.highRiskUnownedCount);
  });

  it("重新计算后可以查看快照历史", async () => {
    const res = await fetch(`${BASE}/api/projects/${ALICE_PROJECT_ID}/ownership/history`, {
      headers: { cookie: aliceCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.snapshots.length).toBeGreaterThanOrEqual(1);
    const snapshot = data.snapshots[0];
    expect(snapshot.projectId).toBe(ALICE_PROJECT_ID);
    expect(snapshot.importantDecisionCount).toBe(1);
    expect(snapshot.highRiskUnownedCount).toBe(1);
    expect(snapshot.calculationVersion).toBeTruthy();
  });
});

describe("项目所有权 API — 空状态", () => {
  let bobCookie;

  beforeAll(async () => {
    const login = await loginEarlyAccess("code-bob");
    bobCookie = login.cookie;
  });

  it("Bob 的项目（无重要决策）显示合理空状态", async () => {
    const res = await fetch(`${BASE}/api/projects/${BOB_PROJECT_ID}/ownership`, {
      headers: { cookie: bobCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.summary.importantDecisionCount).toBe(0);
    expect(data.summary.ownedDecisionCount).toBe(0);
    expect(data.summary.highRiskUnownedCount).toBe(0);
    expect(data.summary.ownershipCoverage).toBe(0);
  });
});
