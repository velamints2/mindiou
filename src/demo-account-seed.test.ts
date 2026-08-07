// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createAuthStore } from "../auth-store.js";
import { createMvp0Store } from "../mvp0-store.js";
import { createTrainingStore } from "../training-store.js";
import { createCognitiveRepaymentStore } from "../cognitive-repayment-store.js";
import { createOwnershipStore } from "../project-ownership-store.js";
import { seedOwnershipData } from "../ownership-seed.js";
import { seedDemoAccountData, DEMO_REPORT_ID } from "../demo-account-seed.js";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const tmpDir = path.join(os.tmpdir(), `mindiou-demo-seed-test-${Date.now()}-${process.pid}`);

async function buildStores() {
  await mkdir(tmpDir, { recursive: true });
  const authStore = createAuthStore(path.join(tmpDir, "auth.sqlite"));
  const mvp0Store = createMvp0Store(path.join(tmpDir, "mvp0.json"));
  await mvp0Store.load();
  const trainingStore = createTrainingStore(path.join(tmpDir, "training.json"));
  await trainingStore.load();
  const repaymentStore = createCognitiveRepaymentStore(path.join(tmpDir, "repayment.sqlite"));
  await repaymentStore.load();
  const ownershipStore = createOwnershipStore(path.join(tmpDir, "ownership.json"));
  await ownershipStore.load();
  return { authStore, mvp0Store, trainingStore, repaymentStore, ownershipStore };
}

const DEMO_EMAIL = "demo@mindiou.test";
const DEMO_PASSWORD = "Demo-12345";

describe("ensureDemoAccount", () => {
  let stores;
  beforeEach(async () => { stores = await buildStores(); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("creates the demo account on first call", () => {
    const { user, created } = stores.authStore.ensureDemoAccount({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: "演示体验官"
    });
    expect(created).toBe(true);
    expect(user.email).toBe(DEMO_EMAIL);
    expect(user.id).toBeTruthy();
  });

  it("is idempotent: second call returns existing user with created=false", () => {
    const first = stores.authStore.ensureDemoAccount({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const second = stores.authStore.ensureDemoAccount({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it("can login with the configured password", () => {
    stores.authStore.ensureDemoAccount({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const { user } = stores.authStore.login(DEMO_EMAIL, DEMO_PASSWORD);
    expect(user.email).toBe(DEMO_EMAIL);
  });

  it("rejects missing email or password", () => {
    expect(() => stores.authStore.ensureDemoAccount({})).toThrow("required");
    expect(() => stores.authStore.ensureDemoAccount({ email: DEMO_EMAIL })).toThrow("required");
  });
});

describe("seedDemoAccountData", () => {
  let stores, userId;
  beforeEach(async () => {
    stores = await buildStores();
    const { user } = stores.authStore.ensureDemoAccount({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    userId = user.id;
    // ownership-seed 创建项目 + 3 条认知欠条，mastery profile 引用这些 debt id
    await seedOwnershipData(stores.ownershipStore, stores.trainingStore, userId);
  });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it("seeds report, capability profiles, mastery profiles and activates genesis", async () => {
    const result = await seedDemoAccountData({
      authStore: stores.authStore,
      mvp0Store: stores.mvp0Store,
      trainingStore: stores.trainingStore,
      repaymentStore: stores.repaymentStore,
      userId
    });
    expect(result.seeded).toBe(true);
    expect(result.reportId).toBe(DEMO_REPORT_ID);

    // 1. 七段报告存在且属于该用户
    const report = stores.mvp0Store.getReport(DEMO_REPORT_ID, userId);
    expect(report.userId).toBe(userId);
    expect(report.sections.dangerousGaps).toHaveLength(3);
    expect(report.sections.feynmanCards).toHaveLength(3);
    expect(report.sections.nextActions.length).toBeGreaterThanOrEqual(3);
    expect(report.generation.fallback).toBe(false);

    // 2. 能力画像：2 个 domain
    const profiles = stores.repaymentStore.listCapabilityProfiles(userId);
    expect(profiles).toHaveLength(2);
    const domains = profiles.map(p => p.domain).sort();
    expect(domains).toEqual(["system-architecture", "web-development"]);
    // 每个维度都有 score/level/stability/evidence
    const webProfile = profiles.find(p => p.domain === "web-development");
    expect(webProfile.dimensions.conceptualUnderstanding.score).toBeGreaterThan(0);
    expect(webProfile.dimensions.conceptualUnderstanding.stability).toBe("stable");

    // 3. 掌握度画像：3 条（对应 ownership-seed 的 3 条欠条）
    const mastery = stores.trainingStore.listMasteryProfiles(userId);
    expect(mastery).toHaveLength(3);
    const debtIds = mastery.map(m => m.cognitiveDebtId).sort();
    expect(debtIds).toEqual([
      "debt-auth-session-revoke",
      "debt-payment-concurrency",
      "debt-redeem-race"
    ]);

    // 4. 创世档案已激活 + 公开身份
    const user = stores.authStore.getUserById(userId);
    expect(user.genesisIdentity.activatedAt).toBeTruthy();
    expect(user.genesisIdentity.visibility).toBe("public");
    expect(user.name).toBeTruthy();
  });

  it("is idempotent: second call returns seeded=false and does not duplicate", async () => {
    const ctx = { authStore: stores.authStore, mvp0Store: stores.mvp0Store, trainingStore: stores.trainingStore, repaymentStore: stores.repaymentStore, userId };
    const first = await seedDemoAccountData(ctx);
    expect(first.seeded).toBe(true);

    const second = await seedDemoAccountData(ctx);
    expect(second.seeded).toBe(false);

    // 数据未重复
    const profiles = stores.repaymentStore.listCapabilityProfiles(userId);
    expect(profiles).toHaveLength(2);
    const mastery = stores.trainingStore.listMasteryProfiles(userId);
    expect(mastery).toHaveLength(3);
  });

  it("report is visible only to the demo user (userId isolation)", async () => {
    await seedDemoAccountData({
      authStore: stores.authStore,
      mvp0Store: stores.mvp0Store,
      trainingStore: stores.trainingStore,
      repaymentStore: stores.repaymentStore,
      userId
    });
    // 另一个用户无法读取演示账号的报告
    const { user: other } = stores.authStore.ensureDemoAccount({ email: "other@mindiou.test", password: "Other-12345" });
    expect(() => stores.mvp0Store.getReport(DEMO_REPORT_ID, other.id)).toThrow("Report not found");
  });
});
