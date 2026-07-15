import { createServer } from "node:http";
import crypto from "node:crypto";
import { createSpiralStore } from "./spiral-store.js";
import { createMvp0Store } from "./mvp0-store.js";
import { generateFallbackReport } from "./mvp0-fallback.js";
import { generateClearanceReport } from "./mvp0-report.js";
import { feynmanFollowUp } from "./mvp0-followup.js";
import {
  endClearanceSession,
  getClearanceAnalysisPrompt,
  getResearchStructuringPrompt,
  publicSession,
  startClearanceSession,
  submitClearanceAnswer
} from "./mvp1-clearance.js";
import { createOpenAiWebResearch } from "./mvp1-openai.js";

const port = Number(process.env.PORT || 8793);
const host = process.env.HOST || "0.0.0.0";
const apiToken = process.env.LEARNING_API_TOKEN || "";
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const disableAi = process.env.SPIRAL_DISABLE_AI === "1";
const openAiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const chatModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const researchModel = process.env.OPENAI_RESEARCH_MODEL || chatModel;
const sttModel = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";
const sttPrompt = process.env.OPENAI_STT_PROMPT || [
  "Learn Coach vocabulary study in Mandarin and English.",
  "Likely commands: 下一张, 下一个, 重复, 再说一遍, 提问, 问我, 会了, next, repeat, ask me, got it.",
  "Preserve English vocabulary terms exactly when possible."
].join(" ");
const learningStorePath = process.env.LEARNING_STORE_PATH || "tmp/spiral-store.json";
const mvp0StorePath = process.env.MVP0_STORE_PATH || "tmp/mvp0-store.json";
const eventLog = [];
const spiralStore = createSpiralStore(learningStorePath);
await spiralStore.load();
const mvp0Store = createMvp0Store(mvp0StorePath);
await mvp0Store.load();
const mvp1Sessions = new Map();
const rawWebResearch = createOpenAiWebResearch({
  apiKey: openAiApiKey,
  baseUrl: openAiBaseUrl,
  model: researchModel
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

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(body);
}

function optionsResponse(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400"
  });
  res.end();
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

function requireToken(req, res) {
  if (!apiToken) return true;
  const header = req.headers.authorization || "";
  if (header === `Bearer ${apiToken}`) return true;
  jsonResponse(res, 401, { ok: false, error: "Invalid token" });
  return false;
}

function parseJson(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  if (!openAiApiKey || disableAi) {
    return {
      ...fallback(),
      __fallback: true,
      __fallbackError: disableAi ? "SPIRAL_DISABLE_AI=1" : "OPENAI_API_KEY is not set"
    };
  }
  const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${openAiApiKey}`,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content || "{}";
  return parseJsonObject(content);
}

async function analyzeClearanceAnswer(input) {
  const result = await chatJson([
    { role: "system", content: getClearanceAnalysisPrompt() },
    { role: "user", content: JSON.stringify(input) }
  ], () => ({
    status: "needs_verification",
    coverage: 0,
    demonstrated: [],
    missing: ["AI answer analysis was unavailable."],
    misconceptions: [],
    evidence: [],
    materialSourceIds: [],
    feedback: "Your answer was recorded, but the system could not evaluate it.",
    teaching: "Review the cited sources and compare them with your explanation.",
    nextQuestion: input.question,
    recommendation: "continue"
  }));
  return result;
}

async function researchClearanceContext(request) {
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
    sources: evidence.sources.filter(source => referencedSourceIds.has(source.id))
  };
}

async function checkOpenAiConnectivity() {
  if (!openAiApiKey || disableAi) {
    return {
      reachable: false,
      error: disableAi ? "SPIRAL_DISABLE_AI=1" : "OPENAI_API_KEY is not set"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${openAiBaseUrl}/models`, {
      headers: {
        "authorization": `Bearer ${openAiApiKey}`,
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
  if (!openAiApiKey) return { ok: false, text: "", error: "OPENAI_API_KEY is not set" };

  const startedAt = Date.now();
  const wav = wavFromPcm16(audioBase64, Number(payload.sampleRate || 16000));
  const form = new FormData();
  form.append("model", sttModel);
  form.append("prompt", clean(sttPrompt).slice(0, 500));
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "g2-audio.wav");

  const response = await fetch(`${openAiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { "authorization": `Bearer ${openAiApiKey}` },
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
        ai: Boolean(openAiApiKey) && !disableAi,
        model: chatModel,
        sttModel,
        ...(live ? { openai: await checkOpenAiConnectivity() } : {})
      });
      return;
    }

    if (!requireToken(req, res)) return;
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
    if (req.method === "GET" && url.pathname === "/api/g2/session") {
      const session = spiralStore.buildSession(url.searchParams.get("duration"));
      jsonResponse(res, 200, { ok: true, session });
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
    if (req.method === "GET" && url.pathname === "/api/rokid/clearance-entry") {
      const report = mvp0Store.listReports().find(item => item.sections?.feynmanCards?.length);
      if (!report) {
        jsonResponse(res, 200, { ok: true, platform: "rokid-aiui", entry: null });
        return;
      }
      const cards = report.sections.feynmanCards;
      const card = cards.find(item => !item.userAnswer) || cards[0];
      jsonResponse(res, 200, {
        ok: true,
        platform: "rokid-aiui",
        entry: {
          reportId: report.id,
          cardId: card.id,
          createdAt: report.createdAt,
          domain: clean(report.analysis?.userCapability?.currentDomain || "认知债务"),
          target: clean(card.target || "理解缺口"),
          prompt: clean(card.prompt || "请用自己的话解释这个问题。"),
          cardNumber: cards.findIndex(item => item.id === card.id) + 1,
          cardCount: cards.length
        }
      });
      return;
    }

    // ── MVP-0: cognitive-debt clearance report ──

    if (req.method === "GET" && url.pathname === "/api/mvp0/reports") {
      jsonResponse(res, 200, { ok: true, reports: mvp0Store.listReports() });
      return;
    }
    const mvp1SessionMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)$/);
    if (req.method === "GET" && mvp1SessionMatch) {
      const session = mvp1Sessions.get(decodeURIComponent(mvp1SessionMatch[1]));
      if (!session) {
        jsonResponse(res, 404, { ok: false, error: "Clearance session not found" });
        return;
      }
      jsonResponse(res, 200, { ok: true, session: publicSession(session, { revealScaffold: session.attempts.length > 0 }) });
      return;
    }
    const mvp0ReportMatch = url.pathname.match(/^\/api\/mvp0\/reports\/([^/]+)$/);
    if (req.method === "GET" && mvp0ReportMatch) {
      try {
        const report = mvp0Store.getReport(decodeURIComponent(mvp0ReportMatch[1]));
        jsonResponse(res, 200, { ok: true, report });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const payload = parseJson(await readBody(req));

    // ── MVP-1: source-grounded debt clearance ──

    if (url.pathname === "/api/mvp1/sessions") {
      try {
        if (!openAiApiKey || disableAi) {
          jsonResponse(res, 503, { ok: false, error: "MVP-1 external research requires an active OpenAI API configuration" });
          return;
        }
        const reportId = clean(payload.reportId || "");
        const cardId = clean(payload.cardId || "");
        if (!reportId || !cardId) {
          jsonResponse(res, 400, { ok: false, error: "Missing reportId or cardId" });
          return;
        }
        const report = mvp0Store.getReport(reportId);
        const session = await startClearanceSession({ report, cardId, researchFn: researchClearanceContext });
        mvp1Sessions.set(session.id, session);
        jsonResponse(res, 200, { ok: true, session: publicSession(session) });
      } catch (error) {
        const status = /not found/i.test(String(error.message)) ? 404 : 502;
        jsonResponse(res, status, { ok: false, error: error.message });
      }
      return;
    }

    const mvp1AnswerMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)\/answers$/);
    if (mvp1AnswerMatch) {
      try {
        const session = mvp1Sessions.get(decodeURIComponent(mvp1AnswerMatch[1]));
        if (!session) {
          jsonResponse(res, 404, { ok: false, error: "Clearance session not found" });
          return;
        }
        const attempt = await submitClearanceAnswer({
          session,
          answer: payload.answer,
          analyzeFn: analyzeClearanceAnswer
        });
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

    const mvp1EndMatch = url.pathname.match(/^\/api\/mvp1\/sessions\/([^/]+)\/end$/);
    if (mvp1EndMatch) {
      const session = mvp1Sessions.get(decodeURIComponent(mvp1EndMatch[1]));
      if (!session) {
        jsonResponse(res, 404, { ok: false, error: "Clearance session not found" });
        return;
      }
      const result = endClearanceSession(session);
      jsonResponse(res, 200, {
        ok: true,
        result,
        session: publicSession(session, { revealScaffold: true })
      });
      return;
    }

    // ── MVP-0: cognitive-debt clearance report ──

    if (url.pathname === "/api/mvp0/report") {
      const artifactText = String(payload.artifactText || "").trim();
      let artifactType = clean(payload.artifactType || "");
      if (!artifactText) {
        jsonResponse(res, 400, { ok: false, error: "Missing artifactText" });
        return;
      }
      // Auto-detect type if not provided or empty
      if (!artifactType) {
        artifactType = detectArtifactType(artifactText);
      }
      const chatFn = (!openAiApiKey || disableAi) ? null : chatJson;
      const report = await generateClearanceReport(artifactText, artifactType, chatFn);
      const saved = await mvp0Store.saveReport(report);
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

    const mvp0CardAnswerMatch = url.pathname.match(
      /^\/api\/mvp0\/reports\/([^/]+)\/cards\/([^/]+)\/answer$/
    );
    if (mvp0CardAnswerMatch) {
      try {
        const reportId = decodeURIComponent(mvp0CardAnswerMatch[1]);
        const cardId = decodeURIComponent(mvp0CardAnswerMatch[2]);
        const answer = clean(payload.answer || "");
        if (!answer) {
          jsonResponse(res, 400, { ok: false, error: "Missing answer" });
          return;
        }
        const report = mvp0Store.getReport(reportId);
        const card = report.sections.feynmanCards?.find(item => item.id === cardId);
        if (!card) {
          jsonResponse(res, 404, { ok: false, error: `Feynman card not found: ${cardId} in report ${reportId}` });
          return;
        }
        const chatFn = (!openAiApiKey || disableAi) ? null : chatJson;
        const followUpResult = await feynmanFollowUp(card, answer, chatFn);
        const aiFollowUp = followUpResult.shouldFollowUp
          ? followUpResult.followUp
          : followUpResult.summary;
        const result = await mvp0Store.updateCardAnswer(reportId, cardId, answer, aiFollowUp);
        jsonResponse(res, 200, {
          ok: true,
          card: result.card,
          shouldFollowUp: followUpResult.shouldFollowUp,
          fallback: (!openAiApiKey || disableAi)
        });
      } catch (error) {
        jsonResponse(res, 404, { ok: false, error: error.message });
      }
      return;
    }

    const mvp0CorrectionMatch = url.pathname.match(
      /^\/api\/mvp0\/reports\/([^/]+)\/corrections$/
    );
    if (mvp0CorrectionMatch) {
      try {
        const reportId = decodeURIComponent(mvp0CorrectionMatch[1]);
        const result = await mvp0Store.addCorrection(reportId, {
          target: payload.target,
          targetId: payload.targetId,
          originalValue: payload.originalValue,
          correctedValue: payload.correctedValue,
          reason: payload.reason
        });
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
