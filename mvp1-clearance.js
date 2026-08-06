import crypto from "node:crypto";

const VALID_STATUSES = new Set([
  "provisionally_cleared",
  "needs_practice",
  "needs_verification",
  "no_valid_attempt"
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fit(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function sourceKind(urlValue) {
  const url = safeUrl(urlValue);
  if (!url) return { type: "ordinary_web", credibility: "unknown" };
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const official = host.endsWith(".gov")
    || host.endsWith(".edu")
    || host.startsWith("docs.")
    || host.startsWith("developer.")
    || host.includes("developer.android.com")
    || host.includes("developers.openai.com")
    || host.includes("developer.huawei.com")
    || host.includes("developer.mozilla.org")
    || host === "evenrealities.com"
    || host.endsWith(".evenrealities.com")
    || host.includes("w3.org")
    || host.includes("whatwg.org");
  return official
    ? { type: "official_doc", credibility: "high" }
    : { type: "ordinary_web", credibility: "medium" };
}

export function normalizeResearchSources(rawSources) {
  const seen = new Set();
  return (Array.isArray(rawSources) ? rawSources : []).flatMap((source, index) => {
    const url = safeUrl(source?.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const classified = sourceKind(url);
    return [{
      id: clean(source?.id || `source-${index + 1}`).slice(0, 80),
      url,
      title: fit(source?.title || new URL(url).hostname, 180),
      claim: fit(source?.claim || source?.snippet || "Source used by external research.", 600),
      type: classified.type,
      credibility: classified.credibility
    }];
  });
}

function normalizeScaffold(rawScaffold, sources) {
  const sourceIds = new Set(sources.map(source => source.id));
  const items = Array.isArray(rawScaffold) ? rawScaffold : [];
  return items.slice(0, 6).map((item, index) => ({
    id: clean(item?.id || `point-${index + 1}`).slice(0, 80),
    point: fit(item?.point || item?.concept || "", 500),
    whyItMatters: fit(item?.whyItMatters || item?.reason || "", 500),
    sourceIds: (Array.isArray(item?.sourceIds) ? item.sourceIds : [])
      .map(clean)
      .filter(id => sourceIds.has(id))
      .slice(0, 5)
  })).filter(item => item.point);
}

function findCard(report, cardId) {
  const card = report?.sections?.feynmanCards?.find(item => item.id === cardId);
  if (!card) throw new Error(`Feynman card not found: ${cardId}`);
  return card;
}

function relatedGap(report, card) {
  const gaps = report?.sections?.dangerousGaps || [];
  const target = clean(card.target).toLowerCase();
  return gaps.find(gap => target && clean(gap.gap).toLowerCase().includes(target)) || gaps[0] || null;
}

export function buildResearchRequest(report, card) {
  const gap = relatedGap(report, card);
  return {
    reportId: clean(report?.id),
    locale: report?.locale === "en" ? "en" : "zh-CN",
    domain: fit(report?.analysis?.userCapability?.currentDomain || "", 300),
    originalQuestion: fit(card?.prompt, 800),
    targetDebt: fit(card?.target || gap?.gap || "", 500),
    dangerousGap: gap ? {
      gap: fit(gap.gap, 500),
      whyDangerous: fit(gap.whyDangerous, 500),
      evidence: fit(gap.evidence, 800)
    } : null,
    practiceEvidence: {
      aiCompleted: (report?.sections?.aiCompleted || []).slice(0, 5),
      userContributed: (report?.sections?.userContributed || []).slice(0, 5),
      facts: (report?.sections?.cognitiveStructure?.facts || []).slice(0, 8),
      decisions: (report?.sections?.cognitiveStructure?.decisions || []).slice(0, 8),
      tradeoffs: (report?.sections?.cognitiveStructure?.tradeoffs || []).slice(0, 8)
    }
  };
}

export async function startClearanceSession({ report, cardId, researchFn, priorProfile, now = () => new Date().toISOString() }) {
  if (!report?.id) throw new Error("A persisted MVP-0 report is required");
  if (typeof researchFn !== "function") throw new Error("External research is unavailable");
  const card = findCard(report, cardId);
  const researchRequest = buildResearchRequest(report, card);
  // ── 三层能力先验：注入到 researchRequest 让研究侧可参考，并本地推导难度调整 ──
  const prior = priorProfile && priorProfile.schemaVersion === "capability_snapshot_v1" ? priorProfile : null;
  if (prior) {
    researchRequest.priorProfile = {
      available: {
        L1: Boolean(prior.layers?.L1_ai_collaboration?.available),
        L2: Boolean(prior.layers?.L2_domain?.available),
        L3: Boolean(prior.layers?.L3_knowledge_points?.available)
      },
      rules: Array.isArray(prior.rules) ? prior.rules.slice(0, 4) : []
    };
  }
  const difficultyAdjustment = prior ? deriveDifficultyAdjustment(prior, report, card) : null;
  const rawResearch = await researchFn(researchRequest);
  const sources = normalizeResearchSources(rawResearch?.sources);
  if (sources.length === 0) throw new Error("External research returned no cited sources");
  const scaffold = normalizeScaffold(rawResearch?.scaffold, sources);
  if (scaffold.length === 0) throw new Error("External research returned no explanation scaffold");
  // 根据难度调整修饰 clearanceQuestion（不替换内容，只附加引导）
  let clearanceQuestion = fit(rawResearch?.rewrittenQuestion || card.prompt, 800);
  if (difficultyAdjustment && difficultyAdjustment.note) {
    clearanceQuestion = fit(`${clearanceQuestion} ${difficultyAdjustment.note}`, 800);
  }

  return {
    id: crypto.randomUUID(),
    reportId: report.id,
    locale: report.locale === "en" ? "en" : "zh-CN",
    cardId: card.id,
    createdAt: now(),
    endedAt: null,
    state: "awaiting_answer",
    originalCard: {
      id: card.id,
      target: fit(card.target, 500),
      prompt: fit(card.prompt, 800),
      targetLevel: clean(card.targetLevel),
      difficulty: clean(card.difficulty)
    },
    clearanceQuestion,
    adjustedDifficulty: difficultyAdjustment ? difficultyAdjustment.adjustedDifficulty : null,
    priorProfileUsed: Boolean(prior),
    currentQuestion: clearanceQuestion,
    consecutiveFailures: 0,
    teachingMode: "coach",
    researchSummary: fit(rawResearch?.summary, 1600),
    researchMode: clean(rawResearch?.researchMode || "live_ai"),
    sources,
    scaffold,
    attempts: [],
    finalResult: null
  };
}

/**
 * Derive a difficulty adjustment from the three-layer prior. The card's original
 * targetLevel/difficulty is the baseline; the prior can shift it by one step.
 *
 * Rules (material evidence in the report always wins; prior only shifts when
 * it is stable and points clearly in one direction):
 * - L3 stable high score (>=85) in a matching domain → upgrade one step.
 * - L3 one_shot or low score (<40) in a matching domain → keep baseline
 *   (do not downgrade on weak evidence; the card already targets +1).
 * - No matching domain → no adjustment (cannot infer across domains).
 * - L1 stable high across domains → allow upgrade only if L3 also supports.
 *
 * Returns null when no adjustment is made. Never throws.
 */
function deriveDifficultyAdjustment(prior, report, card) {
  if (!prior || prior.schemaVersion !== "capability_snapshot_v1") return null;
  const l3 = prior.layers?.L3_knowledge_points;
  if (!l3?.available) return null;
  const reportDomain = clean(report?.analysis?.userCapability?.currentDomain || "").toLowerCase();
  const baselineLevel = clean(card?.targetLevel || "L1");
  const baselineDifficulty = clean(card?.difficulty || "foundation");
  // find a matching domain bucket (substring match either direction)
  const matchedDomain = (l3.domains || []).find(d => {
    const dName = clean(d.domain || "").toLowerCase();
    return dName && (dName.includes(reportDomain) || reportDomain.includes(dName));
  });
  if (!matchedDomain) return null;
  // aggregate stable high signals across the matched domain's dimensions
  const dims = Object.entries(matchedDomain.dimensions || {});
  const stableHigh = dims.filter(([, v]) => v?.stability === "stable" && Number(v?.score) >= 85);
  const oneShotLow = dims.filter(([, v]) => v?.stability === "one_shot" && Number(v?.score) < 40);
  if (stableHigh.length === 0) {
    // No stable-high signal; if there's a one_shot low signal, attach a gentle
    // note but do not change the difficulty label (weak prior).
    if (oneShotLow.length > 0) {
      return {
        adjustedDifficulty: baselineDifficulty,
        reason: "one_shot_low_in_matched_domain",
        note: "（提示：你在该领域有一次性低分记录，可以先从基础概念开始组织答案。）"
      };
    }
    return null;
  }
  // Stable high: upgrade one step
  const upgrade = upgradeDifficulty(baselineLevel, baselineDifficulty);
  return {
    adjustedDifficulty: upgrade.difficulty,
    adjustedLevel: upgrade.level,
    reason: "stable_high_in_matched_domain",
    matchedDomain: matchedDomain.domain,
    note: "（提示：你在该领域已稳定展示较高能力，可以尝试从架构或迁移角度回答。）"
  };
}

const LEVEL_ORDER = ["L0", "L1", "L2", "L3", "L4", "L5"];
const DIFFICULTY_ORDER = ["foundation", "intermediate", "advanced"];

function upgradeDifficulty(level, difficulty) {
  const levelIdx = LEVEL_ORDER.indexOf(level);
  const newLevel = levelIdx >= 0 && levelIdx < LEVEL_ORDER.length - 1
    ? LEVEL_ORDER[levelIdx + 1]
    : level;
  const diffIdx = DIFFICULTY_ORDER.indexOf(difficulty);
  const newDiff = diffIdx >= 0 && diffIdx < DIFFICULTY_ORDER.length - 1
    ? DIFFICULTY_ORDER[diffIdx + 1]
    : difficulty;
  return { level: newLevel, difficulty: newDiff };
}

export function publicSession(session, { revealScaffold = false } = {}) {
  const result = { ...session };
  if (!revealScaffold && session.attempts.length === 0) {
    delete result.scaffold;
  }
  return result;
}

function normalizeAnalysis(raw, session) {
  const status = VALID_STATUSES.has(raw?.status) ? raw.status : "needs_practice";
  const sourceIds = new Set(session.sources.map(source => source.id));
  const materialSourceIds = (Array.isArray(raw?.materialSourceIds) ? raw.materialSourceIds : [])
    .map(clean)
    .filter(id => sourceIds.has(id));
  return {
    status,
    coverage: Math.max(0, Math.min(1, Number(raw?.coverage) || 0)),
    demonstrated: (Array.isArray(raw?.demonstrated) ? raw.demonstrated : []).map(item => fit(item, 400)).filter(Boolean).slice(0, 8),
    missing: (Array.isArray(raw?.missing) ? raw.missing : []).map(item => fit(item, 400)).filter(Boolean).slice(0, 8),
    misconceptions: (Array.isArray(raw?.misconceptions) ? raw.misconceptions : []).map(item => fit(item, 400)).filter(Boolean).slice(0, 6),
    evidence: (Array.isArray(raw?.evidence) ? raw.evidence : []).map(item => fit(item, 500)).filter(Boolean).slice(0, 8),
    materialSourceIds,
    feedback: fit(raw?.feedback, 1000),
    teaching: fit(raw?.teaching, 1400),
    nextQuestion: fit(raw?.nextQuestion, 800),
    recommendation: raw?.recommendation === "end" ? "end" : "continue"
  };
}

function isFailedStatus(status) {
  return status === "needs_practice" || status === "no_valid_attempt";
}

// Sessions persisted before failure tracking existed lack consecutiveFailures;
// derive it from trailing failed attempts so they follow the same rule.
function deriveConsecutiveFailures(session) {
  if (Number.isInteger(session.consecutiveFailures) && session.consecutiveFailures >= 0) {
    return session.consecutiveFailures;
  }
  let count = 0;
  for (let index = session.attempts.length - 1; index >= 0; index -= 1) {
    if (!isFailedStatus(session.attempts[index]?.analysis?.status)) break;
    count += 1;
  }
  return count;
}

// Deterministic anti-repeat guard: a verbatim (whitespace/case-insensitive)
// repeat of earlier teaching is replaced by a transparently labeled direct
// explanation assembled from the hidden scaffold points.
function ensureFreshTeaching(analysis, session) {
  const teaching = clean(analysis.teaching).toLowerCase();
  if (!teaching) return analysis;
  const repeated = session.attempts.some(attempt =>
    clean(attempt?.analysis?.teaching).toLowerCase() === teaching
  );
  if (!repeated) return analysis;
  const points = session.scaffold.map(item => item.point).filter(Boolean).slice(0, 3);
  if (points.length === 0) return analysis;
  const english = session.locale === "en";
  return {
    ...analysis,
    teaching: `${english ? "(Direct system explanation based on source points) " : "（系统直接讲解，基于来源要点）"}${points.join(english ? "; " : "；")}`
  };
}

export async function submitClearanceAnswer({ session, answer, analyzeFn, now = () => new Date().toISOString() }) {
  if (session.endedAt) throw new Error("Clearance session has already ended");
  const text = fit(answer, 6000);
  if (!text) throw new Error("Answer is required");
  if (typeof analyzeFn !== "function") throw new Error("Answer analysis is unavailable");
  const currentQuestion = clean(session.currentQuestion) || session.clearanceQuestion;
  // 评估模式：已连续失败过就用 direct；否则先用 coach。但首次弱回答立即切 direct 重评，
  // 让学习者第一次答错当轮就拿到直接教学，而不是被继续追问。
  const failuresSoFar = deriveConsecutiveFailures(session);
  let teachingMode = failuresSoFar >= 1 ? "direct" : "coach";
  const buildInput = (mode, extraPreviousTeachings = []) => ({
    locale: session.locale === "en" ? "en" : "zh-CN",
    question: currentQuestion,
    originalQuestion: session.clearanceQuestion,
    answer: text,
    scaffold: session.scaffold,
    sources: session.sources,
    teachingMode: mode,
    consecutiveFailures: failuresSoFar,
    previousTeachings: [
      ...session.attempts.map(attempt => attempt.analysis?.teaching).filter(Boolean),
      ...extraPreviousTeachings
    ],
    previousAttempts: session.attempts.map(attempt => ({ answer: attempt.answer, analysis: attempt.analysis }))
  });
  let raw = await analyzeFn(buildInput(teachingMode));
  let analysis = ensureFreshTeaching(normalizeAnalysis(raw, session), session);
  // 首次弱回答：立即用 direct 模式重新评估，本轮反馈就是直接教学。
  if (teachingMode === "coach" && isFailedStatus(analysis.status)) {
    teachingMode = "direct";
    const coachTeaching = analysis.teaching ? [analysis.teaching] : [];
    raw = await analyzeFn(buildInput("direct", coachTeaching));
    analysis = ensureFreshTeaching(normalizeAnalysis(raw, session), session);
  }
  const attempt = {
    id: crypto.randomUUID(),
    createdAt: now(),
    answer: text,
    analysis
  };
  session.attempts.push(attempt);
  session.consecutiveFailures = isFailedStatus(analysis.status) ? failuresSoFar + 1 : 0;
  session.teachingMode = teachingMode;
  if (analysis.recommendation === "continue" && analysis.nextQuestion) {
    session.currentQuestion = analysis.nextQuestion;
  }
  session.state = analysis.recommendation === "end" ? "ready_to_end" : "teaching";
  return attempt;
}

export function endClearanceSession(session, { now = () => new Date().toISOString() } = {}) {
  if (session.endedAt) return session.finalResult;
  const latest = session.attempts.at(-1)?.analysis;
  const status = latest?.status || "no_valid_attempt";
  const materialSources = new Set(latest?.materialSourceIds || []);
  const sourceReviewRequired = status === "provisionally_cleared" && session.sources.some(source =>
    materialSources.has(source.id)
      && (source.type === "ordinary_web" || ["low", "unknown"].includes(source.credibility))
  );
  const finalStatus = sourceReviewRequired ? "needs_verification" : status;
  session.endedAt = now();
  session.state = "ended";
  session.finalResult = {
    status: finalStatus,
    sourceReviewRequired,
    evidence: latest?.evidence || [],
    demonstrated: latest?.demonstrated || [],
    remainingGaps: latest?.missing || ["No valid learner attempt was recorded."],
    materialSourceIds: latest?.materialSourceIds || [],
    nextRecommendation: session.locale === "en"
      ? (finalStatus === "provisionally_cleared"
        ? "Apply this explanation in a new verification task before treating it as stable ability."
        : finalStatus === "needs_verification"
          ? "Check the source material or official documentation before clearing this cognitive debt."
          : "Review the teaching feedback, then explain it again in your own words.")
      : (finalStatus === "provisionally_cleared"
        ? "请在新的验证任务中应用这段解释，再把它视为稳定能力。"
        : finalStatus === "needs_verification"
          ? "请核对材料来源或官方文档，再决定是否清偿这笔认知欠条。"
          : "请复习教学反馈，再用自己的话解释一次。")
  };
  return session.finalResult;
}

export function getClearanceAnalysisPrompt() {
  return [
    "You are MindIOU's source-grounded Feynman evaluator.",
    "Judge only the learner's demonstrated explanation, not writing style or confidence.",
    "Evaluate the answer against input.question, the question the learner is actually answering; treat input.originalQuestion only as background context.",
    "Use the hidden scaffold and cited sources as a checking aid, not as text the learner must repeat verbatim.",
    "Check causal reasoning, important boundaries, trade-offs, and ability to verify AI work.",
    "When input.teachingMode is coach: teaching must address the specific misconception or missing piece of THIS attempt, reference what the learner actually wrote, never repeat any entry of input.previousTeachings, and ask one concrete follow-up question that requires the learner to explain again.",
    "When input.teachingMode is direct: stop re-asking the hard question. Give a direct, plain-language explanation of the core mechanism and one concrete worked example, and set nextQuestion to ONE micro-check question (a simple yes/no or one-sentence confirmation, not the full original question).",
    "Use input.locale for every learner-facing field. When locale is en, feedback, teaching, missing items, misconceptions, evidence, and nextQuestion must be natural English even if quoted evidence is Chinese. Preserve quoted evidence in its original language.",
    "Never claim durable mastery. Use one cautious status: provisionally_cleared, needs_practice, needs_verification, no_valid_attempt.",
    "Keep the status honest: a weak answer stays needs_practice even when teachingMode is direct.",
    "Only recommend end when the core explanation is substantially demonstrated.",
    "Return JSON with: status, coverage (0-1), demonstrated[], missing[], misconceptions[], evidence[], materialSourceIds[], feedback, teaching, nextQuestion, recommendation (continue|end)."
  ].join("\n");
}

export function getClearanceResearchPrompt(request) {
  const questionText = `${request?.originalQuestion || ""} ${request?.targetDebt || ""}`;
  const needsG2Disambiguation = /\bG2\b/i.test(questionText);
  return [
    "Research the minimum external knowledge needed to evaluate one cognitive-debt clearance answer.",
    "Prefer official documentation and primary sources. Use ordinary web sources only when needed.",
    "Resolve product names from the supplied practice context and reject same-name but unrelated products.",
    "Using the supplied practice context, distinguish terms that share a word but name different mechanisms (for example a linker --wrap symbol-redirection feature versus a wrapper launcher shell script); reject sources about the wrong mechanism.",
    ...(needsG2Disambiguation ? ["For this project, G2 means Even Realities G2 smart glasses unless the context explicitly says it is a chart library."] : []),
    "Do not write a broad tutorial. Produce a compact evidence brief with 3-6 essential points.",
    "Explain which source supports each point and include normal inline citations.",
    "Do not return JSON; citations and readable evidence are more important than formatting.",
    "Context:",
    JSON.stringify(request)
  ].join("\n");
}

export function getResearchStructuringPrompt() {
  return [
    "You structure a cited research brief for a MindIOU cognitive-debt clearance session.",
    "Use only the supplied research text and source records. Do not add facts or URLs.",
    "Reject sources about a same-name but unrelated product; do not include their source IDs in the scaffold.",
    "Using the supplied practice context, reject sources about a term that shares a word with the target concept but names a different mechanism (for example linker --wrap symbol redirection versus a wrapper launcher script); do not put their source IDs in the scaffold.",
    "Rewrite the original card into one precise clearance question.",
    "Use the original card's language. Keep the rewritten question under 48 Chinese characters or 90 English characters so it fits on smart glasses.",
    "Build 3-6 hidden scaffold points. Each point must reference one or more supplied source IDs.",
    "Return JSON only:",
    '{"rewrittenQuestion":"","summary":"","scaffold":[{"id":"point-1","point":"","whyItMatters":"","sourceIds":["source-1"]}]}'
  ].join("\n");
}
