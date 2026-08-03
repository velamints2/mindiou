import { createServer } from "node:http";
import crypto from "node:crypto";
import { createSpiralStore } from "./spiral-store.js";
import { createMvp0Store } from "./mvp0-store.js";
import { createMvp1Store } from "./mvp1-store.js";
import { createAuthStore } from "./auth-store.js";
import { generateFallbackReport } from "./mvp0-fallback.js";
import { generateClearanceReport } from "./mvp0-report.js";
import { generateCollaborationTimeline } from "./mvp0-timeline.js";
import { feynmanFollowUp } from "./mvp0-followup.js";
import { handleAdminRoute } from "./admin-backend-patch.js";
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
  updateCapabilityProfile
} from "./cognitive-repayment.js";

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
const sttApiKey = configuredEnv("STT_API_KEY", aiProvider === "openai" ? aiApiKey : "");
const sttBaseUrl = configuredEnv("STT_BASE_URL", aiProvider === "openai" ? aiBaseUrl : "").replace(/\/+$/, "");
const sttModel = configuredEnv("STT_MODEL", process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe");
const sttPrompt = process.env.OPENAI_STT_PROMPT || [
  "Learn Coach vocabulary study in Mandarin and English.",
  "Likely commands: 下一张, 下一个, 重复, 再说一遍, 提问, 问我, 会了, next, repeat, ask me, got it.",
  "Preserve English vocabulary terms exactly when possible."
].join(" ");
const learningStorePath = process.env.LEARNING_STORE_PATH || "tmp/spiral-store.json";
const mvp0StorePath = process.env.MVP0_STORE_PATH || "tmp/mvp0-store.json";
const mvp1StorePath = process.env.MVP1_STORE_PATH || "tmp/mvp1-store.json";
const authStorePath = process.env.AUTH_STORE_PATH || "tmp/auth-store.sqlite";
const eventLog = [];
const spiralStore = createSpiralStore(learningStorePath);
await spiralStore.load();
const mvp0Store = createMvp0Store(mvp0StorePath);
await mvp0Store.load();
const mvp1Store = createMvp1Store(mvp1StorePath);
await mvp1Store.load();
// 兼容 admin 补丁的只读视图：账户体系分支以 mvp1Store 持久化替代原内存 Map
const mvp1Sessions = { values: () => mvp1Store.listSessions() };
const trainingStorePath = process.env.TRAINING_STORE_PATH || "tmp/training-store.json";
const trainingStore = createTrainingStore(trainingStorePath);
await trainingStore.load();
const cognitiveRepaymentV1 = process.env.COGNITIVE_REPAYMENT_V1 === "1";
const repaymentStorePath = process.env.COGNITIVE_REPAYMENT_STORE_PATH || "tmp/cognitive-repayment-store.json";
const repaymentStore = createCognitiveRepaymentStore(repaymentStorePath);
await repaymentStore.load();
const authStore = createAuthStore(authStorePath);
const rawWebResearch = researchProvider === "public_web"
  ? createPublicWebResearch({ timeoutMs: openAiResearchTimeoutMs })
  : createOpenAiWebResearch({
      apiKey: researchApiKey,
      baseUrl: researchBaseUrl,
      model: researchModel,
      timeoutMs: openAiResearchTimeoutMs
    });

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
  const session = readSession(req);
  return session ? { label: session.label, method: "session" } : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024 * 8) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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

async function chatJson(messages, fallback) {
  if (!aiApiKey || disableAi) {
    return {
      ...fallback(),
      __fallback: true,
      __fallbackError: disableAi ? "SPIRAL_DISABLE_AI=1" : "AI_API_KEY is not set"
    };
  }
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
        messages
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content || "{}";
  return parseJsonObject(content);
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

async function transcribe(payload) {
  const audioBase64 = clean(payload.audioBase64);
  if (!audioBase64) return { ok: false, error: "Missing audioBase64" };
  if (!sttApiKey || !sttBaseUrl) return { ok: false, text: "", error: "STT_API_KEY is not set" };

  const startedAt = Date.now();
  const wav = wavFromPcm16(audioBase64, Number(payload.sampleRate || 16000));
  const form = new FormData();
  form.append("model", sttModel);
  form.append("prompt", clean(sttPrompt).slice(0, 500));
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "g2-audio.wav");

  const response = await fetch(`${sttBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { "authorization": `Bearer ${sttApiKey}` },
    body: form
  });
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

const server = createServer(async (req, res) => {
  try {
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
        stt: Boolean(sttApiKey && sttBaseUrl),
        sttModel,
        cognitiveRepaymentV1: cognitiveRepaymentV1,
        ...(live ? { providerStatus: await checkAiConnectivity() } : {})
      });
      return;
    }

    // ── Auth: web user accounts (no LEARNING_API_TOKEN required) ──

    if (url.pathname === "/api/auth/register" && req.method === "POST") {
      const payload = parseJson(await readBody(req));
      try {
        const { user, sessionId } = authStore.register(payload.email, payload.password, payload.name);
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
    if (url.pathname === "/api/genesis" && req.method === "GET") {
      const archive = authStore.getGenesisArchive();
      jsonResponse(res, 200, {
        ok: true,
        genesis: {
          cohort: "001",
          status: "in_progress",
          stage: "MVP-1.x 首发体验阶段",
          stageEn: "MVP-1.x genesis experience stage",
          dates: { start: null, end: null },
          goals: { joined: 300, completed: 87, adoptedSuggestions: 19 },
          actual: { joined: archive.joined, completed: archive.completed },
          adoptedSuggestions: [],
          productImprovements: [],
          members: archive.members
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
        jti: crypto.randomBytes(9).toString("base64url")
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
      mvp0Store, spiralStore, eventLog, mvp1Sessions, authStore
    })) return;

    // ── Web MVP-0/MVP-1 routes: cookie session auth, per-user data isolation ──

    const mvp1SessionMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)$/);
    const mvp0ReportMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)$/);
    const mvp1AnswerMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)\/answers$/);
    const mvp1EndMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)\/end$/);
    const mvp0CardAnswerMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)\/cards\/([^/]+)\/answer$/);
    const mvp0CorrectionMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)\/corrections$/);
    const trainingDebtMatch = url.pathname.match(/^\/api\/training\/debts\/([^/]+)$/);
    const trainingReviewStartMatch = url.pathname.match(/^\/api\/training\/reviews\/([^/]+)\/start$/);
    const trainingReviewSubmitMatch = url.pathname.match(/^\/api\/training\/reviews\/([^/]+)\/submit$/);
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
        const sessions = mvp1Store.listSessions(user.id);
        const latestReport = reports[0] || null;
        const latestSession = sessions[0] || null;
        const outstandingDebts = reports.flatMap(report =>
          (report.sections?.feynmanCards || [])
            .filter(card => !["provisionally_cleared"].includes(card.clearance?.status))
            .map(card => ({
              reportId: report.id,
              cardId: card.id,
              title: card.target || card.prompt || "Cognitive debt",
              status: card.clearance?.status || "not_started",
              locale: report.locale || "zh-CN"
            }))
        ).slice(0, 12);
        const activeSession = sessions.find(session => session.state !== "ended") || null;
        const activeCard = activeSession
          ? reports.find(report => report.id === activeSession.reportId)?.sections?.feynmanCards?.find(card => card.id === activeSession.cardId)
          : null;
        jsonResponse(res, 200, {
          ok: true,
          dashboard: {
            reportCount: reports.length,
            latestReport,
            outstandingDebts,
            latestSession: latestSession ? publicSession(latestSession, { revealScaffold: latestSession.attempts?.length > 0 }) : null,
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
          const session = await startClearanceSession({ report, cardId, researchFn: researchClearanceContext });
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
        const genesisIdentity = session.attempts?.length > 0
          ? authStore.activateGenesisIdentity(user.id, session.endedAt)
          : authStore.getUserById(user.id)?.genesisIdentity || null;
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
        const artifactText = String(draft ? draft.input.artifactText : payload.artifactText || "").trim();
        let artifactType = clean(draft ? draft.input.artifactType : payload.artifactType || "");
        if (!artifactText) {
          jsonResponse(res, 400, { ok: false, error: "Missing artifactText" });
          return;
        }
        // Auto-detect type if not provided or empty
        if (!artifactType) {
          artifactType = detectArtifactType(artifactText);
        }
        const timeline = draft ? draft.timeline : (payload.timeline && typeof payload.timeline === "object" ? payload.timeline : null);
        const confusions = draft
          ? confusionsFromTimeline(draft.timeline)
          : (Array.isArray(payload.confusions) ? payload.confusions : []);
        const chatFn = (!aiApiKey || disableAi) ? null : chatJson;
        const report = await generateClearanceReport(artifactText, artifactType, chatFn, {
          researchFn: mvp0ResearchFn,
          timeline,
          confusions,
          locale: draft?.locale || (payload.locale === "en" ? "en" : "zh-CN")
        });
        if (draft) report.draftId = draft.id;
        report.userId = user.id;
        report.locale = draft?.locale || (payload.locale === "en" ? "en" : "zh-CN");
        const saved = await mvp0Store.saveReport(report);
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
                cardId: undefined,
                gapText,
                gapEvidence: String(gap.evidence || "").slice(0, 1000)
              });
              await trainingStore.saveCognitiveDebt(newDebt);
            }
          }
        } catch (debtError) {
          console.warn(`Cognitive debt detection failed for report ${saved.id}: ${debtError.message}`);
        }
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
        const { record: savedAttempt } = await repaymentStore.saveAttempt(attempt);
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
          masteryLabel: masteryLabel(understandingLevel)
        });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
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

    if (req.method !== "POST" && req.method !== "PATCH") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const payload = parseJson(await readBody(req));

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

    // ── MVP-0: collaboration timeline (step 1 of the report pipeline) ──

    if (req.method === "POST" && url.pathname === "/api/mvp0/timelines") {
      const user = requireAuth(req, res);
      if (!user) return;
      const artifactText = String(payload.artifactText || "").trim();
      let artifactType = clean(payload.artifactType || "");
      if (!artifactText) {
        jsonResponse(res, 400, { ok: false, error: "Missing artifactText" });
        return;
      }
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
          artifactText: artifactText.slice(0, 30000),
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
        detectedType: artifactType
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

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`G2 learning API listening on http://${host}:${port} using ${learningStorePath}`);
});
