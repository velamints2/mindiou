import { createServer } from "node:http";
import crypto from "node:crypto";
import { createSpiralStore } from "./spiral-store.js";
import { createMvp0Store } from "./mvp0-store.js";
import { createMvp1Store } from "./mvp1-store.js";
import { deriveReportDisplay, sessionLastActivityAt } from "./report-display.js";
import { createAuthStore } from "./auth-store.js";
import nodemailer from "nodemailer";
import { generateFallbackReport } from "./mvp0-fallback.js";
import { generateClearanceReport, buildCapabilitySnapshot } from "./mvp0-report.js";
import { generateCollaborationTimeline } from "./mvp0-timeline.js";
import { feynmanFollowUp } from "./mvp0-followup.js";
import { handleAdminRoute } from "./admin-backend-patch.js";
import { createAssessmentStore } from "./assessment-store.js";
import {
  endClearanceSession,
  getClearanceAnalysisPrompt,
  getResearchStructuringPrompt,
  publicSession,
  startClearanceSession,
  submitClearanceAnswer
} from "./mvp1-clearance.js";
import { createOpenAiWebResearch } from "./mvp1-openai.js";
import { createPublicWebResearch } from "./mvp1-public-web.js";
import {
  createDemoAnswerFallback,
  createDemoResearchFallback,
  ensureLearnerFacingLanguage
} from "./mvp1-demo-fallback.js";
import { createTrainingStore } from "./training-store.js";
import { createDebtIntelligenceStore } from "./debt-intelligence-store.js";
import {
  classifyAndSave,
  applyUserCorrection,
  backfillDebtIntelligence
} from "./debt-intelligence.js";
import { createConceptGraphStore } from "./concept-graph-store.js";
import {
  detectRelations,
  confirmRelation,
  rejectRelation,
  syncConceptsFromAnalysis,
  deriveClusterMasterySummary
} from "./debt-relations.js";
import { createCognitiveProfileStore } from "./cognitive-profile-store.js";
import {
  computeProfileAggregates,
  generateInsights,
  generatePeriodicSnapshots,
  buildAndSaveSnapshot
} from "./cognitive-profile.js";
import {
  createCognitiveDebt,
  updateMasteryProfile,
  deriveStatusFromStage,
  deriveUnderstandingLevel,
  masteryLabel,
  handleRelapse,
  migrateLegacySession,
  calculateOverallMastery
} from "./mastery.js";
import {
  deriveEvaluationFromAnalysis,
  createHintEvent,
  getTrainingEvaluationPrompt,
  buildEvaluationRequest,
  normalizeEvaluation
} from "./training-evaluation.js";
import {
  calculateNextReview,
  sortReviewTasks,
  selectTasksByTimeBudget,
  recommendNextStage
} from "./review-scheduler.js";
import {
  generateRuleBasedReviewTask,
  createAttemptFromClearanceSession
} from "./review-generator.js";
import { createCognitiveRepaymentStore } from "./cognitive-repayment-store.js";
import { createUsageLedger } from "./sqlite-state-store.js";
import {
  EVALUATOR_VERSION,
  PROMPT_SCHEMA_VERSION,
  DATA_SCHEMA_VERSION,
  createGapFromReport,
  transitionGapStatus,
  normalizeRepaymentEvaluation,
  createFallbackEvaluation,
  getRepaymentEvaluationPrompt,
  buildAttemptRecord,
  applyAttemptOutcome,
  resolveAttemptOutcome,
  upsertReviewItemForGap,
  refreshReviewDue,
  completePendingReviewItems,
  ensureCapabilityProfileDomain,
  updateCapabilityProfile
} from "./cognitive-repayment.js";
import {
  analyzeNormalizedSession,
  createAgentSessionAdapters,
  fingerprint,
  normalizeSessionImport
} from "./project-memory-analysis.js";
import { createProjectMemoryStore } from "./project-memory-store.js";
import { createCognitiveLoopStore } from "./cognitive-loop-store.js";
import { analyzeCognitiveLoop } from "./cognitive-loop.js";
import { createOwnershipStore } from "./project-ownership-store.js";
import {
  calculateDecisionOwnershipStatus,
  aggregateModuleStatus,
  calculateModuleRiskLevel,
  calculateProjectSummary,
  deriveEvidenceLevel,
  determineMissingEvidenceTypes,
  ownershipGapFromModuleStatus,
  buildModuleDetailView,
  isImportantAIDecision,
  levelToString,
  EVIDENCE_LEVEL,
  MODULE_OWNERSHIP_STATUS,
  DECISION_OWNERSHIP_STATUS,
  OWNERSHIP_CALCULATION_VERSION,
} from "./project-ownership.js";
import { generateModuleRecommendation, generateProjectRecommendations } from "./learning-orchestrator.js";
import { seedOwnershipData } from "./ownership-seed.js";
import { createLearningOrchestratorStore } from "./learning-orchestrator-store.js";
import {
  getTodayRecommendations,
  getWeeklyFocus,
  acceptRecommendation,
  skipRecommendation
} from "./learning-orchestrator.js";
import { createCognitiveReportsStore } from "./cognitive-reports-store.js";
import {
  getLatestWeeklyReport,
  getLatestMonthlyReport,
  generateWeeklyReport
} from "./cognitive-reports.js";
import { seedDemoAccountData } from "./demo-account-seed.js";
import { reportEnvValidation } from "./env-validation.js";
import { createTraceContext, runWithTrace, traceEvent, traceSpan } from "./ops/observability.mjs";

// 启动期环境验证：值非法时打印变量级错误并退出（绝不打印值）。
if (!reportEnvValidation(process.env)) {
  process.exit(1);
}

const port = Number(process.env.PORT || 8793);
const host = process.env.HOST || "0.0.0.0";
const apiToken = process.env.LEARNING_API_TOKEN || "";
const earlyAccessCodes = parseEarlyAccessCodes(
  process.env.MINDIOU_EARLY_ACCESS_CODES || process.env.MINDIOU_ACCESS_CODE || ""
);
const sessionSecret = process.env.MINDIOU_SESSION_SECRET || "";
const configuredSessionTtl = Number(process.env.MINDIOU_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
const sessionTtlSeconds = Number.isFinite(configuredSessionTtl)
  ? Math.min(60 * 60 * 24 * 30, Math.max(300, configuredSessionTtl))
  : 60 * 60 * 24 * 7;
const secureSessionCookie = process.env.MINDIOU_COOKIE_SECURE === "1";
const maxArtifactChars = Math.max(1000, Number(process.env.MAX_ARTIFACT_CHARS || 30000));
const maxRequestBodyBytes = Math.max(1024, Number(process.env.MAX_REQUEST_BODY_BYTES || 8 * 1024 * 1024));
const dailyAnalysisLimit = Math.max(1, Number(process.env.DAILY_ANALYSIS_LIMIT || 3));
const dailyAiTokenBudget = Math.max(1000, Number(process.env.USER_DAILY_AI_TOKEN_BUDGET || 200000));
const aiOutputTokenReserve = Math.max(1000, Number(process.env.AI_OUTPUT_TOKEN_RESERVE || 10000));
const configuredEnv = (name, fallback = "") => Object.hasOwn(process.env, name)
  ? process.env[name] || ""
  : fallback;
const aiProvider = configuredEnv("AI_PROVIDER", "openai");
const aiApiKey = configuredEnv("AI_API_KEY", process.env.OPENAI_API_KEY || "");
const disableAi = process.env.SPIRAL_DISABLE_AI === "1";
const mvp1DemoFallback = process.env.MVP1_DEMO_FALLBACK === "1";
const aiBaseUrl = configuredEnv("AI_BASE_URL", process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const chatModel = configuredEnv("AI_MODEL", process.env.OPENAI_MODEL || "gpt-4o-mini");
const researchProvider = configuredEnv("RESEARCH_PROVIDER", aiProvider);
const researchApiKey = configuredEnv("RESEARCH_API_KEY", aiProvider === "openai" ? aiApiKey : "");
const researchBaseUrl = configuredEnv("RESEARCH_BASE_URL", aiProvider === "openai" ? aiBaseUrl : "").replace(/\/+$/, "");
const researchModel = configuredEnv("RESEARCH_MODEL", process.env.OPENAI_RESEARCH_MODEL || chatModel);
const openAiChatTimeoutMs = Number(process.env.OPENAI_CHAT_TIMEOUT_MS || 30000);
const openAiResearchTimeoutMs = Number(process.env.OPENAI_RESEARCH_TIMEOUT_MS || 45000);
const sttTimeoutMs = Number(process.env.STT_TIMEOUT_MS || 30000);
const sttProvider = configuredEnv("STT_PROVIDER", "openai").toLowerCase();
const sttApiKey = configuredEnv("STT_API_KEY", aiProvider === "openai" ? aiApiKey : "");
const sttBaseUrl = configuredEnv("STT_BASE_URL", aiProvider === "openai" ? aiBaseUrl : "").replace(/\/+$/, "");
const sttModel = configuredEnv("STT_MODEL", process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe");
const baiduApiKey = configuredEnv("BAIDU_API_KEY");
const baiduSecretKey = configuredEnv("BAIDU_SECRET_KEY");
const baiduTokenUrl = configuredEnv("BAIDU_TOKEN_URL", "https://aip.baidubce.com/oauth/2.0/token");
const baiduSttUrl = configuredEnv("BAIDU_STT_URL", "https://vop.baidu.com/pro_api");
const baiduSttModel = configuredEnv("BAIDU_STT_MODEL", "80001");
const sttPrompt = process.env.OPENAI_STT_PROMPT || [
  "Learn Coach vocabulary study in Mandarin and English.",
  "Likely commands: 下一张, 下一个, 重复, 再说一遍, 提问, 问我, 会了, next, repeat, ask me, got it.",
  "Preserve English vocabulary terms exactly when possible."
].join(" ");
const dataDbPath = process.env.DATA_DB_PATH || process.env.AUTH_STORE_PATH || "tmp/mindiou.sqlite";
// 业务状态与 Web 账号/会话可以部署到不同 SQLite 文件；生产环境必须从
// AUTH_STORE_PATH 读取会话，否则登录成功后业务 API 会把有效 session 判成未认证。
const authDbPath = process.env.AUTH_STORE_PATH || dataDbPath;
const learningStorePath = process.env.LEARNING_STORE_PATH || "tmp/spiral-store.json";
const mvp0StorePath = process.env.MVP0_STORE_PATH || "tmp/mvp0-store.json";
const mvp1StorePath = process.env.MVP1_STORE_PATH || "tmp/mvp1-store.json";
const eventLog = [];
let baiduAccessToken = "";
let baiduAccessTokenExpiresAt = 0;
const assessmentStore = createAssessmentStore(dataDbPath);
const spiralStore = createSpiralStore(dataDbPath, { legacyJsonPath: learningStorePath });
await spiralStore.load();
const mvp0Store = createMvp0Store(dataDbPath, { legacyJsonPath: mvp0StorePath });
await mvp0Store.load();
const mvp1Store = createMvp1Store(dataDbPath, { legacyJsonPath: mvp1StorePath });
await mvp1Store.load();
// 兼容 admin 补丁的只读视图：账户体系分支以 mvp1Store 持久化替代原内存 Map
const mvp1Sessions = { values: () => mvp1Store.listSessions() };
const trainingStorePath = process.env.TRAINING_STORE_PATH || "tmp/training-store.json";
const trainingStore = createTrainingStore(dataDbPath, { legacyJsonPath: trainingStorePath });
await trainingStore.load();
const cognitiveRepaymentV1 = process.env.COGNITIVE_REPAYMENT_V1 === "1";
const repaymentStorePath = process.env.COGNITIVE_REPAYMENT_STORE_PATH || "tmp/cognitive-repayment-store.json";
const repaymentStore = createCognitiveRepaymentStore(dataDbPath, { legacyJsonPath: repaymentStorePath });
await repaymentStore.load();
const authStore = createAuthStore(authDbPath);
const usageLedger = createUsageLedger(dataDbPath);
const projectMemoryStore = createProjectMemoryStore(dataDbPath);
const cognitiveLoopStore = createCognitiveLoopStore(dataDbPath);
const projectMemoryHookToken = process.env.PROJECT_MEMORY_HOOK_TOKEN || "";
const projectMemoryAdapters = createAgentSessionAdapters();
const GENESIS_ADOPTED_SUGGESTIONS = [
  "把认知债务报告连接到可连续作答的清偿流程",
  "增加二次回答、复习队列和掌握度更新",
  "保留报告来源证据，让用户能够回看 AI 代劳的依据",
  "把项目、Agent 会话、产出物和人类能力证据放进同一条链路"
];

// 报告生成与认知清偿使用不同的持久化集合。这里做一个幂等的同步层，
// 让历史报告无需用户再次手动逐条导入，也让新报告能立即出现在“待清偿”。
async function syncRepaymentGapsFromReports(userId) {
  if (!cognitiveRepaymentV1 || !userId) return 0;
  const existing = repaymentStore.listGaps(userId);
  const existingKeys = new Set(existing.map(item => `${item.reportId}:${item.gapRank}`));
  let imported = 0;
  for (const report of mvp0Store.listReports(userId)) {
    for (const gapRef of report.sections?.dangerousGaps || []) {
      const gapRank = Number(gapRef.rank);
      if (!Number.isFinite(gapRank)) continue;
      const key = `${report.id}:${gapRank}`;
      if (existingKeys.has(key)) continue;
      try {
        const gap = createGapFromReport({
          report,
          gapRef: { gapRank },
          userId,
          now: new Date().toISOString()
        });
        await repaymentStore.saveGap(gap);
        existingKeys.add(key);
        imported += 1;
      } catch (error) {
        // 某一条旧报告格式异常时，不阻塞其余报告同步。
        console.warn(`Repayment gap sync skipped ${report.id}:${gapRank}: ${error.message}`);
      }
    }
  }
  return imported;
}

function reportCardForRepaymentGap(report, gap) {
  const cards = Array.isArray(report?.sections?.feynmanCards) ? report.sections.feynmanCards : [];
  if (gap?.cardId) return cards.find(card => card.id === gap.cardId) || null;
  const title = String(gap?.title || "").trim();
  const matched = cards.find(card => [card.target, card.prompt]
    .some(value => String(value || "").trim() === title));
  if (matched) return matched;
  const rank = Number(gap?.gapRank);
  return Number.isInteger(rank) && rank > 0 ? cards[rank - 1] || null : null;
}

// Dashboard consumers should not need to know whether a report was written
// before or after repayment V1. New gaps come from repaymentStore; legacy cards
// remain a compatibility fallback for old reports without an imported gap.
function listOutstandingDebts(userId, reports) {
  const reportById = new Map(reports.map(report => [report.id, report]));
  const coveredCards = new Set();
  const repaymentDebts = cognitiveRepaymentV1
    ? repaymentStore.listGaps(userId)
      .filter(gap => gap.status !== "repaid")
      .map(gap => {
        const report = reportById.get(gap.reportId);
        if (!report) return null;
        const card = reportCardForRepaymentGap(report, gap);
        if (card) coveredCards.add(`${report.id}:${card.id}`);
        return {
          reportId: report.id,
          cardId: gap.cardId || card?.id || "",
          gapId: gap.gapId,
          title: gap.title || card?.target || card?.prompt || "Cognitive debt",
          status: gap.status || "identified",
          locale: report.locale || "zh-CN"
        };
      })
      .filter(Boolean)
    : [];
  const legacyDebts = reports.flatMap(report =>
    (report.sections?.feynmanCards || [])
      .filter(card => !["provisionally_cleared", "repaid"].includes(card.clearance?.status))
      .filter(card => !coveredCards.has(`${report.id}:${card.id}`))
      .map(card => ({
        reportId: report.id,
        cardId: card.id,
        title: card.target || card.prompt || "Cognitive debt",
        status: card.clearance?.status || "not_started",
        locale: report.locale || "zh-CN"
      }))
  );
  return [...repaymentDebts, ...legacyDebts];
}
const rawWebResearch = researchProvider === "public_web"
  ? createPublicWebResearch({ timeoutMs: openAiResearchTimeoutMs })
  : createOpenAiWebResearch({
      apiKey: researchApiKey,
      baseUrl: researchBaseUrl,
      model: researchModel,
      timeoutMs: openAiResearchTimeoutMs
    });
// 生产环境（systemd ProtectSystem=strict + ReadWritePaths=/var/lib/mindiou）
// 必须把所有权地图存储放到可写目录，否则会出现 EROFS 只读文件系统错误。
// 本地开发保持 tmp/ 相对路径，与其它 store 一致。
const ownershipStorePath = process.env.OWNERSHIP_STORE_PATH
  || (process.env.NODE_ENV === "production" ? "/var/lib/mindiou/ownership-store.json" : "tmp/ownership-store.json");
const ownershipStore = createOwnershipStore(ownershipStorePath);
await ownershipStore.load();

// 初始化种子数据（幂等）。配置了 DEMO_USERNAME/DEMO_PASSWORD 时，
// 种子数据挂到演示账号真实 userId 下；否则保持原有 demo-user 行为。
const demoEmail = process.env.DEMO_USERNAME || "";
const demoPassword = process.env.DEMO_PASSWORD || "";
if (demoEmail && demoPassword) {
  try {
    const { user: demoUser, created: demoCreated } = authStore.ensureDemoAccount({
      email: demoEmail,
      password: demoPassword,
      name: "MindIOU 演示体验官"
    });
    await seedOwnershipData(ownershipStore, trainingStore, demoUser.id);
    await seedDemoAccountData({
      authStore,
      mvp0Store,
      trainingStore,
      repaymentStore,
      userId: demoUser.id
    });
    console.log(`[demo] 演示账号已${demoCreated ? "创建" : "就绪"}: ${demoEmail}`);
  } catch (demoError) {
    console.warn(`Demo account setup failed (non-blocking): ${demoError.message}`);
  }
} else {
  try {
    await seedOwnershipData(ownershipStore, trainingStore);
  } catch (seedError) {
    console.warn(`Ownership seed failed (non-blocking): ${seedError.message}`);
  }
}
const debtIntelligenceDisabled = process.env.DEBT_INTELLIGENCE_DISABLED === "1";
const debtIntelligenceStorePath = process.env.DEBT_INTELLIGENCE_STORE_PATH || "tmp/debt-intelligence-store.json";
const debtIntelligenceStore = createDebtIntelligenceStore(debtIntelligenceStorePath);
await debtIntelligenceStore.load();
const conceptGraphStorePath = process.env.CONCEPT_GRAPH_STORE_PATH || "tmp/concept-graph-store.json";
const conceptGraphStore = createConceptGraphStore(conceptGraphStorePath);
await conceptGraphStore.load();
const cognitiveProfileStorePath = process.env.COGNITIVE_PROFILE_STORE_PATH || "tmp/cognitive-profile-store.json";
const cognitiveProfileStore = createCognitiveProfileStore(cognitiveProfileStorePath);
await cognitiveProfileStore.load();
const learningOrchestratorStorePath = process.env.LEARNING_ORCHESTRATOR_STORE_PATH || "tmp/learning-orchestrator-store.json";
const learningOrchestratorStore = createLearningOrchestratorStore(learningOrchestratorStorePath);
await learningOrchestratorStore.load();
const cognitiveReportsStorePath = process.env.COGNITIVE_REPORTS_STORE_PATH || "tmp/cognitive-reports-store.json";
const cognitiveReportsStore = createCognitiveReportsStore(cognitiveReportsStorePath);
await cognitiveReportsStore.load();
// G2 glasses marks: in-memory idempotency store keyed by idempotencyKey.
// Each entry holds the response result and the per-mark records (with userId
// and timestamp). Lost on restart, which is acceptable for session-level marks.
const g2MarksStore = new Map();

const learningCoachSystemPrompt = [
  "You are Learn Coach, a rigorous but patient AI teacher for smart glasses including Even G2 and Rokid AIUI devices.",
  "You can teach any subject to learners at any level.",
  "Use active recall, Feynman questioning, Socratic guidance, concrete examples, analogies, and short feedback loops.",
  "When planning a subject, organize the modern-citizen core knowledge into a reasonable sequence of teaching units.",
  "Each unit must contain a concise explanation and 1 to 3 Feynman-style questions that require the learner to answer in their own words.",
  "When evaluating an answer, first identify what is correct, then point out missing or confused parts, then ask one short follow-up question or give one concrete thinking clue.",
  "If the answer is wrong or empty, never criticize. Re-explain more simply and invite another attempt.",
  "For glasses output, be brief and structured. Avoid long lectures unless explicitly asked.",
  "Use Chinese primarily when the learner writes Chinese, but naturally include key English terms in parentheses when useful."
].join(" ");

const rokidDemoCards = [
  {
    id: "demo-rokid-cors",
    projectId: "learn-coach-demo",
    front: "CORS",
    back: "浏览器读取跨域响应的规则。",
    prompt: "用自己的话解释：CORS 和网络白名单有什么区别？",
    tags: ["demo", "web"],
    debtScore: 72,
    mastery: 0,
    due: 0,
    repetitions: 0
  },
  {
    id: "demo-rokid-backpressure",
    projectId: "learn-coach-demo",
    front: "Backpressure",
    back: "消费者跟不上时，生产者必须减速。",
    prompt: "如果没有 backpressure，系统可能出现什么问题？",
    tags: ["demo", "systems"],
    debtScore: 66,
    mastery: 0,
    due: 0,
    repetitions: 0
  },
  {
    id: "demo-rokid-active-recall",
    projectId: "learn-coach-demo",
    front: "Active Recall",
    back: "主动从记忆中提取答案，而不是重复阅读。",
    prompt: "为什么主动回忆通常比重读更能暴露理解缺口？",
    tags: ["demo", "learning"],
    debtScore: 58,
    mastery: 0,
    due: 0,
    repetitions: 0
  }
];

// ── 可观察性基础设施 ──
// 单行 JSON 结构化日志。禁止在 fields 中放入：用户对话原文、AI 输入/输出全文、
// API 密钥、Cookie、Authorization 头、服务器密码。
function logEvent(level, message, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function readRequestId(req) {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  return /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
}

function logRequestCompletion(req, res, requestId, startedAt, traceId = "") {
  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch { /* 保留默认值 */ }
  logEvent(res.statusCode >= 500 ? "error" : "info", "http_request", {
    requestId,
    traceId,
    method: String(req.method || "GET"),
    path: pathname,
    status: res.statusCode,
    durationMs: Date.now() - startedAt
  });
}

function jsonResponse(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,cookie",
    "access-control-allow-credentials": "true",
    ...extraHeaders
  });
  res.end(body);
}

function optionsResponse(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,cookie",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400"
  });
  res.end();
}

function parseEarlyAccessCodes(value) {
  return String(value || "")
    .split(",")
    .map((entry, index) => {
      const trimmed = entry.trim();
      if (!trimmed) return null;
      const separator = trimmed.indexOf(":");
      if (separator < 1) {
        return { label: `early-user-${index + 1}`, code: trimmed };
      }
      return {
        label: clean(trimmed.slice(0, separator)).slice(0, 80) || `early-user-${index + 1}`,
        code: trimmed.slice(separator + 1).trim()
      };
    })
    .filter(entry => entry?.code);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return cookies;
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key) cookies[key] = value;
      return cookies;
    }, {});
}

const revokedSessionSignatures = new Map();

function revokeSessionToken(token, expiresAt) {
  const separator = String(token || "").lastIndexOf(".");
  if (separator < 1) return;
  const now = Date.now();
  for (const [signature, expiry] of revokedSessionSignatures) {
    if (expiry <= now) revokedSessionSignatures.delete(signature);
  }
  revokedSessionSignatures.set(String(token).slice(separator + 1), expiresAt || now);
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSession(req) {
  if (!sessionSecret) return null;
  const token = parseCookies(req).mindiou_session || "";
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (revokedSessionSignatures.has(signature)) return null;
  const expected = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.label || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function earlyAccessSessionCookie(req, value, maxAge) {
  const requestIsHttps = String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  return [
    `mindiou_session=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secureSessionCookie || requestIsHttps ? "Secure" : "",
    `Max-Age=${maxAge}`
  ].filter(Boolean).join("; ");
}

function findEarlyAccessUser(code) {
  return earlyAccessCodes.find(entry => safeEqual(entry.code, code)) || null;
}

function accessControlEnabled() {
  return Boolean(apiToken || earlyAccessCodes.length);
}

function authorizeRequest(req) {
  const header = req.headers.authorization || "";
  if (apiToken && safeEqual(header, `Bearer ${apiToken}`)) {
    return { label: "device-or-service", method: "bearer" };
  }
  // Web accounts use the HttpOnly `session` cookie issued by /api/auth/login.
  // Keep this separate from the legacy early-access `mindiou_session` cookie:
  // production has LEARNING_API_TOKEN enabled, so the shared compatibility
  // gate must recognize an authenticated browser before it can reach routes
  // such as /api/mvp0/timelines.
  const sessionId = parseCookies(req)[sessionCookieName] || "";
  const webUser = sessionId ? authStore.getUserBySession(sessionId) : null;
  if (webUser) {
    return { label: `web-user:${webUser.id}`, method: "web-session", userId: webUser.id };
  }
  const session = readSession(req);
  return session ? { label: session.label, method: "session" } : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    req.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxRequestBodyBytes) {
        if (settled) return;
        settled = true;
        const error = new Error(`Request body exceeds ${Math.round(maxRequestBodyBytes / 1024 / 1024)} MB`);
        error.statusCode = 413;
        error.code = "REQUEST_BODY_TOO_LARGE";
        reject(error);
        return;
      }
      if (settled) return;
      body += chunk;
    });
    req.on("end", () => {
      if (!settled) resolve(body);
    });
    req.on("error", error => {
      if (!settled) reject(error);
    });
  });
}

function requireJsonRequest(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("This endpoint accepts pasted plain text in JSON only. File upload is not supported yet.");
    error.statusCode = 415;
    error.code = "UNSUPPORTED_INPUT_FORMAT";
    throw error;
  }
}

function localizedLimitMessage(error, req) {
  const english = String(req.headers["x-mindiou-locale"] || "").toLowerCase().startsWith("en");
  const messages = {
    REQUEST_BODY_TOO_LARGE: english
      ? `The request exceeds ${Math.round(maxRequestBodyBytes / 1024 / 1024)} MB. Split or summarize the content before importing it.`
      : `请求内容超过 ${Math.round(maxRequestBodyBytes / 1024 / 1024)} MB，请先分段或摘要后再导入。`,
    ARTIFACT_TEXT_TOO_LONG: english
      ? `Text exceeds ${maxArtifactChars.toLocaleString()} characters. Split it into sections or summarize it first.`
      : `文本超过 ${maxArtifactChars.toLocaleString()} 字符，请分段导入或先摘要后再分析。`,
    DAILY_ANALYSIS_LIMIT: english
      ? `You have used today's ${dailyAnalysisLimit} analyses. Please try again tomorrow.`
      : `你今天的 ${dailyAnalysisLimit} 次分析额度已用完，请明天再试。`,
    DAILY_AI_TOKEN_BUDGET: english
      ? "You have reached today's AI usage budget. Shorten the content or try again tomorrow."
      : "你今天的 AI 使用预算已用完，请缩短内容或明天再试。",
    UNSUPPORTED_INPUT_FORMAT: english
      ? "Only pasted plain text is supported right now. File upload is not available yet."
      : "当前仅支持粘贴纯文本，暂不支持文件上传。"
  };
  return messages[error.code] || error.message;
}

function usageDateInShanghai(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

function validateArtifactText(value) {
  const artifactText = String(value || "").trim();
  if (!artifactText) {
    const error = new Error("Missing artifactText");
    error.statusCode = 400;
    error.code = "MISSING_ARTIFACT_TEXT";
    throw error;
  }
  if (artifactText.length > maxArtifactChars) {
    const error = new Error(`Text exceeds ${maxArtifactChars.toLocaleString()} characters. Split it into sections or summarize it first.`);
    error.statusCode = 413;
    error.code = "ARTIFACT_TEXT_TOO_LONG";
    throw error;
  }
  return artifactText;
}

function estimateAnalysisTokens(artifactText) {
  return Math.ceil(String(artifactText).length / 2) + aiOutputTokenReserve;
}

function consumeAnalysisQuota(userId, artifactText) {
  return usageLedger.consumeAnalysis(
    userId,
    usageDateInShanghai(),
    estimateAnalysisTokens(artifactText),
    { analysisLimit: dailyAnalysisLimit, tokenBudget: dailyAiTokenBudget }
  );
}

// Admin channel: LEARNING_API_TOKEN authorizes service-to-service calls and
// debugging with an unfiltered view of the data. When it is not configured,
// the admin channel stays open (local development), matching previous
// behavior.
function requireToken(req, res) {
  if (isAdminToken(req)) return true;
  if (!accessControlEnabled()) return true;
  if (authorizeRequest(req)) return true;
  jsonResponse(res, 401, { ok: false, error: "Invalid token" });
  return false;
}

function isAdminToken(req) {
  if (!apiToken) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${apiToken}`;
}

function readBearer(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireDeviceToken(req, res) {
  const identity = authStore.validateDeviceToken(readBearer(req));
  if (!identity) {
    jsonResponse(res, 401, { ok: false, error: "Invalid device token" });
    return null;
  }
  return identity;
}

// Device channels (Rokid/G2 glasses): a per-user device token identifies the
// owning user and restricts the response to that user's data. The admin
// token remains accepted as a fallback and is labelled in the response.
function resolveDeviceChannel(req, res) {
  const bearer = readBearer(req);
  if (bearer) {
    const identity = authStore.validateDeviceToken(bearer);
    if (identity) return { userId: identity.userId, adminChannel: false };
  }
  if (isAdminToken(req)) return { userId: null, adminChannel: true };
  jsonResponse(res, 401, { ok: false, error: "Invalid device token" });
  return null;
}

function parseJson(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const NON_SPECIFIC_REPORT_DOMAINS = new Set(["", "unknown", "general", "通用", "认知债务", "未识别", "未命名"]);

function deriveReportCapabilityDomain(report) {
  const raw = clean(report?.analysis?.userCapability?.currentDomain || "");
  if (raw && !NON_SPECIFIC_REPORT_DOMAINS.has(raw.toLowerCase())) return raw.slice(0, 200);
  const source = [
    report?.display?.title,
    report?.analysis?.artifactTitle,
    report?.input?.artifactText
  ].map(value => String(value || "")).join("\n").slice(0, 16000);
  if (/3d\s*(打印|print)|增材制造|3d打印机|打印切片|树脂打印|fdm|sla打印/i.test(source)) return "3D打印与增材制造";
  return "";
}

const sessionCookieName = "session";
const sessionCookieMaxAge = 604800; // 7 days, matches auth-store session TTL

function authSessionCookie(sessionId) {
  const parts = [
    `${sessionCookieName}=${sessionId}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${sessionCookieMaxAge}`
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie() {
  const parts = [
    `${sessionCookieName}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

let mailTransporter = null;

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const host = process.env.SMTP_HOST || "";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (!host || !user || !pass) return null;
  mailTransporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass }
  });
  return mailTransporter;
}

function getMailFrom() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@mindiou.top";
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "demo.mindiou.top";
  return proto + "://" + host;
}

async function sendVerificationEmail(email, token, req) {
  const transporter = getMailTransporter();
  const baseUrl = getPublicBaseUrl(req);
  const link = baseUrl + "/mindiou-api/api/auth/verify-email?token=" + token;
  if (!transporter) {
    console.warn("[email-verification] SMTP not configured. Link for " + email + ": " + link);
    return { sent: false, link };
  }
  const from = getMailFrom();
  await transporter.sendMail({
    from,
    to: email,
    subject: "验证你的 MindIOU 邮箱",
    html: "<div style=\"font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;\"><h2>验证你的邮箱</h2><p>感谢注册 MindIOU。请点击下方按钮完成邮箱验证：</p><p><a href=\"" + link + "\" style=\"display:inline-block;padding:12px 32px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;\">验证邮箱</a></p><p>或复制以下链接到浏览器：</p><p><a href=\"" + link + "\">" + link + "</a></p><p style=\"color:#888;font-size:12px;margin-top:24px;\">此链接 24 小时内有效。如果你没有注册 MindIOU，请忽略此邮件。</p></div>"
  });
  return { sent: true, link: null };
}

function requireAuth(req, res) {
  const sessionId = parseCookies(req)[sessionCookieName] || "";
  const user = sessionId ? authStore.getUserBySession(sessionId) : null;
  if (user) return user;
  // Fallback: accept legacy early-access session (invite-code cookie)
  const earlySession = readSession(req);
  if (earlySession) {
    return { id: `early-access:${earlySession.label}`, email: null };
  }
  jsonResponse(res, 401, { ok: false, error: "Authentication required" });
  return null;
}

// Non-failing variant of requireAuth for routes that accept an optional user
// (e.g. training endpoints that fall back to "demo-user").
function getOptionalUser(req) {
  const sessionId = parseCookies(req)[sessionCookieName] || "";
  if (sessionId) {
    const user = authStore.getUserBySession(sessionId);
    if (user) return user;
  }
  const earlySession = readSession(req);
  if (earlySession) {
    return { id: `early-access:${earlySession.label}`, email: null };
  }
  return null;
}

function loadOwnedMvp1Session(id, userId) {
  try {
    return mvp1Store.getSession(id, userId);
  } catch {
    return null;
  }
}

function projectMemoryTokenSet(value) {
  const source = String(value || "").toLowerCase();
  const tokens = source.split(/[^\p{L}\p{N}_-]+/u).map(token => token.trim()).filter(token => token.length >= 2);
  for (const phrase of source.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let size = 2; size <= Math.min(4, phrase.length); size += 1) {
      for (let index = 0; index + size <= phrase.length; index += 1) tokens.push(phrase.slice(index, index + size));
    }
  }
  return tokens;
}

function projectMemorySimilarity(left, right) {
  const a = new Set(projectMemoryTokenSet(left));
  const b = new Set(projectMemoryTokenSet(right));
  if (!a.size || !b.size) return 0;
  return [...a].filter(token => b.has(token)).length / Math.max(1, Math.min(a.size, b.size));
}

function projectMemoryAnalysisForStorage(analysis) {
  const safe = { ...(analysis || {}) };
  delete safe.messages;
  return safe;
}

function projectMemoryAppendHookEvents(sessionId, events, userId) {
  const session = projectMemoryStore.getAgentSession(sessionId, userId);
  const artifacts = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event.type !== "file_changed") continue;
    const payload = event.payload || {};
    const repositoryRelativePath = payload.repositoryRelativePath || payload.path;
    if (!repositoryRelativePath) continue;
    const artifact = projectMemoryStore.upsertArtifact({
      projectId: session.projectId,
      type: "file",
      name: payload.name || repositoryRelativePath,
      repositoryRelativePath,
      diffSummary: payload.diffSummary,
      language: payload.language,
      sensitivity: "metadata_only"
    }, userId);
    projectMemoryStore.linkSessionArtifact(sessionId, artifact.id, { relation: "modified" }, userId);
    artifacts.push(artifact);
  }

  const explicitCandidates = (Array.isArray(events) ? events : [])
    .filter(item => item.type === "debt_candidate")
    .map(item => item.payload || {});
  let analysis = session.analysis || {};
  if (explicitCandidates.length) {
    const candidateAnalysis = analyzeNormalizedSession({
      messages: [],
      explicitDebtCandidates: explicitCandidates,
      changedArtifacts: artifacts.map(item => ({ path: item.repositoryRelativePath, type: item.type }))
    });
    const existing = Array.isArray(analysis.cognitiveDebtCandidates) ? analysis.cognitiveDebtCandidates : [];
    const merged = [...existing];
    for (const candidate of candidateAnalysis.cognitiveDebtCandidates || []) {
      if (!merged.some(item => item.description === candidate.description)) merged.push(candidate);
    }
    analysis = { ...analysis, cognitiveDebtCandidates: merged };
  }
  projectMemoryStore.updateAgentSession(sessionId, { analysis }, userId);
  const detail = projectMemoryStore.getSessionDetail(sessionId, userId);
  return { detail, analysis: detail.session.analysis || {}, artifacts };
}

function projectMemoryCandidateArtifacts(normalized, analysis) {
  const combined = [
    ...(analysis?.artifactCandidates || []),
    ...(normalized.changedArtifacts || []).map(item => ({ ...item, type: item.type || "file", path: item.path || item.repositoryRelativePath })),
    ...(normalized.commits || []).map(item => ({
      ...item,
      type: "commit",
      gitCommitHash: item.gitCommitHash || item.hash || item.commitHash,
      name: item.name || "Commit " + (item.gitCommitHash || item.hash || item.commitHash || "")
    }))
  ];
  const dedupe = new Map();
  for (const item of combined) {
    const key = [item.type, item.path || item.repositoryRelativePath, item.symbolName, item.gitCommitHash || item.hash].join("|");
    if (!dedupe.has(key)) dedupe.set(key, item);
  }
  return [...dedupe.values()];
}

function projectMemoryFindWorkItem(projectId, userId, candidate, artifacts) {
  const existing = projectMemoryStore.listWorkItems(projectId, userId);
  let best = null;
  for (const workItem of existing) {
    const titleScore = projectMemorySimilarity(candidate.title, workItem.title);
    const summaryScore = projectMemorySimilarity(candidate.summary, workItem.summary || "");
    const linked = projectMemoryStore.listWorkItemArtifacts(workItem.id, userId);
    const artifactScore = artifacts.length
      ? linked.filter(artifact => artifacts.some(item =>
        (artifact.repositoryRelativePath && item.repositoryRelativePath === artifact.repositoryRelativePath) ||
        (artifact.symbolName && item.symbolName === artifact.symbolName)
      )).length / artifacts.length
      : 0;
    const score = Math.min(1, titleScore * 0.6 + summaryScore * 0.15 + artifactScore * 0.25);
    if (!best || score > best.score) best = { workItem, score };
  }
  return best;
}

function projectMemorySearch(query, projectId, userId) {
  const results = projectMemoryStore.search(query, projectId, userId);
  const needle = String(query || "").toLowerCase().trim();
  const debts = trainingStore.listCognitiveDebts(userId).filter(debt => {
    const links = projectMemoryStore.listDebtLinks(debt.id, userId);
    const inProject = !projectId || links.some(link => link.artifact.projectId === projectId);
    const textMatch = !needle || [debt.id, debt.gapText, debt.gapEvidence, debt.status].some(value => String(value || "").toLowerCase().includes(needle));
    const linkedArtifactMatch = !needle || links.some(link => [
      link.artifact.name, link.artifact.repositoryRelativePath, link.artifact.symbolName, link.artifact.gitCommitHash,
      link.workItemTitle, link.sessionTitle, link.decisionTitle
    ].some(value => String(value || "").toLowerCase().includes(needle)));
    const linkedProjectMatch = !needle || links.some(link => {
      try {
        const project = projectMemoryStore.getProject(link.artifact.projectId, userId);
        return [project.name, project.description].some(value => String(value || "").toLowerCase().includes(needle));
      } catch {
        return false;
      }
    });
    let reportMatch = false;
    if (needle && debt.reportId) {
      try {
        const report = mvp0Store.getReport(debt.reportId, userId);
        reportMatch = [report.display?.title, report.analysis?.artifactTitle, report.input?.artifactText]
          .some(value => String(value || "").toLowerCase().includes(needle));
      } catch {
        reportMatch = false;
      }
    }
    return inProject && (textMatch || linkedArtifactMatch || linkedProjectMatch || reportMatch);
  }).map(debt => ({ ...debt, context: projectMemoryStore.listDebtLinks(debt.id, userId).slice(0, 8) }));
  results.groups.cognitiveDebts = debts;
  results.total = Object.values(results.groups).reduce((total, group) => total + group.length, 0);
  return results;
}

async function projectMemoryImportSession(input, userId, importMethod = "manual_paste") {
  if (input.rawContentStorage === "encrypted") {
    throw new Error("Encrypted raw content storage is not enabled; choose not_stored or redacted");
  }
  const adapter = Array.isArray(input.events)
    ? projectMemoryAdapters.find(item => item.platform === "hook")
    : projectMemoryAdapters.find(item => item.platform === "manual");
  const normalized = await (adapter || projectMemoryAdapters[0]).parse({ ...input, importMethod });
  const existingSession = projectMemoryStore.findAgentSessionByFingerprint(normalized.sourceFingerprint, userId);
  if (existingSession) {
    const appended = Array.isArray(input.events) && input.events.length
      ? projectMemoryAppendHookEvents(existingSession.id, input.events, userId)
      : null;
    const existingDetail = appended?.detail || projectMemoryStore.getSessionDetail(existingSession.id, userId);
    return {
      project: projectMemoryStore.getProject(existingSession.projectId, userId),
      session: existingDetail,
      analysis: appended?.analysis || existingDetail.session.analysis || {},
      workItem: existingDetail.workItems[0] || null,
      workItemMatch: { confidence: 1, action: "idempotent", existing: true },
      idempotent: true
    };
  }
  const project = projectMemoryStore.ensureProject({
    id: input.projectId,
    name: input.projectName || normalized.projectHints.workspaceName || "未命名项目",
    description: input.projectDescription,
    projectType: input.projectType || "software",
    repositoryUrl: normalized.projectHints.repositoryUrl,
    localWorkspaceFingerprint: normalized.projectHints.gitRootFingerprint,
    defaultBranch: input.defaultBranch
  }, userId);
  const analysis = analyzeNormalizedSession(normalized);
  const savedSession = projectMemoryStore.saveAgentSession({
    projectId: project.id,
    platform: normalized.platform,
    externalSessionId: normalized.externalSessionId,
    sourceFingerprint: normalized.sourceFingerprint,
    startedAt: normalized.startedAt,
    endedAt: normalized.endedAt,
    title: input.title || analysis.workItemCandidates[0]?.title,
    rawTitle: input.rawTitle,
    userIntentSummary: analysis.userIntent,
    implementationSummary: analysis.implementationSummary,
    outcomeSummary: analysis.outcomeSummary,
    keyTopics: analysis.keyTopics,
    technologies: analysis.technologies,
    importMethod,
    rawContentStorage: input.rawContentStorage,
    rawContentReference: input.rawContentReference,
    rawContent: normalized.rawContent,
    processingStatus: "completed",
    analysis: projectMemoryAnalysisForStorage(analysis)
  }, userId);
  const artifacts = [];
  for (const candidate of projectMemoryCandidateArtifacts(normalized, analysis)) {
    const artifact = projectMemoryStore.upsertArtifact({
      projectId: project.id,
      type: candidate.type === "function" ? "function" : candidate.type === "commit" ? "commit" : candidate.type || "file",
      name: candidate.name || candidate.symbolName || candidate.path || candidate.repositoryRelativePath || "Artifact " + (candidate.gitCommitHash || ""),
      repositoryRelativePath: candidate.path || candidate.repositoryRelativePath,
      symbolName: candidate.symbolName,
      gitCommitHash: candidate.gitCommitHash || candidate.hash || candidate.commitHash,
      pullRequestUrl: candidate.pullRequestUrl,
      contentHash: candidate.contentHash,
      diffSummary: candidate.diffSummary,
      relevantSnippet: candidate.relevantSnippet,
      language: candidate.language,
      sensitivity: candidate.sensitivity || "metadata_only"
    }, userId);
    projectMemoryStore.linkSessionArtifact(savedSession.id, artifact.id, {
      relation: candidate.relation || "modified"
    }, userId);
    artifacts.push({ ...artifact, relation: candidate.relation || "modified", confidence: Number(candidate.confidence || 0.8) });
  }
  const candidateWorkItem = analysis.workItemCandidates[0];
  const match = candidateWorkItem ? projectMemoryFindWorkItem(project.id, userId, candidateWorkItem, artifacts) : null;
  let workItem = null;
  let workItemMatch = { confidence: candidateWorkItem?.confidence || 0, action: "pending_confirmation" };
  if (match && match.score >= 0.85) {
    workItem = match.workItem;
    workItemMatch = { confidence: match.score, action: "auto_linked", existing: true };
  } else if (candidateWorkItem && candidateWorkItem.confidence >= 0.85) {
    workItem = projectMemoryStore.createWorkItem({
      projectId: project.id,
      title: candidateWorkItem.title,
      summary: candidateWorkItem.summary,
      type: candidateWorkItem.type,
      source: "session_import",
      confidence: candidateWorkItem.confidence,
      status: "in_progress"
    }, userId);
    workItemMatch = { confidence: candidateWorkItem.confidence, action: "created", existing: false };
  }
  if (workItem) {
    projectMemoryStore.linkSessionWorkItem(savedSession.id, workItem.id, {
      relation: "created",
      confidence: workItemMatch.confidence,
      source: "automatic"
    }, userId);
    for (const artifact of artifacts) {
      projectMemoryStore.linkWorkItemArtifact(workItem.id, artifact.id, {
        relation: artifact.relation,
        sourceSessionId: savedSession.id
      }, userId);
    }
  }
  const decisions = [];
  for (const candidate of analysis.decisionCandidates || []) {
    decisions.push(projectMemoryStore.createDecision({
      projectId: project.id,
      workItemId: workItem?.id,
      sessionId: savedSession.id,
      title: candidate.title,
      decision: candidate.decision,
      rationale: candidate.rationale,
      alternatives: candidate.alternatives,
      tradeoffs: candidate.tradeoffs,
      assumptions: candidate.assumptions,
      risks: candidate.risks,
      decisionType: candidate.type || candidate.decisionType,
      decisionMaker: candidate.decisionMaker,
      userParticipation: candidate.userParticipation,
      importance: candidate.importance
    }, userId));
  }
  return {
    project,
    session: projectMemoryStore.getSessionDetail(savedSession.id, userId),
    analysis: { ...analysis, artifacts: artifacts.map(item => item.id), decisions: decisions.map(item => item.id) },
    workItem,
    workItemMatch,
    idempotent: false
  };
}

async function projectMemoryLinkReport(reportId, projectId, userId) {
  const report = mvp0Store.getReport(reportId, userId);
  const project = projectMemoryStore.getProject(projectId, userId);
  const title = report.display?.title || report.analysis?.artifactTitle || "认知欠条报告";
  const sourceFingerprint = fingerprint({ kind: "mvp0-report-project-memory", reportId, projectId });
  const imported = await projectMemoryImportSession({
    projectId,
    platform: "manual",
    externalSessionId: `mvp0-report:${reportId}`,
    sourceFingerprint,
    title,
    rawTitle: title,
    rawContentStorage: "not_stored",
    importMethod: "report_generation",
    text: report.input?.artifactText || "",
    projectHints: { workspaceName: project.name }
  }, userId, "report_generation");

  const detail = imported.session || projectMemoryStore.getSessionDetail(imported.session.id, userId);
  let workItem = imported.workItem || detail.workItems?.[0] || null;
  if (!workItem) {
    workItem = projectMemoryStore.createWorkItem({
      projectId,
      title,
      summary: "由生成认知欠条主流程归入项目记忆，待用户确认和完善。",
      type: "feature",
      status: "detected",
      source: "session_import",
      confidence: 0.6
    }, userId);
    projectMemoryStore.linkSessionWorkItem(detail.session.id, workItem.id, {
      relation: "created",
      confidence: 0.6,
      source: "automatic"
    }, userId);
  }

  const sourceArtifact = projectMemoryStore.upsertArtifact({
    projectId,
    type: "document",
    name: `${title}（原始协作材料）`,
    contentHash: fingerprint(report.input?.artifactText || reportId),
    diffSummary: "由认知欠条报告生成流程关联；默认不保存完整原始内容。",
    sensitivity: "metadata_only"
  }, userId);
  projectMemoryStore.linkSessionArtifact(detail.session.id, sourceArtifact.id, { relation: "created" }, userId);
  projectMemoryStore.linkWorkItemArtifact(workItem.id, sourceArtifact.id, { relation: "documented", sourceSessionId: detail.session.id }, userId);

  const artifacts = [...(detail.artifacts || [])];
  if (!artifacts.some(item => item.id === sourceArtifact.id)) artifacts.push(sourceArtifact);
  for (const artifact of artifacts) {
    if (artifact.id === sourceArtifact.id) continue;
    projectMemoryStore.linkWorkItemArtifact(workItem.id, artifact.id, {
      relation: artifact.type === "commit" ? "modified" : "modified",
      sourceSessionId: detail.session.id
    }, userId);
  }

  const decisions = detail.decisions || [];
  const reportDebts = trainingStore.listCognitiveDebts(userId).filter(debt =>
    debt.reportId === reportId || (Array.isArray(debt.sourceReports) && debt.sourceReports.includes(reportId))
  );
  for (const debt of reportDebts) {
    projectMemoryStore.linkDebtArtifact({
      debtId: debt.id,
      artifactId: sourceArtifact.id,
      workItemId: workItem.id,
      sessionId: detail.session.id,
      decisionId: decisions[0]?.id,
      relation: "caused_by",
      relevance: "primary"
    }, userId);
    for (const artifact of artifacts) {
      if (artifact.id === sourceArtifact.id) continue;
      projectMemoryStore.linkDebtArtifact({
        debtId: debt.id,
        artifactId: artifact.id,
        workItemId: workItem.id,
        sessionId: detail.session.id,
        decisionId: decisions[0]?.id,
        relation: "implemented_in",
        relevance: "secondary"
      }, userId);
    }
  }
  const finalDetail = projectMemoryStore.getSessionDetail(detail.session.id, userId);
  return {
    project,
    reportId,
    session: finalDetail.session,
    sessionDetail: finalDetail,
    workItem,
    artifacts,
    decisions,
    linkedDebtIds: reportDebts.map(debt => debt.id),
    idempotent: Boolean(imported.idempotent)
  };
}

async function projectMemoryDetectRecurrences(result, userId) {
  const existingDebts = trainingStore.listCognitiveDebts(userId);
  const context = [
    result.analysis?.userIntent,
    result.analysis?.implementationSummary,
    ...(result.analysis?.keyTopics || [])
  ].join(" ");
  const recurrences = [];
  for (const debt of existingDebts) {
    const similarity = projectMemorySimilarity(debt.gapText, context);
    if (similarity < 0.55 || !result.workItem) continue;
    const recurrence = projectMemoryStore.createRecurrence({
      debtId: debt.id,
      projectId: result.project.id,
      workItemId: result.workItem.id,
      sessionId: result.session.session.id,
      artifactId: result.session.artifacts[0]?.id,
      reason: "新会话与历史欠条主题相关（相似度 " + similarity.toFixed(2) + "），需要确认是迁移还是复发。",
      confidence: similarity
    }, userId);
    recurrences.push(recurrence);
    if (similarity >= 0.85) {
      const profile = trainingStore.getMasteryProfile(debt.id);
      if (profile) await trainingStore.saveMasteryProfile(handleRelapse(profile));
      debt.status = "relapsed";
      debt.recurrenceCount = Number(debt.recurrenceCount || 0) + 1;
      debt.updatedAt = new Date().toISOString();
      await trainingStore.saveCognitiveDebt(debt);
    }
  }
  return recurrences;
}

async function projectMemoryAcceptDebtCandidate(sessionId, index, userId) {
  const detail = projectMemoryStore.getSessionDetail(sessionId, userId);
  const candidate = detail.session.analysis?.cognitiveDebtCandidates?.[Number(index)];
  if (!candidate) throw new Error("Cognitive debt candidate not found");
  const existing = trainingStore.findCognitiveDebtByGap(userId, candidate.description || candidate.title);
  const debt = existing || createCognitiveDebt({
    userId,
    reportId: "project-memory:" + sessionId,
    cardId: detail.workItems[0]?.id,
    gapText: candidate.description || candidate.title,
    gapEvidence: candidate.reason
  });
  if (!existing) await trainingStore.saveCognitiveDebt(debt);
  const workItem = detail.workItems[0];
  const artifacts = detail.artifacts;
  const decisions = detail.decisions;
  for (const artifact of artifacts) {
    projectMemoryStore.linkDebtArtifact({
      debtId: debt.id,
      artifactId: artifact.id,
      workItemId: workItem?.id,
      sessionId,
      decisionId: decisions[0]?.id,
      relation: "implemented_in",
      relevance: artifact.id === artifacts[0]?.id ? "primary" : "secondary"
    }, userId);
  }
  if (!trainingStore.getMasteryProfile(debt.id)) {
    await trainingStore.saveMasteryProfile({
      cognitiveDebtId: debt.id,
      conceptualUnderstanding: 0,
      independentRecall: 0,
      hintIndependence: 0,
      misconceptionResistance: 0,
      transferAbility: 0,
      retentionStrength: 0,
      overallMastery: 0,
      currentStage: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      relapseCount: 0
    });
  }
  return { debt, links: projectMemoryStore.listDebtLinks(debt.id, userId) };
}

async function projectMemoryRecordTrainingEvidence(attempt, userId) {
  if (!attempt?.cognitiveDebtId || attempt.userId !== userId) return;
  const levelByStage = {
    initial_compensation: "E1",
    delayed_recall: "E2",
    misconception_check: "E3",
    error_detection: "E3",
    scenario_transfer: "E4",
    real_work_validation: "E5"
  };
  const typeByStage = {
    initial_compensation: "read",
    delayed_recall: "independent_explanation",
    misconception_check: "misconception_detection",
    error_detection: "error_detection",
    scenario_transfer: "scenario_transfer",
    real_work_validation: "real_work_validation"
  };
  const links = projectMemoryStore.listDebtLinks(attempt.cognitiveDebtId, userId);
  if (!links.length || projectMemoryStore.listEvidenceForDebt(attempt.cognitiveDebtId, userId).some(item => item.trainingAttemptId === attempt.id)) return;
  for (const link of links) {
    projectMemoryStore.createEvidence({
      userId,
      debtId: attempt.cognitiveDebtId,
      projectId: link.artifact.projectId,
      workItemId: link.workItemId,
      artifactId: link.artifact.id,
      trainingAttemptId: attempt.id,
      evidenceType: typeByStage[attempt.trainingStage] || "read",
      evidenceLevel: levelByStage[attempt.trainingStage] || "E0",
      result: attempt.evaluation?.passed ? "passed" : "partial",
      evidenceSummary: "训练阶段 " + attempt.trainingStage + " 的既有训练结果；真实所有权仍需按证据核验。",
      occurredAt: attempt.completedAt || new Date().toISOString()
    }, userId);
  }
}
/**
 * 计算项目所有权视图（实时计算，非缓存）
 *
 * 读取项目所有数据 + trainingStore 中的认知欠条和训练记录，
 * 构建决策视图和模块视图，返回摘要和模块列表。
 */
function computeProjectOwnershipView(ownershipStore, trainingStore, projectId, userId) {
  const projectData = ownershipStore.getProjectData(projectId);
  const allDebts = trainingStore.listCognitiveDebts(userId);
  const allAttempts = trainingStore.listAttempts(userId);

  // 为每个决策构建视图
  const decisionViews = projectData.decisionRecords.map((decision) => {
    const linkedDebtIds = projectData.decisionDebtLinks
      .filter((l) => l.decisionId === decision.id)
      .map((l) => l.cognitiveDebtId);
    const linkedDebts = allDebts
      .filter((d) => linkedDebtIds.includes(d.id))
      .map((d) => {
        const link = projectData.decisionDebtLinks.find(
          (l) => l.decisionId === decision.id && l.cognitiveDebtId === d.id
        );
        return { ...d, riskType: link?.riskType };
      });

    const linkedArtifactIds = projectData.decisionArtifactLinks
      .filter((l) => l.decisionId === decision.id)
      .map((l) => l.artifactId);
    const linkedArtifacts = projectData.artifacts.filter((a) => linkedArtifactIds.includes(a.id));

    const decisionEvidence = projectData.evidenceRecords.filter(
      (e) => e.decisionId === decision.id || (e.workItemId === decision.workItemId)
    );

    const decisionAttempts = allAttempts.filter(
      (a) => linkedDebtIds.includes(a.cognitiveDebtId) || a.workItemId === decision.workItemId
    );

    const evidenceLevel = deriveEvidenceLevel({
      evidenceRecords: decisionEvidence,
      trainingAttempts: decisionAttempts,
      artifacts: linkedArtifacts,
    });

    const status = calculateDecisionOwnershipStatus({
      decision,
      evidenceLevel,
      linkedDebts,
    });

    return {
      decisionId: decision.id,
      workItemId: decision.workItemId,
      title: decision.title,
      importance: decision.importance,
      decisionMaker: decision.decisionMaker,
      isImportant: isImportantAIDecision(decision),
      status,
      evidenceLevel,
      evidenceLevelLabel: levelToString(evidenceLevel),
    };
  });

  // 为每个模块（WorkItem）构建视图
  const moduleViews = projectData.workItems.map((workItem) => {
    const moduleDecisionViews = decisionViews.filter((d) => d.workItemId === workItem.id);
    const moduleStatus = aggregateModuleStatus(moduleDecisionViews);
    const moduleRisk = calculateModuleRiskLevel(moduleDecisionViews, allDebts);
    const maxLevel = moduleDecisionViews.reduce(
      (max, d) => Math.max(max, d.evidenceLevel ?? EVIDENCE_LEVEL.E0),
      EVIDENCE_LEVEL.E0
    );
    const missingTypes = determineMissingEvidenceTypes(maxLevel);
    const ownershipGap = ownershipGapFromModuleStatus(moduleStatus);

    // 模块关联数据计数
    const moduleAgentSessions = projectData.agentSessions.filter((s) => s.workItemId === workItem.id);
    const moduleArtifacts = projectData.artifacts.filter((a) => a.workItemId === workItem.id);
    const moduleDebtIds = projectData.decisionDebtLinks
      .filter((l) => {
        const dec = projectData.decisionRecords.find((d) => d.id === l.decisionId);
        return dec && dec.workItemId === workItem.id;
      })
      .map((l) => l.cognitiveDebtId);
    const moduleDebts = allDebts.filter((d) => moduleDebtIds.includes(d.id));
    const highRiskDebts = moduleDebts.filter((d) => {
      const link = projectData.decisionDebtLinks.find(
        (l) => l.cognitiveDebtId === d.id && moduleDebtIds.includes(l.cognitiveDebtId)
      );
      return link?.riskType;
    });

    // 最近活动
    const timestamps = [
      ...moduleAgentSessions.map((s) => s.importedAt),
      ...moduleDecisionViews.map((d) => d.createdAt),
      ...projectData.evidenceRecords.filter((e) => e.workItemId === workItem.id).map((e) => e.createdAt),
    ].filter(Boolean);

    return {
      workItemId: workItem.id,
      title: workItem.title,
      status: moduleStatus,
      statusLabel: MODULE_STATUS_LABELS_TEXT[moduleStatus] || moduleStatus,
      riskLevel: moduleRisk,
      importantDecisionCount: moduleDecisionViews.filter((d) => d.isImportant).length,
      highestEvidenceLevel: maxLevel,
      highestEvidenceLevelLabel: levelToString(maxLevel),
      relatedSessionCount: moduleAgentSessions.length,
      relatedArtifactCount: moduleArtifacts.length,
      openDebtCount: moduleDebts.filter((d) => d.status !== "mastered" && d.status !== "ignored").length,
      highRiskDebtCount: highRiskDebts.length,
      missingEvidenceTypes: missingTypes,
      ownershipGapType: ownershipGap,
      latestActivityAt: timestamps.length > 0 ? timestamps.sort().reverse()[0] : undefined,
    };
  });

  const summary = calculateProjectSummary({
    projectId,
    decisionViews,
    moduleViews,
  });

  return { project: projectData.project, summary, modules: moduleViews, decisions: decisionViews };
}

const MODULE_STATUS_LABELS_TEXT = {
  high_risk_unowned: "高风险无人负责",
  needs_initial_understanding: "缺少初步理解",
  needs_error_boundary_validation: "缺少错误与边界验证",
  needs_transfer_validation: "缺少迁移验证",
  needs_real_work_validation: "缺少独立修改证据",
  owned: "已具备人类所有权",
};

// 兼容早期项目所有权数据：/api/projects 会同时返回关系型 Project Memory
// 和旧版 ownership-store 项目。旧项目没有 pm_* 行时，不能让 Project Memory
// 页面把它当成“项目不存在”而报错；将旧记录转换成只读的统一视图，保证演示
// 链路中的项目、会话、产出物和决策仍然可回看。此适配器只读，不改变旧数据。
function legacyProjectMemoryView(projectId, userId) {
  const project = ownershipStore.getProject(projectId, userId);
  if (!project) return null;
  const data = ownershipStore.getProjectData(projectId);
  const legacyLabel = value => String(value || "").replace(/\bcode\s*x\b/gi, "code T");
  const workItems = (data.workItems || []).filter(item => item.projectId === projectId).map(item => ({
    id: item.id, projectId, userId, title: legacyLabel(item.title),
    summary: legacyLabel(item.description || item.title), type: item.moduleType || "feature",
    status: "implemented", source: "legacy_ownership", confidence: 1,
    createdAt: item.createdAt, updatedAt: item.updatedAt || item.createdAt
  }));
  const sessions = (data.agentSessions || []).filter(item => item.projectId === projectId).map(item => ({
    id: item.id, projectId, userId, workItemId: item.workItemId || undefined, platform: item.source || "agent", title: legacyLabel(item.title),
    rawTitle: legacyLabel(item.title), implementationSummary: legacyLabel(item.implementationSummary || ""),
    outcomeSummary: "已归档的演示会话", processingStatus: "completed",
    createdAt: item.importedAt || item.createdAt, updatedAt: item.importedAt || item.createdAt,
    startedAt: item.importedAt || item.createdAt, endedAt: item.importedAt || item.createdAt,
    analysis: { cognitiveDebtCandidates: [] }
  }));
  const artifacts = (data.artifacts || []).filter(item => item.projectId === projectId).map(item => ({
    id: item.id, projectId, userId, type: item.artifactType === "code_modification" ? "file" : (item.artifactType || "other"),
    name: legacyLabel(item.path || item.functionName || item.commitSha || item.id),
    repositoryRelativePath: item.path, symbolName: item.functionName,
    gitCommitHash: item.commitSha, diffSummary: item.diffSummary || "",
    language: "TypeScript", sensitivity: "metadata_only",
    createdAt: item.createdAt, updatedAt: item.updatedAt || item.createdAt
  }));
  const decisions = (data.decisionRecords || []).filter(item => item.projectId === projectId).map(item => ({
    id: item.id, projectId, userId, workItemId: item.workItemId || null, sessionId: item.sessionId || null,
    title: legacyLabel(item.title), decision: legacyLabel(item.decision || ""), rationale: legacyLabel(item.rationale || ""),
    decisionType: item.decisionType || "other", decisionMaker: item.decisionMaker || "agent",
    userParticipation: item.userParticipation || "accepted", importance: item.importance || "medium",
    createdAt: item.createdAt, updatedAt: item.updatedAt || item.createdAt
  }));
  const projectView = { ...project, userId, projectType: "software", status: "active" };
  const timeline = [...sessions.map(item => ({ id: item.id, occurredAt: item.createdAt, type: "session", label: item.title, referenceId: item.id })),
    ...workItems.map(item => ({ id: item.id, occurredAt: item.createdAt, type: "work_item", label: item.title, referenceId: item.id })),
    ...artifacts.map(item => ({ id: item.id, occurredAt: item.createdAt, type: "artifact", label: item.name, referenceId: item.id })),
    ...decisions.map(item => ({ id: item.id, occurredAt: item.createdAt, type: "decision", label: item.title, referenceId: item.id }))]
    .sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")));
  const byWorkItem = id => ({
    workItem: workItems.find(item => item.id === id),
    sessions: sessions.filter(item => item.workItemId === id || data.agentSessions?.some(s => s.id === item.id && s.workItemId === id)),
    artifacts: artifacts.filter(item => data.artifacts?.some(a => a.id === item.id && a.workItemId === id)),
    decisions: decisions.filter(item => item.workItemId === id),
    debtLinks: []
  });
  return {
    project: projectView, workItems, sessions, artifacts, decisions,
    ownership: { artifacts: [], workItems: [], debts: [], summary: { owned: 0, explainable: 0, transferable: 0, unverified: 0 } },
    counts: { sessions: sessions.length, workItems: workItems.length, artifacts: artifacts.length, decisions: decisions.length, debts: 0, owned: 0 },
    timeline, byWorkItem, raw: data
  };
}

// Project Memory 项目也要能打开旧版“项目所有权”入口。两套存储并存期间，
// 这里把关系型记忆转换成所有权页面所需的只读摘要，避免同一项目 ID 在不同
// 入口被判定为不存在。示范数据仍由 Web 层负责，不写入数据库。
function projectMemoryOwnershipView(projectId, userId) {
  const memory = projectMemoryStore.memory(projectId, userId, trainingStore.listCognitiveDebts(userId));
  const decisions = memory.decisions || [];
  const decisionViews = decisions.map((decision) => {
    const evidenceLevel = Number.isFinite(Number(decision.evidenceLevel)) ? Number(decision.evidenceLevel) : EVIDENCE_LEVEL.E0;
    const linkedDebts = [];
    return {
      decisionId: decision.id,
      workItemId: decision.workItemId,
      title: decision.title,
      importance: decision.importance || "medium",
      decisionMaker: decision.decisionMaker || "agent",
      isImportant: isImportantAIDecision(decision),
      status: calculateDecisionOwnershipStatus({ decision, evidenceLevel, linkedDebts }) || DECISION_OWNERSHIP_STATUS.unverified,
      evidenceLevel,
      evidenceLevelLabel: levelToString(evidenceLevel)
    };
  });
  const moduleViews = (memory.workItems || []).map((workItem) => {
    const moduleDecisions = decisionViews.filter((decision) => decision.workItemId === workItem.id);
    const moduleSessions = (memory.sessions || []).filter((session) => session.workItemId === workItem.id);
    const moduleArtifacts = (memory.artifacts || []).filter((artifact) => artifact.workItemId === workItem.id);
    const highestEvidenceLevel = moduleDecisions.reduce((max, decision) => Math.max(max, decision.evidenceLevel), EVIDENCE_LEVEL.E0);
    const status = aggregateModuleStatus(moduleDecisions);
    return {
      workItemId: workItem.id,
      title: workItem.title,
      status,
      statusLabel: MODULE_STATUS_LABELS_TEXT[status] || status,
      riskLevel: calculateModuleRiskLevel(moduleDecisions, []),
      importantDecisionCount: moduleDecisions.filter((decision) => decision.isImportant).length,
      highestEvidenceLevel,
      highestEvidenceLevelLabel: levelToString(highestEvidenceLevel),
      relatedSessionCount: moduleSessions.length,
      relatedArtifactCount: moduleArtifacts.length,
      openDebtCount: 0,
      highRiskDebtCount: 0,
      missingEvidenceTypes: determineMissingEvidenceTypes(highestEvidenceLevel),
      ownershipGapType: ownershipGapFromModuleStatus(status),
      latestActivityAt: workItem.updatedAt || workItem.createdAt
    };
  });
  return {
    project: memory.project,
    summary: calculateProjectSummary({ projectId, decisionViews, moduleViews }),
    modules: moduleViews,
    decisions: decisionViews
  };
}

function detectArtifactType(text) {
  const lower = text.toLowerCase();
  if (/chatgpt|gpt-4|gpt-3\.5|gpt-3\b/i.test(text)) return "chatgpt";
  if (lower.includes("user:") && lower.includes("assistant:")) return "chatgpt";
  if (lower.includes("你是一个") && lower.includes("请")) return "chatgpt";
  if (/claude|anthropic/i.test(text)) return "claude";
  if (lower.includes("human:") && lower.includes("assistant:")) return "claude";
  if (/cursor|cursor\s+ide|cursor\s+chat/i.test(text)) return "cursor";
  if (lower.includes("@@codebase") || lower.includes("cmd+k") || lower.includes("ctrl+k")) return "cursor";
  if (/codex|copilot|git\s+commit|diff\s+--git|patch/i.test(text)) return "codex";
  if (lower.includes("function ") && lower.includes("import ") && lower.includes("const ")) return "codex";
  if (/```[\s\S]*```/.test(text) && /function|class|const|import/.test(text)) return "codex";
  if (/hackathon|黑客松|demo\s+day|pitch|项目展示|路演/i.test(text)) return "hackathon";
  if (lower.includes("评委") && lower.includes("项目")) return "hackathon";
  if (/会议纪要|meeting\s+notes|action\s+items|参会人|主持人|议程/i.test(text)) return "meeting";
  if (lower.includes("会议") && (lower.includes("讨论") || lower.includes("决定"))) return "meeting";
  if (/^#|markdown|博客|blog|文章|essay/i.test(text.trim())) return "article";
  if (lower.includes("摘要") && lower.includes("关键词")) return "article";
  return "other";
}

function fit(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textArray(value, maxItems = 3, maxLength = 90) {
  if (!Array.isArray(value)) return [];
  return value.map(item => clean(item).slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

function parseJsonObject(text) {
  const stripped = String(text || "{}").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error("Model did not return a JSON object");
  }
}

const validAssessments = new Set(["correct", "partial", "incorrect", "unknown"]);

function normalizeAssessment(value, fallback = "unknown") {
  const assessment = clean(value).toLowerCase();
  return validAssessments.has(assessment) ? assessment : fallback;
}

function baseTutorResult(kind, card, transcript) {
  const front = clean(card.front || "this concept");
  const back = clean(card.back || "the core idea");

  if (kind === "repeat") {
    return {
      assessment: "unknown",
      message: `再听一遍：${front}。先说核心意思，再补一个例子。`,
      missingPoints: [],
      nextQuestion: `用自己的话解释 ${front}，不要照读。`,
      summary: "",
      g2Text: `Explain ${fit(front, 24)}`,
      shouldFollowUp: true
    };
  }

  if (kind === "known") {
    return {
      assessment: "correct",
      message: "已标记会了。下一次复习时优先检查你能否举例。",
      missingPoints: [],
      nextQuestion: "",
      summary: `${front}: ${back}`,
      g2Text: "Marked known",
      shouldFollowUp: false
    };
  }

  if (kind === "answer") {
    if (!transcript) {
      return {
        assessment: "incorrect",
        message: "还没有收到你的解释。先用一句自己的话说核心意思。",
        missingPoints: ["需要主动解释核心含义"],
        nextQuestion: `如果讲给朋友听，${front} 是什么意思？`,
        summary: "",
        g2Text: "Try explaining",
        shouldFollowUp: true
      };
    }

    return {
      assessment: transcript.length > 24 ? "partial" : "partial",
      message: `收到你的回答：“${fit(transcript, 36)}”。方向可以，下一步要把概念和具体情境连起来。`,
      missingPoints: ["补一个真实例子或应用场景"],
      nextQuestion: `请举一个生活或工作里的 ${front} 例子。`,
      summary: "",
      g2Text: "Add one example",
      shouldFollowUp: true
    };
  }

  return {
    assessment: "unknown",
    message: `小测：${front} 的核心意思是什么？`,
    missingPoints: [],
    nextQuestion: `请用简单语言解释 ${front}。`,
    summary: "",
    g2Text: `Explain ${fit(front, 24)}`,
    shouldFollowUp: true
  };
}

function normalizeTutorResult(input, context) {
  const base = baseTutorResult(context.kind, context.card, context.transcript);
  const assessment = normalizeAssessment(input.assessment, base.assessment);
  const missingPoints = Array.isArray(input.missingPoints)
    ? textArray(input.missingPoints)
    : base.missingPoints;
  let nextQuestion = clean(
    typeof input.nextQuestion === "string"
      ? input.nextQuestion
      : typeof input.followUpQuestion === "string"
        ? input.followUpQuestion
        : base.nextQuestion
  ).slice(0, 180);
  const summary = clean(input.summary || base.summary).slice(0, 220);
  const shouldFollowUp = typeof input.shouldFollowUp === "boolean"
    ? input.shouldFollowUp
    : Boolean(nextQuestion) && context.kind !== "known";
  if (!shouldFollowUp) nextQuestion = "";

  return {
    ok: true,
    action: context.kind,
    assessment,
    message: clean(input.message || input.feedback || base.message).slice(0, 360),
    missingPoints,
    nextQuestion,
    summary,
    g2Text: fit(input.g2Text || base.g2Text || nextQuestion || summary, 42),
    shouldFollowUp
  };
}

function fallbackCards(text, maxCards = 40) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.slice(0, maxCards).map(line => {
    const csv = line.split(",").map(part => part.trim()).filter(Boolean);
    const splitPair = line.split(/\s+[-:：]\s+|\s{2,}/).map(part => part.trim()).filter(Boolean);
    const whitespacePair = line.split(/\s+/).map(part => part.trim()).filter(Boolean);
    const pair = csv.length >= 2 ? csv : splitPair.length >= 2 ? splitPair : whitespacePair;
    const front = clean(pair[0] || line).slice(0, 64);
    const back = clean(pair.slice(1).join(" ") || "用自己的话解释。").slice(0, 120);
    return {
      id: crypto.randomUUID(),
      front,
      back,
      prompt: `跟读：${front}。然后用自己的话解释。`,
      tags: ["ai-import"],
      due: Date.now(),
      repetitions: 0
    };
  });
}

function fallbackPlan(subject, level, maxUnits = 8) {
  const cleanSubject = clean(subject || "the subject");
  const units = [
    ["Big Picture", `What ${cleanSubject} studies, why it matters, and where it appears in daily life.`],
    ["Core Concepts", `The most important terms and distinctions a modern citizen should know.`],
    ["Mental Model", `A simple framework for organizing the subject and noticing relationships.`],
    ["Examples", `Concrete examples that make the abstract ideas easier to recall.`],
    ["Misconceptions", `Common misunderstandings and how to avoid them.`],
    ["Application", `How to use the ideas to analyze a small real-world situation.`],
    ["Review", `A compact synthesis of the main points and open questions.`]
  ].slice(0, maxUnits);

  return units.map(([title, body], index) => ({
    id: crypto.randomUUID(),
    front: `${index + 1}. ${title}`,
    back: body,
    prompt: `Feynman question: explain ${title.toLowerCase()} in your own words for ${cleanSubject}.`,
    tags: ["unit", cleanSubject, clean(level || "unknown")].slice(0, 4),
    due: Date.now(),
    repetitions: 0
  }));
}

async function chatJson(messages, fallback, maxTokens = 4096) {
  if (!aiApiKey || disableAi) {
    return {
      ...fallback(),
      __fallback: true,
      __fallbackError: disableAi ? "SPIRAL_DISABLE_AI=1" : "AI_API_KEY is not set"
    };
  }
  return traceSpan("ai.chat_completion", { provider: aiProvider, model: chatModel, maxTokens }, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), openAiChatTimeoutMs);
    let response;
    try {
      response = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${aiApiKey}`,
        "content-type": "application/json",
        "accept": "application/json"
      },
      body: JSON.stringify({
        model: chatModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        ...(aiProvider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
        max_tokens: maxTokens,
        messages
      }),
      signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
      error.code = `AI_HTTP_${response.status}`;
      throw error;
    }
    const content = payload.choices?.[0]?.message?.content || "{}";
    return parseJsonObject(content);
  });
}

function classifyRepaymentError(error) {
  if (error?.errorCategory) return error.errorCategory;
  const message = String(error?.message || "");
  if (error?.name === "AbortError" || /abort|timeout|timed out/i.test(message)) return "timeout";
  if (/429/.test(message)) return "rate_limited";
  if (/http\s*\d|openai http/i.test(message)) return "http";
  if (/json|parse/i.test(message)) return "parse";
  return "unknown";
}

// ── 认知欠条智能分类（Phase 1）：异步触发，绝不阻塞主流程 ──

function buildDebtReportContext(debt, reportId) {
  const rid = reportId || debt.reportId
    || (Array.isArray(debt.sourceReports) ? debt.sourceReports[debt.sourceReports.length - 1] : null);
  if (!rid) return null;
  try {
    const report = mvp0Store.getReport(rid, debt.userId);
    if (!report) return null;
    const gaps = Array.isArray(report.sections?.dangerousGaps) ? report.sections.dangerousGaps : [];
    const gapText = clean(debt.gapText || "").toLowerCase();
    const gap = gaps.find(item => clean(item?.gap || "").toLowerCase() === gapText) || gaps[0] || null;
    const cards = Array.isArray(report.sections?.feynmanCards) ? report.sections.feynmanCards : [];
    const card = cards.find(item => item?.id && item.id === debt.cardId) || null;
    return {
      artifactType: clean(report.input?.artifactType || report.analysis?.artifactKind || ""),
      reportGap: gap ? {
        title: clean(gap.title || "").slice(0, 200),
        gap: clean(gap.gap || "").slice(0, 500),
        underlyingCapability: clean(gap.underlyingCapability || "").slice(0, 200),
        evidence: clean(gap.evidence || "").slice(0, 500)
      } : null,
      reportCard: card ? {
        target: clean(card.target || "").slice(0, 200),
        prompt: clean(card.prompt || "").slice(0, 300)
      } : null
    };
  } catch {
    return null;
  }
}

function scheduleDebtIntelligence(debt, { reportId, trigger = "auto" } = {}) {
  if (debtIntelligenceDisabled || !debt?.id) return;
  setImmediate(() => {
    (async () => {
      if (!aiApiKey || disableAi) {
        const now = new Date().toISOString();
        await debtIntelligenceStore.saveAnalysisRun({
          id: crypto.randomUUID(),
          cognitiveDebtId: debt.id,
          userId: debt.userId || "demo-user",
          trigger,
          status: "skipped",
          attemptCount: 0,
          errorMessage: disableAi ? "SPIRAL_DISABLE_AI=1" : "AI_API_KEY is not set",
          startedAt: now,
          finishedAt: now
        });
        return;
      }
      const result = await classifyAndSave({
        store: debtIntelligenceStore,
        debt,
        reportContext: buildDebtReportContext(debt, reportId),
        chatFn: chatJson,
        modelName: chatModel,
        trigger
      });
      if (!result.ok && !result.skipped) {
        console.warn(`Debt intelligence classification failed for ${debt.id}: ${result.error}`);
      }
      if (result.ok && !result.skipped) {
        await scheduleDebtRelationDetection(debt);
      }
    })().catch(error => {
      console.warn(`Debt intelligence task failed for ${debt.id}: ${error.message}`);
    });
  });
}

// 分类成功后：同步概念节点 → 对该欠条做增量关系识别（幂等）。
// 识别失败只记录日志与 analysisRun，绝不影响欠条主流程。
async function scheduleDebtRelationDetection(debt) {
  try {
    const analysis = debtIntelligenceStore.getCurrentAnalysis(debt.id);
    if (analysis) {
      await syncConceptsFromAnalysis({ graphStore: conceptGraphStore, analysis });
    }
    await detectRelations({
      graphStore: conceptGraphStore,
      intelligenceStore: debtIntelligenceStore,
      trainingStore,
      userId: debt.userId || "demo-user",
      focusDebtId: debt.id,
      chatFn: chatJson
    });
  } catch (error) {
    console.warn(`Debt relation detection failed for ${debt.id}: ${error.message}`);
  }
}

// 簇响应载荷：成员欠条摘要 + 从成员画像派生的掌握度汇总（不存独立六维）。
function buildClusterDetailPayload(cluster, userId) {
  const members = conceptGraphStore.listDebtClusterMembers({ clusterId: cluster.id });
  const debtsById = new Map();
  const profilesByDebtId = new Map();
  const memberItems = [];
  for (const member of members) {
    let debt = null;
    try {
      debt = trainingStore.getCognitiveDebt(member.cognitiveDebtId, userId);
    } catch {
      continue;
    }
    debtsById.set(debt.id, debt);
    const profile = trainingStore.getMasteryProfile(debt.id);
    if (profile) profilesByDebtId.set(debt.id, profile);
    memberItems.push({
      cognitiveDebtId: debt.id,
      gapText: debt.gapText,
      status: debt.status,
      recurrenceCount: debt.recurrenceCount,
      membershipConfidence: member.membershipConfidence
    });
  }
  const masterySummary = deriveClusterMasterySummary({
    memberDebtIds: [...debtsById.keys()],
    debtsById,
    profilesByDebtId
  });
  return { ...cluster, members: memberItems, masterySummary };
}

async function analyzeClearanceAnswer(input) {
  try {
    const result = await chatJson([
      { role: "system", content: getClearanceAnalysisPrompt() },
      { role: "user", content: JSON.stringify(input) }
    ], () => createDemoAnswerFallback(input));
    return ensureLearnerFacingLanguage(result, input);
  } catch (error) {
    if (!mvp1DemoFallback) throw error;
    return ensureLearnerFacingLanguage(createDemoAnswerFallback(input), input);
  }
}

async function researchClearanceContext(request) {
  try {
    // With SPIRAL_DISABLE_AI=1 chatJson only returns an empty-scaffold
    // fallback, so running live rawWebResearch would filter every source
    // out and fail session creation with "no cited sources". Treat the
    // research chain as unavailable and degrade transparently instead.
    if (disableAi) {
      throw new Error("Live research is disabled (SPIRAL_DISABLE_AI=1)");
    }
    const openAiResearchConfigured = researchProvider === "openai" && researchApiKey && researchBaseUrl;
    if (!openAiResearchConfigured && researchProvider !== "public_web") {
      throw new Error(`Live web research is not configured for provider: ${researchProvider}`);
    }
    const evidence = await rawWebResearch(request);
    const structured = await chatJson([
      { role: "system", content: getResearchStructuringPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          request,
          researchText: evidence.researchText,
          sources: evidence.sources
        })
      }
    ], () => ({ rewrittenQuestion: request.originalQuestion, summary: "", scaffold: [] }));
    const referencedSourceIds = new Set(
      (structured.scaffold || []).flatMap(point => Array.isArray(point.sourceIds) ? point.sourceIds : [])
    );
    return {
      ...structured,
      researchMode: "live_ai",
      sources: evidence.sources.filter(source => referencedSourceIds.has(source.id))
    };
  } catch (error) {
    if (!mvp1DemoFallback) throw error;
    return createDemoResearchFallback(request, error);
  }
}

// MVP-0 bounded research adapter: wraps raw web research into the
// (query) => { sources: [{title,url,snippet}] } shape expected by the
// multi-step report pipeline. Returns null when research is not configured,
// which makes the pipeline mark research as "skipped" transparently.
const researchConfigured = researchProvider === "public_web"
  || (researchProvider === "openai" && researchApiKey && researchBaseUrl);
const mvp0ResearchFn = researchConfigured
  ? async query => {
      const evidence = await rawWebResearch({
        originalQuestion: query,
        purpose: "MVP-0 diagnostic report bounded research"
      });
      return {
        sources: (evidence.sources || []).map(source => ({
          title: source.title || "",
          url: source.url || "",
          snippet: clean(source.claim || evidence.researchText || "").slice(0, 300)
        }))
      };
    }
  : null;

function confusionsFromTimeline(timeline) {
  const steps = Array.isArray(timeline?.steps) ? timeline.steps : [];
  return steps
    .filter(step => clean(step?.userConfusion || ""))
    .map(step => ({
      stepId: clean(step.id || ""),
      stepTitle: clean(step.title || ""),
      text: clean(step.userConfusion || "")
    }));
}

async function checkAiConnectivity() {
  if (!aiApiKey || disableAi) {
    return {
      reachable: false,
      error: disableAi ? "SPIRAL_DISABLE_AI=1" : "AI_API_KEY is not set"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${aiBaseUrl}/models`, {
      headers: {
        "authorization": `Bearer ${aiApiKey}`,
        "accept": "application/json"
      },
      signal: controller.signal
    });
    return {
      reachable: response.ok,
      status: response.status,
      error: response.ok ? "" : fit(await response.text(), 180)
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackKnowledgeExtraction(text) {
  const normalized = clean(text);
  const candidates = [
    {
      pattern: /audio|microphone|mic|pcm|语音|音频/i,
      concept: "G2 音频流生命周期",
      explanation: "音频采集、缓冲、上传和转写是四个独立状态，任何一层停止都会中断语音闭环。",
      question: "为什么 G2 已开启麦克风，转写仍可能没有结果？"
    },
    {
      pattern: /state|webview|localstorage|状态|持久化/i,
      concept: "WebView 状态恢复",
      explanation: "运行时状态会随 WebView 回收而丢失，关键学习进度必须写入持久化存储并在启动时恢复。",
      question: "应用被系统回收后，哪些学习状态必须重新恢复？"
    },
    {
      pattern: /cors|whitelist|sdk|api|bridge|container|白名单|插件/i,
      concept: "Even Hub 网络白名单与 CORS",
      explanation: "白名单决定插件能否发出请求，CORS 决定 WebView 是否能读取服务端响应，两者缺一不可。",
      question: "为什么接口在 curl 中可用，在 G2 插件里仍可能失败？"
    },
    {
      pattern: /test|bug|error|失败|故障|修复/i,
      concept: "从故障建立回归测试",
      explanation: "修复只有被转化为可重复的输入、预期结果和失败条件，才不会在后续版本中悄悄复发。",
      question: "怎样把一次真机故障转化成可自动执行的回归测试？"
    }
  ];
  const selected = normalized.length < 80
    ? []
    : candidates.filter(candidate => candidate.pattern.test(normalized)).slice(0, 3);

  return {
    summary: fit(normalized, 220),
    atoms: selected.map((candidate, index) => ({
      concept: candidate.concept,
      plain_explanation: candidate.explanation,
      personal_context: fit(normalized, 180),
      example: fit(normalized, 180),
      common_mistake: `只检查 ${candidate.concept} 的单一环节。`,
      recall_question: candidate.question,
      answer: candidate.explanation,
      ai_task: "AI assisted with diagnosis and implementation.",
      skill_gap: candidate.concept,
      micro_exercise: `不使用 AI，用 30 秒回答：${candidate.question}`,
      card_type: index === 2 ? "exercise" : "recall",
      confidence: 0.62,
      debt_score: Math.min(80, 55 + index * 8)
    }))
  };
}

function computedDebtScore(atom) {
  if (atom.debt_score !== undefined || atom.debtScore !== undefined) {
    return Math.max(0, Math.min(100, Number(atom.debt_score ?? atom.debtScore)));
  }
  const delegation = Number(atom.ai_delegation ?? atom.aiDelegation ?? 50);
  const frequency = Number(atom.repetition_frequency ?? atom.repetitionFrequency ?? 50);
  const relevance = Number(atom.project_relevance ?? atom.projectRelevance ?? 50);
  const risk = Number(atom.error_risk ?? atom.errorRisk ?? 50);
  const mastery = Number(atom.mastery_evidence ?? atom.masteryEvidence ?? 0);
  return Math.max(0, Math.min(100, Math.round(
    delegation * 0.35
    + frequency * 0.2
    + relevance * 0.2
    + risk * 0.15
    - mastery * 0.1
  )));
}

function normalizeKnowledgeExtraction(input, text) {
  const fallback = fallbackKnowledgeExtraction(text);
  const rawAtoms = Array.isArray(input.atoms) ? input.atoms : fallback.atoms;
  return {
    summary: clean(input.summary || fallback.summary).slice(0, 300),
    atoms: rawAtoms.slice(0, 3).map(atom => {
      const explanation = clean(atom.plain_explanation || atom.plainExplanation).slice(0, 220);
      return {
        concept: clean(atom.concept).slice(0, 100),
        plain_explanation: explanation,
        personal_context: clean(atom.personal_context || atom.personalContext).slice(0, 220),
        example: clean(atom.example).slice(0, 220),
        common_mistake: clean(atom.common_mistake || atom.commonMistake).slice(0, 180),
        recall_question: clean(atom.recall_question || atom.recallQuestion).slice(0, 120),
        answer: clean(atom.answer || explanation).slice(0, 220),
        ai_task: clean(atom.ai_task || atom.aiTask).slice(0, 180),
        skill_gap: clean(atom.skill_gap || atom.skillGap || atom.concept).slice(0, 120),
        micro_exercise: clean(atom.micro_exercise || atom.microExercise).slice(0, 180),
        card_type: clean(atom.card_type || atom.cardType || "recall").slice(0, 30),
        confidence: Math.max(0, Math.min(1, Number(atom.confidence ?? 0.7))),
        debt_score: computedDebtScore(atom)
      };
    }).filter(atom => atom.concept && atom.recall_question && atom.answer)
  };
}

async function extractKnowledgeAtoms(text, context = {}) {
  const fallback = () => fallbackKnowledgeExtraction(text);
  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "You are the Spiral cognitive compiler. Compute learning increment, not a session summary.",
          "Answer internally: the original goal, the exposed knowledge gap, reusable knowledge, personal project context, and a question that verifies understanding.",
          "Identify the cognitive task delegated to AI and the capability the user may not yet reproduce without AI.",
          "Create zero to three knowledge atoms. Return zero when there is no genuinely reusable new knowledge.",
          "Each atom covers one concept, uses the user's project context, tests application rather than definition, and never copies a long source passage.",
          "Score cognitive debt from 0 to 100 using AI delegation, repetition, project relevance, error risk, and evidence of mastery. Do not treat every AI action as debt.",
          "Choose card_type concept|recall|exercise|reflection and provide one concrete no-AI micro exercise.",
          "Return JSON only:",
          "{\"summary\":\"\",\"atoms\":[{\"concept\":\"\",\"plain_explanation\":\"\",\"personal_context\":\"\",\"example\":\"\",\"common_mistake\":\"\",\"recall_question\":\"\",\"answer\":\"\",\"ai_task\":\"\",\"skill_gap\":\"\",\"micro_exercise\":\"\",\"card_type\":\"concept|recall|exercise|reflection\",\"confidence\":0.0,\"debt_score\":0}]}.",
          "recall_question max 120 chars; answer max 220; personal_context max 220. Prefer Chinese when the source is Chinese."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          source: context.source || "manual",
          projectId: context.projectId || "general",
          interaction: String(text).slice(0, 30000)
        })
      }
    ], fallback);
    return {
      ...normalizeKnowledgeExtraction(result, text),
      ...(result.__fallback
        ? { fallback: true, error: result.__fallbackError || "AI unavailable" }
        : {})
    };
  } catch (error) {
    return { ...fallback(), fallback: true, error: error.message };
  }
}

async function extractCapabilityCandidate(text, context = {}) {
  const fallback = () => {
    const extraction = fallbackKnowledgeExtraction(text);
    const atom = extraction.atoms[0];
    if (!atom) return { summary: extraction.summary, candidate: null };
    return {
      summary: extraction.summary,
      candidate: {
        ...atom,
        gate_evidence: {
          ai_judgment: atom.ai_task,
          missing_explain_or_verify: "The practice contains no independent explanation or completeness check from the user.",
          project_impact: `The judgment affects the project outcome through ${atom.skill_gap}.`,
          transfer_value: `${atom.concept} is reusable in similar AI-assisted work.`,
          not_low_value: "This is a reusable principle or verification boundary, not a mechanical edit."
        }
      }
    };
  };
  const result = await chatJson([
    {
      role: "system",
      content: [
        learningCoachSystemPrompt,
        "You analyze one captured AI-assisted practice event before any learning card is created.",
        "Return zero or one candidate capability gap. Do not create cards.",
        "A candidate is allowed only when all five conditions are supported by the event:",
        "1 AI materially performed or influenced a key judgment;",
        "2 the user did not demonstrate the ability to explain or verify that judgment;",
        "3 the judgment affects outcome, risk, or technical direction;",
        "4 the principle transfers to future AI-assisted practice;",
        "5 it is not a one-off mechanical implementation detail.",
        "Prefer gaps that help the user explain a failure or verify whether an AI fix is complete.",
        "If any condition lacks evidence, return candidate:null.",
        "Return JSON only:",
        "{\"summary\":\"\",\"candidate\":{\"concept\":\"\",\"plain_explanation\":\"\",\"answer\":\"\",\"recall_question\":\"\",\"ai_task\":\"\",\"skill_gap\":\"\",\"micro_exercise\":\"\",\"confidence\":0.0,\"debt_score\":0,\"gate_evidence\":{\"ai_judgment\":\"\",\"missing_explain_or_verify\":\"\",\"project_impact\":\"\",\"transfer_value\":\"\",\"not_low_value\":\"\"}}}.",
        "Keep every field concise and grounded in the captured event. Prefer Chinese when the event is Chinese."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        source: context.source || "codex",
        projectId: context.projectId || "general",
        practiceEvent: String(text).slice(0, 30000)
      })
    }
  ], fallback);
  const candidate = result.candidate;
  const gate = candidate?.gate_evidence || candidate?.gateEvidence || {};
  const normalizedCandidate = candidate ? {
    concept: clean(candidate.concept).slice(0, 100),
    plain_explanation: clean(candidate.plain_explanation || candidate.plainExplanation).slice(0, 500),
    answer: clean(candidate.answer || candidate.plain_explanation || candidate.plainExplanation).slice(0, 500),
    recall_question: clean(candidate.recall_question || candidate.recallQuestion).slice(0, 240),
    ai_task: clean(candidate.ai_task || candidate.aiTask).slice(0, 240),
    skill_gap: clean(candidate.skill_gap || candidate.skillGap || candidate.concept).slice(0, 160),
    micro_exercise: clean(candidate.micro_exercise || candidate.microExercise).slice(0, 240),
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.7))),
    debt_score: computedDebtScore(candidate),
    gate_evidence: {
      aiJudgment: clean(gate.ai_judgment || gate.aiJudgment).slice(0, 300),
      missingExplainOrVerify: clean(gate.missing_explain_or_verify || gate.missingExplainOrVerify).slice(0, 300),
      projectImpact: clean(gate.project_impact || gate.projectImpact).slice(0, 300),
      transferValue: clean(gate.transfer_value || gate.transferValue).slice(0, 300),
      notLowValue: clean(gate.not_low_value || gate.notLowValue).slice(0, 300)
    }
  } : null;
  const hasAllEvidence = normalizedCandidate
    && normalizedCandidate.concept
    && normalizedCandidate.recall_question
    && Object.values(normalizedCandidate.gate_evidence).every(Boolean);
  return {
    summary: clean(result.summary || fallback().summary).slice(0, 300),
    candidate: hasAllEvidence ? normalizedCandidate : null,
    ...(result.__fallback
      ? { fallback: true, error: result.__fallbackError || "AI unavailable" }
      : {})
  };
}

async function ingestSpiralEvent(payload) {
  const rawText = String(payload.rawText || payload.text || "").trim();
  if (!rawText) return { ok: false, error: "Missing rawText" };
  const source = clean(payload.source || "manual");
  const projectId = clean(payload.projectId || "general");
  const event = await spiralStore.createEvent({
    id: payload.event_id || payload.id,
    sessionId: payload.session_id,
    turnId: payload.turn_id,
    source,
    eventType: payload.event_type || payload.eventType || payload.sourceType || "Stop",
    projectId,
    title: payload.title,
    rawText,
    retainRaw: payload.retainRaw !== false,
    privacyTags: payload.privacyTags
  });
  return {
    ok: true,
    event,
    status: "captured",
    atoms: [],
    debts: [],
    cards: [],
    today: spiralStore.dashboard()
  };
}

function researchStubFor(atom) {
  const networkTopic = /cors|whitelist|network|webview|api|白名单|网络/i.test(
    `${atom.concept} ${atom.plain_explanation} ${atom.personal_context}`
  );
  if (networkTopic) {
    return {
      mode: "stub",
      label: "Curated research stub for the vertical slice",
      facts: [
        {
          text: "CORS controls whether browser or WebView code may read a cross-origin response.",
          source: "MDN Web Docs: Cross-Origin Resource Sharing"
        },
        {
          text: "An application network allowlist and CORS act at different boundaries; satisfying one does not prove device-to-service reachability.",
          source: "Learn Coach G2 verified project evidence"
        }
      ],
      findings: [
        {
          text: "A complete diagnosis separates request permission, network reachability, server response, and glasses rendering.",
          kind: "inference"
        }
      ],
      verification: "Verify the WebView request, server permission, device reachability, response body, and final glasses rendering separately."
    };
  }
  return {
    mode: "stub",
    label: "Curated research stub for the vertical slice",
    facts: [
      {
        text: atom.plain_explanation,
        source: "Captured Learn Coach practice evidence"
      }
    ],
    findings: [
      {
        text: `Understanding ${atom.concept} should improve explanation and verification of the AI-assisted decision.`,
        kind: "inference"
      }
    ],
    verification: `State the expected result and the observable evidence that would prove ${atom.concept} was handled completely.`
  };
}

async function runManualCheckpoint(payload) {
  const pending = spiralStore.pendingEvents(payload.projectId);
  const event = payload.eventId
    ? pending.find(item => item.id === payload.eventId)
    : pending[0];
  if (!event) {
    return { ok: true, processed: 0, candidates: [], message: "No unprocessed practice evidence." };
  }
  const text = event.analysisText || event.rawText || event.excerpt;
  const extraction = await extractCapabilityCandidate(text, { source: event.source, projectId: event.projectId });
  const atom = extraction.candidate;
  if (!atom) {
    await spiralStore.markCheckpointed(event.id, extraction.summary || "No qualified capability gap.");
    return {
      ok: true,
      processed: 1,
      candidates: [],
      fallback: Boolean(extraction.fallback),
      message: "No practice detail passed the learning-value gate."
    };
  }
  const saved = await spiralStore.saveCandidate({
    eventId: event.id,
    concept: atom.concept,
    summary: extraction.summary,
    explanation: atom.plain_explanation,
    answer: atom.answer,
    recallQuestion: atom.recall_question,
    aiTask: atom.ai_task,
    skillGap: atom.skill_gap,
    microExercise: atom.micro_exercise,
    debtScore: atom.debt_score,
    confidence: atom.confidence,
    gateEvidence: atom.gate_evidence,
    research: researchStubFor(atom),
    researchMode: "stub"
  });
  return {
    ok: true,
    processed: 1,
    candidates: [saved.candidate],
    created: saved.created,
    fallback: Boolean(extraction.fallback)
  };
}

async function importCards(payload) {
  const text = String(payload.text || "").trim();
  const maxCards = Math.max(1, Math.min(80, Number(payload.maxCards || 40)));
  if (!text) return { ok: false, error: "Missing text" };

  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "Convert user learning material into concise Even G2 flashcards.",
          "Return JSON only: {\"cards\":[{\"front\":\"\",\"back\":\"\",\"prompt\":\"\",\"tags\":[\"\"]}]}",
          "Front must be glanceable, usually one word or short phrase. Back is short.",
          "Prompt must be a Feynman-style active recall question that asks the learner to explain, compare, give an example, or apply the idea.",
          "Create one card per genuinely distinct concept. Do not pad the result to the maximum, repeat a concept, or invent details beyond the source.",
          "If the material is code or logs, extract the underlying concept or failure mode. Never copy raw code, stack traces, or long source passages into front."
        ].join(" ")
      },
      {
        role: "user",
        content: `Create at most ${maxCards} cards from this material:\n\n${text}`
      }
    ], () => ({ cards: fallbackCards(text, maxCards) }));
    const cards = Array.isArray(result.cards) ? result.cards.slice(0, maxCards) : fallbackCards(text, maxCards);
    return {
      ok: true,
      cards: cards.map(card => ({
        id: crypto.randomUUID(),
        front: fit(card.front, 36),
        back: clean(card.back).slice(0, 120),
        prompt: clean(card.prompt || `Explain ${card.front}`).slice(0, 120),
        tags: Array.isArray(card.tags) ? card.tags.map(String).slice(0, 4) : ["ai-import"],
        due: Date.now(),
        repetitions: 0
      })).filter(card => card.front),
      ...(result.__fallback
        ? { fallback: true, error: result.__fallbackError || "AI unavailable" }
        : {})
    };
  } catch (error) {
    return { ok: true, cards: fallbackCards(text, maxCards), fallback: true, error: error.message };
  }
}

async function planCourse(payload) {
  const subject = clean(payload.subject);
  const level = clean(payload.level || "zero basis");
  const maxUnits = Math.max(3, Math.min(12, Number(payload.maxUnits || 8)));
  if (!subject) return { ok: false, error: "Missing subject" };

  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "Return JSON only: {\"overview\":\"\",\"cards\":[{\"front\":\"\",\"back\":\"\",\"prompt\":\"\",\"tags\":[\"\"]}]}",
          "Create a sequential course plan. Each card is one teaching unit.",
          "front: short unit title. back: compact explanation with key terms. prompt: 1 Feynman question requiring the learner to answer in their own words.",
          "Keep each card readable on smart glasses."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({ subject, level, maxUnits })
      }
    ], () => ({
      overview: `A ${maxUnits}-unit starter path for ${subject}.`,
      cards: fallbackPlan(subject, level, maxUnits)
    }));

    const cards = Array.isArray(result.cards) ? result.cards.slice(0, maxUnits) : fallbackPlan(subject, level, maxUnits);
    return {
      ok: true,
      overview: clean(result.overview || `Course created for ${subject}.`).slice(0, 160),
      cards: cards.map(card => ({
        id: crypto.randomUUID(),
        front: clean(card.front).slice(0, 64),
        back: clean(card.back).slice(0, 160),
        prompt: clean(card.prompt || "Explain this unit in your own words.").slice(0, 140),
        tags: Array.isArray(card.tags) ? card.tags.map(String).slice(0, 4) : ["unit"],
        due: Date.now(),
        repetitions: 0
      })).filter(card => card.front),
      ...(result.__fallback
        ? { fallback: true, error: result.__fallbackError || "AI unavailable" }
        : {})
    };
  } catch (error) {
    return {
      ok: true,
      overview: `Fallback course created for ${subject}.`,
      cards: fallbackPlan(subject, level, maxUnits),
      fallback: true,
      error: error.message
    };
  }
}

async function tutor(payload) {
  const card = payload.card || {};
  const kind = clean(payload.kind || "ask");
  const transcript = clean(payload.transcript || "");
  const safeKind = ["ask", "repeat", "known", "answer"].includes(kind) ? kind : "ask";
  const context = { kind: safeKind, card, transcript };
  const fallback = () => normalizeTutorResult({}, context);

  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "Return JSON only using this schema:",
          "{\"ok\":true,\"assessment\":\"correct|partial|incorrect|unknown\",\"message\":\"\",\"missingPoints\":[\"\"],\"nextQuestion\":\"\",\"summary\":\"\",\"g2Text\":\"\",\"shouldFollowUp\":true}.",
          "assessment evaluates learnerSaid only when action is answer; otherwise use unknown unless action is known.",
          "message is the learner-facing feedback. First affirm correct parts, then point out missing or confused parts.",
          "missingPoints contains at most 3 short missing ideas. Use [] if nothing is missing.",
          "nextQuestion is one Feynman or Socratic follow-up that makes the learner explain, compare, give an example, or apply the idea.",
          "summary is optional and should be a compact review note when no follow-up is needed.",
          "g2Text must be one short glasses line, max 42 characters, no markdown.",
          "If the answer is wrong or empty, re-explain simply and invite another attempt without criticism."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          action: safeKind,
          card: {
            front: card.front,
            back: card.back,
            prompt: card.prompt
          },
          learnerSaid: transcript,
          progress: payload.progress || {}
        })
      }
    ], fallback);
    return {
      ...normalizeTutorResult(result, context),
      ...(result.__fallback
        ? { fallback: true, error: result.__fallbackError || "AI unavailable" }
        : {})
    };
  } catch (error) {
    return { ...fallback(), fallback: true, error: error.message };
  }
}

function rokidCard(card) {
  if (!card) return null;
  return {
    id: String(card.id),
    knowledgeAtomId: card.knowledgeAtomId,
    projectId: clean(card.projectId || "general").slice(0, 80),
    front: fit(card.front, 28),
    back: clean(card.back).slice(0, 120),
    prompt: clean(card.prompt).slice(0, 140),
    tags: Array.isArray(card.tags) ? card.tags.map(String).slice(0, 4) : [],
    debtScore: Math.max(0, Math.min(100, Number(card.debtScore || 0))),
    mastery: Math.max(0, Math.min(1, Number(card.mastery || 0))),
    due: Number(card.due || Date.now()),
    repetitions: Number(card.repetitions || 0)
  };
}

function clearanceEntryPayload(platform) {
  const report = mvp0Store.listReports().find(item => item.sections?.feynmanCards?.length);
  if (!report) {
    return { ok: true, platform, entry: null };
  }
  const cards = report.sections.feynmanCards;
  const card = cards.find(item => !item.userAnswer) || cards[0];
  const cardIndex = cards.findIndex(item => item.id === card.id);
  return {
    ok: true,
    platform,
    entry: {
      reportId: report.id,
      cardId: card.id,
      nextCardId: cards.length > 1 ? cards[(cardIndex + 1) % cards.length].id : "",
      createdAt: report.createdAt,
      domain: clean(report.analysis?.userCapability?.currentDomain || "认知债务"),
      target: clean(card.target || "理解缺口"),
      prompt: clean(card.prompt || "请用自己的话解释这个问题。"),
      cardNumber: cardIndex + 1,
      cardCount: cards.length
    }
  };
}

function rokidSession(duration, demo = false) {
  const session = spiralStore.buildSession(duration);
  const sourceCards = demo ? rokidDemoCards : session.cards;
  const cards = sourceCards.map(rokidCard);
  return {
    ok: true,
    platform: "rokid-aiui",
    session: {
      ...session,
      cardCount: cards.length,
      estimatedSeconds: Math.min(session.duration, cards.length * 30),
      cards
    },
    display: {
      mode: demo ? "demo" : "live",
      currentCard: cards[0] || null,
      progress: cards.length ? `1 / ${cards.length}` : "0 / 0",
      voiceHint: "直接解释，或说下一题、会了、提问"
    },
    commands: ["next", "previous", "repeat", "ask", "known", "skip", "answer"]
  };
}

async function rokidTutor(payload) {
  const action = clean(payload.action || payload.kind || "answer");
  const result = await tutor({
    ...payload,
    kind: action,
    transcript: payload.transcript || payload.utterance || ""
  });
  return {
    ok: true,
    platform: "rokid-aiui",
    tutor: result,
    display: {
      state: result.shouldFollowUp ? "follow_up" : "complete",
      assessment: result.assessment,
      feedback: fit(result.g2Text || result.message, 72),
      nextQuestion: clean(result.nextQuestion).slice(0, 120)
    }
  };
}

async function rokidReview(payload) {
  const result = await spiralStore.recordReview({
    cardId: payload.cardId,
    result: payload.result,
    responseText: payload.responseText,
    confidence: payload.confidence,
    source: "rokid"
  });
  return {
    ok: true,
    platform: "rokid-aiui",
    review: result.review,
    debt: result.debt,
    next: rokidSession(payload.duration || 60)
  };
}

function wavFromPcm16(base64, sampleRate = 16000) {
  const pcm = Buffer.from(base64 || "", "base64");
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function sttIsConfigured() {
  if (sttProvider === "baidu") return Boolean(baiduApiKey && baiduSecretKey && baiduSttUrl);
  return Boolean(sttApiKey && sttBaseUrl);
}

async function getBaiduAccessToken() {
  if (baiduAccessToken && Date.now() < baiduAccessTokenExpiresAt) return baiduAccessToken;
  const tokenUrl = new URL(baiduTokenUrl);
  tokenUrl.searchParams.set("grant_type", "client_credentials");
  tokenUrl.searchParams.set("client_id", baiduApiKey);
  tokenUrl.searchParams.set("client_secret", baiduSecretKey);
  const response = await fetch(tokenUrl, { signal: AbortSignal.timeout(sttTimeoutMs) });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || `Baidu token HTTP ${response.status}`);
  }
  baiduAccessToken = result.access_token;
  const expiresIn = Math.max(60, Number(result.expires_in || 2592000));
  baiduAccessTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  return baiduAccessToken;
}

async function transcribeWithBaidu(audioBase64, payload, startedAt) {
  const pcm = Buffer.from(audioBase64, "base64");
  let token;
  try {
    token = await getBaiduAccessToken();
    const response = await fetch(baiduSttUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "pcm",
        rate: Number(payload.sampleRate || 16000),
        channel: 1,
        dev_pid: Number(baiduSttModel),
        cuid: clean(payload.cuid || payload.source || "mindiou-g2").slice(0, 60),
        token,
        len: pcm.length,
        speech: audioBase64
      }),
      signal: AbortSignal.timeout(sttTimeoutMs)
    });
    const result = await response.json();
    const latencyMs = Date.now() - startedAt;
    if (!response.ok || Number(result.err_no || 0) !== 0) {
      if (Number(result.err_no) === 110) {
        baiduAccessToken = "";
        baiduAccessTokenExpiresAt = 0;
      }
      return { ok: false, error: result.err_msg || `Baidu STT HTTP ${response.status}`, latencyMs };
    }
    return { ok: true, text: clean(result.result?.[0] || ""), confidence: 0, latencyMs, provider: "baidu" };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      error: error?.name === "TimeoutError" ? `STT request timed out after ${sttTimeoutMs}ms` : clean(error?.message || String(error)),
      latencyMs
    };
  }
}

async function transcribe(payload) {
  const audioBase64 = clean(payload.audioBase64);
  if (!audioBase64) return { ok: false, error: "Missing audioBase64" };
  if (!sttIsConfigured()) {
    return { ok: false, text: "", error: sttProvider === "baidu" ? "Baidu STT credentials are not set" : "STT_API_KEY is not set" };
  }

  const startedAt = Date.now();
  if (sttProvider === "baidu") return transcribeWithBaidu(audioBase64, payload, startedAt);
  const wav = wavFromPcm16(audioBase64, Number(payload.sampleRate || 16000));
  const form = new FormData();
  form.append("model", sttModel);
  form.append("prompt", clean(sttPrompt).slice(0, 500));
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "g2-audio.wav");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sttTimeoutMs);
  let response;
  try {
    response = await fetch(`${sttBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { "authorization": `Bearer ${sttApiKey}` },
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error?.name === "AbortError") {
      return { ok: false, error: `STT request timed out after ${sttTimeoutMs}ms`, latencyMs };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), latencyMs };
  } finally {
    clearTimeout(timeout);
  }
  const result = await response.json();
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    return { ok: false, error: result.error?.message || `STT HTTP ${response.status}`, latencyMs };
  }
  return { ok: true, text: clean(result.text), confidence: 0, latencyMs };
}

function recordEvent(payload) {
  const event = {
    at: new Date().toISOString(),
    type: clean(payload.type || "event").slice(0, 80),
    data: payload.data && typeof payload.data === "object" ? payload.data : {}
  };
  eventLog.push(event);
  while (eventLog.length > 200) eventLog.shift();
  return event;
}

function fallbackAssessmentReview(answers) {
  const reviews = Object.entries(answers || {}).slice(0, 12).map(([questionId, raw]) => {
    const answer = clean(raw).slice(0, 3000);
    const substantive = answer.length >= 40;
    const causal = /(因为|所以|导致|避免|恢复|关系|cause|because|so that|avoid|recover)/i.test(answer);
    const risk = /(风险|验证|证据|来源|权限|隐私|样本|对照|risk|verify|evidence|source|privacy|sample|control)/i.test(answer);
    const uncertainty = /(不确定|无法确认|需要核实|尚未|unknown|uncertain|cannot confirm|not yet)/i.test(answer);
    const transfer = /(幂等|唯一约束|试点|灰度|原始来源|第三个因素|idempoten|unique constraint|pilot|staged|original source|third factor)/i.test(answer);
    return {
      questionId,
      causal_explanation: causal ? (substantive ? 2 : 1) : 0,
      independent_judgment: substantive ? 2 : 1,
      risk_identification: risk ? 2 : 0,
      uncertainty_awareness: uncertainty ? 2 : 0,
      transfer: transfer ? 2 : 0,
      evidence: answer.slice(0, 120),
      reason: "Rule-based provisional review; model review was unavailable."
    };
  });
  return { reviews };
}

async function reviewAssessmentAnswers(payload) {
  const answers = payload?.answers && typeof payload.answers === "object" ? payload.answers : {};
  const limited = Object.fromEntries(Object.entries(answers).slice(0, 12).map(([id, value]) => [clean(id).slice(0, 40), clean(value).slice(0, 3000)]).filter(([, value]) => value));
  const questions = Array.isArray(payload?.questions) ? payload.questions.slice(0, 12).map(question => ({
    id: clean(question?.id).slice(0, 40), title: clean(question?.title).slice(0, 500),
    context: clean(question?.context).slice(0, 2000), rubric: clean(question?.rubric).slice(0, 1000)
  })).filter(question => question.id && Object.hasOwn(limited, question.id)) : [];
  const fallback = () => fallbackAssessmentReview(limited);
  let result;
  try {
    result = await chatJson([
      { role: "system", content: [
        "Evaluate constructed responses in MindIOU's AI collaboration behavior test.",
        "Use each question's context and rubric. Do not reward jargon unless it answers that rubric.",
        "Do not infer personality, occupation, intelligence, or long-term mastery.",
        "Score only evidence present in the answer. Each field is an integer 0-3.",
        "Quote a short exact excerpt from the answer in evidence.",
        "Return JSON only: {reviews:[{questionId,causal_explanation,independent_judgment,risk_identification,uncertainty_awareness,transfer,evidence,reason}]}"
      ].join("\n") },
      { role: "user", content: JSON.stringify({ version: clean(payload?.version), role: clean(payload?.role), locale: clean(payload?.locale), questions: questions.map(question => ({...question, answer: limited[question.id]})) }) }
    ], fallback);
  } catch {
    result = { ...fallback(), __fallback: true };
  }
  const reviews = Array.isArray(result?.reviews) ? result.reviews.slice(0, 12).map(item => ({
    questionId: clean(item?.questionId).slice(0, 40),
    causal_explanation: Math.max(0, Math.min(3, Number(item?.causal_explanation) || 0)),
    independent_judgment: Math.max(0, Math.min(3, Number(item?.independent_judgment) || 0)),
    risk_identification: Math.max(0, Math.min(3, Number(item?.risk_identification) || 0)),
    uncertainty_awareness: Math.max(0, Math.min(3, Number(item?.uncertainty_awareness) || 0)),
    transfer: Math.max(0, Math.min(3, Number(item?.transfer) || 0)),
    evidence: clean(item?.evidence).slice(0, 160),
    reason: clean(item?.reason).slice(0, 300)
  })).filter(item => item.questionId) : fallback().reviews;
  return { reviews, mode: result?.__fallback ? "rule_fallback" : "model_structured" };
}

const server = createServer(async (req, res) => {
  const requestId = readRequestId(req);
  const traceContext = createTraceContext(req, requestId);
  const startedAt = Date.now();
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-trace-id", traceContext.traceId);
  res.on("finish", () => {
    logRequestCompletion(req, res, requestId, startedAt, traceContext.traceId);
    traceEvent("http_request", {
      ...traceContext,
      status: res.statusCode,
      method: String(req.method || "GET"),
      durationMs: Date.now() - startedAt
    });
  });
  return runWithTrace(traceContext, async () => { try {
    if (req.method === "OPTIONS") {
      optionsResponse(res);
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health") {
      const live = url.searchParams.get("live") === "1";
      jsonResponse(res, 200, {
        ok: true,
        ai: Boolean(aiApiKey) && !disableAi,
        provider: aiProvider,
        model: chatModel,
        stt: sttIsConfigured(),
        sttProvider,
        sttModel: sttProvider === "baidu" ? baiduSttModel : sttModel,
        cognitiveRepaymentV1: cognitiveRepaymentV1,
        ...(live ? { providerStatus: await checkAiConnectivity() } : {})
      });
      return;
    }

    if (url.pathname === "/api/assessment/review" && req.method === "POST") {
      try {
        const payload = parseJson(await readBody(req));
        const result = await reviewAssessmentAnswers(payload);
        // 埋点：记录 MBAI 测试完成次数，用于运营后台统计。
        // 不记录任何答案内容或用户身份，仅记录角色、语言和评审模式。
        recordEvent({
          type: "assessment_review",
          data: {
            role: clean(payload.role || "unknown"),
            locale: clean(payload.locale || "zh"),
            mode: result.mode || "unknown",
            ts: Date.now()
          }
        });
        assessmentStore.recordCompletion({
          completionId: clean(payload.completionId || `assessment-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`),
          completedAt: new Date().toISOString(),
          role: payload.role,
          locale: payload.locale,
          mode: result.mode
        });
        jsonResponse(res, 200, { ok: true, ...result });
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: clean(error?.message || "Assessment review failed") });
      }
      return;
    }

    // Liveness：进程存活即可，不检查任何依赖，不调用模型。
    if (url.pathname === "/healthz") {
      jsonResponse(res, 200, {
        ok: true,
        status: "alive",
        uptimeSeconds: Math.round(process.uptime())
      });
      return;
    }

    // Readiness：关键本地依赖可读 + 配置状态分解。不调用昂贵模型探活。
    if (url.pathname === "/readyz") {
      const checks = {
        authStore: { ok: true, error: "" },
        config: {
          ai: Boolean(aiApiKey) && !disableAi,
          research: Boolean(researchApiKey && researchBaseUrl),
          stt: sttIsConfigured(),
          sttProvider
        }
      };
      try {
        // 轻量只读探测：SQLite 可接受查询即视为可读。
        authStore.getUserById("__readiness_probe__");
      } catch (error) {
        checks.authStore = { ok: false, error: fit(String(error?.message || error), 120) };
      }
      const ready = checks.authStore.ok;
      jsonResponse(res, ready ? 200 : 503, {
        ok: ready,
        status: ready ? "ready" : "not_ready",
        checks
      });
      return;
    }

    // ── Auth: web user accounts (no LEARNING_API_TOKEN required) ──

    if (url.pathname === "/api/auth/register" && req.method === "POST") {
      const payload = parseJson(await readBody(req));
      try {
        const { user, sessionId } = authStore.register(payload.email, payload.password, payload.name);
        try {
          const token = authStore.createEmailVerificationToken(user.id);
          await sendVerificationEmail(user.email, token, req);
        } catch (mailError) {
          console.error("[email-verification] Failed to send: " + mailError.message);
        }
        jsonResponse(res, 201, { ok: true, user }, { "set-cookie": authSessionCookie(sessionId) });
      } catch (error) {
        const status = /already registered/i.test(String(error.message)) ? 409 : 400;
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const payload = parseJson(await readBody(req));
      try {
        const { user, sessionId } = authStore.login(payload.email, payload.password);
        jsonResponse(res, 200, { ok: true, user }, { "set-cookie": authSessionCookie(sessionId) });
      } catch {
        jsonResponse(res, 401, { ok: false, error: "Invalid email or password" });
      }
      return;
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const sessionId = parseCookies(req)[sessionCookieName];
      if (sessionId) authStore.logout(sessionId);
      jsonResponse(res, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
      return;
    }
    if (url.pathname === "/api/auth/me" && req.method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      jsonResponse(res, 200, { ok: true, user });
      return;
    }
    if (url.pathname === "/api/auth/verify-email" && req.method === "GET") {
      const token = url.searchParams.get("token") || "";
      const result = authStore.verifyEmailToken(token);
      const baseUrl = getPublicBaseUrl(req);
      if (result.ok) {
        res.writeHead(302, { Location: baseUrl + "/mindiou/#/verify-email?status=success" });
      } else {
        res.writeHead(302, { Location: baseUrl + "/mindiou/#/verify-email?status=failed" });
      }
      res.end();
      return;
    }
    if (url.pathname === "/api/auth/verify-email" && req.method === "POST") {
      const payload = parseJson(await readBody(req));
      const result = authStore.verifyEmailToken(payload.token);
      if (result.ok) {
        jsonResponse(res, 200, { ok: true, message: "Email verified successfully" });
      } else {
        jsonResponse(res, 400, { ok: false, error: result.error });
      }
      return;
    }
    if (url.pathname === "/api/auth/resend-verification" && req.method === "POST") {
      const user = requireAuth(req, res);
      if (!user) return;
      if (authStore.isEmailVerified(user.id)) {
        jsonResponse(res, 200, { ok: true, message: "Email already verified" });
        return;
      }
      try {
        const token = authStore.createEmailVerificationToken(user.id);
        const email = authStore.getUserEmail(user.id);
        if (email) await sendVerificationEmail(email, token, req);
        jsonResponse(res, 200, { ok: true, message: "Verification email sent" });
      } catch (mailError) {
        jsonResponse(res, 500, { ok: false, error: "Failed to send verification email" });
      }
      return;
    }
    if (url.pathname === "/api/genesis" && req.method === "GET") {
      const archive = authStore.getGenesisArchive();
      const reports = mvp0Store.listReports();
      const sessions = mvp1Store.listSessions();
      const joinedUserIds = new Set(reports.map(report => report.userId).filter(Boolean));
      const clearedUserIds = new Set(sessions
        .filter(session => session.state === "ended" && session.attempts?.length > 0)
        .map(session => session.userId)
        .filter(Boolean));
      const currentUser = getOptionalUser(req);
      const userReports = currentUser ? reports.filter(report => report.userId === currentUser.id) : [];
      const userSessions = currentUser ? sessions.filter(session => session.userId === currentUser.id) : [];
      const completedSessions = userSessions.filter(session => session.state === "ended" && session.attempts?.length > 0);
      const activeSession = userSessions.find(session => session.state !== "ended") || null;
      jsonResponse(res, 200, {
        ok: true,
        genesis: {
          cohort: "001",
          status: "recruiting",
          stage: "MVP-1.x 首发体验阶段",
          stageEn: "MVP-1.x genesis experience stage",
          dates: { start: null, end: null },
          capacity: 300,
          estimates: { completed: 87 },
          actual: {
            registered: archive.joined,
            joined: joinedUserIds.size,
            completedFirstClearance: clearedUserIds.size,
            adoptedSuggestions: 7
          },
          adoptedSuggestions: GENESIS_ADOPTED_SUGGESTIONS,
          productImprovements: GENESIS_ADOPTED_SUGGESTIONS,
          members: archive.members,
          participant: currentUser ? {
            registered: true,
            officiallyJoined: userReports.length > 0,
            reportCount: userReports.length,
            completedClearanceCount: completedSessions.length,
            activeSessionId: activeSession?.id || null,
            identity: authStore.getUserById(currentUser.id)?.genesisIdentity || null
          } : null
        }
      });
      return;
    }
    if (url.pathname === "/api/genesis/identity" && req.method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      jsonResponse(res, 200, { ok: true, identity: authStore.getUserById(user.id)?.genesisIdentity || null });
      return;
    }
    if (url.pathname === "/api/genesis/identity" && req.method === "PATCH") {
      const user = requireAuth(req, res);
      if (!user) return;
      try {
        const payload = parseJson(await readBody(req));
        const identity = authStore.updateGenesisIdentity(user.id, payload);
        jsonResponse(res, 200, { ok: true, identity });
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: error.message });
      }
      return;
    }
    if (url.pathname === "/api/auth/device-token" && req.method === "POST") {
      const user = requireAuth(req, res);
      if (!user) return;
      const payload = parseJson(await readBody(req));
      const deviceToken = authStore.generateDeviceToken(user.id, payload.name);
      // The plaintext token is returned only in this response.
      jsonResponse(res, 201, { ok: true, deviceToken });
      return;
    }
    if (url.pathname === "/api/auth/device-tokens" && req.method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      jsonResponse(res, 200, { ok: true, deviceTokens: authStore.listDeviceTokens(user.id) });
      return;
    }
    const deviceTokenMatch = url.pathname.match(/^\/api\/auth\/device-token\/([^/]+)$/);
    if (deviceTokenMatch && req.method === "DELETE") {
      const user = requireAuth(req, res);
      if (!user) return;
      const revoked = authStore.revokeDeviceToken(decodeURIComponent(deviceTokenMatch[1]), user.id);
      if (!revoked) {
        jsonResponse(res, 404, { ok: false, error: "Device token not found" });
        return;
      }
      jsonResponse(res, 200, { ok: true });
      return;
    }

    // ── Legacy early-access login (kept for backward compatibility) ──

    if (req.method === "POST" && url.pathname === "/api/access/login") {
      if (!earlyAccessCodes.length) {
        jsonResponse(res, 503, { ok: false, error: "体验邀请码登录尚未启用。" });
        return;
      }
      if (Buffer.byteLength(sessionSecret) < 32) {
        jsonResponse(res, 503, { ok: false, error: "体验会话尚未完成服务端配置。" });
        return;
      }
      let payload;
      try {
        payload = parseJson(await readBody(req));
      } catch {
        jsonResponse(res, 400, { ok: false, error: "登录请求格式无效。" });
        return;
      }
      const user = findEarlyAccessUser(String(payload.code || "").trim());
      if (!user) {
        jsonResponse(res, 401, { ok: false, error: "邀请码无效，请联系邀请人确认。" });
        return;
      }
      const expiresAt = Date.now() + sessionTtlSeconds * 1000;
      const token = signSession({
        label: user.label,
        expiresAt,
        jti: crypto.randomBytes(16).toString("base64url")
      });
      res.setHeader("set-cookie", earlyAccessSessionCookie(req, token, sessionTtlSeconds));
      jsonResponse(res, 200, {
        ok: true,
        user: { label: user.label },
        expiresAt: new Date(expiresAt).toISOString()
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/access/logout") {
      const session = readSession(req);
      if (session) {
        revokeSessionToken(parseCookies(req).mindiou_session, session.expiresAt);
      }
      res.setHeader("set-cookie", earlyAccessSessionCookie(req, "", 0));
      jsonResponse(res, 200, { ok: true });
      return;
    }

    // ── 运营后台路由（独立鉴权，不走邀请码）──
    if (handleAdminRoute(req, res, url.pathname, req.method, {
      mvp0Store, spiralStore, eventLog, mvp1Sessions, authStore, assessmentStore
    })) return;

    // ── Project Memory: project, session, artifact, decision and evidence graph ──
    const pmProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    const pmProjectMemoryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory$/);
    const pmProjectTimelineMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/timeline$/);
    const pmProjectSearchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/search$/);
    const pmProjectOwnershipMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ownership$/);
    const pmProjectWorkItemsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/work-items$/);
    const pmProjectArtifactsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/artifacts$/);
    const pmProjectDecisionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/decisions$/);
    const pmAgentContextMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/agent-context$/);
    const pmWorkItemMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)$/);
    const pmWorkItemMergeMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/merge$/);
    const pmWorkItemSplitMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/split$/);
    const pmSessionMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)$/);
    const pmSessionEventsMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/events$/);
    const pmSessionWorkItemLinkMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/link-work-item$/);
    const pmAnalyzeMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/(analyze|reprocess)$/);
    const pmDebtArtifactMatch = url.pathname.match(/^\/api\/debts\/([^/]+)\/artifacts$/);
    const pmDebtArtifactDeleteMatch = url.pathname.match(/^\/api\/debts\/([^/]+)\/artifacts\/([^/]+)$/);
    const pmDebtHistoryMatch = url.pathname.match(/^\/api\/debts\/([^/]+)\/project-history$/);
    const pmDebtRecurrencesMatch = url.pathname.match(/^\/api\/debts\/([^/]+)\/recurrences$/);
    const pmDebtEvidenceMatch = url.pathname.match(/^\/api\/debts\/([^/]+)\/evidence$/);
    const pmArtifactMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    const pmArtifactDebtMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/link-debt$/);
    const pmArtifactSessionMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/link-session$/);
    const pmDecisionMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)$/);
    const pmSessionCandidateMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/debt-candidates\/([^/]+)\/accept$/);
    const pmHookTokenMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/hook-token$/);
    const pmHookTokenRevokeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/hook-token\/([^/]+)$/);
    const pmReportProjectMemoryMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)\/project-memory$/);

    const isProjectMemoryRoute = url.pathname === "/api/projects" ||
      url.pathname === "/api/search" ||
      url.pathname === "/api/agent-sessions/import" ||
      url.pathname === "/api/agent-sessions/events" ||
      pmProjectMatch || pmProjectMemoryMatch || pmProjectTimelineMatch || pmProjectSearchMatch ||
      pmProjectOwnershipMatch || pmProjectWorkItemsMatch || pmProjectArtifactsMatch || pmProjectDecisionsMatch ||
      pmWorkItemMatch || pmWorkItemMergeMatch || pmWorkItemSplitMatch || pmSessionMatch || pmSessionWorkItemLinkMatch || pmAnalyzeMatch ||
      pmSessionEventsMatch ||
      pmDebtArtifactMatch || pmDebtArtifactDeleteMatch || pmDebtHistoryMatch || pmDebtRecurrencesMatch ||
      pmArtifactMatch || pmArtifactDebtMatch || pmArtifactSessionMatch || pmDecisionMatch ||
      pmDebtEvidenceMatch ||
      pmSessionCandidateMatch || pmHookTokenMatch || pmHookTokenRevokeMatch || pmReportProjectMemoryMatch || pmAgentContextMatch;
    if (isProjectMemoryRoute) {
      let body = {};
      if (req.method !== "GET" && req.method !== "DELETE") {
        requireJsonRequest(req);
        body = parseJson(await readBody(req));
      }
      const isHookEventRoute = req.method === "POST" && url.pathname === "/api/agent-sessions/events";
      // Agent-facing routes accept a per-project hook token (Bearer) as an
      // alternative to cookie auth, so TRAE hooks and the MindIOU MCP server
      // can call them without handling user credentials.
      const isHookTokenRoute = isHookEventRoute ||
        (req.method === "GET" && pmAgentContextMatch) ||
        (req.method === "POST" && pmProjectDecisionsMatch) ||
        (req.method === "POST" && pmDebtEvidenceMatch) ||
        (req.method === "POST" && pmSessionCandidateMatch) ||
        (req.method === "POST" && pmSessionEventsMatch);
      let user = null;
      let hookIdentity = null;
      if (isHookTokenRoute) {
        const bearer = readBearer(req);
        if (bearer) {
          hookIdentity = projectMemoryStore.validateHookToken(bearer);
          if (!hookIdentity && isHookEventRoute && projectMemoryHookToken && safeEqual(bearer, projectMemoryHookToken) && body.userId) {
            if (authStore.getUserById(String(body.userId))) {
              hookIdentity = { userId: String(body.userId), projectId: body.projectId || null };
            }
          }
          if (!hookIdentity) {
            jsonResponse(res, 401, { ok: false, error: "Invalid Project Memory hook token" });
            return;
          }
          user = { id: hookIdentity.userId };
          // A hook token is bound to one project; project-scoped routes must
          // match it. "_" selects the bound project implicitly.
          const scopedMatch = pmAgentContextMatch || (req.method === "POST" && pmProjectDecisionsMatch);
          if (scopedMatch && hookIdentity.projectId) {
            const requested = decodeURIComponent(scopedMatch[1]);
            if (requested !== "_" && requested !== hookIdentity.projectId) {
              jsonResponse(res, 403, { ok: false, error: "Hook token is bound to another project" });
              return;
            }
          }
        } else {
          user = requireAuth(req, res);
          if (!user) return;
        }
      } else {
        user = requireAuth(req, res);
        if (!user) return;
      }
      const resolveHookProjectId = (raw) => {
        const decoded = decodeURIComponent(raw);
        return decoded === "_" && hookIdentity?.projectId ? hookIdentity.projectId : decoded;
      };
      try {
        if (req.method === "GET" && url.pathname === "/api/projects") {
          const pmProjects = projectMemoryStore.listProjects(user.id);
          const ownershipProjects = ownershipStore.listProjects(user.id);
          const allProjects = [...pmProjects];
          for (const op of ownershipProjects) {
            if (!allProjects.find((p) => p.id === op.id)) allProjects.push(op);
          }
          jsonResponse(res, 200, { ok: true, projects: allProjects });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/projects") {
          jsonResponse(res, 201, { ok: true, project: projectMemoryStore.createProject(body, user.id) });
          return;
        }
        if (req.method === "GET" && pmProjectMatch) {
          const projectId = decodeURIComponent(pmProjectMatch[1]);
          let project;
          try { project = projectMemoryStore.getProject(projectId, user.id); }
          catch { project = legacyProjectMemoryView(projectId, user.id)?.project; }
          if (!project) { jsonResponse(res, 404, { ok: false, error: "Project not found" }); return; }
          const workItems = (() => { try { return projectMemoryStore.listWorkItems(projectId, user.id); } catch { return legacyProjectMemoryView(projectId, user.id)?.workItems || []; } })();
          jsonResponse(res, 200, { ok: true, project, workItems });
          return;
        }
        if (req.method === "PATCH" && pmProjectMatch) {
          jsonResponse(res, 200, { ok: true, project: projectMemoryStore.updateProject(decodeURIComponent(pmProjectMatch[1]), body, user.id) });
          return;
        }
        if (req.method === "DELETE" && pmProjectMatch) {
          jsonResponse(res, 200, { ok: true, project: projectMemoryStore.deleteProject(decodeURIComponent(pmProjectMatch[1]), user.id) });
          return;
        }
        if (req.method === "GET" && pmProjectMemoryMatch) {
          const projectId = decodeURIComponent(pmProjectMemoryMatch[1]);
          let memory;
          try { memory = projectMemoryStore.memory(projectId, user.id, trainingStore.listCognitiveDebts(user.id)); }
          catch {
            memory = legacyProjectMemoryView(projectId, user.id);
            if (!memory) { jsonResponse(res, 404, { ok: false, error: "Project not found" }); return; }
            delete memory.byWorkItem; delete memory.raw;
          }
          jsonResponse(res, 200, { ok: true, memory });
          return;
        }
        if (req.method === "GET" && pmAgentContextMatch) {
          // Compact learning context for AI-agent consumption (TRAE hooks /
          // MindIOU MCP): project summary, cognitive debts with mastery and
          // evidence levels, due reviews and recent decisions. Report-backed
          // repayment gaps are included separately so the MCP can distinguish
          // an identified gap from a legacy training debt.
          const projectId = resolveHookProjectId(pmAgentContextMatch[1]);
          await syncRepaymentGapsFromReports(user.id);
          const debts = trainingStore.listCognitiveDebts(user.id);
          const memoryView = projectMemoryStore.memory(projectId, user.id, debts);
          const projectDebtIds = new Set(memoryView.ownership.debts.map(item => item.debtId));
          const projectDebts = debts.filter(debt => projectDebtIds.has(debt.id));
          const profiles = trainingStore.listMasteryProfiles(user.id);
          const profileMap = {};
          for (const p of profiles) profileMap[p.cognitiveDebtId] = p;
          const ownershipByDebt = {};
          for (const item of memoryView.ownership.debts) ownershipByDebt[item.debtId] = item;
          const debtContext = projectDebts.slice(0, 50).map(debt => {
            const profile = profileMap[debt.id] || null;
            const understandingLevel = profile ? deriveUnderstandingLevel(profile) : "not_understood";
            return {
              id: debt.id,
              gapText: debt.gapText || debt.title || "",
              status: debt.status || "open",
              understandingLevel,
              masteryLabel: masteryLabel(understandingLevel),
              evidenceLevel: ownershipByDebt[debt.id]?.evidenceLevel || "E0",
              ownershipState: ownershipByDebt[debt.id]?.ownershipState || "unverified"
            };
          });
          const dueTasks = trainingStore.listDueReviews(user.id).filter(task => projectDebtIds.has(task.cognitiveDebtId));
          const pendingCandidates = memoryView.sessions.flatMap(session =>
            (session.analysis?.cognitiveDebtCandidates || []).map((candidate, index) => ({
              sessionId: session.id,
              candidateIndex: index,
              title: candidate.title,
              description: candidate.description,
              reason: candidate.reason,
              priority: candidate.priority,
              confidence: candidate.confidence
            }))
          ).slice(0, 10);
          const projectReportIds = new Set(memoryView.sessions
            .map(session => String(session.externalSessionId || "").match(/^mvp0-report:(.+)$/)?.[1])
            .filter(Boolean));
          const allRepaymentGaps = repaymentStore.listGaps(user.id);
          const repaymentGaps = allRepaymentGaps
            .filter(gap => projectReportIds.has(gap.reportId))
            .slice(0, 50)
            .map(gap => {
              const attempts = repaymentStore.listAttemptsForGap(gap.gapId);
              const latestAttempt = attempts[attempts.length - 1] || null;
              return {
                gapId: gap.gapId,
                reportId: gap.reportId,
                gapRank: gap.gapRank,
                title: gap.title,
                gapText: gap.title,
                whyItMatters: gap.whyItMatters,
                status: gap.status,
                confidence: gap.confidence,
                verificationMethod: gap.verificationMethod,
                latestAttempt: latestAttempt ? {
                  submittedAt: latestAttempt.submittedAt,
                  passed: Boolean(latestAttempt.evaluation?.passed),
                  overallFeedback: latestAttempt.evaluation?.overallFeedback || "",
                  nextQuestion: latestAttempt.evaluation?.nextQuestion || ""
                } : null
              };
            });
          const capabilityProfiles = repaymentStore.listCapabilityProfiles(user.id)
            .filter(profile => !profile.reportId || projectReportIds.has(profile.reportId))
            .slice(0, 20);
          jsonResponse(res, 200, {
            ok: true,
            project: memoryView.project,
            counts: { ...memoryView.counts, repaymentGaps: repaymentGaps.length },
            debts: debtContext,
            repaymentGaps,
            capabilityProfiles,
            dueReviews: { total: dueTasks.length, tasks: dueTasks.slice(0, 5) },
            recentDecisions: memoryView.decisions.slice(0, 10),
            pendingCandidates,
            ownership: memoryView.ownership
          });
          return;
        }
        if (req.method === "GET" && pmProjectTimelineMatch) {
          const projectId = decodeURIComponent(pmProjectTimelineMatch[1]);
          let timeline;
          try { timeline = projectMemoryStore.timeline(projectId, user.id); }
          catch { timeline = legacyProjectMemoryView(projectId, user.id)?.timeline; }
          if (!timeline) { jsonResponse(res, 404, { ok: false, error: "Project not found" }); return; }
          jsonResponse(res, 200, { ok: true, timeline });
          return;
        }
        if (req.method === "GET" && pmProjectSearchMatch) {
          jsonResponse(res, 200, { ok: true, results: projectMemorySearch(url.searchParams.get("q") || "", decodeURIComponent(pmProjectSearchMatch[1]), user.id) });
          return;
        }
        if (req.method === "GET" && pmProjectOwnershipMatch) {
          const projectId = decodeURIComponent(pmProjectOwnershipMatch[1]);
          const project = ownershipStore.getProject(projectId, user.id);
          const memoryProject = project || (() => { try { return projectMemoryStore.getProject(projectId, user.id); } catch { return null; } })();
          if (!memoryProject) {
            jsonResponse(res, 404, { ok: false, error: "Project not found" });
            return;
          }
          const view = project
            ? computeProjectOwnershipView(ownershipStore, trainingStore, projectId, user.id)
            : projectMemoryOwnershipView(projectId, user.id);
          jsonResponse(res, 200, { ok: true, ...view });
          return;
        }
        if (req.method === "GET" && pmProjectWorkItemsMatch) {
          const projectId = decodeURIComponent(pmProjectWorkItemsMatch[1]);
          let workItems;
          try { workItems = projectMemoryStore.listWorkItems(projectId, user.id); }
          catch { workItems = legacyProjectMemoryView(projectId, user.id)?.workItems; }
          if (!workItems) { jsonResponse(res, 404, { ok: false, error: "Project not found" }); return; }
          jsonResponse(res, 200, { ok: true, workItems });
          return;
        }
        if (req.method === "POST" && pmProjectWorkItemsMatch) {
          jsonResponse(res, 201, { ok: true, workItem: projectMemoryStore.createWorkItem({ ...body, projectId: decodeURIComponent(pmProjectWorkItemsMatch[1]) }, user.id) });
          return;
        }
        if (req.method === "GET" && pmProjectArtifactsMatch) {
          jsonResponse(res, 200, { ok: true, artifacts: projectMemoryStore.listArtifacts(decodeURIComponent(pmProjectArtifactsMatch[1]), user.id) });
          return;
        }
        if (req.method === "GET" && pmProjectDecisionsMatch) {
          jsonResponse(res, 200, { ok: true, decisions: projectMemoryStore.listDecisions(decodeURIComponent(pmProjectDecisionsMatch[1]), user.id) });
          return;
        }
        if (req.method === "POST" && pmProjectDecisionsMatch) {
          const projectId = resolveHookProjectId(pmProjectDecisionsMatch[1]);
          jsonResponse(res, 201, { ok: true, decision: projectMemoryStore.createDecision({ ...body, projectId }, user.id) });
          return;
        }
        if (req.method === "GET" && pmWorkItemMatch) {
          const workItemId = decodeURIComponent(pmWorkItemMatch[1]);
          try {
            jsonResponse(res, 200, { ok: true, detail: projectMemoryStore.getWorkItemDetail(workItemId, user.id) });
          } catch {
            const legacyProject = ownershipStore.listProjects(user.id).map(p => legacyProjectMemoryView(p.id, user.id)).find(view => view?.workItems.some(item => item.id === workItemId));
            const detail = legacyProject?.byWorkItem(workItemId);
            if (!detail?.workItem) { jsonResponse(res, 404, { ok: false, error: "Work item not found" }); return; }
            jsonResponse(res, 200, { ok: true, detail });
          }
          return;
        }
        if (req.method === "PATCH" && pmWorkItemMatch) {
          jsonResponse(res, 200, { ok: true, workItem: projectMemoryStore.updateWorkItem(decodeURIComponent(pmWorkItemMatch[1]), body, user.id) });
          return;
        }
        if (req.method === "POST" && pmWorkItemMergeMatch) {
          const targetId = decodeURIComponent(pmWorkItemMergeMatch[1]);
          jsonResponse(res, 200, { ok: true, merge: projectMemoryStore.mergeWorkItems(targetId, body.sourceWorkItemId || body.sourceId, user.id) });
          return;
        }
        if (req.method === "POST" && pmWorkItemSplitMatch) {
          jsonResponse(res, 201, { ok: true, workItem: projectMemoryStore.splitWorkItem(decodeURIComponent(pmWorkItemSplitMatch[1]), body, user.id) });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/agent-sessions/import") {
          const result = await projectMemoryImportSession(body, user.id, body.importMethod || "manual_paste");
          result.recurrences = result.idempotent ? [] : await projectMemoryDetectRecurrences(result, user.id);
          jsonResponse(res, 200, { ok: true, ...result });
          return;
        }
        if (req.method === "POST" && pmReportProjectMemoryMatch) {
          const result = await projectMemoryLinkReport(
            decodeURIComponent(pmReportProjectMemoryMatch[1]),
            String(body.projectId || ""),
            user.id
          );
          jsonResponse(res, 200, { ok: true, ...result });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/agent-sessions/events") {
          const events = Array.isArray(body.events) ? body.events : [body];
          if (!events.length) throw new Error("events must not be empty");
          if (hookIdentity?.projectId && body.projectId && hookIdentity.projectId !== body.projectId) throw new Error("Hook token is bound to another project");
          for (const event of events) projectMemoryStore.recordHookEvent({ ...event, projectId: event.projectId || body.projectId || hookIdentity?.projectId, sessionId: event.sessionId || body.sessionId }, user.id);
          const eventIds = events.map(event => event.id || event.idempotencyKey || event.type);
          const result = await projectMemoryImportSession({
            ...body,
            projectId: body.projectId || hookIdentity?.projectId,
            externalSessionId: body.externalSessionId || body.sessionId,
            sourceFingerprint: body.sourceFingerprint || fingerprint({ projectId: body.projectId || hookIdentity?.projectId, sessionId: body.sessionId, eventIds }),
            events
          }, user.id, "hook");
          result.recurrences = result.idempotent ? [] : await projectMemoryDetectRecurrences(result, user.id);
          jsonResponse(res, 200, { ok: true, ...result, eventsAccepted: events.length });
          return;
        }
        if (req.method === "POST" && pmSessionEventsMatch) {
          const sessionId = decodeURIComponent(pmSessionEventsMatch[1]);
          const session = projectMemoryStore.getAgentSession(sessionId, user.id);
          if (hookIdentity?.projectId && session.projectId !== hookIdentity.projectId) {
            jsonResponse(res, 403, { ok: false, error: "Hook token is bound to another project" });
            return;
          }
          const events = Array.isArray(body.events) ? body.events : [body];
          if (!events.length) throw new Error("events must not be empty");
          for (const event of events) {
            projectMemoryStore.recordHookEvent({
              ...event,
              projectId: session.projectId,
              sessionId,
            }, user.id);
          }
          const appended = projectMemoryAppendHookEvents(sessionId, events, user.id);
          const detail = appended.detail;
          jsonResponse(res, 200, {
            ok: true,
            appended: true,
            session: detail,
            analysis: detail.session.analysis || {},
            artifacts: appended.artifacts,
            eventsAccepted: events.length
          });
          return;
        }
        if (req.method === "GET" && pmSessionMatch) {
          const sessionId = decodeURIComponent(pmSessionMatch[1]);
          try {
            jsonResponse(res, 200, { ok: true, detail: projectMemoryStore.getSessionDetail(sessionId, user.id) });
          } catch {
            const legacyProject = ownershipStore.listProjects(user.id).map(p => legacyProjectMemoryView(p.id, user.id)).find(view => view?.sessions.some(item => item.id === sessionId));
            const session = legacyProject?.sessions.find(item => item.id === sessionId);
            if (!session) { jsonResponse(res, 404, { ok: false, error: "Agent session not found" }); return; }
            const raw = legacyProject.raw;
            const artifacts = legacyProject.artifacts.filter(item => raw.artifacts?.some(a => a.id === item.id && a.sessionId === sessionId));
            const decisions = legacyProject.decisions.filter(item => item.sessionId === sessionId);
            jsonResponse(res, 200, { ok: true, detail: { session, workItems: [], artifacts, decisions, recurrences: [] } });
          }
          return;
        }
        if (req.method === "DELETE" && pmSessionMatch) {
          jsonResponse(res, 200, { ok: true, result: projectMemoryStore.deleteAgentSession(decodeURIComponent(pmSessionMatch[1]), user.id, { rawOnly: url.searchParams.get("rawOnly") === "1" }) });
          return;
        }
        if (req.method === "POST" && pmAnalyzeMatch) {
          const sessionId = decodeURIComponent(pmAnalyzeMatch[1]);
          const source = projectMemoryStore.getAgentSessionSource(sessionId, user.id);
          if (!source.rawContent) throw new Error("This session did not retain source content; re-import it to reprocess");
          const analysis = analyzeNormalizedSession(normalizeSessionImport(source));
          projectMemoryStore.updateAgentSession(sessionId, {
            userIntentSummary: analysis.userIntent,
            implementationSummary: analysis.implementationSummary,
            outcomeSummary: analysis.outcomeSummary,
            keyTopics: analysis.keyTopics,
            technologies: analysis.technologies,
            rawContentStorage: source.rawContent ? "redacted" : "not_stored",
            rawContent: source.rawContent,
            processingStatus: "completed",
            analysis: projectMemoryAnalysisForStorage(analysis)
          }, user.id);
          jsonResponse(res, 200, { ok: true, detail: projectMemoryStore.getSessionDetail(sessionId, user.id) });
          return;
        }
        if (req.method === "POST" && pmSessionWorkItemLinkMatch) {
          jsonResponse(res, 201, { ok: true, link: projectMemoryStore.linkSessionWorkItem(decodeURIComponent(pmSessionWorkItemLinkMatch[1]), body.workItemId, { ...body, source: "manual" }, user.id) });
          return;
        }
        if (req.method === "POST" && pmSessionCandidateMatch) {
          const sessionId = decodeURIComponent(pmSessionCandidateMatch[1]);
          const session = projectMemoryStore.getAgentSession(sessionId, user.id);
          if (hookIdentity?.projectId && session.projectId !== hookIdentity.projectId) {
            jsonResponse(res, 403, { ok: false, error: "Hook token is bound to another project" });
            return;
          }
          jsonResponse(res, 201, { ok: true, ...(await projectMemoryAcceptDebtCandidate(sessionId, decodeURIComponent(pmSessionCandidateMatch[2]), user.id)) });
          return;
        }
        if (req.method === "GET" && pmArtifactMatch) {
          jsonResponse(res, 200, { ok: true, artifact: projectMemoryStore.getArtifact(decodeURIComponent(pmArtifactMatch[1]), user.id) });
          return;
        }
        if (req.method === "POST" && pmArtifactDebtMatch) {
          const debtId = body.debtId;
          trainingStore.getCognitiveDebt(debtId, user.id);
          jsonResponse(res, 201, { ok: true, link: projectMemoryStore.linkDebtArtifact({ ...body, debtId, artifactId: decodeURIComponent(pmArtifactDebtMatch[1]) }, user.id) });
          return;
        }
        if (req.method === "POST" && pmArtifactSessionMatch) {
          const sessionId = body.sessionId;
          jsonResponse(res, 201, { ok: true, link: projectMemoryStore.linkSessionArtifact(sessionId, decodeURIComponent(pmArtifactSessionMatch[1]), body, user.id) });
          return;
        }
        if (req.method === "GET" && pmDebtArtifactMatch) {
          trainingStore.getCognitiveDebt(decodeURIComponent(pmDebtArtifactMatch[1]), user.id);
          jsonResponse(res, 200, { ok: true, links: projectMemoryStore.listDebtLinks(decodeURIComponent(pmDebtArtifactMatch[1]), user.id) });
          return;
        }
        if (req.method === "POST" && pmDebtArtifactMatch) {
          trainingStore.getCognitiveDebt(decodeURIComponent(pmDebtArtifactMatch[1]), user.id);
          jsonResponse(res, 201, { ok: true, link: projectMemoryStore.linkDebtArtifact({ ...body, debtId: decodeURIComponent(pmDebtArtifactMatch[1]) }, user.id) });
          return;
        }
        if (req.method === "DELETE" && pmDebtArtifactDeleteMatch) {
          trainingStore.getCognitiveDebt(decodeURIComponent(pmDebtArtifactDeleteMatch[1]), user.id);
          projectMemoryStore.deleteDebtLink(decodeURIComponent(pmDebtArtifactDeleteMatch[1]), decodeURIComponent(pmDebtArtifactDeleteMatch[2]), user.id);
          jsonResponse(res, 200, { ok: true });
          return;
        }
        if (req.method === "GET" && pmDebtHistoryMatch) {
          trainingStore.getCognitiveDebt(decodeURIComponent(pmDebtHistoryMatch[1]), user.id);
          jsonResponse(res, 200, { ok: true, history: projectMemoryStore.listDebtHistory(decodeURIComponent(pmDebtHistoryMatch[1]), user.id) });
          return;
        }
        if (req.method === "GET" && pmDebtRecurrencesMatch) {
          trainingStore.getCognitiveDebt(decodeURIComponent(pmDebtRecurrencesMatch[1]), user.id);
          jsonResponse(res, 200, { ok: true, recurrences: projectMemoryStore.listRecurrences(decodeURIComponent(pmDebtRecurrencesMatch[1]), user.id) });
          return;
        }
        if (req.method === "GET" && pmDebtEvidenceMatch) {
          jsonResponse(res, 200, { ok: true, evidence: projectMemoryStore.listEvidenceForDebt(decodeURIComponent(pmDebtEvidenceMatch[1]), user.id) });
          return;
        }
        if (req.method === "POST" && pmDebtEvidenceMatch) {
          const debtId = decodeURIComponent(pmDebtEvidenceMatch[1]);
          trainingStore.getCognitiveDebt(debtId, user.id);
          const evidenceProjectId = body.projectId || hookIdentity?.projectId || null;
          if (evidenceProjectId) projectMemoryStore.getProject(evidenceProjectId, user.id);
          if (body.workItemId) projectMemoryStore.getWorkItem(body.workItemId, user.id);
          if (body.artifactId) projectMemoryStore.getArtifact(body.artifactId, user.id);
          jsonResponse(res, 201, { ok: true, evidence: projectMemoryStore.createEvidence({ ...body, projectId: evidenceProjectId, debtId }, user.id) });
          return;
        }
        if (req.method === "GET" && pmDecisionMatch) {
          jsonResponse(res, 200, { ok: true, decision: projectMemoryStore.getDecision(decodeURIComponent(pmDecisionMatch[1]), user.id) });
          return;
        }
        if (req.method === "PATCH" && pmDecisionMatch) {
          jsonResponse(res, 200, { ok: true, decision: projectMemoryStore.updateDecision(decodeURIComponent(pmDecisionMatch[1]), body, user.id) });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/search") {
          jsonResponse(res, 200, { ok: true, results: projectMemorySearch(url.searchParams.get("q") || "", url.searchParams.get("projectId"), user.id) });
          return;
        }
        if (req.method === "POST" && pmHookTokenMatch) {
          jsonResponse(res, 201, { ok: true, hook: projectMemoryStore.createHookToken(decodeURIComponent(pmHookTokenMatch[1]), user.id, body.name) });
          return;
        }
        if (req.method === "GET" && pmHookTokenMatch) {
          jsonResponse(res, 200, { ok: true, tokens: projectMemoryStore.listHookTokens(decodeURIComponent(pmHookTokenMatch[1]), user.id) });
          return;
        }
        if (req.method === "DELETE" && pmHookTokenRevokeMatch) {
          projectMemoryStore.revokeHookToken(decodeURIComponent(pmHookTokenRevokeMatch[2]), user.id);
          jsonResponse(res, 200, { ok: true });
          return;
        }
        jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
      } catch (error) {
        const status = /not found/i.test(String(error.message)) ? 404 : 400;
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }

    // ── Cognitive Loop MVP: activity → profile → debt → briefing → experiment ──
    const cognitiveLoopRunMatch = url.pathname.match(/^\/api\/cognitive-loop\/runs\/([^/]+)$/);
    const cognitiveLoopFeedbackMatch = url.pathname.match(/^\/api\/cognitive-loop\/runs\/([^/]+)\/feedback$/);
    const isCognitiveLoopRoute =
      (req.method === "GET" && (url.pathname === "/api/cognitive-loop/latest" || cognitiveLoopRunMatch)) ||
      (req.method === "POST" && (url.pathname === "/api/cognitive-loop/runs" || cognitiveLoopFeedbackMatch));
    if (isCognitiveLoopRoute) {
      const user = requireAuth(req, res);
      if (!user) return;
      let body = {};
      if (req.method !== "GET") {
        requireJsonRequest(req);
        body = parseJson(await readBody(req));
      }
      try {
        if (req.method === "GET" && url.pathname === "/api/cognitive-loop/latest") {
          const projectId = clean(url.searchParams.get("projectId"));
          if (!projectId) {
            jsonResponse(res, 400, { ok: false, error: "projectId is required" });
            return;
          }
          projectMemoryStore.getProject(projectId, user.id);
          const run = cognitiveLoopStore.getLatestRun(projectId, user.id);
          jsonResponse(res, 200, {
            ok: true,
            run,
            feedback: run ? cognitiveLoopStore.listFeedback(run.id, user.id) : []
          });
          return;
        }
        if (req.method === "GET" && cognitiveLoopRunMatch) {
          const run = cognitiveLoopStore.getRun(decodeURIComponent(cognitiveLoopRunMatch[1]), user.id);
          if (!run) {
            jsonResponse(res, 404, { ok: false, error: "Cognitive Loop run not found" });
            return;
          }
          jsonResponse(res, 200, {
            ok: true,
            run,
            feedback: cognitiveLoopStore.listFeedback(run.id, user.id)
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/cognitive-loop/runs") {
          const projectId = clean(body.projectId);
          if (!projectId) throw new Error("projectId is required");
          projectMemoryStore.getProject(projectId, user.id);
          if (!Array.isArray(body.activities) || body.activities.length === 0) {
            throw new Error("At least one AI conversation activity is required");
          }
          const clientRunId = clean(body.clientRunId) || "client-run-" + crypto.randomUUID();
          const existing = cognitiveLoopStore.getByClientRunId(clientRunId, user.id);
          if (existing) {
            jsonResponse(res, 200, {
              ok: true,
              run: existing,
              feedback: cognitiveLoopStore.listFeedback(existing.id, user.id),
              idempotent: true
            });
            return;
          }
          const runId = clean(body.runId) || "loop-" + crypto.randomUUID();
          const now = new Date().toISOString();
          const result = analyzeCognitiveLoop({
            ...body,
            runId,
            now,
            previousFeedback: cognitiveLoopStore.listRecentFeedback(projectId, user.id)
          });
          const activityText = body.activities
            .slice(0, 100)
            .map(item => clean(item?.content || item?.transcript || item?.text))
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 12000);
          const activitySession = projectMemoryStore.saveAgentSession({
            projectId,
            platform: "ai_conversation",
            externalSessionId: "cognitive-loop:" + runId,
            sourceFingerprint: fingerprint({
              kind: "cognitive-loop-activity",
              projectId,
              clientRunId,
              activityHashes: result.activities.map(item => item.contentHash)
            }),
            title: "Cognitive Loop · " + projectMemoryStore.getProject(projectId, user.id).name,
            rawTitle: "Cognitive Loop activity import",
            startedAt: result.window.start,
            endedAt: result.window.end,
            userIntentSummary: clean(body.projectContext || body.context),
            implementationSummary: "Structured AI collaboration activity analysis",
            outcomeSummary: result.aiUsageDebts[0]?.title || "No new AI Usage Debt selected",
            keyTopics: result.aiCollaborationProfile.filter(item => item.evidence.length).map(item => item.label),
            technologies: [],
            importMethod: "cognitive_loop",
            rawContentStorage: "redacted",
            rawContent: activityText,
            processingStatus: "completed",
            analysis: {
              schemaVersion: result.schemaVersion,
              source: result.source,
              profile: result.aiCollaborationProfile,
              selectedDebt: result.aiUsageDebts[0]
            }
          }, user.id);
          const run = cognitiveLoopStore.saveRun({
            id: runId,
            userId: user.id,
            projectId,
            clientRunId,
            activitySessionId: activitySession.id,
            windowStart: result.window.start,
            windowEnd: result.window.end,
            source: result.source,
            result
          });
          jsonResponse(res, 201, {
            ok: true,
            run,
            feedback: [],
            activitySessionId: activitySession.id
          });
          return;
        }
        if (req.method === "POST" && cognitiveLoopFeedbackMatch) {
          const runId = decodeURIComponent(cognitiveLoopFeedbackMatch[1]);
          const run = cognitiveLoopStore.getRun(runId, user.id);
          if (!run) {
            jsonResponse(res, 404, { ok: false, error: "Cognitive Loop run not found" });
            return;
          }
          const feedback = cognitiveLoopStore.recordFeedback({
            runId,
            userId: user.id,
            kind: body.kind,
            targetId: body.targetId,
            payload: body.payload || body
          });
          jsonResponse(res, 201, {
            ok: true,
            feedback,
            run,
            feedbackHistory: cognitiveLoopStore.listFeedback(runId, user.id)
          });
          return;
        }
        jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
      } catch (error) {
        const message = clean(error?.message || "Cognitive Loop request failed");
        const status = /not found/i.test(message) ? 404 : /required|activity/i.test(message) ? 400 : 500;
        jsonResponse(res, status, { ok: false, error: message });
      }
      return;
    }

    // ── Web MVP-0/MVP-1 routes: cookie session auth, per-user data isolation ──

    const mvp1SessionMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)$/);
    const mvp0ReportMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)$/);
    const mvp1AnswerMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)\/answers$/);
    const mvp1EndMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)\/end$/);
    const mvp0CardAnswerMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)\/cards\/([^/]+)\/answer$/);
    const mvp0CorrectionMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)\/corrections$/);
    const trainingDebtMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)$/);
    const trainingDebtIntelligenceMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)\/intelligence$/);
    const trainingDebtReanalyzeMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)\/intelligence\/reanalyze$/);
    const trainingDebtRelationsMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)\/relations$/);
    const trainingDebtRelationConfirmMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)\/relations\/([^/]+)\/confirm$/);
    const trainingDebtRelationRejectMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)\/relations\/([^/]+)\/reject$/);
    const trainingDebtClusterMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)\/cluster$/);
    const trainingClusterMatch = url.pathname.match(/^\/api\/training\/clusters\/([^/]+)$/);
    const profileInsightEvidenceMatch = url.pathname.match(/^\/api\/cognitive-profile\/insights\/([^/]+)\/evidence$/);
    const trainingReviewStartMatch = url.pathname.match(/^\/api\/training\/reviews\/([^/]+)\/start$/);
    const trainingReviewSubmitMatch = url.pathname.match(/^\/api\/training\/reviews\/([^/]+)\/submit$/);
    const learningRecommendationActionMatch = url.pathname.match(/^\/api\/learning-recommendations\/([^/]+)\/(accept|skip)$/);
    const isWebMvpRoute =
      (req.method === "GET" && (url.pathname === "/api/dashboard" || url.pathname === "/api/mvp0/reports" || mvp1SessionMatch || mvp0ReportMatch)) ||
      (req.method === "POST" && (
        url.pathname === "/api/mvp1/sessions" || mvp1AnswerMatch || mvp1EndMatch ||
        url.pathname === "/api/mvp0/report" || mvp0CardAnswerMatch || mvp0CorrectionMatch
      ));
    if (isWebMvpRoute) {
      const user = requireAuth(req, res);
      if (!user) return;

      if (req.method === "GET" && url.pathname === "/api/mvp0/reports") {
        jsonResponse(res, 200, { ok: true, reports: mvp0Store.listReports(user.id) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        const reports = mvp0Store.listReports(user.id);
        await syncRepaymentGapsFromReports(user.id);
        const sessions = mvp1Store.listSessions(user.id);
        const latestReport = reports[0] || null;
        const latestSession = sessions[0] || null;
        const latestSessionReport = latestSession
          ? reports.find(report => report.id === latestSession.reportId) || null
          : null;
        const latestSessionCard = latestSessionReport?.sections?.feynmanCards?.find(card => card.id === latestSession.cardId) || null;
        // 已清偿口径合并：MVP-1 卡片 clearance 与认知清偿 V1 的 repaid gap
        // 是同一笔债务的两种表示，按标题去重，避免“清偿后计数不变”。
        const repaymentGapsForDashboard = repaymentStore.listGaps(user.id);
        const repaidTitles = new Set(
          repaymentGapsForDashboard
            .filter(gap => gap.status === "repaid")
            .map(gap => gap.title)
            .filter(Boolean)
        );
        const outstandingDebts = reports.flatMap(report =>
          (report.sections?.feynmanCards || [])
            .filter(card => !["provisionally_cleared"].includes(card.clearance?.status))
            .filter(card => !repaidTitles.has(card.target || card.prompt || ""))
            .map(card => ({
              reportId: report.id,
              cardId: card.id,
              title: card.target || card.prompt || "Cognitive debt",
              status: card.clearance?.status || "not_started",
              locale: report.locale || "zh-CN"
            }))
        ).slice(0, 12);
        const clearedCardTitles = new Set();
        for (const report of reports) {
          for (const card of report.sections?.feynmanCards || []) {
            if (card.clearance?.status === "provisionally_cleared") {
              clearedCardTitles.add(card.target || card.prompt || "Cognitive debt");
            }
          }
        }
        const repaidCount = new Set([...repaidTitles, ...clearedCardTitles]).size;
        const activeSession = sessions.find(session => session.state !== "ended") || null;
        const activeCard = activeSession
          ? reports.find(report => report.id === activeSession.reportId)?.sections?.feynmanCards?.find(card => card.id === activeSession.cardId)
          : null;
        jsonResponse(res, 200, {
          ok: true,
          dashboard: {
            reportCount: reports.length,
            latestReport: latestReport ? { ...latestReport, display: deriveReportDisplay(latestReport) } : null,
            outstandingDebts,
            repaidCount,
            latestSession: latestSession ? {
              ...publicSession(latestSession, { revealScaffold: latestSession.attempts?.length > 0 }),
              reportDisplay: latestSessionReport ? deriveReportDisplay(latestSessionReport) : null,
              cardTitle: latestSessionCard?.target || latestSession.originalCard?.target || latestSession.clearanceQuestion || "Cognitive debt",
              lastActivityAt: sessionLastActivityAt(latestSession)
            } : null,
            continuable: activeSession ? {
              sessionId: activeSession.id,
              reportId: activeSession.reportId,
              cardId: activeSession.cardId,
              title: activeCard?.target || activeSession.clearanceQuestion || "Cognitive debt"
            } : null
          }
        });
        return;
      }
      if (req.method === "GET" && mvp1SessionMatch) {
        const session = loadOwnedMvp1Session(decodeURIComponent(mvp1SessionMatch[1]), user.id);
        if (!session) {
          jsonResponse(res, 404, { ok: false, error: "Clearance session not found" });
          return;
        }
        jsonResponse(res, 200, { ok: true, session: publicSession(session, { revealScaffold: session.attempts.length > 0 }) });
        return;
      }
      if (req.method === "GET" && mvp0ReportMatch) {
        try {
          const report = mvp0Store.getReport(decodeURIComponent(mvp0ReportMatch[1]), user.id);
          jsonResponse(res, 200, { ok: true, report });
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
        }
        return;
      }

      if (url.pathname === "/api/mvp0/report") requireJsonRequest(req);
      const payload = parseJson(await readBody(req));

      // ── MVP-1: source-grounded debt clearance ──

      if (url.pathname === "/api/mvp1/sessions") {
        try {
          if ((!aiApiKey || disableAi) && !mvp1DemoFallback) {
            jsonResponse(res, 503, { ok: false, error: "MVP-1 external research requires an active OpenAI API configuration" });
            return;
          }
          const reportId = clean(payload.reportId || "");
          const cardId = clean(payload.cardId || "");
          if (!reportId || !cardId) {
            jsonResponse(res, 400, { ok: false, error: "Missing reportId or cardId" });
            return;
          }
          const report = mvp0Store.getReport(reportId, user.id);
          // ── 聚合用户历史能力三层快照，用于调整 clearance 初始难度 ──
          let priorProfile = null;
          try {
            const historicalReports = mvp0Store.listReports(user.id);
            const capabilityProfiles = repaymentStore.listCapabilityProfiles(user.id);
            if (historicalReports.length > 0 || capabilityProfiles.length > 0) {
              priorProfile = buildCapabilitySnapshot({
                reports: historicalReports,
                capabilityProfiles,
                userId: user.id
              });
            }
          } catch (snapshotError) {
            console.warn(`Capability snapshot failed for clearance (user ${user.id}): ${snapshotError.message}`);
          }
          const session = await startClearanceSession({ report, cardId, researchFn: researchClearanceContext, priorProfile });
          session.userId = user.id;
          session.locale = report.locale || (payload.locale === "en" ? "en" : "zh-CN");
          await mvp1Store.saveSession(session);
          jsonResponse(res, 200, { ok: true, session: publicSession(session) });
        } catch (error) {
          const status = /not found/i.test(String(error.message)) ? 404 : 502;
          jsonResponse(res, status, { ok: false, error: error.message });
        }
        return;
      }

      if (mvp1AnswerMatch) {
        try {
          const session = loadOwnedMvp1Session(decodeURIComponent(mvp1AnswerMatch[1]), user.id);
          if (!session) {
            jsonResponse(res, 404, { ok: false, error: "Clearance session not found" });
            return;
          }
          const attempt = await submitClearanceAnswer({
            session,
            answer: payload.answer,
            analyzeFn: analyzeClearanceAnswer
          });
          await mvp1Store.saveSession(session);
          jsonResponse(res, 200, {
            ok: true,
            attempt,
            session: publicSession(session, { revealScaffold: true })
          });
        } catch (error) {
          jsonResponse(res, 400, { ok: false, error: error.message });
        }
        return;
      }

      if (mvp1EndMatch) {
        const session = loadOwnedMvp1Session(decodeURIComponent(mvp1EndMatch[1]), user.id);
        if (!session) {
          jsonResponse(res, 404, { ok: false, error: "Clearance session not found" });
          return;
        }
        const result = endClearanceSession(session);
        // The first repayment counts toward cohort progress, but the permanent
        // Genesis identity is awarded only after the full challenge review.
        const genesisIdentity = authStore.getUserById(user.id)?.genesisIdentity || null;
        try {
          await mvp0Store.updateCardClearance(session.reportId, session.cardId, {
            sessionId: session.id,
            status: result.status,
            sourceReviewRequired: result.sourceReviewRequired,
            endedAt: session.endedAt,
            nextRecommendation: result.nextRecommendation,
            remainingGaps: result.remainingGaps
          }, user.id);
        } catch (error) {
          console.warn(`MVP-1 clearance write-back failed for session ${session.id}: ${error.message}`);
        }
        // ── 训练系统接入：将会话转换为 TrainingAttempt ──
        try {
          const report = mvp0Store.getReport(session.reportId, user.id);
          const card = report?.sections?.feynmanCards?.find(c => c.id === session.cardId);
          const gap = report?.sections?.dangerousGaps?.[0];
          const gapText = gap?.gap || card?.target || session.originalCard?.target || "";

          let debt = trainingStore.findCognitiveDebtByGap(user.id, gapText);
          if (!debt) {
            debt = createCognitiveDebt({
              userId: user.id,
              reportId: session.reportId,
              cardId: session.cardId,
              gapText,
              gapEvidence: gap?.evidence || ""
            });
          }
          debt.status = "initial_training";
          debt.updatedAt = new Date().toISOString();
          if (!debt.sourceReports.includes(session.reportId)) {
            debt.sourceReports.push(session.reportId);
          }
          await trainingStore.saveCognitiveDebt(debt);

          const lastAnalysis = session.attempts?.[session.attempts.length - 1]?.analysis;
          const evaluation = deriveEvaluationFromAnalysis(lastAnalysis, [], "initial_compensation");

          const attempt = createAttemptFromClearanceSession(session, {
            userId: user.id,
            cognitiveDebtId: debt.id,
            hintEvents: [],
            evaluation
          });
          await trainingStore.saveAttempt(attempt);
          await projectMemoryRecordTrainingEvidence(attempt, user.id);

          let profile = trainingStore.getMasteryProfile(debt.id);
          profile = updateMasteryProfile(profile, attempt);
          await trainingStore.saveMasteryProfile(profile);

          const newStatus = deriveStatusFromStage("initial_compensation", evaluation);
          debt.status = newStatus;
          debt.updatedAt = new Date().toISOString();
          await trainingStore.saveCognitiveDebt(debt);

          const { nextReviewAt } = calculateNextReview({
            trainingStage: "initial_compensation",
            evaluation,
            hintEvents: [],
            previousAttempts: [attempt],
            currentMastery: profile
          });
          profile.nextReviewAt = nextReviewAt;
          await trainingStore.saveMasteryProfile(profile);

          const reviewTask = generateRuleBasedReviewTask({
            debt,
            card: card || session.originalCard,
            firstAttempt: attempt,
            mastery: profile,
            trainingStage: "delayed_recall",
            dueAt: nextReviewAt,
            userId: user.id
          });
          await trainingStore.saveReviewTask(reviewTask);
          // 异步触发智能分类，不阻塞会话结束响应
          scheduleDebtIntelligence(debt, { reportId: session.reportId });
        } catch (trainingError) {
          console.warn(`Training system integration failed for session ${session.id}: ${trainingError.message}`);
        }
        await mvp1Store.saveSession(session);
        jsonResponse(res, 200, {
          ok: true,
          result,
          session: publicSession(session, { revealScaffold: true }),
          genesisIdentity
        });
        return;
      }

      // ── MVP-0: cognitive-debt clearance report ──

      if (url.pathname === "/api/mvp0/report") {
        let draft = null;
        const draftId = clean(payload.draftId || "");
        if (draftId) {
          try {
            draft = mvp0Store.getDraft(draftId, user.id);
          } catch (error) {
            jsonResponse(res, 404, { ok: false, error: error.message });
            return;
          }
        }
        const artifactText = validateArtifactText(draft ? draft.input.artifactText : payload.artifactText);
        let artifactType = clean(draft ? draft.input.artifactType : payload.artifactType || "");
        if (!draft) consumeAnalysisQuota(user.id, artifactText);
        // Auto-detect type if not provided or empty
        if (!artifactType) {
          artifactType = detectArtifactType(artifactText);
        }
        const timeline = draft ? draft.timeline : (payload.timeline && typeof payload.timeline === "object" ? payload.timeline : null);
        const confusions = draft
          ? confusionsFromTimeline(draft.timeline)
          : (Array.isArray(payload.confusions) ? payload.confusions : []);
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        // ── 聚合用户历史能力三层快照（L1 报告历史 + L2/L3 capabilityProfile）──
        let priorProfile = null;
        try {
          const historicalReports = mvp0Store.listReports(user.id);
          const capabilityProfiles = repaymentStore.listCapabilityProfiles(user.id);
          if (historicalReports.length > 0 || capabilityProfiles.length > 0) {
            priorProfile = buildCapabilitySnapshot({
              reports: historicalReports,
              capabilityProfiles,
              userId: user.id
            });
          }
        } catch (snapshotError) {
          // 快照构造失败不应阻断报告生成；降级为无先验（冷启动等价行为）
          console.warn(`Capability snapshot failed for user ${user.id}: ${snapshotError.message}`);
        }
        const report = await generateClearanceReport(artifactText, artifactType, chatFn, {
          researchFn: mvp0ResearchFn,
          timeline,
          confusions,
          locale: draft?.locale || (payload.locale === "en" ? "en" : "zh-CN"),
          priorProfile
        });
        if (draft) report.draftId = draft.id;
        report.userId = user.id;
        report.locale = draft?.locale || (payload.locale === "en" ? "en" : "zh-CN");
        const saved = await traceSpan("sqlite.report_save", { userId: user.id, reportId: report.id || "new" }, () => mvp0Store.saveReport(report));
        traceEvent("report.generated", { reportId: saved.id, userId: user.id });
        // 报告生成即建立“领域占位画像”：只记录主题存在，不伪造用户掌握证据。
        try {
          const reportDomain = deriveReportCapabilityDomain(saved);
          if (reportDomain) {
            const profile = ensureCapabilityProfileDomain({
              profiles: repaymentStore.getState().capabilityProfiles,
              userId: user.id,
              domain: reportDomain,
              reportId: saved.id,
              now: saved.createdAt || new Date().toISOString()
            });
            if (profile) await repaymentStore.saveCapabilityProfile(profile);
          }
        } catch (profileError) {
          // 画像写入失败不应让已经成功生成的报告失败。
          console.warn(`Capability domain initialization failed for report ${saved.id}: ${profileError.message}`);
        }
        if (draft) {
          await mvp0Store.attachReportToDraft(draft.id, saved.id, user.id);
        }
        // ── 重复缺口检测与复发识别 ──
        try {
          const gaps = saved.sections?.dangerousGaps || [];
          for (const gap of gaps) {
            const gapText = String(gap.gap || "").trim();
            if (!gapText) continue;
            const existingDebt = trainingStore.findCognitiveDebtByGap(user.id, gapText);
            if (existingDebt) {
              // 同一缺口再次出现
              existingDebt.recurrenceCount = (existingDebt.recurrenceCount || 0) + 1;
              if (!existingDebt.sourceReports.includes(saved.id)) {
                existingDebt.sourceReports.push(saved.id);
              }
              existingDebt.updatedAt = new Date().toISOString();

              // 如果之前已 mastered，标记为 relapsed
              if (existingDebt.status === "mastered") {
                existingDebt.status = "relapsed";
                const profile = trainingStore.getMasteryProfile(existingDebt.id);
                if (profile) {
                  const relapsedProfile = handleRelapse(profile);
                  await trainingStore.saveMasteryProfile(relapsedProfile);
                }
              }
              await trainingStore.saveCognitiveDebt(existingDebt);
            } else {
              // 新缺口，创建认知欠条
              const newDebt = createCognitiveDebt({
                userId: user.id,
                reportId: saved.id,
                cardId: saved.sections?.feynmanCards?.find(card =>
                  String(card.target || "").trim() === gapText || String(card.prompt || "").trim() === gapText
                )?.id,
                gapText,
                gapEvidence: String(gap.evidence || "").slice(0, 1000)
              });
              await trainingStore.saveCognitiveDebt(newDebt);
              // 异步触发智能分类，不阻塞报告响应
              scheduleDebtIntelligence(newDebt, { reportId: saved.id });
            }
          }
        } catch (debtError) {
          console.warn(`Cognitive debt detection failed for report ${saved.id}: ${debtError.message}`);
        }
        // 报告一生成就进入清偿集合；重复请求由 reportId + gapRank 幂等去重。
        await syncRepaymentGapsFromReports(user.id);
        const isFallback = Boolean(saved.generation?.fallback);
        jsonResponse(res, 200, {
          ok: true,
          report: saved,
          fallback: isFallback,
          ...(isFallback && saved.generation?.error ? { error: saved.generation.error } : {}),
          detectedType: artifactType
        });
        return;
      }

      if (mvp0CardAnswerMatch) {
        try {
          const reportId = decodeURIComponent(mvp0CardAnswerMatch[1]);
          const cardId = decodeURIComponent(mvp0CardAnswerMatch[2]);
          const answer = clean(payload.answer || "");
          if (!answer) {
            jsonResponse(res, 400, { ok: false, error: "Missing answer" });
            return;
          }
          const report = mvp0Store.getReport(reportId, user.id);
          const card = report.sections.feynmanCards?.find(item => item.id === cardId);
          if (!card) {
            jsonResponse(res, 404, { ok: false, error: `Feynman card not found: ${cardId} in report ${reportId}` });
            return;
          }
          const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
          const followUpResult = await feynmanFollowUp(card, answer, chatFn);
          const aiFollowUp = followUpResult.shouldFollowUp
            ? followUpResult.followUp
            : followUpResult.summary;
          const result = await mvp0Store.updateCardAnswer(reportId, cardId, answer, aiFollowUp, user.id);
          jsonResponse(res, 200, {
            ok: true,
            card: result.card,
            shouldFollowUp: followUpResult.shouldFollowUp,
            fallback: (!aiApiKey || disableAi)
          });
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
        }
        return;
      }

      if (mvp0CorrectionMatch) {
        try {
          const reportId = decodeURIComponent(mvp0CorrectionMatch[1]);
          const result = await mvp0Store.addCorrection(reportId, {
            target: payload.target,
            targetId: payload.targetId,
            originalValue: payload.originalValue,
            correctedValue: payload.correctedValue,
            reason: payload.reason
          }, user.id);
          jsonResponse(res, 200, {
            ok: true,
            correction: result.correction,
            report: result.report
          });
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
        }
        return;
      }
    }

    // ── Cognitive repayment V1: evidence-bound gap repayment loop ──

    if (req.method === "GET" && url.pathname === "/api/repayment/status") {
      jsonResponse(res, 200, {
        ok: true,
        enabled: cognitiveRepaymentV1,
        versions: {
          evaluatorVersion: EVALUATOR_VERSION,
          promptSchemaVersion: PROMPT_SCHEMA_VERSION,
          dataSchemaVersion: DATA_SCHEMA_VERSION
        }
      });
      return;
    }

    const repaymentGapMatch = url.pathname.match(/^\/api\/repayment\/gaps\/([^/]+)$/);
    const repaymentAttemptsMatch = url.pathname.match(/^\/api\/repayment\/gaps\/([^/]+)\/attempts$/);
    const repaymentDismissMatch = url.pathname.match(/^\/api\/repayment\/review-queue\/([^/]+)\/dismiss$/);
    const isRepaymentRoute =
      url.pathname === "/api/repayment/gaps/import" ||
      url.pathname === "/api/repayment/gaps" ||
      Boolean(repaymentGapMatch) ||
      Boolean(repaymentAttemptsMatch) ||
      url.pathname === "/api/repayment/review-queue" ||
      Boolean(repaymentDismissMatch) ||
      url.pathname === "/api/repayment/profile";
    if (isRepaymentRoute) {
      if (!cognitiveRepaymentV1) {
        jsonResponse(res, 404, { ok: false, error: "Cognitive repayment V1 is disabled" });
        return;
      }
      const user = requireAuth(req, res);
      if (!user) return;

      if (req.method === "POST" && url.pathname === "/api/repayment/gaps/import") {
        const payload = parseJson(await readBody(req));
        const reportId = clean(payload.reportId || "");
        if (!reportId) {
          jsonResponse(res, 400, { ok: false, error: "Missing reportId" });
          return;
        }
        let report;
        try {
          report = mvp0Store.getReport(reportId, user.id);
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
          return;
        }
        const hasGapRank = payload.gapRank !== undefined && payload.gapRank !== null && payload.gapRank !== "";
        const cardId = clean(payload.cardId || "");
        if (!hasGapRank && !cardId) {
          jsonResponse(res, 400, { ok: false, error: "Missing gapRank or cardId" });
          return;
        }
        let gap;
        try {
          gap = createGapFromReport({
            report,
            gapRef: hasGapRank ? { gapRank: Number(payload.gapRank) } : { cardId },
            userId: user.id,
            now: new Date().toISOString()
          });
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
          return;
        }
        const existing = repaymentStore.listGaps(user.id).find(
          item => item.reportId === gap.reportId && item.gapRank === gap.gapRank
        );
        if (existing) {
          jsonResponse(res, 200, { ok: true, gap: existing, deduplicated: true });
          return;
        }
        await repaymentStore.saveGap(gap);
        jsonResponse(res, 200, { ok: true, gap });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/repayment/gaps") {
        await syncRepaymentGapsFromReports(user.id);
        const status = clean(url.searchParams.get("status") || "");
        const gaps = repaymentStore.listGaps(user.id, status ? { status } : {}).map(gap => {
          const attempts = repaymentStore.listAttemptsForGap(gap.gapId);
          const pendingReview = repaymentStore.listReviewItems(user.id, { status: "pending" })
            .find(item => item.gapId === gap.gapId);
          return {
            ...gap,
            latestAttempt: attempts[attempts.length - 1] || null,
            nextReviewAt: pendingReview ? pendingReview.dueAt : null
          };
        });
        jsonResponse(res, 200, { ok: true, gaps });
        return;
      }

      if (req.method === "GET" && repaymentGapMatch) {
        const gapId = decodeURIComponent(repaymentGapMatch[1]);
        let gap;
        try {
          gap = repaymentStore.getGap(gapId, user.id);
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
          return;
        }
        const statusBefore = gap.status;
        refreshReviewDue(gap, { now: new Date().toISOString(), reviewQueue: repaymentStore.getState().reviewQueue });
        if (gap.status !== statusBefore) {
          await repaymentStore.persist();
        }
        jsonResponse(res, 200, {
          ok: true,
          gap,
          attempts: repaymentStore.listAttemptsForGap(gap.gapId),
          reviewItems: repaymentStore.getState().reviewQueue.filter(item => item.gapId === gap.gapId)
        });
        return;
      }

      if (req.method === "POST" && repaymentAttemptsMatch) {
        const gapId = decodeURIComponent(repaymentAttemptsMatch[1]);
        const payload = parseJson(await readBody(req));
        const answer = String(payload.answer || "").trim();
        if (!answer) {
          jsonResponse(res, 400, { ok: false, error: "Missing answer" });
          return;
        }
        let gap;
        try {
          gap = repaymentStore.getGap(gapId, user.id);
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
          return;
        }
        const clientAttemptId = clean(payload.clientAttemptId || "");
        if (clientAttemptId) {
          const existingAttempt = repaymentStore.findAttemptByClientId(gap.gapId, clientAttemptId);
          if (existingAttempt) {
            jsonResponse(res, 200, { ok: true, attempt: existingAttempt, gap, deduplicated: true });
            return;
          }
        }
        const now = new Date().toISOString();
        refreshReviewDue(gap, { now, reviewQueue: repaymentStore.getState().reviewQueue });
        if (gap.status === "archived") {
          jsonResponse(res, 409, { ok: false, error: "Repayment gap is archived and cannot be answered" });
          return;
        }
        if (gap.status !== "attempting") {
          transitionGapStatus(gap, "attempting", { reason: "提交清偿回答", now });
        }
        const previousAttempts = repaymentStore.listAttemptsForGap(gap.gapId);
        let evaluation;
        let feedback = "";
        let nextQuestion = "";
        let fallbackUsed = false;
        let errorCategory = null;
        try {
          if (!aiApiKey || disableAi) {
            const error = new Error(disableAi ? "AI is disabled (SPIRAL_DISABLE_AI=1)" : "AI_API_KEY is not set");
            error.errorCategory = "unavailable";
            throw error;
          }
          const raw = await chatJson([
            { role: "system", content: getRepaymentEvaluationPrompt() },
            {
              role: "user",
              content: JSON.stringify({
                gapTitle: gap.title,
                evidence: gap.evidence,
                verificationMethod: gap.verificationMethod,
                answer,
                previousAttempts: previousAttempts
                  .map(item => ({ answer: item.answer, passed: Boolean(item.evaluation?.passed) }))
                  .slice(-3)
              })
            }
          ], () => ({ __unavailable: true }));
          evaluation = normalizeRepaymentEvaluation(raw);
          feedback = evaluation.overallFeedback;
          nextQuestion = evaluation.nextQuestion;
        } catch (error) {
          errorCategory = classifyRepaymentError(error);
          const fallback = createFallbackEvaluation({ gap, answer });
          evaluation = fallback;
          feedback = fallback.overallFeedback;
          nextQuestion = fallback.nextQuestion;
          fallbackUsed = true;
          console.warn(`Repayment evaluation degraded to fallback (${errorCategory}): ${error.message}`);
        }
        const attempt = buildAttemptRecord({
          gap,
          answer,
          selfConfidence: payload.selfConfidence,
          evaluation,
          feedback,
          nextQuestion,
          repaymentStatus: resolveAttemptOutcome({ evaluation }, previousAttempts),
          fallbackUsed,
          errorCategory,
          modelProvider: aiProvider,
          modelName: chatModel,
          clientAttemptId,
          now
        });
        const { record: savedAttempt } = await traceSpan("sqlite.repayment_save", { userId: user.id, gapId: gap.gapId }, () => repaymentStore.saveAttempt(attempt));
        traceEvent("repayment.updated", { userId: user.id, gapId: gap.gapId, status: savedAttempt.repaymentStatus });
        completePendingReviewItems({ reviewQueue: repaymentStore.getState().reviewQueue, gapId: gap.gapId, now });
        applyAttemptOutcome(gap, savedAttempt, { now, previousAttempts });
        upsertReviewItemForGap({ reviewQueue: repaymentStore.getState().reviewQueue, gap, attempt: savedAttempt, now });
        let domain = "general";
        try {
          const gapReport = mvp0Store.getReport(gap.reportId, user.id);
          domain = clean(gapReport?.analysis?.userCapability?.currentDomain || "") || "general";
        } catch {}
        updateCapabilityProfile({
          profiles: repaymentStore.getState().capabilityProfiles,
          userId: user.id,
          domain,
          attempt: savedAttempt,
          now
        });
        await repaymentStore.persist();
        jsonResponse(res, 200, { ok: true, attempt: savedAttempt, gap });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/repayment/review-queue") {
        const items = repaymentStore.listReviewItems(user.id, { status: "pending" }).map(item => {
          let gap = null;
          try {
            gap = repaymentStore.getGap(item.gapId, user.id);
          } catch {}
          return { ...item, gapTitle: gap?.title || null, gapStatus: gap?.status || null };
        });
        jsonResponse(res, 200, { ok: true, items });
        return;
      }

      if (req.method === "POST" && repaymentDismissMatch) {
        const reviewItemId = decodeURIComponent(repaymentDismissMatch[1]);
        const item = repaymentStore.getState().reviewQueue.find(
          entry => entry.reviewItemId === reviewItemId && entry.userId === user.id
        );
        if (!item) {
          jsonResponse(res, 404, { ok: false, error: "Review item not found" });
          return;
        }
        item.status = "dismissed";
        item.updatedAt = new Date().toISOString();
        await repaymentStore.persist();
        jsonResponse(res, 200, { ok: true, item });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/repayment/profile") {
        const profiles = repaymentStore.listCapabilityProfiles(user.id);
        if (profiles.length === 0) {
          jsonResponse(res, 200, { ok: true, profiles: [], degraded: true, note: "暂无能力画像数据" });
          return;
        }
        jsonResponse(res, 200, { ok: true, profiles });
        return;
      }

      jsonResponse(res, 404, { ok: false, error: "Not found" });
      return;
    }

    // ── Device channels (Rokid/G2 glasses): a per-user device token scopes
    // the response to its owner; the admin token stays as a labelled
    // fallback. These routes must run before the admin-token gate below. ──

    if (req.method === "GET" && url.pathname === "/api/rokid/clearance-entry") {
      const channel = resolveDeviceChannel(req, res);
      if (!channel) return;
      const reports = channel.adminChannel ? mvp0Store.listReports() : mvp0Store.listReports(channel.userId);
      const requestedReportId = url.searchParams.get("reportId") || "";
      const requestedCardId = url.searchParams.get("cardId") || "";
      const report = requestedReportId
        ? reports.find(item => item.id === requestedReportId)
        : reports.find(item => item.sections?.feynmanCards?.length);
      if (!report || !report.sections?.feynmanCards?.length) {
        jsonResponse(res, 200, {
          ok: true,
          platform: "rokid-aiui",
          ...(channel.adminChannel ? { _adminChannel: true } : {}),
          entry: null
        });
        return;
      }
      const cards = report.sections.feynmanCards;
      const card = (requestedCardId && cards.find(item => item.id === requestedCardId)) ||
        cards.find(item => !item.userAnswer) || cards[0];
      const cardIndex = cards.findIndex(item => item.id === card.id);
      jsonResponse(res, 200, {
        ok: true,
        platform: "rokid-aiui",
        ...(channel.adminChannel ? { _adminChannel: true } : {}),
        entry: {
          reportId: report.id,
          cardId: card.id,
          nextCardId: cards.length > 1 ? cards[(cardIndex + 1) % cards.length].id : "",
          createdAt: report.createdAt,
          domain: clean(report.analysis?.userCapability?.currentDomain || "认知债务"),
          target: clean(card.target || "理解缺口"),
          prompt: clean(card.prompt || "请用自己的话解释这个问题。"),
          cardNumber: cardIndex + 1,
          cardCount: cards.length
        }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/g2/session") {
      const channel = resolveDeviceChannel(req, res);
      if (!channel) return;
      const session = spiralStore.buildSession(url.searchParams.get("duration"));
      jsonResponse(res, 200, { ok: true, session, ...(channel.adminChannel ? { _adminChannel: true } : {}) });
      return;
    }

    // Web 报告/草稿链路使用账号的 HttpOnly session Cookie，不应先落入
    // 旧的 service-token 兼容闸门。否则 Cookie 失效时会返回误导性的
    // "Invalid token"，用户会误以为需要填写 MCP/Hook Token。
    const isWebDraftOrTimelineRequest =
      url.pathname === "/api/mvp0/drafts" ||
      url.pathname === "/api/mvp0/timelines" ||
      /^\/api\/mvp0\/drafts\/[^/]+$/.test(url.pathname);
    if (isWebDraftOrTimelineRequest) {
      const user = requireAuth(req, res);
      if (!user) return;

    // G2 full deck: returns the four-layer feynman cards for the device's
    // visible reports. Reuses the same device channel and report selection
    // logic as /api/rokid/clearance-entry, but emits the whole cards array.
    if (req.method === "GET" && url.pathname === "/api/g2/deck") {
      const channel = resolveDeviceChannel(req, res);
      if (!channel) return;
      const reports = channel.adminChannel ? mvp0Store.listReports() : mvp0Store.listReports(channel.userId);
      const requestedReportId = url.searchParams.get("reportId") || "";
      const report = requestedReportId
        ? reports.find(item => item.id === requestedReportId)
        : reports.find(item => item.sections?.feynmanCards?.length);
      const adminTag = channel.adminChannel ? { _adminChannel: true } : {};
      if (!report || !report.sections?.feynmanCards?.length) {
        jsonResponse(res, 200, {
          ok: true,
          contractVersion: 1,
          reportId: "",
          createdAt: "",
          ...adminTag,
          cards: []
        });
        return;
      }
      const cards = report.sections.feynmanCards.map(card => ({
        id: clean(card.id || ""),
        reportId: report.id,
        gapId: clean(card.target || ""),
        title: clean(card.prompt || ""),
        whyItMatters: clean(card.whyItMatters || ""),
        evidence: clean(card.evidence || ""),
        referenceAnswer: clean(card.referenceAnswer || ""),
        sourceRef: clean(card.sourceRef || "")
      }));
      jsonResponse(res, 200, {
        ok: true,
        contractVersion: 1,
        reportId: report.id,
        createdAt: report.createdAt || "",
        ...adminTag,
        cards
      });
      return;
    }

    // G2 marks: accepts a batch of card mastery marks with idempotent
    // deduplication. Marks are session-level evidence stored in memory; they
    // do not certify durable mastery and never upgrade to clearance state.
    if (req.method === "POST" && url.pathname === "/api/g2/marks") {
      const channel = resolveDeviceChannel(req, res);
      if (!channel) return;
      let payload;
      try {
        payload = parseJson(await readBody(req));
      } catch {
        jsonResponse(res, 400, { ok: false, error: "Invalid JSON body" });
        return;
      }
      const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : "";
      const rawMarks = Array.isArray(payload.marks) ? payload.marks : null;
      if (!idempotencyKey || !rawMarks) {
        jsonResponse(res, 400, { ok: false, error: "idempotencyKey and marks are required" });
        return;
      }
      const validLayers = ["question", "why", "evidence", "answer"];
      const normalized = [];
      for (const item of rawMarks) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          jsonResponse(res, 400, { ok: false, error: "each mark must be an object" });
          return;
        }
        const cardId = typeof item.cardId === "string" ? item.cardId.trim() : "";
        const mark = item.mark;
        const deepestLayer = item.deepestLayer;
        if (!cardId || (mark !== "known" && mark !== "review")) {
          jsonResponse(res, 400, { ok: false, error: "mark requires cardId and mark (known|review)" });
          return;
        }
        if (!validLayers.includes(deepestLayer)) {
          jsonResponse(res, 400, { ok: false, error: "deepestLayer must be question|why|evidence|answer" });
          return;
        }
        normalized.push({
          cardId,
          mark,
          deepestLayer,
          answerRevealed: Boolean(item.answerRevealed)
        });
      }
      if (g2MarksStore.has(idempotencyKey)) {
        jsonResponse(res, 200, g2MarksStore.get(idempotencyKey).result);
        return;
      }
      const userId = channel.adminChannel ? null : channel.userId;
      const timestamp = new Date().toISOString();
      const records = normalized.map(mark => ({ ...mark, userId, timestamp }));
      const result = { ok: true, accepted: normalized.length, idempotencyKey };
      g2MarksStore.set(idempotencyKey, { result, records });
      jsonResponse(res, 200, result);
      return;
    }

    if (!requireToken(req, res)) return;
    if (req.method === "GET" && url.pathname === "/api/access/session") {
      const identity = authorizeRequest(req) || { label: "local-user", method: "disabled" };
      jsonResponse(res, 200, {
        ok: true,
        user: { label: identity.label },
        method: identity.method
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/learn/events") {
      const since = url.searchParams.get("since");
      const events = since ? eventLog.filter(event => event.at > since) : eventLog.slice(-80);
      jsonResponse(res, 200, { ok: true, events });
      return;
    }
    if (req.method === "GET" && ["/api/spiral/today", "/api/g2/today"].includes(url.pathname)) {
      jsonResponse(res, 200, spiralStore.dashboard());
      return;
    }
    if (req.method === "GET" && ["/api/spiral/atoms", "/api/spiral/debts"].includes(url.pathname)) {
      const dashboard = spiralStore.dashboard();
      jsonResponse(res, 200, { ok: true, atoms: dashboard.atoms, debts: dashboard.debts });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/spiral/reviews") {
      const dashboard = spiralStore.dashboard();
      jsonResponse(res, 200, { ok: true, reviews: dashboard.reviews, report: dashboard.report });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/spiral/candidates") {
      jsonResponse(res, 200, {
        ok: true,
        candidates: spiralStore.listCandidates(url.searchParams.get("status") || "")
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/review/next") {
      const mode = url.searchParams.get("mode") || "learn";
      if (mode !== "learn") {
        jsonResponse(res, 501, { ok: false, error: "Thought mode starts in Spiral v0.2" });
        return;
      }
      jsonResponse(res, 200, { ok: true, mode, card: spiralStore.nextReview() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/rokid/session") {
      jsonResponse(
        res,
        200,
        rokidSession(url.searchParams.get("duration"), url.searchParams.get("demo") === "1")
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/mentra/clearance-entry") {
      jsonResponse(res, 200, clearanceEntryPayload("mentra"));
      return;
    }

    // ── Training system: today's review tasks and cognitive debts ──
    if (req.method === "GET" && url.pathname === "/api/training/today") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const dueTasks = trainingStore.listDueReviews(userId);
      const profiles = trainingStore.listMasteryProfiles(userId);
      const profileMap = {};
      for (const p of profiles) {
        profileMap[p.cognitiveDebtId] = p;
      }
      const sorted = sortReviewTasks(dueTasks, profileMap);
      jsonResponse(res, 200, {
        ok: true,
        totalDue: sorted.length,
        tasks: sorted.slice(0, 20),
        profiles
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/training/debts") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debts = trainingStore.listCognitiveDebts(userId);
      const profiles = trainingStore.listMasteryProfiles(userId);
      const profileMap = {};
      for (const p of profiles) {
        profileMap[p.cognitiveDebtId] = p;
      }
      const enriched = debts.map(debt => ({
        ...debt,
        mastery: profileMap[debt.id] || null,
        understandingLevel: profileMap[debt.id]
          ? deriveUnderstandingLevel(profileMap[debt.id])
          : "not_understood",
        masteryLabel: profileMap[debt.id]
          ? masteryLabel(deriveUnderstandingLevel(profileMap[debt.id]))
          : "正在补偿"
      }));
      jsonResponse(res, 200, { ok: true, debts: enriched });
      return;
    }

    if (req.method === "GET" && trainingDebtMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtMatch[1]);
      try {
        const debt = trainingStore.getCognitiveDebt(debtId, userId);
        const profile = trainingStore.getMasteryProfile(debtId);
        const attempts = trainingStore.listAttempts(userId, { cognitiveDebtId: debtId });
        const reviews = trainingStore.listReviewTasks(userId, { cognitiveDebtId: debtId });
        const understandingLevel = profile ? deriveUnderstandingLevel(profile) : "not_understood";
        jsonResponse(res, 200, {
          ok: true,
          debt,
          profile,
          attempts,
          reviews,
          understandingLevel,
          masteryLabel: masteryLabel(understandingLevel),
          projectMemory: projectMemoryStore.listDebtHistory(debtId, userId)
        });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    // ── 认知欠条智能分类：查询当前生效版本 ──
    if (req.method === "GET" && trainingDebtIntelligenceMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtIntelligenceMatch[1]);
      try {
        trainingStore.getCognitiveDebt(debtId, userId);
        const analysis = debtIntelligenceStore.getCurrentAnalysis(debtId);
        jsonResponse(res, 200, {
          ok: true,
          analysis,
          versionCount: debtIntelligenceStore.countAnalyses(debtId)
        });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    // ── 欠条关系与欠条簇（Phase 2）：查询 ──

    if (req.method === "GET" && trainingDebtRelationsMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtRelationsMatch[1]);
      try {
        trainingStore.getCognitiveDebt(debtId, userId);
        const relations = conceptGraphStore.listDebtRelations({ userId, cognitiveDebtId: debtId })
          .filter(item => item.status !== "user_rejected")
          .map(item => {
            const otherDebtId = item.sourceDebtId === debtId ? item.targetDebtId : item.sourceDebtId;
            let otherDebt = null;
            try {
              const debt = trainingStore.getCognitiveDebt(otherDebtId, userId);
              otherDebt = {
                id: debt.id,
                gapText: debt.gapText,
                status: debt.status,
                recurrenceCount: debt.recurrenceCount
              };
            } catch { /* 对方欠条已删除时保留 null */ }
            return { ...item, direction: item.sourceDebtId === debtId ? "outgoing" : "incoming", otherDebt };
          });
        jsonResponse(res, 200, { ok: true, relations });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    if (req.method === "GET" && trainingDebtClusterMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtClusterMatch[1]);
      try {
        trainingStore.getCognitiveDebt(debtId, userId);
        const membership = conceptGraphStore.listDebtClusterMembers({ cognitiveDebtId: debtId })[0] || null;
        const cluster = membership ? conceptGraphStore.getDebtCluster(membership.clusterId) : null;
        jsonResponse(res, 200, {
          ok: true,
          cluster: cluster ? buildClusterDetailPayload(cluster, userId) : null
        });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/training/clusters") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const clusters = conceptGraphStore.listDebtClusters(userId)
        .map(cluster => buildClusterDetailPayload(cluster, userId));
      jsonResponse(res, 200, { ok: true, clusters });
      return;
    }

    if (req.method === "GET" && trainingClusterMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const clusterId = decodeURIComponent(trainingClusterMatch[1]);
      const cluster = conceptGraphStore.getDebtCluster(clusterId);
      if (!cluster || cluster.userId !== userId) {
        jsonResponse(res, 404, { ok: false, error: `Debt cluster not found: ${clusterId}` });
        return;
      }
      jsonResponse(res, 200, { ok: true, cluster: buildClusterDetailPayload(cluster, userId) });
      return;
    }

    // ── 用户长期认知画像（Phase 3）──
    // 聚合全部读时计算（删除欠条后重算即生效）；结论记录按周期幂等刷新，
    // 确定性文案直接生成，模型仅在手动快照时对已算好的结论做措辞润色。

    if (req.method === "GET" && url.pathname === "/api/cognitive-profile/summary") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const rawPeriodDays = url.searchParams.get("periodDays");
      const requestedDays = rawPeriodDays === null ? NaN : Number(rawPeriodDays);
      const periodDays = Number.isFinite(requestedDays)
        ? Math.min(90, Math.max(7, Math.round(requestedDays)))
        : 30;
      const aggregates = computeProfileAggregates({
        userId,
        trainingStore,
        intelligenceStore: debtIntelligenceStore,
        profileStore: cognitiveProfileStore,
        periodDays
      });
      const { insights, aiEnhanced } = await generateInsights({
        userId,
        skills: aggregates.skills,
        gapPatterns: aggregates.patterns,
        learningBehavior: aggregates.learningBehavior,
        risks: aggregates.risks,
        periodStart: aggregates.patterns.periodStart,
        periodEnd: aggregates.patterns.periodEnd,
        store: cognitiveProfileStore
      });
      jsonResponse(res, 200, {
        ok: true,
        periodDays,
        calculationVersion: insights[0]?.calculationVersion || null,
        skills: aggregates.skills,
        patterns: aggregates.patterns,
        learning: aggregates.learningBehavior,
        risks: aggregates.risks,
        insights,
        aiEnhanced
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-profile/skills") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const aggregates = computeProfileAggregates({
        userId, trainingStore, intelligenceStore: debtIntelligenceStore, profileStore: cognitiveProfileStore
      });
      jsonResponse(res, 200, { ok: true, ...aggregates.skills });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-profile/patterns") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const rawPeriodDays = url.searchParams.get("periodDays");
      const requestedDays = rawPeriodDays === null ? NaN : Number(rawPeriodDays);
      const periodDays = Number.isFinite(requestedDays)
        ? Math.min(90, Math.max(7, Math.round(requestedDays)))
        : 30;
      const aggregates = computeProfileAggregates({
        userId, trainingStore, intelligenceStore: debtIntelligenceStore, profileStore: cognitiveProfileStore, periodDays
      });
      jsonResponse(res, 200, { ok: true, ...aggregates.patterns });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-profile/learning") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const aggregates = computeProfileAggregates({
        userId, trainingStore, intelligenceStore: debtIntelligenceStore, profileStore: cognitiveProfileStore
      });
      jsonResponse(res, 200, { ok: true, ...aggregates.learning });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-profile/risks") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const aggregates = computeProfileAggregates({
        userId, trainingStore, intelligenceStore: debtIntelligenceStore, profileStore: cognitiveProfileStore
      });
      jsonResponse(res, 200, { ok: true, ...aggregates.risks });
      return;
    }

    if (req.method === "GET" && profileInsightEvidenceMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const insightId = decodeURIComponent(profileInsightEvidenceMatch[1]);
      const insight = cognitiveProfileStore.getInsight(insightId, userId);
      if (!insight) {
        jsonResponse(res, 404, { ok: false, error: `Insight not found: ${insightId}` });
        return;
      }
      const debts = [];
      for (const debtId of insight.evidenceDebtIds) {
        try {
          const debt = trainingStore.getCognitiveDebt(debtId, userId);
          debts.push({
            id: debt.id,
            gapText: debt.gapText,
            status: debt.status,
            recurrenceCount: debt.recurrenceCount,
            createdAt: debt.createdAt
          });
        } catch { /* 欠条已删除：证据留空但结论仍可追溯 */ }
      }
      const attemptIdSet = new Set(insight.evidenceAttemptIds);
      const attempts = attemptIdSet.size > 0
        ? trainingStore.listAttempts(userId)
          .filter(attempt => attemptIdSet.has(attempt.id))
          .map(attempt => ({
            id: attempt.id,
            cognitiveDebtId: attempt.cognitiveDebtId,
            trainingStage: attempt.trainingStage,
            passed: Boolean(attempt.evaluation?.passed),
            overallScore: Number.isFinite(Number(attempt.evaluation?.overallScore))
              ? Number(attempt.evaluation.overallScore)
              : null,
            completedAt: attempt.completedAt || null
          }))
        : [];
      const clusters = insight.evidenceClusterIds
        .map(clusterId => conceptGraphStore.getDebtCluster(clusterId))
        .filter(cluster => cluster && cluster.userId === userId)
        .map(cluster => ({ id: cluster.id, title: cluster.title || cluster.id, clusterType: cluster.clusterType }));
      jsonResponse(res, 200, { ok: true, insight, evidence: { debts, attempts, clusters } });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-profile/snapshots") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const snapshotType = clean(url.searchParams.get("type") || "");
      const snapshots = cognitiveProfileStore.listSnapshots(
        userId,
        snapshotType ? { snapshotType } : {}
      );
      jsonResponse(res, 200, { ok: true, snapshots });
      return;
    }

    const mvp0DraftMatch = url.pathname.match(/^\/api\/mvp0\/drafts\/([^/]+)$/);
    const isDraftOrTimelineRoute =
      url.pathname === "/api/mvp0/drafts" ||
      url.pathname === "/api/mvp0/timelines" ||
      Boolean(mvp0DraftMatch);
    if (isDraftOrTimelineRoute) {
      const user = requireAuth(req, res);
      if (!user) return;

      if (req.method === "GET" && url.pathname === "/api/mvp0/drafts") {
        jsonResponse(res, 200, { ok: true, drafts: mvp0Store.listDrafts(user.id) });
        return;
      }
      if (req.method === "GET" && mvp0DraftMatch) {
        try {
          const draft = mvp0Store.getDraft(decodeURIComponent(mvp0DraftMatch[1]), user.id);
          jsonResponse(res, 200, { ok: true, draft });
        } catch (error) {
          jsonResponse(res, 404, { ok: false, error: error.message });
        }
        return;
      }
    } // close isDraftOrTimelineRoute

// ── 下一步学习编排（Phase 4）：今日推荐 / 每周重点（GET，必须在方法闸门之前） ──

    if (req.method === "GET" && url.pathname === "/api/learning-recommendations/today") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      try {
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        const result = await getTodayRecommendations(userId, {
          store: learningOrchestratorStore,
          trainingStore,
          intelligenceStore: debtIntelligenceStore,
          graphStore: conceptGraphStore
        }, { chatFn });
        jsonResponse(res, 200, { ok: true, ...result });
      } catch (error) {
        logEvent("error", "learning_recommendations_today_failed", { requestId, error: error.message });
        jsonResponse(res, 500, { ok: false, error: "学习推荐生成失败，请稍后重试" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/learning-recommendations/weekly-focus") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      try {
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        const result = await getWeeklyFocus(userId, {
          store: learningOrchestratorStore,
          trainingStore,
          intelligenceStore: debtIntelligenceStore,
          graphStore: conceptGraphStore
        }, { chatFn });
        jsonResponse(res, 200, { ok: true, ...result });
      } catch (error) {
        logEvent("error", "learning_weekly_focus_failed", { requestId, error: error.message });
        jsonResponse(res, 500, { ok: false, error: "每周学习重点生成失败，请稍后重试" });
      }
      return;
    }

    // ── 周期性认知报告（Phase 5）：周报 / 月报（GET，必须在方法闸门之前） ──
    // 读时生成、同周期幂等；历史报告只增不改。

    if (req.method === "GET" && url.pathname === "/api/cognitive-reports/weekly/latest") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      try {
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        const result = await getLatestWeeklyReport(userId, {
          store: cognitiveReportsStore,
          trainingStore,
          intelligenceStore: debtIntelligenceStore,
          profileStore: cognitiveProfileStore,
          graphStore: conceptGraphStore,
          orchestratorStore: learningOrchestratorStore
        }, { chatFn });
        jsonResponse(res, 200, { ok: true, ...result });
      } catch (error) {
        logEvent("error", "cognitive_reports_weekly_failed", { requestId, error: error.message });
        jsonResponse(res, 500, { ok: false, error: "认知周报生成失败，请稍后重试" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-reports/monthly/latest") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      try {
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        const result = await getLatestMonthlyReport(userId, {
          store: cognitiveReportsStore,
          trainingStore,
          intelligenceStore: debtIntelligenceStore,
          profileStore: cognitiveProfileStore,
          graphStore: conceptGraphStore,
          orchestratorStore: learningOrchestratorStore
        }, { chatFn });
        jsonResponse(res, 200, { ok: true, ...result });
      } catch (error) {
        logEvent("error", "cognitive_reports_monthly_failed", { requestId, error: error.message });
        jsonResponse(res, 500, { ok: false, error: "认知月报生成失败，请稍后重试" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cognitive-reports/history") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const reportType = clean(url.searchParams.get("type") || "");
      if (!["weekly", "monthly"].includes(reportType)) {
        jsonResponse(res, 400, { ok: false, error: "type must be weekly or monthly" });
        return;
      }
      // 注意：缺省参数时 Number(null) === 0，会把默认 limit 压成 1，必须先判空
      const limitParam = url.searchParams.get("limit");
      const rawLimit = limitParam === null || limitParam === "" ? NaN : Number(limitParam);
      const limit = Number.isFinite(rawLimit) ? Math.min(52, Math.max(1, Math.round(rawLimit))) : 12;
      const offsetParam = url.searchParams.get("offset");
      const rawOffset = offsetParam === null || offsetParam === "" ? NaN : Number(offsetParam);
      const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.round(rawOffset)) : 0;
      const all = cognitiveReportsStore.listReports(userId, { reportType });
      jsonResponse(res, 200, {
        ok: true,
        reportType,
        total: all.length,
        limit,
        offset,
        reports: all.slice(offset, offset + limit)
      });
      return;
    }

    const isOwnershipRoute = url.pathname.startsWith("/api/projects");
    if (!isOwnershipRoute && req.method !== "POST" && req.method !== "PATCH") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed", requestId });
      return;
    }
    if (url.pathname === "/api/mvp0/timelines") requireJsonRequest(req);
    const payload = (req.method === "POST" || req.method === "PATCH") ? parseJson(await readBody(req)) : {};

    // ── 认知欠条智能分类：回填 / 重新分类 / 人工纠正 ──

    if (req.method === "POST" && url.pathname === "/api/training/intelligence/backfill") {
      const user = requireAuth(req, res);
      if (!user) return;
      if (debtIntelligenceDisabled) {
        jsonResponse(res, 503, { ok: false, error: "Debt intelligence is disabled (DEBT_INTELLIGENCE_DISABLED=1)" });
        return;
      }
      if (!aiApiKey || disableAi) {
        jsonResponse(res, 503, { ok: false, error: "Debt intelligence requires an active AI configuration" });
        return;
      }
      const debts = trainingStore.listCognitiveDebts(user.id);
      const result = await backfillDebtIntelligence({
        store: debtIntelligenceStore,
        debts,
        chatFn: chatJson,
        modelName: chatModel,
        batchSize: payload.batchSize,
        offset: payload.offset ?? payload.cursor,
        reportContextFor: debt => buildDebtReportContext(debt)
      });
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    // ── 认知画像（Phase 3）：手动生成当日快照 + 幂等刷新结论（可经模型润色措辞） ──

    if (req.method === "POST" && url.pathname === "/api/cognitive-profile/snapshots") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const aggregates = computeProfileAggregates({
        userId,
        trainingStore,
        intelligenceStore: debtIntelligenceStore,
        profileStore: cognitiveProfileStore
      });
      const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
      const insightResult = await generateInsights({
        userId,
        skills: aggregates.skills,
        gapPatterns: aggregates.patterns,
        learningBehavior: aggregates.learningBehavior,
        risks: aggregates.risks,
        periodStart: aggregates.patterns.periodStart,
        periodEnd: aggregates.patterns.periodEnd,
        store: cognitiveProfileStore,
        chatFn
      });
      const snapshotResult = await buildAndSaveSnapshot({
        profileStore: cognitiveProfileStore,
        trainingStore,
        intelligenceStore: debtIntelligenceStore,
        userId,
        snapshotType: "manual"
      });
      jsonResponse(res, snapshotResult.created ? 201 : 200, {
        ok: true,
        created: snapshotResult.created,
        snapshot: snapshotResult.snapshot,
        insightCount: insightResult.insights.length,
        aiEnhanced: insightResult.aiEnhanced
      });
      return;
    }

    // ── 周期性认知报告（Phase 5）：手动生成本周期周报（幂等重算替换） ──

    if (req.method === "POST" && url.pathname === "/api/cognitive-reports/weekly/generate") {
      const user = requireAuth(req, res);
      if (!user) return;
      try {
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        const report = await generateWeeklyReport(user.id, {
          store: cognitiveReportsStore,
          trainingStore,
          intelligenceStore: debtIntelligenceStore,
          profileStore: cognitiveProfileStore,
          graphStore: conceptGraphStore,
          orchestratorStore: learningOrchestratorStore
        }, { chatFn });
        jsonResponse(res, 200, { ok: true, report });
      } catch (error) {
        logEvent("error", "cognitive_reports_weekly_generate_failed", { requestId, error: error.message });
        jsonResponse(res, 500, { ok: false, error: "认知周报生成失败，请稍后重试" });
      }
      return;
    }

    // ── 欠条关系（Phase 2）：手动全量扫描（幂等，复用 detectRelations 编排） ──

    if (req.method === "POST" && url.pathname === "/api/training/relations/scan") {
      const user = requireAuth(req, res);
      if (!user) return;
      if (debtIntelligenceDisabled) {
        jsonResponse(res, 503, { ok: false, error: "Debt intelligence is disabled (DEBT_INTELLIGENCE_DISABLED=1)" });
        return;
      }
      if (!aiApiKey || disableAi) {
        jsonResponse(res, 503, { ok: false, error: "Debt relation scan requires an active AI configuration" });
        return;
      }
      const result = await detectRelations({
        graphStore: conceptGraphStore,
        intelligenceStore: debtIntelligenceStore,
        trainingStore,
        userId: user.id,
        chatFn: chatJson,
        trigger: "manual_scan"
      });
      jsonResponse(res, 200, {
        ok: true,
        pairsConsidered: result.pairsConsidered,
        created: result.created,
        pending: result.pending,
        ...(result.skipped ? { skipped: result.skipped } : {})
      });
      return;
    }

    if (req.method === "POST" && trainingDebtReanalyzeMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtReanalyzeMatch[1]);
      let debt;
      try {
        debt = trainingStore.getCognitiveDebt(debtId, userId);
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
        return;
      }
      const current = debtIntelligenceStore.getCurrentAnalysis(debtId);
      if (current?.isUserCorrected) {
        jsonResponse(res, 409, {
          ok: false,
          error: "该欠条分类已被人工纠正，自动重新分类已锁定；如需更新请直接修改纠正内容"
        });
        return;
      }
      if (debtIntelligenceDisabled) {
        jsonResponse(res, 503, { ok: false, error: "Debt intelligence is disabled (DEBT_INTELLIGENCE_DISABLED=1)" });
        return;
      }
      if (!aiApiKey || disableAi) {
        jsonResponse(res, 503, { ok: false, error: "Debt intelligence requires an active AI configuration" });
        return;
      }
      scheduleDebtIntelligence(debt, { trigger: "reanalyze" });
      jsonResponse(res, 202, { ok: true, scheduled: true });
      return;
    }

    if (req.method === "PATCH" && trainingDebtIntelligenceMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtIntelligenceMatch[1]);
      try {
        const debt = trainingStore.getCognitiveDebt(debtId, userId);
        const analysis = await applyUserCorrection({
          store: debtIntelligenceStore,
          debt,
          patch: payload,
          modelName: chatModel
        });
        jsonResponse(res, 200, {
          ok: true,
          analysis,
          versionCount: debtIntelligenceStore.countAnalyses(debtId)
        });
      } catch (error) {
        const status = /not found/i.test(String(error.message)) ? 404 : 400;
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }

    // ── 欠条关系（Phase 2）：用户确认 / 拒绝 ──

    if (req.method === "POST" && trainingDebtRelationConfirmMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtRelationConfirmMatch[1]);
      const relationId = decodeURIComponent(trainingDebtRelationConfirmMatch[2]);
      try {
        const result = await confirmRelation({
          graphStore: conceptGraphStore,
          trainingStore,
          userId,
          debtId,
          relationId
        });
        jsonResponse(res, 200, {
          ok: true,
          relation: result.relation,
          relapse: result.relapse,
          alreadyConfirmed: Boolean(result.alreadyConfirmed)
        });
      } catch (error) {
        const status = error.statusCode || (/not found/i.test(String(error.message)) ? 404 : 400);
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }

    if (req.method === "POST" && trainingDebtRelationRejectMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const debtId = decodeURIComponent(trainingDebtRelationRejectMatch[1]);
      const relationId = decodeURIComponent(trainingDebtRelationRejectMatch[2]);
      try {
        const result = await rejectRelation({
          graphStore: conceptGraphStore,
          trainingStore,
          userId,
          debtId,
          relationId
        });
        jsonResponse(res, 200, {
          ok: true,
          relation: result.relation,
          alreadyRejected: Boolean(result.alreadyRejected)
        });
      } catch (error) {
        const status = error.statusCode || (/not found/i.test(String(error.message)) ? 404 : 400);
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }

    // ── Training system: review start and submit ──
    if (trainingReviewStartMatch && req.method === "POST") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const taskId = decodeURIComponent(trainingReviewStartMatch[1]);
      try {
        const task = trainingStore.getReviewTask(taskId, userId);
        task.status = "in_progress";
        await trainingStore.saveReviewTask(task);
        jsonResponse(res, 200, { ok: true, task });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    if (trainingReviewSubmitMatch && req.method === "POST") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const taskId = decodeURIComponent(trainingReviewSubmitMatch[1]);
      try {
        const task = trainingStore.getReviewTask(taskId, userId);
        const debt = trainingStore.getCognitiveDebt(task.cognitiveDebtId, userId);
        const answer = String(payload.answer || "").trim().slice(0, 6000);
        if (!answer) {
          jsonResponse(res, 400, { ok: false, error: "Answer is required" });
          return;
        }

        // 优先使用 AI 评估，失败时 fallback 到规则评估
        let evaluation;
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        if (chatFn) {
          try {
            const evalRequest = buildEvaluationRequest({
              card: { prompt: task.prompt, target: debt.gapText },
              attempt: { originalPrompt: task.prompt, initialAnswer: answer, finalAnswer: answer },
              hintEvents: [],
              capabilityLevel: "unknown"
            });
            const rawEval = await chatFn(
              [
                { role: "system", content: getTrainingEvaluationPrompt() },
                { role: "user", content: JSON.stringify(evalRequest) }
              ],
              () => ({ overallScore: 50, passed: true, conceptualAccuracy: 50, completeness: 50, independentRecall: 50, hintDependency: 0, transferAbility: 0, understandingLevel: "initially_understood", strengths: [], missingPoints: [], misconceptions: [], nextTrainingGoal: "继续练习", recommendedNextStage: task.trainingStage, userFeedback: "AI 评估暂时不可用，使用规则评估。" })
            );
            evaluation = normalizeEvaluation(rawEval);
          } catch (evalError) {
            console.warn(`AI evaluation failed for task ${taskId}: ${evalError.message}`);
            evaluation = deriveEvaluationFromAnalysis(
              { coverage: 0.5, demonstrated: [], missing: [], misconceptions: [], feedback: "" },
              [],
              task.trainingStage
            );
          }
        } else {
          evaluation = deriveEvaluationFromAnalysis(
            { coverage: 0.5, demonstrated: [], missing: [], misconceptions: [], feedback: "" },
            [],
            task.trainingStage
          );
        }

        const attempt = {
          id: crypto.randomUUID(),
          userId,
          cardId: task.cardId,
          cognitiveDebtId: task.cognitiveDebtId,
          trainingStage: task.trainingStage,
          taskType: task.taskType,
          originalPrompt: task.prompt,
          initialAnswer: answer,
          finalAnswer: answer,
          hintEvents: [],
          evaluation,
          startedAt: task.createdAt,
          completedAt: new Date().toISOString(),
          durationSeconds: undefined
        };
        await trainingStore.saveAttempt(attempt);
        // 这里是实际先命中的复训提交处理器；保留证据写入，避免复训完成后项目认知账本仍然断链。
        await projectMemoryRecordTrainingEvidence(attempt, userId);

        let profile = trainingStore.getMasteryProfile(task.cognitiveDebtId);
        profile = updateMasteryProfile(profile, attempt);
        await trainingStore.saveMasteryProfile(profile);

        const newStatus = deriveStatusFromStage(task.trainingStage, evaluation);
        debt.status = newStatus;
        debt.updatedAt = new Date().toISOString();
        await trainingStore.saveCognitiveDebt(debt);

        const { nextReviewAt } = calculateNextReview({
          trainingStage: task.trainingStage,
          evaluation,
          hintEvents: [],
          previousAttempts: trainingStore.listAttempts(userId, { cognitiveDebtId: task.cognitiveDebtId }),
          currentMastery: profile
        });
        profile.nextReviewAt = nextReviewAt;
        await trainingStore.saveMasteryProfile(profile);

        task.status = "completed";
        task.attemptId = attempt.id;
        await trainingStore.saveReviewTask(task);

        if (evaluation.passed) {
          const nextStage = recommendNextStage(profile.currentStage, evaluation, profile);
          const nextTask = generateRuleBasedReviewTask({
            debt,
            card: { id: task.cardId, target: debt.gapText, prompt: task.prompt },
            firstAttempt: attempt,
            mastery: profile,
            trainingStage: nextStage,
            dueAt: nextReviewAt,
            userId
          });
          await trainingStore.saveReviewTask(nextTask);
        }

        jsonResponse(res, 200, {
          ok: true,
          attempt,
          evaluation,
          profile,
          debtStatus: debt.status,
          nextReviewAt
        });
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: error.message });
      }
      return;
    }


    if (req.method === "PATCH" && mvp0DraftMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      try {
        const draftId = decodeURIComponent(mvp0DraftMatch[1]);
        const confusions = payload.confusions;
        const confusionsValid =
          confusions === undefined ||
          (Array.isArray(confusions) &&
            confusions.every(
              entry =>
                entry !== null &&
                typeof entry === "object" &&
                typeof entry.stepId === "string" &&
                typeof entry.text === "string"
            ));
        if (!confusionsValid) {
          jsonResponse(res, 400, {
            ok: false,
            error: "confusions must be an array of { stepId, text }"
          });
          return;
        }
        const draft = await mvp0Store.updateDraftConfusions(draftId, confusions, user.id);
        jsonResponse(res, 200, { ok: true, draft });
      } catch (error) {
        jsonResponse(res, /not found/i.test(String(error.message)) ? 404 : 400, {
          ok: false,
          error: error.message
        });
      }
      return;
    }

    // ── Training system: review start and submit ──
    if (trainingReviewStartMatch && req.method === "POST") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const taskId = decodeURIComponent(trainingReviewStartMatch[1]);
      try {
        const task = trainingStore.getReviewTask(taskId, userId);
        task.status = "in_progress";
        await trainingStore.saveReviewTask(task);
        jsonResponse(res, 200, { ok: true, task });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    if (trainingReviewSubmitMatch && req.method === "POST") {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const taskId = decodeURIComponent(trainingReviewSubmitMatch[1]);
      try {
        const task = trainingStore.getReviewTask(taskId, userId);
        const debt = trainingStore.getCognitiveDebt(task.cognitiveDebtId, userId);
        const answer = String(payload.answer || "").trim().slice(0, 6000);
        if (!answer) {
          jsonResponse(res, 400, { ok: false, error: "Answer is required" });
          return;
        }

        // 优先使用 AI 评估，失败时 fallback 到规则评估
        let evaluation;
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        if (chatFn) {
          try {
            const evalRequest = buildEvaluationRequest({
              card: { prompt: task.prompt, target: debt.gapText },
              attempt: { originalPrompt: task.prompt, initialAnswer: answer, finalAnswer: answer },
              hintEvents: [],
              capabilityLevel: "unknown"
            });
            const rawEval = await chatFn(
              [
                { role: "system", content: getTrainingEvaluationPrompt() },
                { role: "user", content: JSON.stringify(evalRequest) }
              ],
              () => ({ overallScore: 50, passed: true, conceptualAccuracy: 50, completeness: 50, independentRecall: 50, hintDependency: 0, transferAbility: 0, understandingLevel: "initially_understood", strengths: [], missingPoints: [], misconceptions: [], nextTrainingGoal: "继续练习", recommendedNextStage: task.trainingStage, userFeedback: "AI 评估暂时不可用，使用规则评估。" })
            );
            evaluation = normalizeEvaluation(rawEval);
          } catch (evalError) {
            console.warn(`AI evaluation failed for task ${taskId}: ${evalError.message}`);
            evaluation = deriveEvaluationFromAnalysis(
              { coverage: 0.5, demonstrated: [], missing: [], misconceptions: [], feedback: "" },
              [],
              task.trainingStage
            );
          }
        } else {
          evaluation = deriveEvaluationFromAnalysis(
            { coverage: 0.5, demonstrated: [], missing: [], misconceptions: [], feedback: "" },
            [],
            task.trainingStage
          );
        }

        const attempt = {
          id: crypto.randomUUID(),
          userId,
          cardId: task.cardId,
          cognitiveDebtId: task.cognitiveDebtId,
          trainingStage: task.trainingStage,
          taskType: task.taskType,
          originalPrompt: task.prompt,
          initialAnswer: answer,
          finalAnswer: answer,
          hintEvents: [],
          evaluation,
          startedAt: task.createdAt,
          completedAt: new Date().toISOString(),
          durationSeconds: undefined
        };
        await trainingStore.saveAttempt(attempt);
        await projectMemoryRecordTrainingEvidence(attempt, user.id);

        let profile = trainingStore.getMasteryProfile(task.cognitiveDebtId);
        profile = updateMasteryProfile(profile, attempt);
        await trainingStore.saveMasteryProfile(profile);

        const newStatus = deriveStatusFromStage(task.trainingStage, evaluation);
        debt.status = newStatus;
        debt.updatedAt = new Date().toISOString();
        await trainingStore.saveCognitiveDebt(debt);

        const { nextReviewAt } = calculateNextReview({
          trainingStage: task.trainingStage,
          evaluation,
          hintEvents: [],
          previousAttempts: trainingStore.listAttempts(userId, { cognitiveDebtId: task.cognitiveDebtId }),
          currentMastery: profile
        });
        profile.nextReviewAt = nextReviewAt;
        await trainingStore.saveMasteryProfile(profile);

        task.status = "completed";
        task.attemptId = attempt.id;
        await trainingStore.saveReviewTask(task);

        if (evaluation.passed) {
          const nextStage = recommendNextStage(profile.currentStage, evaluation, profile);
          const nextTask = generateRuleBasedReviewTask({
            debt,
            card: { id: task.cardId, target: debt.gapText, prompt: task.prompt },
            firstAttempt: attempt,
            mastery: profile,
            trainingStage: nextStage,
            dueAt: nextReviewAt,
            userId
          });
          await trainingStore.saveReviewTask(nextTask);
        }

        jsonResponse(res, 200, {
          ok: true,
          attempt,
          evaluation,
          profile,
          debtStatus: debt.status,
          nextReviewAt
        });
      } catch (error) {
        jsonResponse(res, 400, { ok: false, error: error.message });
      }
      return;
    }

    // ── 下一步学习编排（Phase 4）：接受 / 跳过 ──

    if (req.method === "POST" && learningRecommendationActionMatch) {
      const user = getOptionalUser(req);
      const userId = user?.id || "demo-user";
      const recommendationId = decodeURIComponent(learningRecommendationActionMatch[1]);
      const action = learningRecommendationActionMatch[2];
      try {
        if (action === "accept") {
          const result = await acceptRecommendation({
            store: learningOrchestratorStore,
            trainingStore,
            userId,
            recommendationId
          });
          jsonResponse(res, 200, { ok: true, ...result });
        } else {
          const result = await skipRecommendation({
            store: learningOrchestratorStore,
            userId,
            recommendationId,
            skipReason: payload.skipReason
          });
          jsonResponse(res, 200, { ok: true, ...result });
        }
      } catch (error) {
        const status = error.statusCode || (/not found/i.test(String(error.message)) ? 404 : 400);
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }

    // ── MVP-0: collaboration timeline (step 1 of the report pipeline) ──

    if (req.method === "POST" && url.pathname === "/api/mvp0/timelines") {
      const user = requireAuth(req, res);
      if (!user) return;
      const artifactText = validateArtifactText(payload.artifactText);
      let artifactType = clean(payload.artifactType || "");
      const usage = consumeAnalysisQuota(user.id, artifactText);
      if (!artifactType) {
        artifactType = detectArtifactType(artifactText);
      }
      const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
      const locale = payload.locale === "en" ? "en" : "zh-CN";
      const timeline = await generateCollaborationTimeline(artifactText, artifactType, chatFn, { locale });
      const draft = await mvp0Store.saveDraft({
        userId: user.id,
        locale,
        input: {
          artifactText,
          artifactType,
          charCount: clean(artifactText).length
        },
        timeline: { steps: timeline.steps },
        generation: timeline.generation,
        status: "timeline"
      });
      const isFallback = Boolean(timeline.generation?.fallback);
      jsonResponse(res, 200, {
        ok: true,
        draft,
        timeline: { steps: draft.timeline.steps, ...(timeline.note ? { note: timeline.note } : {}) },
        fallback: isFallback,
        ...(isFallback && timeline.generation?.error ? { error: timeline.generation.error } : {}),
        detectedType: artifactType,
        usage
      });
      return;
    }

    if (req.method === "PATCH" && mvp0DraftMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      try {
        const draftId = decodeURIComponent(mvp0DraftMatch[1]);
        const confusions = payload.confusions;
        const confusionsValid =
          confusions === undefined ||
          (Array.isArray(confusions) &&
            confusions.every(
              entry =>
                entry !== null &&
                typeof entry === "object" &&
                typeof entry.stepId === "string" &&
                typeof entry.text === "string"
            ));
        if (!confusionsValid) {
          jsonResponse(res, 400, {
            ok: false,
            error: "confusions must be an array of { stepId, text }"
          });
          return;
        }
        const draft = await mvp0Store.updateDraftConfusions(draftId, confusions, user.id);
        jsonResponse(res, 200, { ok: true, draft });
      } catch (error) {
        jsonResponse(res, /not found/i.test(String(error.message)) ? 404 : 400, {
          ok: false,
          error: error.message
        });
      }
      return;
    }

    if (url.pathname === "/api/learn/events") {
      jsonResponse(res, 200, { ok: true, event: recordEvent(payload) });
      return;
    }
    if (url.pathname === "/api/learn/import") {
      jsonResponse(res, 200, await importCards(payload));
      return;
    }
    if (url.pathname === "/api/rokid/import") {
      const result = await importCards(payload);
      jsonResponse(res, 200, {
        ...result,
        platform: "rokid-aiui",
        cards: Array.isArray(result.cards) ? result.cards.map(rokidCard) : []
      });
      return;
    }
    if (url.pathname === "/api/learn/plan") {
      jsonResponse(res, 200, await planCourse(payload));
      return;
    }
    if (url.pathname === "/api/learn/tutor") {
      jsonResponse(res, 200, await tutor(payload));
      return;
    }
    if (url.pathname === "/api/rokid/tutor") {
      jsonResponse(res, 200, await rokidTutor(payload));
      return;
    }
    if (url.pathname === "/api/learn/transcribe") {
      jsonResponse(res, 200, await transcribe(payload));
      return;
    }
    if (["/v1/events/codex", "/api/spiral/ingest", "/api/spiral/capture"].includes(url.pathname)) {
      const result = await ingestSpiralEvent(payload);
      jsonResponse(res, result.ok ? 200 : 400, result);
      return;
    }
    if (url.pathname === "/api/spiral/checkpoint") {
      jsonResponse(res, 200, await runManualCheckpoint(payload));
      return;
    }
    const candidateDecisionMatch = url.pathname.match(/^\/api\/spiral\/candidates\/([^/]+)\/decision$/);
    if (candidateDecisionMatch) {
      const result = await spiralStore.decideCandidate(
        decodeURIComponent(candidateDecisionMatch[1]),
        payload.decision
      );
      jsonResponse(res, 200, { ok: true, ...result, today: spiralStore.dashboard() });
      return;
    }
    if (["/v1/reviews", "/api/spiral/review"].includes(url.pathname)) {
      const result = await spiralStore.recordReview(payload);
      jsonResponse(res, 200, { ok: true, ...result, today: spiralStore.dashboard() });
      return;
    }
    if (url.pathname === "/api/rokid/review") {
      jsonResponse(res, 200, await rokidReview(payload));
      return;
    }
    const g2AnswerMatch = url.pathname.match(/^\/api\/g2\/card\/([^/]+)\/answer$/);
    if (g2AnswerMatch) {
      const result = await spiralStore.recordReview({
        ...payload,
        cardId: decodeURIComponent(g2AnswerMatch[1]),
        source: payload.source || "g2"
      });
      jsonResponse(res, 200, { ok: true, ...result, today: spiralStore.dashboard() });
      return;
    }

    // ── 项目认知所有权地图 ──

    const ownershipMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ownership$/);
    const ownershipModuleMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ownership\/modules\/([^/]+)$/);
    const ownershipHighRiskMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ownership\/high-risk$/);
    const ownershipHistoryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ownership\/history$/);
    const ownershipRecalculateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ownership\/recalculate$/);
    const projectDetailMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);

    // GET /api/projects — 列出当前用户的项目
    if (req.method === "GET" && url.pathname === "/api/projects") {
      const user = requireAuth(req, res);
      if (!user) return;
      const projects = ownershipStore.listProjects(user.id);
      jsonResponse(res, 200, { ok: true, projects });
      return;
    }

    // GET /api/projects/:projectId — 项目详情
    if (req.method === "GET" && projectDetailMatch && !ownershipMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(projectDetailMatch[1]);
      const project = ownershipStore.getProject(projectId, user.id);
      if (!project) {
        jsonResponse(res, 404, { ok: false, error: "Project not found" });
        return;
      }
      const workItems = ownershipStore.listWorkItems(projectId);
      jsonResponse(res, 200, { ok: true, project, workItems });
      return;
    }

    // GET /api/projects/:projectId/ownership — 所有权摘要 + 模块列表
    if (req.method === "GET" && ownershipMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(ownershipMatch[1]);
      const project = ownershipStore.getProject(projectId, user.id);
      if (!project) {
        jsonResponse(res, 404, { ok: false, error: "Project not found" });
        return;
      }
      const view = computeProjectOwnershipView(ownershipStore, trainingStore, projectId, user.id);
      jsonResponse(res, 200, { ok: true, ...view });
      return;
    }

    // GET /api/projects/:projectId/ownership/modules/:workItemId — 模块详情
    if (req.method === "GET" && ownershipModuleMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(ownershipModuleMatch[1]);
      const workItemId = decodeURIComponent(ownershipModuleMatch[2]);
      const project = ownershipStore.getProject(projectId, user.id);
      if (!project) {
        jsonResponse(res, 404, { ok: false, error: "Project not found" });
        return;
      }
      const workItem = ownershipStore.getWorkItem(workItemId);
      if (!workItem || workItem.projectId !== projectId) {
        jsonResponse(res, 404, { ok: false, error: "Work item not found" });
        return;
      }
      const projectData = ownershipStore.getProjectData(projectId);
      const moduleAgentSessions = projectData.agentSessions.filter((s) => s.workItemId === workItemId);
      const moduleArtifacts = projectData.artifacts.filter((a) => a.workItemId === workItemId);
      const moduleEvidence = projectData.evidenceRecords.filter((e) => e.workItemId === workItemId);

      // 从 trainingStore 获取关联认知欠条和训练记录
      const allDebts = trainingStore.listCognitiveDebts(user.id);
      const linkedDebtIds = projectData.decisionDebtLinks
        .filter((l) => {
          const decision = projectData.decisionRecords.find((d) => d.id === l.decisionId);
          return decision && decision.workItemId === workItemId;
        })
        .map((l) => l.cognitiveDebtId);
      const moduleDebts = allDebts.filter((d) => linkedDebtIds.includes(d.id));
      const moduleAttempts = trainingStore.listAttempts(user.id)
        .filter((a) => linkedDebtIds.includes(a.cognitiveDebtId) || a.workItemId === workItemId);

      const detailView = buildModuleDetailView({
        workItem,
        agentSessions: moduleAgentSessions,
        decisions: projectData.decisionRecords.filter((d) => d.workItemId === workItemId),
        artifacts: moduleArtifacts,
        evidenceRecords: moduleEvidence,
        cognitiveDebts: moduleDebts,
        decisionDebtLinks: projectData.decisionDebtLinks,
        decisionArtifactLinks: projectData.decisionArtifactLinks,
        trainingAttempts: moduleAttempts,
      });

      const recommendation = generateModuleRecommendation({
        ...detailView,
        projectId,
      });

      jsonResponse(res, 200, { ok: true, module: detailView, recommendation });
      return;
    }

    // GET /api/projects/:projectId/ownership/high-risk — 高风险模块
    if (req.method === "GET" && ownershipHighRiskMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(ownershipHighRiskMatch[1]);
      const project = ownershipStore.getProject(projectId, user.id);
      if (!project) {
        jsonResponse(res, 404, { ok: false, error: "Project not found" });
        return;
      }
      const view = computeProjectOwnershipView(ownershipStore, trainingStore, projectId, user.id);
      const highRiskModules = view.modules.filter(
        (m) => m.status === MODULE_OWNERSHIP_STATUS.high_risk_unowned
      );
      jsonResponse(res, 200, { ok: true, highRiskModules });
      return;
    }

    // GET /api/projects/:projectId/ownership/history — 快照历史
    if (req.method === "GET" && ownershipHistoryMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(ownershipHistoryMatch[1]);
      const project = ownershipStore.getProject(projectId, user.id);
      if (!project) {
        jsonResponse(res, 404, { ok: false, error: "Project not found" });
        return;
      }
      const snapshots = ownershipStore.listSnapshots(projectId);
      jsonResponse(res, 200, { ok: true, snapshots });
      return;
    }

    // POST /api/projects/:projectId/ownership/recalculate — 重新计算并保存快照
    if (req.method === "POST" && ownershipRecalculateMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(ownershipRecalculateMatch[1]);
      const project = ownershipStore.getProject(projectId, user.id);
      if (!project) {
        jsonResponse(res, 404, { ok: false, error: "Project not found" });
        return;
      }
      const view = computeProjectOwnershipView(ownershipStore, trainingStore, projectId, user.id);
      // 保存快照
      const snapshot = {
        projectId,
        summary: view.summary,
        moduleSummary: view.modules.map((m) => ({
          workItemId: m.workItemId,
          title: m.title,
          status: m.status,
          riskLevel: m.riskLevel,
          importantDecisionCount: m.importantDecisionCount,
          highestEvidenceLevel: m.highestEvidenceLevel,
        })),
      };
      const { createOwnershipSnapshot } = await import("./project-ownership.js");
      await ownershipStore.saveSnapshot(createOwnershipSnapshot(snapshot));
      jsonResponse(res, 200, { ok: true, ...view, snapshotSaved: true });
      return;
    }

    jsonResponse(res, 404, { ok: false, error: "Not found", requestId });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || (error instanceof SyntaxError ? 400 : 500);
    if (statusCode >= 500) {
      logEvent("error", "unhandled_request_error", {
        requestId,
        error: String(error?.message || error).slice(0, 300)
      });
      jsonResponse(res, statusCode, { ok: false, error: "Internal server error", requestId });
      return;
    }
    const clientMessage = error instanceof SyntaxError
      ? "Request body must be valid JSON"
      : localizedLimitMessage(error, req);
    jsonResponse(res, statusCode, {
      ok: false,
      error: clientMessage,
      requestId,
      ...(error.code ? { code: error.code } : {})
    });
  }
  });
});

// ── 认知画像周/月定时快照（Phase 3）──
// 幂等：同一周期已存在则跳过；单用户失败仅记录日志，不影响其他用户。
// COGNITIVE_PROFILE_SNAPSHOT_INTERVAL_MS 可覆盖检查间隔，设为 0 可完全关闭
// （测试环境关闭以保证确定性）。
const profileSnapshotIntervalMs = Number(process.env.COGNITIVE_PROFILE_SNAPSHOT_INTERVAL_MS || 6 * 60 * 60 * 1000);
async function runPeriodicProfileSnapshots() {
  try {
    const result = await generatePeriodicSnapshots({
      profileStore: cognitiveProfileStore,
      trainingStore,
      intelligenceStore: debtIntelligenceStore
    });
    if (result.created > 0 || result.errors.length > 0) {
      logEvent(result.errors.length > 0 ? "warn" : "info", "cognitive_profile_snapshots", {
        users: result.users,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors.length
      });
    }
  } catch (error) {
    logEvent("warn", "cognitive_profile_snapshots_failed", {
      error: String(error?.message || error).slice(0, 300)
    });
  }
}
if (Number.isFinite(profileSnapshotIntervalMs) && profileSnapshotIntervalMs > 0) {
  const profileSnapshotTimer = setInterval(runPeriodicProfileSnapshots, profileSnapshotIntervalMs);
  profileSnapshotTimer.unref();
  const profileSnapshotBootTimer = setTimeout(runPeriodicProfileSnapshots, 15000);
  profileSnapshotBootTimer.unref();
}

server.listen(port, host, () => {
  console.log(`G2 learning API listening on http://${host}:${port} using ${learningStorePath}`);
});
