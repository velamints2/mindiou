/**
 * 演示账号专用种子数据
 *
 * 为评委预填充一条完整的认知债务闭环，让登录后立即看到：
 * - 一份七段诊断报告（MVP-0）
 * - 能力画像（CapabilityProfile，跨 domain 的用户级画像）
 * - 掌握度画像（MasteryProfile，每条认知欠条的掌握阶段）
 * - 已激活的创世档案
 *
 * 幂等：若报告已存在则跳过。项目/工作项/欠条由 ownership-seed 创建。
 *
 * 与 ownership-seed.js 的关系：
 *   ownership-seed 创建 3 条认知欠条（debt-auth-session-revoke /
 *   debt-payment-concurrency / debt-redeem-race），reportId 均为 "seed-report"。
 *   本模块补上这份报告，并附加能力画像与掌握度画像，使闭环完整。
 */

import { DATA_SCHEMA_VERSION } from "./cognitive-repayment.js";

export const DEMO_REPORT_ID = "seed-report";

function levelForScore(score) {
  if (score < 40) return "L1";
  if (score < 70) return "L2";
  if (score < 90) return "L3";
  return "L4";
}

function dim(score, attemptId, now, verifiedCount = 2) {
  const evidence = [];
  const sources = verifiedCount >= 2
    ? ["user_verified", "user_verified"]
    : ["model_inferred"];
  for (let i = 0; i < sources.length; i++) {
    evidence.push({ attemptId: `${attemptId}-${i + 1}`, source: sources[i], at: now });
  }
  return {
    score,
    level: levelForScore(score),
    stability: verifiedCount >= 2 ? "stable" : "one_shot",
    evidence
  };
}

function buildCapabilityProfile(userId, domain, now, scores) {
  return {
    userId,
    domain,
    dimensions: {
      conceptualUnderstanding: dim(scores.conceptualUnderstanding, `cp-${domain}`, now),
      causalExplanation: dim(scores.causalExplanation, `cp-${domain}`, now),
      practicalReproduction: dim(scores.practicalReproduction, `cp-${domain}`, now),
      boundariesAndRisks: dim(scores.boundariesAndRisks, `cp-${domain}`, now),
      transferAbility: dim(scores.transferAbility, `cp-${domain}`, now)
    },
    createdAt: now,
    updatedAt: now,
    dataSchemaVersion: DATA_SCHEMA_VERSION
  };
}

function buildMasteryProfile(debtId, overall, stage, now) {
  const base = Math.round(overall * 0.9);
  return {
    cognitiveDebtId: debtId,
    conceptualUnderstanding: Math.min(100, base + 5),
    independentRecall: Math.min(100, base),
    hintIndependence: Math.min(100, base - 5),
    misconceptionResistance: Math.min(100, base + 2),
    transferAbility: Math.min(100, base - 10),
    retentionStrength: Math.min(100, base - 3),
    overallMastery: overall,
    currentStage: stage,
    lastAttemptAt: now,
    nextReviewAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    successfulAttempts: stage >= 2 ? stage - 1 : 0,
    failedAttempts: stage >= 3 ? 1 : 0,
    relapseCount: 0
  };
}

function buildDemoReport(userId, now) {
  return {
    id: DEMO_REPORT_ID,
    userId,
    locale: "zh-CN",
    createdAt: now,
    draftId: "",
    input: {
      artifactText: [
        "用户要求 Codex 实现 MindIOU 账户体系与激活码兑换功能。",
        "Codex 完成了注册、登录、登出、HttpOnly Cookie 会话管理、bcrypt 密码哈希、设备 Token 生成与撤销。",
        "会话令牌加入唯一 jti，服务端维护内存撤销集合，退出即撤销当前令牌。",
        "激活码兑换使用 UPDATE ... WHERE status='unused' 的条件更新，配合 (code, user_id) 唯一索引防止并发重复兑换。",
        "JSON 持久化迁移到 SQLite WAL，启用 foreign_keys，每日在线备份。",
        "用户批准了所有实现方向，测试通过，但全程没有解释 jti 撤销集合在进程重启后的局限性、",
        "并发兑换中数据库条件更新的原子性边界，以及 SQLite WAL 与 PostgreSQL 迁移的验收差异。"
      ].join(""),
      artifactType: "codex",
      charCount: 0,
      preprocess: { truncated: false, extractedRecords: 42, filteredNoise: 18 },
      confusions: []
    },
    analysis: {
      artifactTitle: "账户体系与激活码兑换实现",
      artifactKind: "codex_rollout",
      userCapability: {
        overall: "mixed",
        dimensions: {
          productProblemFraming: { level: "L2", evidenceStatus: "observed", evidence: ["批准实现方向"], confidence: 0.6 },
          aiAgentSteering: { level: "L2", evidenceStatus: "observed", evidence: ["接受 Codex 全部方案"], confidence: 0.55 },
          systemMentalModel: { level: "L1", evidenceStatus: "weak", evidence: ["未解释会话撤销机制"], confidence: 0.3 },
          technicalDecisionComprehension: { level: "L1", evidenceStatus: "weak", evidence: ["未解释并发原子性边界"], confidence: 0.25 },
          validationAndQualityJudgment: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0.2 }
        },
        currentDomain: "web-development",
        strongestDemonstratedAbility: "能识别功能完成信号（测试通过、构建成功）",
        highestPriorityGrowthArea: "安全机制的运行时边界与失效场景理解",
        evidenceSignals: ["批准方向但未追问机制", "接受并发方案但未验证边界条件"],
        recommendedCardLevel: "intermediate"
      }
    },
    generation: { fallback: false, error: "", failedStep: "" },
    sections: {
      aiCompleted: [
        { item: "实现注册/登录/登出与 HttpOnly Cookie 会话管理", evidence: "材料：Codex 完成注册、登录、登出与会话管理", isInference: false },
        { item: "使用 bcrypt 哈希密码，jti 唯一标识会话令牌", evidence: "材料：bcrypt 密码哈希、会话令牌加入唯一 jti", isInference: false },
        { item: "实现激活码兑换的条件更新与唯一约束防重复", evidence: "材料：UPDATE ... WHERE status='unused' 条件更新 + (code, user_id) 唯一索引", isInference: false },
        { item: "将 JSON 持久化迁移到 SQLite WAL 模式", evidence: "材料：迁移到 SQLite WAL，启用 foreign_keys，每日在线备份", isInference: false }
      ],
      userContributed: [
        { item: "提出账户体系与激活码兑换的功能目标", evidence: "材料：用户要求 Codex 实现账户体系与激活码兑换", isInference: false },
        { item: "批准账户体系实现方向与激活码兑换方案", evidence: "材料：用户批准了所有实现方向", isInference: false },
        { item: "确认测试通过后接受交付", evidence: "材料：测试通过；但全程未追问撤销、并发与迁移的边界", isInference: false }
      ],
      cognitiveProcessesOutsourced: [
        { item: "会话令牌撤销机制的运行时边界判断（jti 撤销集合在进程重启后失效）", evidence: "材料：用户未解释 jti 撤销集合在进程重启后的局限性", isInference: true },
        { item: "并发竞态条件的原子性保证分析（条件更新 vs 应用层锁）", evidence: "材料：用户未解释并发兑换中条件更新的原子性边界", isInference: true },
        { item: "数据库迁移的验收边界设计（SQLite WAL 与生产级数据库的差异）", evidence: "材料：用户未解释 SQLite WAL 与 PostgreSQL 迁移的验收差异", isInference: true }
      ],
      dangerousGaps: [
        {
          rank: 1,
          title: "会话令牌撤销机制的运行时边界",
          gap: "用户尚未掌握 jti 撤销集合的工作原理和内存撤销的局限性，无法判断进程重启后的安全风险",
          underlyingCapability: "安全机制的运行时失效场景分析",
          surfaceSignals: [
            "批准了内存撤销集合方案但未追问重启后失效",
            "无法解释为何退出后令牌仍可能在重启后被重放"
          ],
          whyDangerous: "若攻击者截获令牌且服务重启，撤销集合丢失，已退出令牌可被重放，导致会话劫持",
          evidence: "表面信号：批准了内存撤销集合方案但未追问重启后失效；无法解释为何退出后令牌仍可能在重启后被重放",
          transferScenarios: ["任何基于内存状态的安全撤销机制", "JWT 黑名单与刷新令牌轮换"],
          confidence: 0.85,
          alternativeExplanations: ["用户可能理解但未在此次表达"],
          diagnosticQuestion: "服务进程重启后，已退出的会话令牌还能被使用吗？为什么？",
          masteryCriteria: [
            "能画出 jti 撤销集合的生命周期与失效边界",
            "能提出至少一种重启安全的撤销方案（如持久化撤销集合）"
          ]
        },
        {
          rank: 2,
          title: "并发竞态条件的原子性边界",
          gap: "用户无法解释数据库条件更新的原子性保证和唯一约束的边界条件",
          underlyingCapability: "并发与原子性的形式化推理",
          surfaceSignals: [
            "接受条件更新方案但未验证高并发下的行为",
            "无法说明唯一索引在部分失败时的回滚行为"
          ],
          whyDangerous: "若并发量超出预期或索引约束存在边界条件，可能导致重复兑换，造成财务损失",
          evidence: "表面信号：接受条件更新方案但未验证高并发下的行为；无法说明唯一索引在部分失败时的回滚行为",
          transferScenarios: ["库存扣减", "投票防重复", "限流计数"],
          confidence: 0.8,
          alternativeExplanations: ["用户可能熟悉其他并发模型但未迁移到数据库场景"],
          diagnosticQuestion: "两个并发请求同时兑换同一激活码，数据库条件更新如何保证只有一个成功？",
          masteryCriteria: [
            "能用事务隔离级别解释条件更新的原子性",
            "能设计验证并发安全性的测试用例"
          ]
        },
        {
          rank: 3,
          title: "数据库迁移的验收边界",
          gap: "用户尚未理解 SQLite WAL 与生产级数据库的验收差异，无法判断迁移是否真正覆盖生产场景",
          underlyingCapability: "基础设施决策的迁移性评估",
          surfaceSignals: [
            "接受 SQLite WAL 迁移但未追问 PostgreSQL 场景",
            "未要求迁移后的等价性验证"
          ],
          whyDangerous: "生产环境若使用其他数据库，事务行为、锁机制、外键约束可能不同，导致隐蔽故障",
          evidence: "表面信号：接受 SQLite WAL 迁移但未追问 PostgreSQL 场景；未要求迁移后的等价性验证",
          transferScenarios: ["任何数据库引擎迁移", "本地开发与生产环境的一致性验证"],
          confidence: 0.7,
          alternativeExplanations: ["用户可能认为 SQLite 即生产数据库"],
          diagnosticQuestion: "SQLite WAL 的并发模型与 PostgreSQL 的主要差异是什么？迁移时如何验证等价性？",
          masteryCriteria: [
            "能列出至少 3 项 SQLite 与 PostgreSQL 的行为差异",
            "能设计迁移等价性的验收清单"
          ]
        }
      ],
      cognitiveStructure: {
        facts: [
          { item: "会话令牌使用 jti 唯一标识", evidence: "auth-store.js 实现", isInference: false },
          { item: "撤销集合存储在进程内存", evidence: "server.js revokedSessionSignatures", isInference: false },
          { item: "激活码兑换使用条件更新", evidence: "ownership-seed.js 决策记录", isInference: false }
        ],
        hypotheses: [
          { item: "用户假设内存撤销集合足够安全", evidence: "批准方案未追问边界", isInference: true, confidence: 0.8, alternativeExplanation: "用户可能未考虑重启场景" }
        ],
        questions: [
          { item: "进程重启后撤销集合如何恢复？", evidence: "材料未提及重启后的撤销状态恢复方案", isInference: true },
          { item: "高并发下条件更新是否仍保证原子性？", evidence: "材料未包含并发压测或隔离级别说明", isInference: true }
        ],
        decisions: [
          { item: "使用内存撤销集合而非持久化", evidence: "server.js 实现", isInference: false, decisionOwner: "ai" },
          { item: "使用条件更新而非应用层锁", evidence: "兑换接口实现", isInference: false, decisionOwner: "ai" },
          { item: "迁移到 SQLite WAL", evidence: "sqlite-state-store.js 实现", isInference: false, decisionOwner: "ai" }
        ],
        tradeoffs: [
          { item: "得到：实现简单、性能好；放弃：重启安全、跨实例撤销；依赖：单进程部署；失败影响：已退出令牌可被重放", evidence: "内存撤销集合方案的固有取舍", isInference: true }
        ]
      },
      feynmanCards: [
        {
          id: "seed-card-auth",
          target: "会话令牌撤销机制的运行时边界",
          cardType: "system_map",
          prompt: "画出 jti 撤销集合的生命周期：从登录创建令牌、退出撤销令牌，到进程重启后的状态。标注哪些环节是安全的、哪些是失效的。",
          targetLevel: "L2",
          difficulty: "intermediate",
          evaluationCriteria: [
            "能画出令牌从创建到撤销的完整流程",
            "能标注进程重启后撤销集合丢失",
            "能提出持久化撤销的改进方案"
          ],
          userAnswer: "jti 撤销集合在登录时不记录、退出时写入内存集合，中间件逐请求检查。问题是进程重启后集合清空，之前退出的令牌在剩余有效期内又能用。改进：把撤销集合落盘到 SQLite，或改用短有效期 + 刷新令牌轮换。",
          aiFollowUp: "结构完整：生命周期、失效边界、改进方案都覆盖了。补充一点：持久化撤销集合要注意退出写入的延迟与检查路径的一致性。",
          answeredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          clearance: {
            sessionId: "demo-seeded-clearance-auth",
            status: "provisionally_cleared",
            sourceReviewRequired: false,
            endedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            nextRecommendation: "间隔 3 天后用迁移场景题复训一次，确认不是瞬时记忆",
            remainingGaps: ["持久化撤销集合的写入延迟与一致性尚未实操验证"]
          }
        },
        {
          id: "seed-card-payment",
          target: "并发竞态条件的原子性边界",
          cardType: "prediction",
          prompt: "两个并发请求同时兑换同一激活码，用你自己的话描述数据库条件更新如何保证只有一个成功。如果改为先查询再更新，会发生什么？",
          targetLevel: "L2",
          difficulty: "intermediate",
          evaluationCriteria: [
            "能解释条件更新的原子性来自单条 SQL 的原子执行",
            "能说明先查询再更新存在 TOCTOU 竞态",
            "能提到事务隔离级别或行锁的作用"
          ],
          userAnswer: "",
          aiFollowUp: "",
          answeredAt: null
        },
        {
          id: "seed-card-migration",
          target: "数据库迁移的验收边界",
          cardType: "validation_design",
          prompt: "如果生产环境要从 SQLite 迁移到 PostgreSQL，你会设计哪些验收用例来确认迁移等价？至少列出 3 项需要验证的行为差异。",
          targetLevel: "L2",
          difficulty: "advanced",
          evaluationCriteria: [
            "能列出并发模型差异",
            "能列出外键约束行为差异",
            "能列出事务隔离差异"
          ],
          userAnswer: "",
          aiFollowUp: "",
          answeredAt: null
        }
      ],
      nextActions: [
        { item: "在本地重启服务验证已退出令牌是否仍可用", route: "verify", reason: "确认内存撤销集合的失效边界", relatedCapability: "安全机制运行时分析" },
        { item: "记录 jti 撤销方案的局限与改进方向", route: "note", reason: "沉淀安全决策的取舍", relatedCapability: "安全机制运行时分析" },
        { item: "设计并发兑换的压力测试用例", route: "task", reason: "验证条件更新的原子性边界", relatedCapability: "并发与原子性推理" },
        { item: "向有数据库迁移经验的工程师请教 SQLite→PG 的常见陷阱", route: "ask", reason: "补全迁移验收清单", relatedCapability: "基础设施迁移性评估" }
      ]
    },
    research: { status: "skipped", sources: [] },
    confusionResolutions: [],
    corrections: [],
    status: "generated"
  };
}

/**
 * 为演示账号预填充体验数据。幂等：报告已存在则跳过。
 *
 * @param {object} ctx
 * @param {object} ctx.authStore       — 用于激活创世档案
 * @param {object} ctx.mvp0Store       — 用于保存七段报告
 * @param {object} ctx.trainingStore   — 用于保存掌握度画像
 * @param {object} ctx.repaymentStore  — 用于保存能力画像
 * @param {string} ctx.userId          — 演示账号真实用户 id
 */
export async function seedDemoAccountData({ authStore, mvp0Store, trainingStore, repaymentStore, userId }) {
  // 幂等检查：报告已存在且为新版结构（EvidenceItem 对象）则跳过；
  // 旧版纯字符串结构会导致前端渲染为空，检测到后自动重建。
  let needsReportReseed = true;
  try {
    const existing = mvp0Store.getReport(DEMO_REPORT_ID, userId);
    const first = existing?.sections?.aiCompleted?.[0];
    const questionsFirst = existing?.sections?.cognitiveStructure?.questions?.[0];
    const isLegacyShape = typeof first === "string" || typeof questionsFirst === "string";
    const cardMissingClearance = !existing?.sections?.feynmanCards?.[0]?.clearance;
    needsReportReseed = isLegacyShape || cardMissingClearance;
    if (!needsReportReseed) {
      return { seeded: false, reportId: DEMO_REPORT_ID };
    }
    console.log(`[demo-seed] 检测到旧版报告结构（isLegacyShape=${isLegacyShape}, cardMissingClearance=${cardMissingClearance}），重建报告`);
  } catch {
    // 报告不存在，继续
  }

  const now = new Date().toISOString();

  // 1. 七段诊断报告
  await mvp0Store.saveReport(buildDemoReport(userId, now));

  // 2. 能力画像（2 个 domain，体现跨域积累）
  await repaymentStore.saveCapabilityProfile(buildCapabilityProfile(userId, "web-development", now, {
    conceptualUnderstanding: 72,
    causalExplanation: 68,
    practicalReproduction: 65,
    boundariesAndRisks: 70,
    transferAbility: 60
  }));
  await repaymentStore.saveCapabilityProfile(buildCapabilityProfile(userId, "system-architecture", now, {
    conceptualUnderstanding: 58,
    causalExplanation: 55,
    practicalReproduction: 50,
    boundariesAndRisks: 52,
    transferAbility: 45
  }));

  // 3. 掌握度画像（3 条认知欠条，不同阶段体现清偿进度）
  await trainingStore.saveMasteryProfile(buildMasteryProfile("debt-auth-session-revoke", 45, 2, now));
  await trainingStore.saveMasteryProfile(buildMasteryProfile("debt-payment-concurrency", 72, 3, now));
  await trainingStore.saveMasteryProfile(buildMasteryProfile("debt-redeem-race", 20, 1, now));

  // 4. 创世档案激活 + 公开身份
  authStore.activateGenesisIdentity(userId, now);
  authStore.updateGenesisIdentity(userId, {
    visibility: "public",
    displayName: "MindIOU 演示体验官",
    avatarUrl: ""
  });

  return { seeded: true, reportId: DEMO_REPORT_ID };
}
