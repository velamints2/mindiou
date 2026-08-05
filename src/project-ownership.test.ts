// @ts-nocheck
/**
 * 项目认知所有权地图 — 核心计算引擎测试
 *
 * 覆盖规格第十六节"所有权计算"和"风险优先级"全部用例
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LEVEL,
  EVIDENCE_TYPE,
  DECISION_OWNERSHIP_STATUS,
  MODULE_OWNERSHIP_STATUS,
  RISK_TYPE,
  TRAINING_STAGE,
  highestEvidenceLevelFromRecords,
  deriveEvidenceLevelFromAttempts,
  deriveEvidenceLevel,
  levelToString,
  stringToLevel,
  isImportantAIDecision,
  calculateDecisionOwnershipStatus,
  aggregateModuleStatus,
  calculateModuleRiskLevel,
  determineMissingEvidenceTypes,
  recommendNextStage,
  ownershipGapFromModuleStatus,
  calculateProjectSummary,
  buildModuleDetailView,
  createProject,
  createWorkItem,
  createAgentSession,
  createArtifact,
  createDecisionRecord,
  createEvidenceRecord,
  createDecisionDebtLink,
} from "../project-ownership.js";

function makeDecision(overrides = {}) {
  return createDecisionRecord({
    id: "decision-1",
    projectId: "proj-1",
    workItemId: "wi-1",
    sessionId: "session-1",
    title: "测试决策",
    decision: "测试决策内容",
    rationale: "测试原因",
    decisionType: "architecture",
    importance: "high",
    decisionMaker: "agent",
    userParticipation: "none",
    ...overrides,
  });
}

function makeAttempt(stage, overrides = {}) {
  return {
    id: `attempt-${stage}-${Math.random().toString(36).slice(2, 8)}`,
    trainingStage: stage,
    evaluation: { passed: true, hintDependency: 20, overallScore: 80, transferAbility: 1 },
    completedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeArtifact(overrides = {}) {
  return createArtifact({
    id: "artifact-1",
    projectId: "proj-1",
    workItemId: "wi-1",
    sessionId: "session-1",
    artifactType: "file",
    path: "src/foo.ts",
    ...overrides,
  });
}

function makeEvidence(level, overrides = {}) {
  return createEvidenceRecord({
    id: `evidence-${level}-${Math.random().toString(36).slice(2, 8)}`,
    userId: "user-1",
    projectId: "proj-1",
    workItemId: "wi-1",
    decisionId: "decision-1",
    evidenceType: EVIDENCE_TYPE.independent_explanation,
    evidenceLevel: level,
    source: "training",
    description: "测试证据",
    ...overrides,
  });
}

// ─── 证据等级推导 ───

describe("证据等级推导 — E0-E5", () => {
  it("空证据列表返回 E0", () => {
    expect(highestEvidenceLevelFromRecords([])).toBe(EVIDENCE_LEVEL.E0);
    expect(highestEvidenceLevelFromRecords(null)).toBe(EVIDENCE_LEVEL.E0);
  });

  it("取所有证据中的最高等级", () => {
    const records = [
      makeEvidence(EVIDENCE_LEVEL.E1),
      makeEvidence(EVIDENCE_LEVEL.E3),
      makeEvidence(EVIDENCE_LEVEL.E2),
    ];
    expect(highestEvidenceLevelFromRecords(records)).toBe(EVIDENCE_LEVEL.E3);
  });

  it("缺失 evidenceLevel 字段视为 E0", () => {
    const records = [{ id: "x", evidenceLevel: undefined }];
    expect(highestEvidenceLevelFromRecords(records)).toBe(EVIDENCE_LEVEL.E0);
  });
});

describe("从 TrainingAttempt 推导证据等级", () => {
  it("空训练记录返回 E0", () => {
    expect(deriveEvidenceLevelFromAttempts([])).toBe(EVIDENCE_LEVEL.E0);
  });

  it("未通过的训练不提升等级", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.real_work_validation, {
      evaluation: { passed: false, hintDependency: 10 },
    })];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBe(EVIDENCE_LEVEL.E0);
  });

  it("initial_compensation 通过只能到 E1", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.initial_compensation)];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBe(EVIDENCE_LEVEL.E1);
  });

  it("阅读记录不能达到 E2", () => {
    const records = [makeEvidence(EVIDENCE_LEVEL.E1, { evidenceType: EVIDENCE_TYPE.reading_acceptance })];
    expect(highestEvidenceLevelFromRecords(records)).toBe(EVIDENCE_LEVEL.E1);
  });

  it("普通首次训练不能直接达到 E4", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.initial_compensation)];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBeLessThan(EVIDENCE_LEVEL.E4);
  });

  it("delayed_recall 通过且无高提示依赖 → E2 候选", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.delayed_recall, {
      evaluation: { passed: true, hintDependency: 20 },
    })];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBe(EVIDENCE_LEVEL.E2);
  });

  it("delayed_recall 通过但高提示依赖 → 不达 E2", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.delayed_recall, {
      evaluation: { passed: true, hintDependency: 70 },
    })];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBeLessThan(EVIDENCE_LEVEL.E2);
  });

  it("error_detection 通过 → E3 候选", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.error_detection)];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBe(EVIDENCE_LEVEL.E3);
  });

  it("misconception_check 通过 → E3 候选", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.misconception_check)];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBe(EVIDENCE_LEVEL.E3);
  });

  it("scenario_transfer 通过且有迁移表现 → E4 候选", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.scenario_transfer, {
      evaluation: { passed: true, hintDependency: 20, transferAbility: 1 },
    })];
    expect(deriveEvidenceLevelFromAttempts(attempts)).toBe(EVIDENCE_LEVEL.E4);
  });

  it("real_work_validation 通过但无 artifact → 不能达到 E5", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.real_work_validation)];
    const level = deriveEvidenceLevel({
      trainingAttempts: attempts,
      evidenceRecords: [],
      artifacts: [],
    });
    expect(level).toBeLessThan(EVIDENCE_LEVEL.E5);
  });

  it("真实修改和验证证据齐全时可达 E5", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.real_work_validation)];
    const artifacts = [
      makeArtifact({ artifactType: "code_modification" }),
      makeArtifact({ artifactType: "test" }),
    ];
    const level = deriveEvidenceLevel({
      trainingAttempts: attempts,
      evidenceRecords: [],
      artifacts,
    });
    expect(level).toBe(EVIDENCE_LEVEL.E5);
  });

  it("仅有 commit artifact 也可达 E5（含 real_work_validation 训练）", () => {
    const attempts = [makeAttempt(TRAINING_STAGE.real_work_validation)];
    const artifacts = [makeArtifact({ artifactType: "commit", commitSha: "abc1234" })];
    const level = deriveEvidenceLevel({
      trainingAttempts: attempts,
      evidenceRecords: [],
      artifacts,
    });
    expect(level).toBe(EVIDENCE_LEVEL.E5);
  });

  it("无 real_work_validation 训练但有 E5 证据记录和 artifact → E5", () => {
    const records = [makeEvidence(EVIDENCE_LEVEL.E5, { evidenceType: EVIDENCE_TYPE.real_work_modification })];
    const artifacts = [makeArtifact({ artifactType: "manual_review" })];
    const level = deriveEvidenceLevel({
      trainingAttempts: [],
      evidenceRecords: records,
      artifacts,
    });
    expect(level).toBe(EVIDENCE_LEVEL.E5);
  });
});

describe("levelToString / stringToLevel", () => {
  it("数值与字符串互转", () => {
    expect(levelToString(0)).toBe("E0");
    expect(levelToString(5)).toBe("E5");
    expect(stringToLevel("E5")).toBe(5);
    expect(stringToLevel("UNKNOWN")).toBe(0);
  });
});

// ─── 决策级状态计算 ───

describe("isImportantAIDecision", () => {
  it("high + agent → 重要", () => {
    expect(isImportantAIDecision(makeDecision({ importance: "high", decisionMaker: "agent" }))).toBe(true);
  });

  it("critical + collaborative → 重要", () => {
    expect(isImportantAIDecision(makeDecision({ importance: "critical", decisionMaker: "collaborative" }))).toBe(true);
  });

  it("medium → 不重要", () => {
    expect(isImportantAIDecision(makeDecision({ importance: "medium" }))).toBe(false);
  });

  it("low → 不重要", () => {
    expect(isImportantAIDecision(makeDecision({ importance: "low" }))).toBe(false);
  });

  it("user 决策 → 不重要（即使是 high）", () => {
    expect(isImportantAIDecision(makeDecision({ importance: "high", decisionMaker: "user" }))).toBe(false);
  });
});

describe("决策级状态计算 — 优先级与互斥", () => {
  it("非重要决策返回 null", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "medium" }),
      evidenceLevel: EVIDENCE_LEVEL.E5,
    });
    expect(status).toBeNull();
  });

  it("没有证据的重要 AI 决策为 unverified", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E0,
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.unverified);
  });

  it("E1 → initial_understanding", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E1,
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.initial_understanding);
  });

  it("E2-E4 → missing_verification", () => {
    for (const level of [EVIDENCE_LEVEL.E2, EVIDENCE_LEVEL.E3, EVIDENCE_LEVEL.E4]) {
      const status = calculateDecisionOwnershipStatus({
        decision: makeDecision({ importance: "high" }),
        evidenceLevel: level,
      });
      expect(status).toBe(DECISION_OWNERSHIP_STATUS.missing_verification);
    }
  });

  it("E5 + 无未处理 critical 欠条 → owned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E5,
      linkedDebts: [],
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.owned);
  });

  it("E5 + 关联未处理 security critical 欠条 → 非 owned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E5,
      linkedDebts: [{
        id: "debt-1",
        status: "new",
        riskType: RISK_TYPE.security_risk,
        importance: "critical",
      }],
    });
    expect(status).not.toBe(DECISION_OWNERSHIP_STATUS.owned);
  });

  it("E5 + 已 mastered 的 security 欠条 → owned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E5,
      linkedDebts: [{
        id: "debt-1",
        status: "mastered",
        riskType: RISK_TYPE.security_risk,
        importance: "critical",
      }],
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.owned);
  });
});

describe("决策级状态 — high_risk_unowned 触发条件", () => {
  it("critical 决策且证据 < E2 → high_risk_unowned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "critical" }),
      evidenceLevel: EVIDENCE_LEVEL.E1,
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("critical 决策且证据 = E2 → 非 high_risk_unowned（进入 missing_verification）", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "critical" }),
      evidenceLevel: EVIDENCE_LEVEL.E2,
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.missing_verification);
  });

  it("关联 security_risk 欠条未稳定 + 证据 < E2 → high_risk_unowned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E1,
      linkedDebts: [{
        id: "debt-1",
        status: "new",
        riskType: RISK_TYPE.security_risk,
      }],
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("关联 relapsed 高风险欠条 + 证据 < E2 → high_risk_unowned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E1,
      linkedDebts: [{
        id: "debt-1",
        status: "relapsed",
        riskType: RISK_TYPE.privacy_risk,
      }],
    });
    expect(status).toBe(DECISION_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("关联已 mastered 的高风险欠条 + 证据 < E2 → 非 high_risk_unowned", () => {
    const status = calculateDecisionOwnershipStatus({
      decision: makeDecision({ importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E1,
      linkedDebts: [{
        id: "debt-1",
        status: "mastered",
        riskType: RISK_TYPE.security_risk,
      }],
    });
    expect(status).not.toBe(DECISION_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("普通低风险决策不能覆盖关键高风险决策", () => {
    const criticalStatus = calculateDecisionOwnershipStatus({
      decision: makeDecision({ id: "d-critical", importance: "critical" }),
      evidenceLevel: EVIDENCE_LEVEL.E0,
    });
    expect(criticalStatus).toBe(DECISION_OWNERSHIP_STATUS.high_risk_unowned);

    const lowStatus = calculateDecisionOwnershipStatus({
      decision: makeDecision({ id: "d-low", importance: "high" }),
      evidenceLevel: EVIDENCE_LEVEL.E5,
    });
    expect(lowStatus).toBe(DECISION_OWNERSHIP_STATUS.owned);
  });
});

// ─── 模块级聚合 ───

describe("模块级状态聚合 — aggregateModuleStatus", () => {
  it("空决策列表 → owned", () => {
    expect(aggregateModuleStatus([])).toBe(MODULE_OWNERSHIP_STATUS.owned);
  });

  it("无重要决策的模块 → owned", () => {
    const views = [
      { isImportant: false, status: null, evidenceLevel: EVIDENCE_LEVEL.E0, importance: "low" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.owned);
  });

  it("存在 high_risk_unowned 决策 → high_risk_unowned", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.high_risk_unowned, evidenceLevel: EVIDENCE_LEVEL.E0, importance: "critical" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("存在无 E2 证据的重要决策 → needs_initial_understanding", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.unverified, evidenceLevel: EVIDENCE_LEVEL.E0, importance: "high" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.needs_initial_understanding);
  });

  it("最高证据只有 E2 → needs_error_boundary_validation", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, evidenceLevel: EVIDENCE_LEVEL.E2, importance: "high" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.needs_error_boundary_validation);
  });

  it("最高证据达到 E3 但缺少 E4 → needs_transfer_validation", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, evidenceLevel: EVIDENCE_LEVEL.E3, importance: "high" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.needs_transfer_validation);
  });

  it("最高证据达到 E4 但缺少 E5 → needs_real_work_validation", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, evidenceLevel: EVIDENCE_LEVEL.E4, importance: "high" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.needs_real_work_validation);
  });

  it("所有 high/critical 决策达到 E5 → owned", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "critical" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.owned);
  });

  it("存在一个未拥有的 critical 决策时模块不能显示 owned", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.high_risk_unowned, evidenceLevel: EVIDENCE_LEVEL.E0, importance: "critical" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
    ];
    expect(aggregateModuleStatus(views)).not.toBe(MODULE_OWNERSHIP_STATUS.owned);
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("模块状态采用风险优先级而不是平均分", () => {
    const views = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, evidenceLevel: EVIDENCE_LEVEL.E5, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.high_risk_unowned, evidenceLevel: EVIDENCE_LEVEL.E0, importance: "critical" },
    ];
    expect(aggregateModuleStatus(views)).toBe(MODULE_OWNERSHIP_STATUS.high_risk_unowned);
  });

  it("relapsed 高风险欠条使模块重新降级", () => {
    const workItem = createWorkItem({ id: "wi-relapse", projectId: "p1", title: "测试模块" });
    const decision = createDecisionRecord({
      id: "dec-relapse",
      projectId: "p1",
      workItemId: "wi-relapse",
      title: "安全决策",
      decision: "...",
      importance: "critical",
      decisionMaker: "agent",
    });
    const debt = {
      id: "debt-relapse",
      gapText: "...",
      status: "relapsed",
      importance: "critical",
    };
    const link = createDecisionDebtLink({
      decisionId: "dec-relapse",
      cognitiveDebtId: "debt-relapse",
      riskType: RISK_TYPE.security_risk,
    });

    const view = buildModuleDetailView({
      workItem,
      decisions: [decision],
      artifacts: [],
      evidenceRecords: [],
      cognitiveDebts: [debt],
      decisionDebtLinks: [link],
      decisionArtifactLinks: [],
      trainingAttempts: [],
      agentSessions: [],
    });

    expect(view.status).toBe(MODULE_OWNERSHIP_STATUS.high_risk_unowned);
  });
});

describe("calculateModuleRiskLevel", () => {
  it("critical 决策且证据 < E2 → critical 风险", () => {
    const views = [
      { isImportant: true, importance: "critical", evidenceLevel: EVIDENCE_LEVEL.E0 },
    ];
    expect(calculateModuleRiskLevel(views, [])).toBe("critical");
  });

  it("存在 critical 决策 → high 风险（即使证据高）", () => {
    const views = [
      { isImportant: true, importance: "critical", evidenceLevel: EVIDENCE_LEVEL.E5 },
    ];
    expect(calculateModuleRiskLevel(views, [])).toBe("high");
  });

  it("存在 high 重要性决策 → medium 风险", () => {
    const views = [
      { isImportant: true, importance: "high", evidenceLevel: EVIDENCE_LEVEL.E5 },
    ];
    expect(calculateModuleRiskLevel(views, [])).toBe("medium");
  });

  it("无重要决策 → low 风险", () => {
    const views = [
      { isImportant: false, importance: "low", evidenceLevel: EVIDENCE_LEVEL.E0 },
    ];
    expect(calculateModuleRiskLevel(views, [])).toBe("low");
  });
});

// ─── 缺失证据和下一步训练 ───

describe("determineMissingEvidenceTypes", () => {
  it("E0 缺少所有证据类型", () => {
    const missing = determineMissingEvidenceTypes(EVIDENCE_LEVEL.E0);
    expect(missing).toContain(EVIDENCE_TYPE.reading_acceptance);
    expect(missing).toContain(EVIDENCE_TYPE.independent_explanation);
    expect(missing).toContain(EVIDENCE_TYPE.real_work_modification);
  });

  it("E5 没有缺失证据", () => {
    const missing = determineMissingEvidenceTypes(EVIDENCE_LEVEL.E5);
    expect(missing).toHaveLength(0);
  });
});

describe("recommendNextStage", () => {
  it("E0 → initial_compensation", () => {
    expect(recommendNextStage(EVIDENCE_LEVEL.E0)).toBe(TRAINING_STAGE.initial_compensation);
  });

  it("E1 → delayed_recall", () => {
    expect(recommendNextStage(EVIDENCE_LEVEL.E1)).toBe(TRAINING_STAGE.delayed_recall);
  });

  it("E2 → misconception_check", () => {
    expect(recommendNextStage(EVIDENCE_LEVEL.E2)).toBe(TRAINING_STAGE.misconception_check);
  });

  it("E3 → scenario_transfer", () => {
    expect(recommendNextStage(EVIDENCE_LEVEL.E3)).toBe(TRAINING_STAGE.scenario_transfer);
  });

  it("E4 → real_work_validation", () => {
    expect(recommendNextStage(EVIDENCE_LEVEL.E4)).toBe(TRAINING_STAGE.real_work_validation);
  });

  it("E5 → null", () => {
    expect(recommendNextStage(EVIDENCE_LEVEL.E5)).toBeNull();
  });
});

describe("ownershipGapFromModuleStatus", () => {
  it("owned → null", () => {
    expect(ownershipGapFromModuleStatus(MODULE_OWNERSHIP_STATUS.owned)).toBeNull();
  });

  it("high_risk_unowned → needs_initial_understanding", () => {
    expect(ownershipGapFromModuleStatus(MODULE_OWNERSHIP_STATUS.high_risk_unowned)).toBe("needs_initial_understanding");
  });

  it("needs_error_boundary_validation → needs_error_boundary_validation", () => {
    expect(ownershipGapFromModuleStatus(MODULE_OWNERSHIP_STATUS.needs_error_boundary_validation)).toBe("needs_error_boundary_validation");
  });
});

// ─── 项目摘要 — 互斥性 ───

describe("calculateProjectSummary — 顶部统计互斥性", () => {
  it("四个分类互斥且总数一致", () => {
    const decisionViews = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.initial_understanding, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.unverified, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.high_risk_unowned, importance: "critical" },
      { isImportant: false, status: null, importance: "low" },
    ];

    const summary = calculateProjectSummary({
      projectId: "p1",
      decisionViews,
      moduleViews: [],
    });

    const sum = summary.ownedDecisionCount
      + summary.initialUnderstandingCount
      + summary.missingVerificationCount
      + summary.highRiskUnownedCount;

    expect(summary.importantDecisionCount).toBe(7);
    expect(sum).toBe(7);
    expect(summary.ownedDecisionCount).toBe(2);
    expect(summary.initialUnderstandingCount).toBe(2);
    expect(summary.missingVerificationCount).toBe(2);
    expect(summary.highRiskUnownedCount).toBe(1);
  });

  it("所有权覆盖率 = owned / 重要决策总数", () => {
    const decisionViews = [
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.owned, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.high_risk_unowned, importance: "critical" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, importance: "high" },
      { isImportant: true, status: DECISION_OWNERSHIP_STATUS.missing_verification, importance: "high" },
    ];
    const summary = calculateProjectSummary({
      projectId: "p1",
      decisionViews,
      moduleViews: [],
    });
    expect(summary.ownershipCoverage).toBe(25);
  });

  it("无重要决策时覆盖率为 0", () => {
    const summary = calculateProjectSummary({
      projectId: "p1",
      decisionViews: [],
      moduleViews: [],
    });
    expect(summary.ownershipCoverage).toBe(0);
    expect(summary.importantDecisionCount).toBe(0);
  });

  it("模块统计正确", () => {
    const moduleViews = [
      { status: MODULE_OWNERSHIP_STATUS.owned },
      { status: MODULE_OWNERSHIP_STATUS.owned },
      { status: MODULE_OWNERSHIP_STATUS.high_risk_unowned },
      { status: MODULE_OWNERSHIP_STATUS.needs_real_work_validation },
    ];
    const summary = calculateProjectSummary({
      projectId: "p1",
      decisionViews: [],
      moduleViews,
    });
    expect(summary.moduleCount).toBe(4);
    expect(summary.ownedModuleCount).toBe(2);
    expect(summary.highRiskModuleCount).toBe(1);
    expect(summary.needsRealWorkModuleCount).toBe(1);
  });
});

// ─── buildModuleDetailView — 验收场景 ───

describe("buildModuleDetailView — 验收场景", () => {
  it("激活码兑换：初始无证据 → high_risk_unowned", () => {
    const workItem = createWorkItem({
      id: "wi-activation",
      projectId: "p-activation",
      title: "激活码兑换与防重复使用",
    });
    const decision = createDecisionRecord({
      id: "dec-activation",
      projectId: "p-activation",
      workItemId: "wi-activation",
      title: "使用数据库条件更新和唯一约束避免并发重复兑换",
      decision: "...",
      decisionType: "database",
      importance: "critical",
      decisionMaker: "agent",
    });
    const debt = {
      id: "debt-activation",
      gapText: "尚未掌握并发兑换中的竞态条件",
      status: "new",
      importance: "critical",
    };
    const link = createDecisionDebtLink({
      decisionId: "dec-activation",
      cognitiveDebtId: "debt-activation",
      riskType: RISK_TYPE.reliability_risk,
    });

    const view = buildModuleDetailView({
      workItem,
      decisions: [decision],
      artifacts: [],
      evidenceRecords: [],
      cognitiveDebts: [debt],
      decisionDebtLinks: [link],
      decisionArtifactLinks: [],
      trainingAttempts: [],
      agentSessions: [],
    });

    expect(view.status).toBe(MODULE_OWNERSHIP_STATUS.high_risk_unowned);
    expect(view.riskLevel).toBe("critical");
    expect(view.importantDecisionCount).toBe(1);
    expect(view.openDebtCount).toBe(1);
    expect(view.highRiskDebtCount).toBe(1);
  });

  it("激活码兑换：用户通过 error_detection → E3 → 缺少迁移验证", () => {
    const workItem = createWorkItem({
      id: "wi-activation",
      projectId: "p-activation",
      title: "激活码兑换与防重复使用",
    });
    const decision = createDecisionRecord({
      id: "dec-activation",
      projectId: "p-activation",
      workItemId: "wi-activation",
      title: "...",
      decision: "...",
      importance: "high",
      decisionMaker: "agent",
    });
    const attempts = [makeAttempt(TRAINING_STAGE.error_detection, { workItemId: "wi-activation" })];

    const view = buildModuleDetailView({
      workItem,
      decisions: [decision],
      artifacts: [],
      evidenceRecords: [],
      cognitiveDebts: [],
      decisionDebtLinks: [],
      decisionArtifactLinks: [],
      trainingAttempts: attempts,
      agentSessions: [],
    });

    expect(view.highestEvidenceLevel).toBe(EVIDENCE_LEVEL.E3);
    expect(view.status).toBe(MODULE_OWNERSHIP_STATUS.needs_transfer_validation);
  });

  it("激活码兑换：用户独立修改并通过测试 → E5 → owned", () => {
    const workItem = createWorkItem({
      id: "wi-activation",
      projectId: "p-activation",
      title: "激活码兑换与防重复使用",
    });
    const decision = createDecisionRecord({
      id: "dec-activation",
      projectId: "p-activation",
      workItemId: "wi-activation",
      title: "...",
      decision: "...",
      importance: "high",
      decisionMaker: "agent",
    });
    const attempts = [makeAttempt(TRAINING_STAGE.real_work_validation, { workItemId: "wi-activation" })];
    const artifacts = [
      makeArtifact({ id: "art-code", artifactType: "code_modification", workItemId: "wi-activation" }),
      makeArtifact({ id: "art-test", artifactType: "test", workItemId: "wi-activation" }),
    ];
    const artifactLinks = [
      { id: "link-1", decisionId: "dec-activation", artifactId: "art-code" },
      { id: "link-2", decisionId: "dec-activation", artifactId: "art-test" },
    ];

    const view = buildModuleDetailView({
      workItem,
      decisions: [decision],
      artifacts,
      evidenceRecords: [],
      cognitiveDebts: [],
      decisionDebtLinks: [],
      decisionArtifactLinks: artifactLinks,
      trainingAttempts: attempts,
      agentSessions: [],
    });

    expect(view.highestEvidenceLevel).toBe(EVIDENCE_LEVEL.E5);
    expect(view.status).toBe(MODULE_OWNERSHIP_STATUS.owned);
  });

  it("模块详情包含 AI 工作、用户证据、剩余欠条三部分", () => {
    const workItem = createWorkItem({
      id: "wi-detail",
      projectId: "p-detail",
      title: "详情测试模块",
    });
    const session = createAgentSession({
      id: "session-detail",
      projectId: "p-detail",
      workItemId: "wi-detail",
      source: "codex",
      title: "实现详情功能",
      implementationSummary: "AI 完成了详情展示",
    });
    const decision = createDecisionRecord({
      id: "dec-detail",
      projectId: "p-detail",
      workItemId: "wi-detail",
      title: "详情架构",
      decision: "...",
      importance: "high",
      decisionMaker: "agent",
    });
    const artifact = createArtifact({
      id: "art-detail",
      projectId: "p-detail",
      workItemId: "wi-detail",
      artifactType: "file",
      path: "src/detail.ts",
    });
    const debt = {
      id: "debt-detail",
      gapText: "...",
      status: "new",
      importance: "high",
    };
    const link = createDecisionDebtLink({
      decisionId: "dec-detail",
      cognitiveDebtId: "debt-detail",
      riskType: RISK_TYPE.reliability_risk,
    });
    const evidence = createEvidenceRecord({
      id: "ev-detail",
      userId: "user-1",
      projectId: "p-detail",
      workItemId: "wi-detail",
      decisionId: "dec-detail",
      evidenceType: EVIDENCE_TYPE.independent_explanation,
      evidenceLevel: EVIDENCE_LEVEL.E2,
    });

    const view = buildModuleDetailView({
      workItem,
      agentSessions: [session],
      decisions: [decision],
      artifacts: [artifact],
      evidenceRecords: [evidence],
      cognitiveDebts: [debt],
      decisionDebtLinks: [link],
      decisionArtifactLinks: [],
      trainingAttempts: [],
    });

    expect(view.aiWork.agentSessions).toHaveLength(1);
    expect(view.aiWork.decisions).toHaveLength(1);
    expect(view.aiWork.artifacts).toHaveLength(1);
    expect(view.userEvidence.independentExplanation).toHaveLength(1);
    expect(view.remainingDebts.openDebts).toHaveLength(1);
  });
});

// ─── 实体工厂 ───

describe("实体工厂", () => {
  it("createProject 生成完整记录", () => {
    const p = createProject({ id: "p1", userId: "u1", name: "测试项目" });
    expect(p.id).toBe("p1");
    expect(p.userId).toBe("u1");
    expect(p.createdAt).toBeTruthy();
  });

  it("createWorkItem 生成完整记录", () => {
    const w = createWorkItem({ id: "w1", projectId: "p1", title: "模块1" });
    expect(w.id).toBe("w1");
    expect(w.moduleType).toBe("feature");
  });

  it("createDecisionRecord 默认值正确", () => {
    const d = createDecisionRecord({ id: "d1", projectId: "p1" });
    expect(d.importance).toBe("medium");
    expect(d.decisionMaker).toBe("agent");
    expect(d.userParticipation).toBe("none");
  });
});
