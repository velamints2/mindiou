/**
 * 一次性脚本：补充演示账号的体验内容。
 *
 * 1. 从 seed-report 的 dangerousGaps 导入 3 条 repayment gaps
 * 2. 创建 3 条今日到期的 review tasks（让"今日复训"有任务）
 * 3. 将 mastery profiles 的 nextReviewAt 调整到今天
 * 4. 补充项目记忆数据（sessions/artifacts/decisions）
 * 5. 创建一条已清偿欠条 + 清偿历史（展示完整清偿会话机制）
 *
 * 用法（在服务器 /opt/mindiou/ 下执行）：
 *   node --env-file=/etc/mindiou.env scripts/fill-demo-content.mjs
 */
import crypto from "node:crypto";
import { createAuthStore } from "../auth-store.js";
import { createMvp0Store } from "../mvp0-store.js";
import { createTrainingStore } from "../training-store.js";
import { createCognitiveRepaymentStore } from "../cognitive-repayment-store.js";
import { createProjectMemoryStore } from "../project-memory-store.js";
import { createGapFromReport } from "../cognitive-repayment.js";
import { DEMO_REPORT_ID } from "../demo-account-seed.js";

const DEMO_EMAIL = process.env.DEMO_USERNAME || "demo@mindiou.app";

const authDbPath = process.env.DATA_DB_PATH || process.env.AUTH_STORE_PATH;
const dataDbPath = process.env.DATA_DB_PATH;

console.log("[fill] 演示账号:", DEMO_EMAIL);
console.log("[fill] data DB:", dataDbPath);

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
const projectMemoryStore = createProjectMemoryStore(dataDbPath);
console.log("[fill] store 已加载");

// 2. 查找演示账号
const users = authStore.listUsersWithStats();
const demoUser = users.find(u => u.email === DEMO_EMAIL.toLowerCase().trim());
if (!demoUser) {
  console.error(`[fill] 错误：演示账号 ${DEMO_EMAIL} 不存在`);
  process.exit(1);
}
const userId = demoUser.id;
console.log(`[fill] 演示账号 userId: ${userId}`);

// 3. 获取报告
const report = mvp0Store.getReport(DEMO_REPORT_ID, userId);
console.log(`[fill] 报告: ${report.id}, dangerousGaps=${report.sections.dangerousGaps.length}`);

// 4. 导入 repayment gaps（幂等：已存在则跳过）
const now = new Date().toISOString();
let importedCount = 0;
for (const gapRef of report.sections.dangerousGaps) {
  const existing = repaymentStore.listGaps(userId).find(
    item => item.reportId === report.id && item.gapRank === gapRef.rank
  );
  if (existing) {
    console.log(`[fill] repayment gap #${gapRef.rank} 已存在，跳过`);
    continue;
  }
  const gap = createGapFromReport({
    report,
    gapRef: { gapRank: gapRef.rank },
    userId,
    now
  });
  await repaymentStore.saveGap(gap);
  console.log(`[fill] 已导入 repayment gap #${gapRef.rank}: ${gap.title}`);
  importedCount++;
}
console.log(`[fill] repayment gaps 导入完成: ${importedCount} 条新增`);

// 5. 创建 review tasks（今日到期，让"今日复训"有任务）
const seedDebtIds = ["debt-auth-session-revoke", "debt-payment-concurrency", "debt-redeem-race"];
const reviewPrompts = {
  "debt-auth-session-revoke": "用自己的话解释 jti 撤销集合在进程重启后的行为，以及这对安全边界的影响。",
  "debt-payment-concurrency": "描述数据库条件更新在并发场景下的原子性保证，以及唯一约束的边界条件。",
  "debt-redeem-race": "解释 SQLite WAL 模式与 PostgreSQL 在迁移验收上的关键差异。"
};
const trainingStages = {
  "debt-auth-session-revoke": 2,
  "debt-payment-concurrency": 3,
  "debt-redeem-race": 1
};

let taskCount = 0;
for (const debtId of seedDebtIds) {
  // 幂等：已存在 pending 的 review task 则跳过
  const existingTasks = trainingStore.listReviewTasks(userId, { status: "pending", cognitiveDebtId: debtId });
  if (existingTasks.length > 0) {
    console.log(`[fill] review task for ${debtId} 已存在，跳过`);
    continue;
  }
  const taskId = `review-demo-${debtId}-${Date.now()}`;
  const task = {
    id: taskId,
    userId,
    cognitiveDebtId: debtId,
    status: "pending",
    prompt: reviewPrompts[debtId] || "复习这条认知欠条的核心机制。",
    trainingStage: trainingStages[debtId] || 1,
    dueAt: now, // 今日到期
    createdAt: now,
    updatedAt: now
  };
  await trainingStore.saveReviewTask(task);
  console.log(`[fill] 已创建 review task: ${debtId}`);
  taskCount++;
}
console.log(`[fill] review tasks 创建完成: ${taskCount} 条新增`);

// 6. 调整 mastery profiles 的 nextReviewAt 到今天
for (const debtId of seedDebtIds) {
  const profile = trainingStore.getMasteryProfile(debtId);
  if (!profile) {
    console.log(`[fill] mastery profile for ${debtId} 不存在，跳过`);
    continue;
  }
  const todayIso = new Date().toISOString();
  if (profile.nextReviewAt && new Date(profile.nextReviewAt) <= new Date(todayIso)) {
    console.log(`[fill] mastery profile ${debtId} nextReviewAt 已到期，跳过`);
    continue;
  }
  await trainingStore.saveMasteryProfile({
    ...profile,
    nextReviewAt: todayIso
  });
  console.log(`[fill] 已调整 mastery profile ${debtId} nextReviewAt -> 今天`);
}

// 7. 验证
const gaps = repaymentStore.listGaps(userId);
console.log(`[fill] 验证 repayment gaps: ${gaps.length} 条`);
const dueReviews = trainingStore.listDueReviews(userId);
console.log(`[fill] 验证今日到期 review tasks: ${dueReviews.length} 条`);

// ── 项目记忆数据 ──
const PROJECT_ID = "mindiou-web";

// 7.5 创建功能任务（幂等：按标题去重），供项目结构树分组
// sessionsData 中的 workItemId 是提示键，映射到真实 work item id
const mainWorkItemsData = [
  { hint: "wi-auth", title: "登录与鉴权", summary: "注册登录、HttpOnly Cookie 会话与令牌撤销", type: "security", status: "verified" },
  { hint: "wi-redeem", title: "激活码兑换", summary: "条件更新与唯一约束防并发重复兑换", type: "feature", status: "verified" },
  { hint: "wi-migration", title: "SQLite 迁移", summary: "JSON 持久化迁移到 SQLite WAL 模式", type: "refactor", status: "verified" }
];
const mainWorkItemIdByHint = new Map();
{
  const existingMainWorkItems = projectMemoryStore.listWorkItems(PROJECT_ID, userId);
  for (const wi of mainWorkItemsData) {
    const found = existingMainWorkItems.find(w => w.title === wi.title);
    if (found) { mainWorkItemIdByHint.set(wi.hint, found.id); continue; }
    const created = projectMemoryStore.createWorkItem({
      projectId: PROJECT_ID,
      title: wi.title,
      summary: wi.summary,
      type: wi.type,
      status: wi.status,
      source: "user_created"
    }, userId);
    mainWorkItemIdByHint.set(wi.hint, created.id);
    console.log(`[fill] 已创建功能任务: ${wi.title}`);
  }
}

// 8. 创建 Agent Sessions（幂等：按 sourceFingerprint 去重）
const sessionsData = [
  {
    sourceFingerprint: "demo-session-auth-revoke",
    platform: "codex",
    title: "会话令牌撤销机制实现",
    startedAt: "2026-08-06T02:00:00.000Z",
    endedAt: "2026-08-06T03:30:00.000Z",
    userIntentSummary: "实现用户退出登录时的会话令牌撤销，防止已退出令牌被重放",
    implementationSummary: "使用内存中的 jti 撤销集合记录已退出令牌，中间件检查每个请求的 jti 是否在集合中",
    outcomeSummary: "功能实现完成，但未考虑进程重启后撤销集合丢失的问题",
    keyTopics: ["JWT", "jti", "会话撤销", "安全"],
    technologies: ["Node.js", "Express", "SQLite"],
    workItemId: "wi-auth"
  },
  {
    sourceFingerprint: "demo-session-payment-concurrency",
    platform: "codex",
    title: "激活码兑换并发安全设计",
    startedAt: "2026-08-06T05:00:00.000Z",
    endedAt: "2026-08-06T06:15:00.000Z",
    userIntentSummary: "实现激活码兑换接口，确保并发场景下不会重复兑换",
    implementationSummary: "使用数据库条件更新（WHERE redeemed=0）和唯一约束防止重复兑换",
    outcomeSummary: "兑换逻辑实现完成，但未验证高并发下的原子性行为",
    keyTopics: ["并发", "原子性", "条件更新", "唯一约束"],
    technologies: ["Node.js", "SQLite", "WAL"],
    workItemId: "wi-redeem"
  },
  {
    sourceFingerprint: "demo-session-db-migration",
    platform: "trae",
    title: "JSON 到 SQLite 数据迁移",
    startedAt: "2026-08-05T08:00:00.000Z",
    endedAt: "2026-08-05T10:00:00.000Z",
    userIntentSummary: "将各 store 从 JSON 文件迁移到 SQLite，提升并发写入可靠性",
    implementationSummary: "启用 WAL 模式和 foreign_keys，每日在线备份，实现 checkpoint 逻辑",
    outcomeSummary: "迁移完成，但未验证与 PostgreSQL 的等价性",
    keyTopics: ["SQLite", "WAL", "数据迁移", "备份"],
    technologies: ["SQLite", "better-sqlite3", "Node.js"],
    workItemId: "wi-migration"
  }
];

const createdSessions = [];
for (const sd of sessionsData) {
  const existing = projectMemoryStore.findAgentSessionByFingerprint(sd.sourceFingerprint, userId);
  if (existing) {
    console.log(`[fill] agent session "${sd.title}" 已存在，跳过`);
    createdSessions.push(existing);
    continue;
  }
  const session = projectMemoryStore.saveAgentSession({
    projectId: PROJECT_ID,
    platform: sd.platform,
    sourceFingerprint: sd.sourceFingerprint,
    title: sd.title,
    startedAt: sd.startedAt,
    endedAt: sd.endedAt,
    userIntentSummary: sd.userIntentSummary,
    implementationSummary: sd.implementationSummary,
    outcomeSummary: sd.outcomeSummary,
    keyTopics: sd.keyTopics,
    technologies: sd.technologies,
    importMethod: "manual_paste",
    rawContentStorage: "not_stored",
    processingStatus: "completed"
  }, userId);
  console.log(`[fill] 已创建 agent session: ${session.title}`);
  createdSessions.push(session);
}

// 8.5 关联 session ↔ workItem（幂等 upsert），供结构树按功能任务分组
createdSessions.forEach((session, index) => {
  const hint = sessionsData[index]?.workItemId;
  const workItemId = hint ? mainWorkItemIdByHint.get(hint) : null;
  if (!workItemId) return;
  try {
    projectMemoryStore.linkSessionWorkItem(session.id, workItemId, { relation: "continued", source: "manual", confidence: 1 }, userId);
  } catch { /* 关联已存在则忽略 */ }
});

// 9. 创建 Artifacts（幂等：按 artifactKey 自动 upsert）
const artifactsData = [
  {
    type: "file",
    name: "auth-store.js",
    repositoryRelativePath: "evenhub-g2-learning/auth-store.js",
    language: "JavaScript",
    sessionId: 0,
    relation: "modified"
  },
  {
    type: "file",
    name: "server.js",
    repositoryRelativePath: "evenhub-g2-learning/server.js",
    language: "JavaScript",
    sessionId: 1,
    relation: "modified"
  },
  {
    type: "file",
    name: "training-store.js",
    repositoryRelativePath: "evenhub-g2-learning/training-store.js",
    language: "JavaScript",
    sessionId: 2,
    relation: "modified"
  },
  {
    type: "commit",
    name: "feat: add token revocation",
    gitCommitHash: "a1b2c3d4e5f6789",
    sessionId: 0,
    relation: "produced"
  }
];

const createdArtifacts = [];
for (const ad of artifactsData) {
  const artifact = projectMemoryStore.upsertArtifact({
    projectId: PROJECT_ID,
    type: ad.type,
    name: ad.name,
    repositoryRelativePath: ad.repositoryRelativePath,
    gitCommitHash: ad.gitCommitHash,
    language: ad.language,
    sensitivity: "metadata_only"
  }, userId);
  console.log(`[fill] artifact: ${artifact.name}`);
  createdArtifacts.push(artifact);

  // 关联 session 和 artifact
  if (createdSessions[ad.sessionId] && artifact) {
    try {
      projectMemoryStore.linkSessionArtifact(createdSessions[ad.sessionId].id, artifact.id, {
        relation: ad.relation
      }, userId);
    } catch (err) {
      // 关联已存在则忽略
    }
    // 关联 workItem 和 artifact（沿 session 的 workItem 归属）
    const workItemId = mainWorkItemIdByHint.get(sessionsData[ad.sessionId]?.workItemId);
    if (workItemId) {
      try {
        projectMemoryStore.linkWorkItemArtifact(workItemId, artifact.id, {
          relation: ad.relation,
          sourceSessionId: createdSessions[ad.sessionId].id
        }, userId);
      } catch { /* 关联已存在则忽略 */ }
    }
  }
}

// 10. 创建 Decisions（幂等：先检查是否已存在）
const existingDecisions = projectMemoryStore.listDecisions(PROJECT_ID, userId);
const decisionsData = [
  {
    title: "使用内存 jti 撤销集合而非 Redis",
    decision: "在内存中维护已撤销的 jti 集合，进程重启后集合清空",
    rationale: "MVP 阶段不引入 Redis 依赖，降低部署复杂度",
    alternatives: ["Redis 撤销集合", "数据库持久化撤销表"],
    tradeoffs: ["进程重启后撤销集合丢失", "已退出令牌可能被重放"],
    risks: ["重启后的安全窗口", "多实例部署时不共享撤销状态"],
    decisionType: "architecture",
    decisionMaker: "AI-assisted",
    userParticipation: "approved",
    importance: "high",
    sessionId: 0
  },
  {
    title: "激活码兑换使用条件更新而非事务锁",
    decision: "使用 UPDATE ... WHERE redeemed=0 实现原子性兑换，而非显式事务锁",
    rationale: "条件更新在 SQLite 中是原子的，性能优于显式锁",
    alternatives: ["SELECT FOR UPDATE", "应用层分布式锁"],
    tradeoffs: ["依赖数据库原子性保证", "未验证高并发边界"],
    risks: ["唯一约束的边界条件未验证", "并发量超预期时可能失效"],
    decisionType: "architecture",
    decisionMaker: "AI-assisted",
    userParticipation: "approved",
    importance: "high",
    sessionId: 1
  },
  {
    title: "SQLite WAL 模式而非 PostgreSQL",
    decision: "MVP 阶段使用 SQLite WAL 模式，未来迁移到 PostgreSQL",
    rationale: "SQLite 部署简单，WAL 模式支持并发读",
    alternatives: ["PostgreSQL", "MySQL"],
    tradeoffs: ["单机写入限制", "迁移验收差异"],
    risks: ["生产环境数据库行为差异", "外键约束语义不同"],
    decisionType: "infrastructure",
    decisionMaker: "AI-assisted",
    userParticipation: "approved",
    importance: "medium",
    sessionId: 2
  }
];

for (const dd of decisionsData) {
  const exists = existingDecisions.some(d => d.title === dd.title);
  if (exists) {
    console.log(`[fill] decision "${dd.title}" 已存在，跳过`);
    continue;
  }
  const decision = projectMemoryStore.createDecision({
    projectId: PROJECT_ID,
    sessionId: createdSessions[dd.sessionId]?.id || null,
    workItemId: mainWorkItemIdByHint.get(sessionsData[dd.sessionId]?.workItemId) || null,
    title: dd.title,
    decision: dd.decision,
    rationale: dd.rationale,
    alternatives: dd.alternatives,
    tradeoffs: dd.tradeoffs,
    risks: dd.risks,
    decisionType: dd.decisionType,
    decisionMaker: dd.decisionMaker,
    userParticipation: dd.userParticipation,
    importance: dd.importance
  }, userId);
  console.log(`[fill] 已创建 decision: ${decision.title}`);
}

// 11. 验证项目记忆数据
const memory = projectMemoryStore.memory(PROJECT_ID, userId);
console.log(`[fill] 验证项目记忆: sessions=${memory.sessions?.length || 0}, artifacts=${memory.artifacts?.length || 0}, decisions=${memory.decisions?.length || 0}`);

// 11.5 额外项目（认知账本多项目展示，幂等：按项目名去重）
// 每个项目带独立的功能任务 / Agent 会话 / 产出物 / 技术决策，
// 让评委看到"多项目并行追踪"而非单项目账本。
const extraProjects = [
  {
    name: "MindIOU 智能眼镜端",
    description: "G2 / Rokid 眼镜上的认知欠条清偿客户端：一屏一题、语音作答、与 Web 共享后端。",
    workItems: [
      { title: "眼镜端清偿会话界面", summary: "固定视口渲染问题、反馈与参考答案，禁止内容驱动滚动", type: "feature", status: "verified" },
      { title: "语音作答与短指令导航", summary: "短指令上下翻页，长语音视为学习答案提交后端", type: "feature", status: "in_progress" }
    ],
    sessions: [
      {
        sourceFingerprint: "demo-session-glasses-viewport",
        platform: "trae",
        title: "眼镜端固定视口渲染",
        startedAt: "2026-08-04T06:00:00.000Z",
        endedAt: "2026-08-04T07:20:00.000Z",
        userIntentSummary: "在 G2 眼镜上以固定视口展示清偿问题，避免长文滚动",
        implementationSummary: "实现单屏问题卡片 + 大字排版，切卡前清空旧反馈文本",
        outcomeSummary: "视口渲染完成，但未在真实眼镜上验证麦克风与手势延迟",
        keyTopics: ["G2", "固定视口", "清偿卡片"],
        technologies: ["EvenHub SDK", "WebView"],
        workItemIndex: 0
      },
      {
        sourceFingerprint: "demo-session-glasses-voice",
        platform: "codex",
        title: "语音作答接入",
        startedAt: "2026-08-04T09:00:00.000Z",
        endedAt: "2026-08-04T10:10:00.000Z",
        userIntentSummary: "把眼镜麦克风语音转文字后提交为清偿答案",
        implementationSummary: "复用现有 STT 接口，短指令走导航、长语音走答案提交",
        outcomeSummary: "链路打通，但网络路由依赖手机伴侣，弱网表现未验证",
        keyTopics: ["STT", "语音作答", "指令导航"],
        technologies: ["WebRTC", "STT API"],
        workItemIndex: 1
      }
    ],
    artifacts: [
      { type: "file", name: "mvp1.html", repositoryRelativePath: "evenhub-g2-learning/mvp1.html", language: "HTML", sessionIndex: 0, relation: "modified" },
      { type: "file", name: "voice-client.js", repositoryRelativePath: "evenhub-g2-learning/platforms/g2/voice-client.js", language: "JavaScript", sessionIndex: 1, relation: "produced" }
    ],
    decisions: [
      {
        title: "眼镜端只做单题清偿，不展示完整报告",
        decision: "眼镜视口只承载一问一答，完整七段报告留在 Web 端",
        rationale: "小视口信息密度受限，长报告浏览体验差",
        alternatives: ["眼镜端内嵌完整报告", "语音播报报告摘要"],
        tradeoffs: ["用户需回到 Web 查看报告全貌", "眼镜端职责更清晰"],
        risks: ["用户误以为眼镜端功能缺失"],
        decisionType: "product",
        decisionMaker: "user",
        userParticipation: "decided",
        importance: "high",
        sessionIndex: 0
      }
    ]
  },
  {
    name: "认知复训调度器",
    description: "基于遗忘曲线的复训任务生成与掌握度画像更新，支撑今日复训与长期追踪。",
    workItems: [
      { title: "复训任务调度", summary: "按 nextReviewAt 生成今日到期任务，支持六阶段进阶", type: "feature", status: "verified" },
      { title: "掌握度画像更新", summary: "每次复训评估后更新五维得分与阶段迁移", type: "feature", status: "verified" }
    ],
    sessions: [
      {
        sourceFingerprint: "demo-session-review-scheduler",
        platform: "trae",
        title: "复训调度器实现",
        startedAt: "2026-08-03T03:00:00.000Z",
        endedAt: "2026-08-03T04:40:00.000Z",
        userIntentSummary: "按艾宾浩斯间隔生成今日到期的复训任务",
        implementationSummary: "实现 review-scheduler，依据掌握度与上次练习时间计算 nextReviewAt",
        outcomeSummary: "调度逻辑完成并接入今日复训页，间隔参数未做个体化校准",
        keyTopics: ["遗忘曲线", "间隔重复", "任务调度"],
        technologies: ["Node.js", "SQLite"],
        workItemIndex: 0
      }
    ],
    artifacts: [
      { type: "file", name: "review-scheduler.js", repositoryRelativePath: "evenhub-g2-learning/review-scheduler.js", language: "JavaScript", sessionIndex: 0, relation: "modified" },
      { type: "file", name: "training-store.js", repositoryRelativePath: "evenhub-g2-learning/training-store.js", language: "JavaScript", sessionIndex: 0, relation: "modified" }
    ],
    decisions: [
      {
        title: "复训间隔固定档位而非个体化模型",
        decision: "使用 1/3/7/15 天固定间隔档位，暂不引入个体化遗忘参数拟合",
        rationale: "演示阶段样本量不足，固定档位行为可预期、易验证",
        alternatives: ["SM-2 算法", "个体化贝叶斯遗忘模型"],
        tradeoffs: ["复习节奏不精确", "实现与验收简单"],
        risks: ["高频欠条可能复习不足", "长期需回归个体化模型"],
        decisionType: "algorithm",
        decisionMaker: "AI-assisted",
        userParticipation: "approved",
        importance: "medium",
        sessionIndex: 0
      }
    ]
  }
];

const existingProjects = projectMemoryStore.listProjects(userId);
for (const pd of extraProjects) {
  let project = existingProjects.find(p => p.name === pd.name);
  if (project) {
    console.log(`[fill] 项目 "${pd.name}" 已存在，补充缺失数据`);
  } else {
    project = projectMemoryStore.createProject({
      name: pd.name,
      description: pd.description,
      projectType: "software"
    }, userId);
    console.log(`[fill] 已创建项目: ${pd.name}`);
  }

  const workItemIds = [];
  const existingWorkItems = projectMemoryStore.listWorkItems(project.id, userId);
  for (const wi of pd.workItems) {
    const found = existingWorkItems.find(w => w.title === wi.title);
    if (found) { workItemIds.push(found.id); continue; }
    const created = projectMemoryStore.createWorkItem({
      projectId: project.id,
      title: wi.title,
      summary: wi.summary,
      type: wi.type,
      status: wi.status,
      source: "user_created"
    }, userId);
    workItemIds.push(created.id);
  }

  const projectSessions = [];
  for (const sd of pd.sessions) {
    const existing = projectMemoryStore.findAgentSessionByFingerprint(sd.sourceFingerprint, userId);
    if (existing) { projectSessions.push(existing); continue; }
    const session = projectMemoryStore.saveAgentSession({
      projectId: project.id,
      platform: sd.platform,
      sourceFingerprint: sd.sourceFingerprint,
      title: sd.title,
      startedAt: sd.startedAt,
      endedAt: sd.endedAt,
      userIntentSummary: sd.userIntentSummary,
      implementationSummary: sd.implementationSummary,
      outcomeSummary: sd.outcomeSummary,
      keyTopics: sd.keyTopics,
      technologies: sd.technologies,
      importMethod: "manual_paste",
      rawContentStorage: "not_stored",
      processingStatus: "completed"
    }, userId);
    console.log(`[fill]   会话: ${session.title}`);
    projectSessions.push(session);
  }

  // 关联 session ↔ workItem（幂等 upsert），供结构树按功能任务分组
  projectSessions.forEach((session, index) => {
    const workItemIndex = pd.sessions[index]?.workItemIndex;
    const workItemId = workItemIndex != null ? workItemIds[workItemIndex] : null;
    if (!workItemId) return;
    try {
      projectMemoryStore.linkSessionWorkItem(session.id, workItemId, { relation: "continued", source: "manual", confidence: 1 }, userId);
    } catch { /* 关联已存在则忽略 */ }
  });

  for (const ad of pd.artifacts) {
    const artifact = projectMemoryStore.upsertArtifact({
      projectId: project.id,
      type: ad.type,
      name: ad.name,
      repositoryRelativePath: ad.repositoryRelativePath,
      language: ad.language,
      sensitivity: "metadata_only"
    }, userId);
    const session = projectSessions[ad.sessionIndex];
    if (session && artifact) {
      try {
        projectMemoryStore.linkSessionArtifact(session.id, artifact.id, { relation: ad.relation }, userId);
      } catch { /* 关联已存在 */ }
      // 关联 workItem ↔ artifact（沿 session 的 workItem 归属）
      const workItemIndex = pd.sessions[ad.sessionIndex]?.workItemIndex;
      const workItemId = workItemIndex != null ? workItemIds[workItemIndex] : null;
      if (workItemId) {
        try {
          projectMemoryStore.linkWorkItemArtifact(workItemId, artifact.id, {
            relation: ad.relation,
            sourceSessionId: session.id
          }, userId);
        } catch { /* 关联已存在则忽略 */ }
      }
    }
  }

  const projectDecisions = projectMemoryStore.listDecisions(project.id, userId);
  for (const dd of pd.decisions) {
    if (projectDecisions.some(d => d.title === dd.title)) continue;
    const workItemIndex = pd.sessions[dd.sessionIndex]?.workItemIndex;
    projectMemoryStore.createDecision({
      projectId: project.id,
      sessionId: projectSessions[dd.sessionIndex]?.id || null,
      workItemId: workItemIndex != null ? workItemIds[workItemIndex] || null : null,
      title: dd.title,
      decision: dd.decision,
      rationale: dd.rationale,
      alternatives: dd.alternatives,
      tradeoffs: dd.tradeoffs,
      risks: dd.risks,
      decisionType: dd.decisionType,
      decisionMaker: dd.decisionMaker,
      userParticipation: dd.userParticipation,
      importance: dd.importance
    }, userId);
    console.log(`[fill]   决策: ${dd.title}`);
  }

  const pm = projectMemoryStore.memory(project.id, userId);
  console.log(`[fill] 项目 "${pd.name}": sessions=${pm.sessions.length}, workItems=${pm.workItems.length}, decisions=${pm.decisions.length}`);
}


// ── 已清偿欠条 + 清偿历史 ──
// 创建一条已清偿的 gap 和两条通过的 attempt，展示完整清偿会话机制
const REPAID_GAP_ID = "demo-repaid-gap-credit-system";
const existingRepaidGap = (() => {
  try { return repaymentStore.getGap(REPAID_GAP_ID, userId); } catch { return null; }
})();

if (!existingRepaidGap) {
  const repaidGap = {
    gapId: REPAID_GAP_ID,
    userId,
    reportId: DEMO_REPORT_ID,
    cardId: null,
    gapRank: 1,
    title: "信用积分系统的设计边界",
    whyItMatters: "用户未理解信用积分的累加规则和边界条件，可能在高并发或异常场景下产生错误积分",
    evidence: [
      { excerpt: "接受积分累加方案但未追问并发场景", evidenceType: "inferred", sourceLocation: { kind: "unlocated" } },
      { excerpt: "无法说明积分回滚与事务的关系", evidenceType: "inferred", sourceLocation: { kind: "unlocated" } }
    ],
    systemReasoningSummary: "该缺口解释 2 个表面信号，0 条证据可直接定位到输入材料；证据无法定位，已标记为推断型缺口",
    confidence: 0.38,
    userCapabilityLevel: "mixed",
    verificationMethod: "信用积分在并发累加时如何保证一致性？积分回滚时事务边界是什么？",
    status: "repaid",
    statusHistory: [
      { from: "identified", to: "queued", reason: "用户选择开始清偿", at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      { from: "queued", to: "attempting", reason: "用户提交第一次回答", at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      { from: "attempting", to: "partiallyRepaid", reason: "首次通过，需要间隔后再次独立验证", at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      { from: "partiallyRepaid", to: "attempting", reason: "用户提交第二次回答", at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
      { from: "attempting", to: "repaid", reason: "再次独立通过，标记为已清偿", at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    dataSchemaVersion: "repayment-data-1"
  };
  await repaymentStore.saveGap(repaidGap);
  console.log(`[fill] 已创建已清偿 gap: ${repaidGap.title}`);

  // 创建两条通过的 attempt 记录
  const passEvaluation = {
    dimensions: {
      conceptualUnderstanding: { score: 82, evidence: "用户解释了信用积分的累加规则和并发场景下的原子性保证", feedback: "概念理解清晰，正确描述了积分累加的原子性要求", uncertainty: "low" },
      causalExplanation: { score: 78, evidence: "因为数据库事务保证了原子性，所以并发累加不会产生竞态", feedback: "因果链完整，说明了事务与原子性的关系", uncertainty: "low" },
      practicalReproduction: { score: 75, evidence: "可以通过单元测试模拟并发场景验证", feedback: "提到了测试验证手段，可以更具体", uncertainty: "medium" },
      boundariesAndRisks: { score: 80, evidence: "但如果事务隔离级别不够，可能读到脏数据", feedback: "识别了事务隔离级别的风险边界", uncertainty: "low" },
      transferAbility: { score: 72, evidence: "这个模式也可以应用到库存扣减场景", feedback: "成功迁移到相似并发场景", uncertainty: "medium" }
    },
    overallScore: 78,
    passed: true,
    overallFeedback: "你的回答展示了对信用积分并发累加机制的扎实理解，特别是事务原子性和隔离级别风险的解释。建议补充更具体的测试用例。",
    nextQuestion: "如果积分系统需要支持跨服务的分布式事务，你会如何设计回滚机制？"
  };

  const attempt1 = {
    attemptId: crypto.randomUUID(),
    gapId: REPAID_GAP_ID,
    userId,
    answer: "信用积分的累加需要保证原子性。在数据库层面，使用事务和条件更新可以确保并发场景下积分不会错误累加。具体来说，每次累加操作都在一个事务内完成，使用 SELECT FOR UPDATE 或条件 UPDATE 来保证一致性。如果操作失败，事务回滚，积分不变。边界条件是事务隔离级别——如果隔离级别不够，可能读到脏数据，所以需要设置合适的隔离级别。",
    submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    selfConfidence: 4,
    evaluation: passEvaluation,
    feedback: passEvaluation.overallFeedback,
    nextQuestion: passEvaluation.nextQuestion,
    repaymentStatus: "partiallyRepaid",
    evaluatorVersion: "repayment-eval-1",
    promptSchemaVersion: "repayment-prompt-1",
    dataSchemaVersion: "repayment-data-1",
    modelProvider: "openai",
    modelName: "gpt-4o",
    fallbackUsed: false,
    errorCategory: null,
    clientAttemptId: null
  };
  await repaymentStore.saveAttempt(attempt1);
  console.log(`[fill] 已创建 attempt 1（首次通过）`);

  const attempt2 = {
    ...attempt1,
    attemptId: crypto.randomUUID(),
    answer: "对于跨服务的分布式事务，可以采用 Saga 模式或两阶段提交。Saga 模式更适合微服务架构，每个服务执行本地事务并发布事件，如果某一步失败，执行补偿操作回滚之前的步骤。对于信用积分，补偿操作就是反向扣减。关键边界是补偿操作必须是幂等的，因为网络重试可能导致重复执行。此外，需要引入幂等键来防止重复的积分变更请求。",
    submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    selfConfidence: 4,
    evaluation: {
      dimensions: {
        conceptualUnderstanding: { score: 88, evidence: "用户解释了 Saga 模式和两阶段提交的区别", feedback: "概念理解深入，正确区分了不同分布式事务方案", uncertainty: "low" },
        causalExplanation: { score: 85, evidence: "因为补偿操作需要幂等，所以网络重试不会导致错误", feedback: "因果链完整，说明了幂等性与重试的关系", uncertainty: "low" },
        practicalReproduction: { score: 82, evidence: "通过幂等键防止重复请求", feedback: "给出了具体的实现手段", uncertainty: "low" },
        boundariesAndRisks: { score: 84, evidence: "补偿操作必须是幂等的，否则网络重试可能导致重复执行", feedback: "准确识别了幂等性边界", uncertainty: "low" },
        transferAbility: { score: 80, evidence: "这个模式也可以应用到库存扣减和支付系统", feedback: "成功迁移到多个业务场景", uncertainty: "low" }
      },
      overallScore: 84,
      passed: true,
      overallFeedback: "第二次回答展示了更深入的理解，特别是分布式事务的补偿机制和幂等性设计。回答完整且可迁移。",
      nextQuestion: ""
    },
    feedback: "第二次回答展示了更深入的理解，特别是分布式事务的补偿机制和幂等性设计。回答完整且可迁移。",
    nextQuestion: "",
    repaymentStatus: "repaid"
  };
  await repaymentStore.saveAttempt(attempt2);
  console.log(`[fill] 已创建 attempt 2（再次通过，已清偿）`);
} else {
  console.log(`[fill] 已清偿 gap 已存在，跳过`);
}

// 12. 最终验证
const allGaps = repaymentStore.listGaps(userId);
const repaidGaps = allGaps.filter(g => g.status === "repaid");
console.log(`[fill] 验证 repayment gaps: ${allGaps.length} 条（已清偿 ${repaidGaps.length} 条）`);

console.log("");
console.log("========================================");
console.log("演示账号内容补充完成");
console.log("========================================");
