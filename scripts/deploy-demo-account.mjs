/**
 * 一次性部署脚本：在生产服务器上创建演示账号并预填充体验数据。
 *
 * 不修改服务器任何现有代码文件。仅：
 *   1. 读取 /etc/mindiou.env 路径配置
 *   2. 创建 authStore + 业务 store（import 服务器现有模块）
 *   3. 注册演示账号（幂等：邮箱已存在则跳过）
 *   4. 调用 seedOwnershipData + seedDemoAccountData 预填充数据
 *
 * 用法（在服务器 /opt/mindiou/ 下执行）：
 *   node --env-file=/etc/mindiou.env scripts/deploy-demo-account.mjs
 *
 * 或通过 ssh：
 *   ssh root@HOST 'cd /opt/mindiou && node --env-file=/etc/mindiou.env scripts/deploy-demo-account.mjs'
 */
import { createAuthStore } from "../auth-store.js";
import { createMvp0Store } from "../mvp0-store.js";
import { createTrainingStore } from "../training-store.js";
import { createCognitiveRepaymentStore } from "../cognitive-repayment-store.js";
import { createOwnershipStore } from "../project-ownership-store.js";
import { seedOwnershipData } from "../ownership-seed.js";
import { seedDemoAccountData, DEMO_REPORT_ID } from "../demo-account-seed.js";

const DEMO_EMAIL = process.env.DEMO_USERNAME || "demo@mindiou.app";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "";
const DEMO_NAME = "MindIOU 演示体验官";

if (!DEMO_PASSWORD) {
  console.error("[demo] 错误：DEMO_PASSWORD 环境变量未设置");
  process.exit(1);
}

// 注意：服务器 server.js 用 DATA_DB_PATH 创建 authStore（不是 AUTH_STORE_PATH）
const authDbPath = process.env.DATA_DB_PATH || process.env.AUTH_STORE_PATH;
const dataDbPath = process.env.DATA_DB_PATH;
const ownershipPath = process.env.OWNERSHIP_STORE_PATH || "/var/lib/mindiou/ownership-store.json";

console.log(`[demo] 演示账号: ${DEMO_EMAIL}`);
console.log(`[demo] auth DB: ${authDbPath}`);
console.log(`[demo] data DB: ${dataDbPath}`);
console.log(`[demo] ownership: ${ownershipPath}`);

// 1. 创建并加载 store
const authStore = createAuthStore(authDbPath);
const mvp0Store = createMvp0Store(dataDbPath, { legacyJsonPath: process.env.MVP0_STORE_PATH });
await mvp0Store.load();
const trainingStore = createTrainingStore(dataDbPath, { legacyJsonPath: process.env.TRAINING_STORE_PATH });
await trainingStore.load();
const repaymentStore = createCognitiveRepaymentStore(dataDbPath, {
  legacyJsonPath: process.env.COGNITIVE_REPAYMENT_STORE_PATH
});
await repaymentStore.load();
const ownershipStore = createOwnershipStore(ownershipPath);
await ownershipStore.load();
console.log("[demo] store 已加载");

// 2. 注册演示账号（幂等：邮箱已存在则跳过）
let demoUser;
try {
  const { user } = authStore.register(DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME);
  demoUser = user;
  console.log(`[demo] 演示账号已创建: ${demoUser.id}`);
} catch (err) {
  if (String(err.message || "").includes("already registered")) {
    // 邮箱已存在，通过 listUsersWithStats 查找
    const users = authStore.listUsersWithStats();
    const found = users.find(u => u.email === DEMO_EMAIL.toLowerCase().trim());
    if (!found) throw new Error(`注册说邮箱已存在但 listUsersWithStats 找不到: ${DEMO_EMAIL}`);
    demoUser = { id: found.id, email: found.email, name: found.displayName };
    console.log(`[demo] 演示账号已存在: ${demoUser.id}`);
  } else {
    throw err;
  }
}

// 3. 项目 + 工作项 + 认知欠条
await seedOwnershipData(ownershipStore, trainingStore, demoUser.id);
console.log("[demo] 项目种子数据已填充");

// 3.5 修复欠条 userId（ownership-seed 内部默认用 "demo-user" 而非传入的 userId）
const seedDebtIds = ["debt-auth-session-revoke", "debt-payment-concurrency", "debt-redeem-race"];
for (const debtId of seedDebtIds) {
  try {
    const debt = trainingStore.getCognitiveDebt(debtId);
    if (debt && debt.userId !== demoUser.id) {
      await trainingStore.saveCognitiveDebt({ ...debt, userId: demoUser.id });
      console.log(`[demo] 修复欠条 userId: ${debtId}`);
    }
  } catch {
    // 欠条不存在，跳过
  }
}

// 4. 报告 + 能力画像 + 掌握度画像 + 创世档案
const result = await seedDemoAccountData({
  authStore,
  mvp0Store,
  trainingStore,
  repaymentStore,
  userId: demoUser.id
});
console.log(`[demo] 体验数据已填充: seeded=${result.seeded}, reportId=${result.reportId}`);

// 4.5 创建 "demo-user" 占位项目，防止服务重启时 seedOwnershipData(默认 "demo-user")
//      重新创建欠条覆盖 demo 用户的 userId。服务代码 server.js 第 202 行不传 userId。
if (!ownershipStore.getProject("mindiou-web", "demo-user")) {
  ownershipStore.saveProject({
    id: "mindiou-web",
    name: "MindIOU Web (legacy placeholder)",
    userId: "demo-user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  console.log("[demo] 已创建 demo-user 占位项目（防止服务重启覆盖）");
}

// 5. 验证
const report = mvp0Store.getReport(DEMO_REPORT_ID, demoUser.id);
console.log(`[demo] 验证报告: gaps=${report.sections.dangerousGaps.length}, cards=${report.sections.feynmanCards.length}`);
const profiles = repaymentStore.listCapabilityProfiles(demoUser.id);
console.log(`[demo] 验证能力画像: domains=${profiles.length}`);
const debts = trainingStore.listCognitiveDebts ? trainingStore.listCognitiveDebts(demoUser.id) : [];
console.log(`[demo] 验证认知欠条: count=${debts.length}`);
const user = authStore.getUserById(demoUser.id);
console.log(`[demo] 验证创世档案: activated=${!!user.genesisIdentity?.activatedAt}, visibility=${user.genesisIdentity?.visibility}`);

console.log("");
console.log("========================================");
console.log("演示账号部署完成");
console.log("========================================");
console.log(`  邮箱: ${DEMO_EMAIL}`);
console.log(`  登录: https://demo.mindiou.top/mindiou/#/login`);
console.log("========================================");
