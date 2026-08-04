/**
 * 项目所有权地图 — 种子数据
 *
 * 验收场景：MindIOU Web 项目的认知所有权地图
 *
 * 包含模块：
 * 1. 登录与鉴权 — 高风险无人负责（critical 安全决策，无 E2 证据）
 * 2. 支付和激活码 — 缺少迁移验证（E3，缺少 E4）
 * 3. Feynman 状态机 — 已具备人类所有权（E5 + 真实 artifact）
 * 4. 复训调度 — 只有初步理解（E1）
 * 5. 数据库迁移 — 缺少独立修改证据（E4，缺少 E5）
 *
 * 第 6 个模块为验收场景：
 * 6. 激活码兑换与防重复使用 — 初始无证据（E0，高风险）
 *
 * 种子数据幂等：如果项目已存在则跳过。
 */

import {
  createProject,
  createWorkItem,
  createAgentSession,
  createArtifact,
  createDecisionRecord,
  createEvidenceRecord,
  createDecisionDebtLink,
  createDecisionArtifactLink,
  EVIDENCE_LEVEL,
  EVIDENCE_TYPE,
  RISK_TYPE,
} from "./project-ownership.js";

export async function seedOwnershipData(ownershipStore, trainingStore, userId = "demo-user") {
  // 幂等检查
  const existing = ownershipStore.getProject("mindiou-web", userId);
  if (existing) return { seeded: false, projectId: "mindiou-web" };

  const projectId = "mindiou-web";

  // ─── Project ───
  await ownershipStore.saveProject(createProject({
    id: projectId,
    userId,
    name: "MindIOU Web",
    description: "MindIOU 认知欠条清算系统 Web 产品",
  }));

  // ─── WorkItem 1: 登录与鉴权 — 高风险无人负责 ───
  const authWorkItem = createWorkItem({
    id: "wi-auth",
    projectId,
    title: "登录与鉴权",
    description: "用户注册、登录、登出、HttpOnly Cookie 会话、bcrypt 密码哈希、设备 Token 管理",
    moduleType: "security",
  });
  await ownershipStore.saveWorkItem(authWorkItem);

  const authSession = createAgentSession({
    id: "session-auth",
    projectId,
    workItemId: "wi-auth",
    source: "codex",
    title: "实现完整账户体系",
    implementationSummary: "Codex 会话实现了注册、登录、登出、HttpOnly Cookie 会话管理、bcrypt 密码哈希、设备 Token 生成与撤销。包含 jti 唯一标识和内存撤销集合用于登出失效。",
  });
  await ownershipStore.saveAgentSession(authSession);

  const authDecision = createDecisionRecord({
    id: "decision-auth-cookie",
    projectId,
    workItemId: "wi-auth",
    sessionId: "session-auth",
    title: "使用 HttpOnly Secure Cookie + jti 撤销集合",
    decision: "登录令牌加入唯一 jti；服务端维护内存撤销集合；退出即撤销当前令牌。Cookie 设置 HttpOnly、SameSite=Lax、生产环境 Secure。",
    rationale: "防止 XSS 窃取会话令牌；确保退出后令牌不可重放。",
    decisionType: "security",
    importance: "critical",
    decisionMaker: "agent",
    userParticipation: "accepted",
  });
  await ownershipStore.saveDecisionRecord(authDecision);

  // 安全风险欠条
  const authDebt = {
    id: "debt-auth-session-revoke",
    userId,
    reportId: "seed-report",
    cardId: "seed-card-auth",
    gapText: "尚未掌握会话令牌撤销机制和 jti 安全原理",
    gapEvidence: "用户无法解释 jti 撤销集合的工作原理和内存撤销的局限性",
    status: "new",
    recurrenceCount: 0,
    sourceReports: ["seed-report"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (trainingStore) {
    await trainingStore.saveCognitiveDebt(authDebt);
  }

  await ownershipStore.saveDecisionDebtLink({
    decisionId: "decision-auth-cookie",
    cognitiveDebtId: "debt-auth-session-revoke",
    riskType: RISK_TYPE.security_risk,
  });

  const authArtifact = createArtifact({
    id: "artifact-auth-store",
    projectId,
    workItemId: "wi-auth",
    sessionId: "session-auth",
    artifactType: "file",
    path: "auth-store.js",
    functionName: "createAuthStore",
    diffSummary: "SQLite 表 users/sessions/device_tokens，bcrypt 密码哈希，jti 撤销集合",
  });
  await ownershipStore.saveArtifact(authArtifact);
  await ownershipStore.saveDecisionArtifactLink({
    decisionId: "decision-auth-cookie",
    artifactId: "artifact-auth-store",
  });

  // ─── WorkItem 2: 支付和激活码 — 缺少迁移验证 (E3) ───
  const paymentWorkItem = createWorkItem({
    id: "wi-payment",
    projectId,
    title: "支付和激活码",
    description: "激活码兑换、防重复使用、支付回调处理",
    moduleType: "feature",
  });
  await ownershipStore.saveWorkItem(paymentWorkItem);

  const paymentSession = createAgentSession({
    id: "session-payment",
    projectId,
    workItemId: "wi-payment",
    source: "codex",
    title: "实现激活码兑换接口",
    implementationSummary: "实现了激活码兑换 API，使用数据库事务和唯一约束防止重复兑换。",
  });
  await ownershipStore.saveAgentSession(paymentSession);

  const paymentDecision = createDecisionRecord({
    id: "decision-payment-concurrency",
    projectId,
    workItemId: "wi-payment",
    sessionId: "session-payment",
    title: "使用数据库条件更新和唯一约束避免并发重复兑换",
    decision: "兑换时使用 UPDATE ... WHERE status='unused' 的条件更新，配合唯一索引防止并发重复兑换。",
    rationale: "数据库层面的原子操作比应用层锁更可靠。",
    decisionType: "database",
    importance: "high",
    decisionMaker: "agent",
    userParticipation: "accepted",
  });
  await ownershipStore.saveDecisionRecord(paymentDecision);

  const paymentDebt = {
    id: "debt-payment-concurrency",
    userId,
    reportId: "seed-report",
    cardId: "seed-card-payment",
    gapText: "尚未完全掌握并发兑换中的竞态条件处理",
    gapEvidence: "用户能识别基本的并发问题但无法解释所有边界条件",
    status: "independently_explainable",
    recurrenceCount: 0,
    sourceReports: ["seed-report"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (trainingStore) {
    await trainingStore.saveCognitiveDebt(paymentDebt);
  }

  await ownershipStore.saveDecisionDebtLink({
    decisionId: "decision-payment-concurrency",
    cognitiveDebtId: "debt-payment-concurrency",
    riskType: RISK_TYPE.financial_risk,
  });

  // E3 证据：error_detection 通过
  await ownershipStore.saveEvidenceRecord(createEvidenceRecord({
    id: "evidence-payment-e3",
    userId,
    projectId,
    workItemId: "wi-payment",
    decisionId: "decision-payment-concurrency",
    cognitiveDebtId: "debt-payment-concurrency",
    evidenceType: EVIDENCE_TYPE.error_detection,
    evidenceLevel: EVIDENCE_LEVEL.E3,
    source: "training",
    sourceId: "attempt-payment-error-detection",
    description: "用户通过 error_detection 训练，能识别并发兑换中的竞态条件",
    trainingStage: "error_detection",
    passed: true,
    hintDependency: 25,
  }));

  // ─── WorkItem 3: Feynman 状态机 — 已具备人类所有权 (E5) ───
  const feynmanWorkItem = createWorkItem({
    id: "wi-feynman",
    projectId,
    title: "Feynman 状态机",
    description: "清偿会话状态机：问题→回答→反馈→教学→追问→结束→参考答案→下一步行动",
    moduleType: "feature",
  });
  await ownershipStore.saveWorkItem(feynmanWorkItem);

  const feynmanDecision = createDecisionRecord({
    id: "decision-feynman-state",
    projectId,
    workItemId: "wi-feynman",
    title: "清偿会话状态机设计",
    decision: "使用显式状态流转：question → answered → feedback → teaching → followup → ended。每步有明确的前置条件和输出。",
    rationale: "保证清偿流程的可追溯性和一致性。",
    decisionType: "architecture",
    importance: "high",
    decisionMaker: "collaborative",
    userParticipation: "modified",
  });
  await ownershipStore.saveDecisionRecord(feynmanDecision);

  // E5 证据：real_work_validation 通过 + 真实 artifact
  await ownershipStore.saveEvidenceRecord(createEvidenceRecord({
    id: "evidence-feynman-e5",
    userId,
    projectId,
    workItemId: "wi-feynman",
    decisionId: "decision-feynman-state",
    evidenceType: EVIDENCE_TYPE.real_work_modification,
    evidenceLevel: EVIDENCE_LEVEL.E5,
    source: "training",
    sourceId: "attempt-feynman-real-work",
    description: "用户独立修改了清偿会话状态机，添加了追问循环和超时处理",
    trainingStage: "real_work_validation",
    passed: true,
    hintDependency: 5,
    hasCodeModification: true,
    hasTestPassed: true,
  }));

  const feynmanArtifact = createArtifact({
    id: "artifact-feynman-code",
    projectId,
    workItemId: "wi-feynman",
    artifactType: "code_modification",
    path: "mvp1-clearance.js",
    functionName: "submitClearanceAnswer",
    commitSha: "a1b2c3d",
    diffSummary: "用户独立添加了追问循环和超时处理逻辑",
  });
  await ownershipStore.saveArtifact(feynmanArtifact);
  await ownershipStore.saveDecisionArtifactLink({
    decisionId: "decision-feynman-state",
    artifactId: "artifact-feynman-code",
  });

  const feynmanTestArtifact = createArtifact({
    id: "artifact-feynman-test",
    projectId,
    workItemId: "wi-feynman",
    artifactType: "test",
    path: "src/mvp1-clearance.test.ts",
    diffSummary: "用户为追问循环和超时处理编写了测试",
  });
  await ownershipStore.saveArtifact(feynmanTestArtifact);

  // ─── WorkItem 4: 复训调度 — 只有初步理解 (E1) ───
  const reviewWorkItem = createWorkItem({
    id: "wi-review",
    projectId,
    title: "复训调度",
    description: "基于间隔重复的复训时间计算和任务排序",
    moduleType: "feature",
  });
  await ownershipStore.saveWorkItem(reviewWorkItem);

  const reviewDecision = createDecisionRecord({
    id: "decision-review-scheduler",
    projectId,
    workItemId: "wi-review",
    title: "间隔重复调度算法",
    decision: "使用基于训练阶段和提示依赖度的间隔重复算法，首次训练3天后复训，延迟回忆7天，迁移训练14天，稳定掌握30天。",
    rationale: "渐进式延长间隔，避免遗忘。",
    decisionType: "architecture",
    importance: "high",
    decisionMaker: "agent",
    userParticipation: "accepted",
  });
  await ownershipStore.saveDecisionRecord(reviewDecision);

  // E1 证据：只完成首次补偿训练
  await ownershipStore.saveEvidenceRecord(createEvidenceRecord({
    id: "evidence-review-e1",
    userId,
    projectId,
    workItemId: "wi-review",
    decisionId: "decision-review-scheduler",
    evidenceType: EVIDENCE_TYPE.reading_acceptance,
    evidenceLevel: EVIDENCE_LEVEL.E1,
    source: "training",
    sourceId: "attempt-review-initial",
    description: "用户完成了首次补偿训练，能复述基本概念",
    trainingStage: "initial_compensation",
    passed: true,
    hintDependency: 40,
  }));

  // ─── WorkItem 5: 数据库迁移 — 缺少独立修改证据 (E4) ───
  const migrationWorkItem = createWorkItem({
    id: "wi-migration",
    projectId,
    title: "数据库迁移",
    description: "JSON 文件持久化迁移到 SQLite WAL，账户/报告/会话/训练状态共库",
    moduleType: "infrastructure",
  });
  await ownershipStore.saveWorkItem(migrationWorkItem);

  const migrationDecision = createDecisionRecord({
    id: "decision-migration-sqlite",
    projectId,
    workItemId: "wi-migration",
    title: "JSON 持久化迁移到 SQLite WAL",
    decision: "生产数据统一迁移到 SQLite WAL 模式，启用 foreign_keys，每日在线备份。",
    rationale: "原子事务、WAL 并发读、外键约束比 JSON 文件更可靠。",
    decisionType: "database",
    importance: "high",
    decisionMaker: "agent",
    userParticipation: "accepted",
  });
  await ownershipStore.saveDecisionRecord(migrationDecision);

  // E4 证据：scenario_transfer 通过
  await ownershipStore.saveEvidenceRecord(createEvidenceRecord({
    id: "evidence-migration-e4",
    userId,
    projectId,
    workItemId: "wi-migration",
    decisionId: "decision-migration-sqlite",
    evidenceType: EVIDENCE_TYPE.scenario_transfer,
    evidenceLevel: EVIDENCE_LEVEL.E4,
    source: "training",
    sourceId: "attempt-migration-transfer",
    description: "用户在 PostgreSQL 迁移场景中完成 scenario_transfer",
    trainingStage: "scenario_transfer",
    passed: true,
    hintDependency: 15,
    transferAbility: 75,
  }));

  // ─── WorkItem 6: 激活码兑换与防重复使用 — 验收场景 (初始 E0) ───
  const redeemWorkItem = createWorkItem({
    id: "wi-redeem",
    projectId,
    title: "激活码兑换与防重复使用",
    description: "激活码兑换接口、并发防重复、竞态条件处理",
    moduleType: "feature",
  });
  await ownershipStore.saveWorkItem(redeemWorkItem);

  const redeemSession = createAgentSession({
    id: "session-redeem",
    projectId,
    workItemId: "wi-redeem",
    source: "codex",
    title: "实现激活码兑换接口",
    implementationSummary: "Codex 会话实现了 redeemActivationCode() 接口，使用数据库条件更新和唯一约束避免并发重复兑换。",
  });
  await ownershipStore.saveAgentSession(redeemSession);

  const redeemDecision = createDecisionRecord({
    id: "decision-redeem-concurrency",
    projectId,
    workItemId: "wi-redeem",
    sessionId: "session-redeem",
    title: "使用数据库条件更新和唯一约束避免并发重复兑换",
    decision: "兑换时使用 UPDATE ... WHERE status='unused' AND code=? 的条件更新，配合 (code, user_id) 唯一索引防止并发重复兑换。",
    rationale: "数据库层面的原子操作比应用层锁更可靠，且无需引入 Redis 等外部依赖。",
    decisionType: "database",
    importance: "critical",
    decisionMaker: "agent",
    userParticipation: "none",
  });
  await ownershipStore.saveDecisionRecord(redeemDecision);

  const redeemDebt = {
    id: "debt-redeem-race",
    userId,
    reportId: "seed-report",
    cardId: "seed-card-redeem",
    gapText: "尚未掌握并发兑换中的竞态条件",
    gapEvidence: "用户无法解释数据库条件更新的原子性保证和唯一约束的边界条件",
    status: "new",
    recurrenceCount: 0,
    sourceReports: ["seed-report"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (trainingStore) {
    await trainingStore.saveCognitiveDebt(redeemDebt);
  }

  await ownershipStore.saveDecisionDebtLink({
    decisionId: "decision-redeem-concurrency",
    cognitiveDebtId: "debt-redeem-race",
    riskType: RISK_TYPE.financial_risk,
  });

  // Artifacts for redeem module
  const redeemArtifact1 = createArtifact({
    id: "artifact-redeem-service",
    projectId,
    workItemId: "wi-redeem",
    sessionId: "session-redeem",
    artifactType: "file",
    path: "src/services/activationCode.ts",
    diffSummary: "激活码服务，包含兑换逻辑和状态管理",
  });
  await ownershipStore.saveArtifact(redeemArtifact1);
  await ownershipStore.saveDecisionArtifactLink({
    decisionId: "decision-redeem-concurrency",
    artifactId: "artifact-redeem-service",
  });

  const redeemArtifact2 = createArtifact({
    id: "artifact-redeem-api",
    projectId,
    workItemId: "wi-redeem",
    sessionId: "session-redeem",
    artifactType: "file",
    path: "src/api/redeem.ts",
    functionName: "redeemActivationCode",
    commitSha: "8f3a2d1",
    diffSummary: "兑换 API 端点，调用 activationCode 服务的兑换方法",
  });
  await ownershipStore.saveArtifact(redeemArtifact2);
  await ownershipStore.saveDecisionArtifactLink({
    decisionId: "decision-redeem-concurrency",
    artifactId: "artifact-redeem-api",
  });

  return { seeded: true, projectId };
}
