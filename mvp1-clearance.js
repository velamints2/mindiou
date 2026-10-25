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

function questionKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[“”"'‘’`.,!?，。！？：:；;（）()\[\]【】\s]/g, "");
}

function questionTokens(value) {
  return new Set((questionKey(value).match(/[a-z0-9]+|[一-鿿]/g) || []).filter(Boolean));
}

function contextTerms(value) {
  const text = clean(value).toLowerCase();
  const english = text.match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const chinese = text.match(/[一-鿿]{2,}/g) || [];
  const bigrams = chinese.flatMap(word => Array.from({ length: Math.max(0, word.length - 1) }, (_, index) => word.slice(index, index + 2)));
  return new Set([...english, ...bigrams]);
}

function questionFitsDebtContext(candidate, session) {
  const question = clean(candidate);
  if (!question) return false;
  const generic = /机制|边界|验证|证据|反例|条件|失效|原因|如何|为什么|what|why|how|boundary|verify|evidence|counterexample|condition/i.test(question);
  const context = [
    session.originalCard?.prompt,
    session.originalCard?.target,
    session.debtContext?.title,
    session.debtContext?.gap,
    session.debtContext?.evidence,
    session.debtContext?.domain
  ].filter(Boolean).join(" ");
  const terms = contextTerms(context);
  if (terms.size === 0 || (generic && question.length < 18)) return true;
  const english = question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const chinese = question.toLowerCase().match(/[一-鿿]{2,}/g) || [];
  const candidateTerms = new Set([
    ...english,
    ...chinese.flatMap(word => Array.from({ length: Math.max(0, word.length - 1) }, (_, index) => word.slice(index, index + 2)))
  ]);
  const overlap = [...candidateTerms].filter(term => terms.has(term)).length;
  return overlap > 0 || generic;
}

function isRepeatedQuestion(candidate, previous) {
  const candidateKey = questionKey(candidate);
  const previousKey = questionKey(previous);
  if (!candidateKey || !previousKey) return false;
  if (candidateKey === previousKey) return true;
  const shorter = candidateKey.length <= previousKey.length ? candidateKey : previousKey;
  const longer = candidateKey.length > previousKey.length ? candidateKey : previousKey;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.78) return true;
  const candidateTokens = questionTokens(candidate);
  const previousTokens = questionTokens(previous);
  if (candidateTokens.size < 6 || previousTokens.size < 6) return false;
  const intersection = [...candidateTokens].filter(token => previousTokens.has(token)).length;
  return intersection / new Set([...candidateTokens, ...previousTokens]).size >= 0.86;
}

function fallbackDistinctQuestion(session, analysis, previousQuestions) {
  const locale = session.locale === "en" ? "en" : "zh-CN";
  const missing = analysis.missing?.find(item => questionFitsDebtContext(item, session));
  const candidates = locale === "en"
    ? [
        missing ? `Use a different scenario to explain: ${fit(missing, 90)}` : "Use a different scenario: when would this mechanism fail, and how would you verify it?",
        "Change one condition in the example. What would change in your conclusion, and why?",
        "Give one concrete signal that would distinguish the two cases."
      ]
    : [
        missing ? `换一个场景说明：${fit(missing, 90)}` : "换一个场景：这个机制在什么情况下会失效，你会如何验证？",
        "改变例子中的一个条件，你的结论会怎么变？为什么？",
        "请给出一个能区分这两种情况的具体信号。"
      ];
  return candidates.find(candidate => !previousQuestions.some(previous => isRepeatedQuestion(candidate, previous))) || "";
}

function distinctNextQuestion(candidate, session, analysis) {
  if (analysis.recommendation === "end") return "";
  const previousQuestions = [
    session.clearanceQuestion,
    session.researchQuestion,
    ...session.attempts.map(attempt => attempt.analysis?.nextQuestion)
  ].filter(Boolean);
  const nextQuestion = fit(candidate, 800);
  if (nextQuestion
    && questionFitsDebtContext(nextQuestion, session)
    && !previousQuestions.some(previous => isRepeatedQuestion(nextQuestion, previous))) {
    return nextQuestion;
  }
  return fallbackDistinctQuestion(session, analysis, previousQuestions);
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
  if (card?.sourceGapId) {
    const bySourceGap = gaps.find(gap => clean(gap.sourceGapId) === clean(card.sourceGapId));
    if (bySourceGap) return bySourceGap;
  }
  if (Number.isInteger(Number(card?.gapRank))) {
    const byRank = gaps.find(gap => Number(gap.rank) === Number(card.gapRank));
    if (byRank) return byRank;
  }
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

export async function startClearanceSession({ report, cardId, cognitiveDebtId = "", debtContext = null, researchFn, now = () => new Date().toISOString() }) {
  if (!report?.id) throw new Error("A persisted MVP-0 report is required");
  if (typeof researchFn !== "function") throw new Error("External research is unavailable");
  const card = findCard(report, cardId);
  const researchRequest = buildResearchRequest(report, card);
  const rawResearch = await researchFn(researchRequest);
  const sources = normalizeResearchSources(rawResearch?.sources);
  if (sources.length === 0) throw new Error("External research returned no cited sources");
  const scaffold = normalizeScaffold(rawResearch?.scaffold, sources);
  if (scaffold.length === 0) throw new Error("External research returned no explanation scaffold");

  const resolvedDebtContext = debtContext && typeof debtContext === "object"
    ? {
        cognitiveDebtId: fit(debtContext.cognitiveDebtId || cognitiveDebtId, 100),
        title: fit(debtContext.title || card.target, 500),
        gap: fit(debtContext.gap, 600),
        evidence: fit(debtContext.evidence, 1000),
        masteryCriteria: Array.isArray(debtContext.masteryCriteria) ? debtContext.masteryCriteria.slice(0, 6).map(item => fit(item, 300)) : [],
        domain: fit(debtContext.domain || report.analysis?.userCapability?.currentDomain, 300)
      }
    : {
        cognitiveDebtId: fit(cognitiveDebtId, 100),
        title: fit(card.target, 500),
        gap: fit(researchRequest.dangerousGap?.gap, 600),
        evidence: fit(researchRequest.dangerousGap?.evidence, 1000),
        masteryCriteria: [],
        domain: fit(report.analysis?.userCapability?.currentDomain, 300)
      };

  return {
    id: crypto.randomUUID(),
    reportId: report.id,
    locale: report.locale === "en" ? "en" : "zh-CN",
    cardId: card.id,
    cognitiveDebtId: resolvedDebtContext.cognitiveDebtId,
    debtContext: resolvedDebtContext,
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
    // Research may explain the topic, but it must not redefine the learner's
    // task. Keep the original card prompt as the canonical question.
    clearanceQuestion: fit(card.prompt, 800),
    researchQuestion: fit(rawResearch?.rewrittenQuestion, 800),
    researchSummary: fit(rawResearch?.summary, 1600),
    researchMode: clean(rawResearch?.researchMode || "live_ai"),
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
  const analysis = {
    status,
    coverage: Math.max(0, Math.min(1, Number(raw?.coverage) || 0)),
    demonstrated: (Array.isArray(raw?.demonstrated) ? raw.demonstrated : []).map(item => fit(item, 400)).filter(Boolean).slice(0, 8),
    missing: (Array.isArray(raw?.missing) ? raw.missing : []).map(item => fit(item, 400)).filter(Boolean).slice(0, 8),
    misconceptions: (Array.isArray(raw?.misconceptions) ? raw.misconceptions : []).map(item => fit(item, 400)).filter(Boolean).slice(0, 6),
    evidence: (Array.isArray(raw?.evidence) ? raw.evidence : []).map(item => fit(item, 500)).filter(Boolean).slice(0, 8),
    materialSourceIds,
    feedback: fit(raw?.feedback, 1000),
    teaching: fit(raw?.teaching, 1400),
    nextQuestion: "",
    recommendation: raw?.recommendation === "end" ? "end" : "continue"
  };
  analysis.nextQuestion = distinctNextQuestion(raw?.nextQuestion, session, analysis);
  return analysis;
}

export async function submitClearanceAnswer({ session, answer, analyzeFn, now = () => new Date().toISOString() }) {
  if (session.endedAt) throw new Error("Clearance session has already ended");
  const text = fit(answer, 6000);
  if (!text) throw new Error("Answer is required");
  if (typeof analyzeFn !== "function") throw new Error("Answer analysis is unavailable");
  const raw = await analyzeFn({
    locale: session.locale === "en" ? "en" : "zh-CN",
    question: session.clearanceQuestion || session.originalCard?.prompt || "",
    originalQuestion: session.originalCard?.prompt || "",
    answer: text,
    debtContext: session.debtContext,
    scaffold: session.scaffold,
    sources: session.sources,
    previousAttempts: session.attempts.map(attempt => ({ answer: attempt.answer, analysis: attempt.analysis })),
    previousQuestions: [
      session.clearanceQuestion,
      ...session.attempts.map(attempt => attempt.analysis?.nextQuestion)
    ].filter(Boolean)
  });
  const analysis = normalizeAnalysis(raw, session);
  const attempt = {
    id: crypto.randomUUID(),
    createdAt: now(),
    question: session.clearanceQuestion || session.originalCard?.prompt || "",
    answer: text,
    analysis
  };
  session.attempts.push(attempt);
  // A follow-up is the actual question for the next turn. Keep originalCard
  // as the immutable source, while clearanceQuestion tracks the live turn so
  // the evaluator and UI do not keep replaying the first question.
  if (analysis.nextQuestion) session.clearanceQuestion = analysis.nextQuestion;
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
    "Use the hidden scaffold and cited sources as a checking aid, not as text the learner must repeat verbatim.",
    "Check causal reasoning, important boundaries, trade-offs, and ability to verify AI work.",
    "If the answer is weak, teach briefly and ask one concrete question that requires the learner to explain again.",
    "The debtContext is the binding scope for this session. Evaluate only the originalQuestion, debtContext, cited sources, and the learner's answer. Do not introduce a new person, product, metric, symptom, or application scenario that is absent from that scope.",
    "If a missing point or a proposed next question is outside debtContext, discard it and ask about a missing mechanism, boundary, counterexample, changed condition, or verification signal within debtContext.",
    "Never repeat the original question or any previous follow-up question. Change the angle: ask about a missing mechanism, a boundary, a counterexample, a changed condition, or a concrete verification signal.",
    "The input includes previousQuestions. Treat them as forbidden duplicates, including minor punctuation or wording changes that preserve the same question.",
    "Use input.locale for every learner-facing field. When locale is en, feedback, teaching, missing items, misconceptions, evidence, and nextQuestion must be natural English even if quoted evidence is Chinese. Preserve quoted evidence in its original language.",
    "Never claim durable mastery. Use one cautious status: provisionally_cleared, needs_practice, needs_verification, no_valid_attempt.",
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
    "The original card is the task boundary. Rewrite it only for brevity while preserving its subject, actors, metrics, and decision. Never substitute a different application scenario or add a new person, symptom, metric, or product.",
    "Use the original card's language. Keep the rewritten question under 48 Chinese characters or 90 English characters so it fits on smart glasses.",
    "Build 3-6 hidden scaffold points. Each point must reference one or more supplied source IDs.",
    "Return JSON only:",
    '{"rewrittenQuestion":"","summary":"","scaffold":[{"id":"point-1","point":"","whyItMatters":"","sourceIds":["source-1"]}]}'
  ].join("\n");
}
