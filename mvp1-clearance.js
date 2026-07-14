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

export async function startClearanceSession({ report, cardId, researchFn, now = () => new Date().toISOString() }) {
  if (!report?.id) throw new Error("A persisted MVP-0 report is required");
  if (typeof researchFn !== "function") throw new Error("External research is unavailable");
  const card = findCard(report, cardId);
  const researchRequest = buildResearchRequest(report, card);
  const rawResearch = await researchFn(researchRequest);
  const sources = normalizeResearchSources(rawResearch?.sources);
  if (sources.length === 0) throw new Error("External research returned no cited sources");
  const scaffold = normalizeScaffold(rawResearch?.scaffold, sources);
  if (scaffold.length === 0) throw new Error("External research returned no explanation scaffold");

  return {
    id: crypto.randomUUID(),
    reportId: report.id,
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
    clearanceQuestion: fit(rawResearch?.rewrittenQuestion || card.prompt, 800),
    researchSummary: fit(rawResearch?.summary, 1600),
    sources,
    scaffold,
    attempts: [],
    finalResult: null
  };
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

export async function submitClearanceAnswer({ session, answer, analyzeFn, now = () => new Date().toISOString() }) {
  if (session.endedAt) throw new Error("Clearance session has already ended");
  const text = fit(answer, 6000);
  if (!text) throw new Error("Answer is required");
  if (typeof analyzeFn !== "function") throw new Error("Answer analysis is unavailable");
  const raw = await analyzeFn({
    question: session.clearanceQuestion,
    answer: text,
    scaffold: session.scaffold,
    sources: session.sources,
    previousAttempts: session.attempts.map(attempt => ({ answer: attempt.answer, analysis: attempt.analysis }))
  });
  const analysis = normalizeAnalysis(raw, session);
  const attempt = {
    id: crypto.randomUUID(),
    createdAt: now(),
    answer: text,
    analysis
  };
  session.attempts.push(attempt);
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
    nextRecommendation: finalStatus === "provisionally_cleared"
      ? "Apply the explanation in a new verification task before treating the debt as durable capability."
      : finalStatus === "needs_verification"
        ? "Review the material sources or verify the claim against an official source before clearing this debt."
        : "Review the teaching feedback and make another explanation attempt."
  };
  return session.finalResult;
}

export function getClearanceAnalysisPrompt() {
  return [
    "You are MindIOU's source-grounded Feynman evaluator.",
    "Judge only the learner's demonstrated explanation, not writing style or confidence.",
    "Use the hidden scaffold and cited sources as a checking aid, not as text the learner must repeat verbatim.",
    "Check causal reasoning, important boundaries, trade-offs, and ability to verify AI work.",
    "If the answer is weak, teach briefly and ask one concrete question that requires the learner to explain again.",
    "Never claim durable mastery. Use one cautious status: provisionally_cleared, needs_practice, needs_verification, no_valid_attempt.",
    "Only recommend end when the core explanation is substantially demonstrated.",
    "Return JSON with: status, coverage (0-1), demonstrated[], missing[], misconceptions[], evidence[], materialSourceIds[], feedback, teaching, nextQuestion, recommendation (continue|end)."
  ].join("\n");
}

export function getClearanceResearchPrompt(request) {
  return [
    "Research the minimum external knowledge needed to evaluate one cognitive-debt clearance answer.",
    "Prefer official documentation and primary sources. Use ordinary web sources only when needed.",
    "Resolve product names from the supplied practice context and reject same-name but unrelated products.",
    "For this project, G2 means Even Realities G2 smart glasses unless the context explicitly says it is a chart library.",
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
    "Rewrite the original card into one precise clearance question.",
    "Build 3-6 hidden scaffold points. Each point must reference one or more supplied source IDs.",
    "Return JSON only:",
    '{"rewrittenQuestion":"","summary":"","scaffold":[{"id":"point-1","point":"","whyItMatters":"","sourceIds":["source-1"]}]}'
  ].join("\n");
}
