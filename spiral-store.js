import crypto from "node:crypto";
import { createSqliteStateNamespace } from "./sqlite-state-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyState() {
  return {
    version: 5,
    sourceEvents: [],
    learningCandidates: [],
    learningPaths: [],
    knowledgeAtoms: [],
    learningDebts: [],
    knowledgeCards: [],
    reviewLogs: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function recent(items, now = Date.now()) {
  return items.filter(item => now - new Date(item.createdAt || item.reviewedAt || 0).getTime() <= DAY_MS);
}

function conceptKey(projectId, concept) {
  return `${clean(projectId).toLowerCase()}::${clean(concept).toLowerCase()}`;
}

function debtLevel(score) {
  if (score >= 81) return "critical";
  if (score >= 61) return "high";
  if (score >= 31) return "medium";
  return "light";
}

function priorityScore(card, now) {
  const overdue = card.due <= now ? 1 : 0;
  const masteryGap = 1 - clamp(card.mastery || 0, 0, 1);
  const repetition = clamp(card.occurrences || 1, 1, 5) / 5;
  const recency = now - new Date(card.createdAt).getTime() < 7 * DAY_MS ? 1 : 0.4;
  return 0.35 * overdue + 0.25 * recency + 0.2 * masteryGap + 0.2 * repetition;
}

export function createSpiralStore(dbPath, options = {}) {
  const persistence = createSqliteStateNamespace(dbPath, "spiral", options);
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = await persistence.load(emptyState());
      state = {
        ...emptyState(),
        ...parsed,
        version: 5,
        sourceEvents: Array.isArray(parsed.sourceEvents) ? parsed.sourceEvents : [],
        learningCandidates: Array.isArray(parsed.learningCandidates) ? parsed.learningCandidates : [],
        learningPaths: Array.isArray(parsed.learningPaths) ? parsed.learningPaths : [],
        knowledgeAtoms: Array.isArray(parsed.knowledgeAtoms) ? parsed.knowledgeAtoms : [],
        learningDebts: Array.isArray(parsed.learningDebts) ? parsed.learningDebts : [],
        knowledgeCards: Array.isArray(parsed.knowledgeCards) ? parsed.knowledgeCards : [],
        reviewLogs: Array.isArray(parsed.reviewLogs) ? parsed.reviewLogs : []
      };
      const migratedDebts = backfillLearningDebts();
      const migratedCards = normalizeKnowledgeCards();
      if (migratedDebts > 0 || migratedCards > 0) await persist();
    } catch (error) {
      console.warn(`Spiral store could not be loaded: ${error.message}`);
    }
    return state;
  }

  function backfillLearningDebts() {
    let migrated = 0;
    for (const atom of state.knowledgeAtoms) {
      if (state.learningDebts.some(debt => debt.knowledgeAtomId === atom.id)) continue;
      const card = state.knowledgeCards.find(item => item.knowledgeAtomId === atom.id);
      const latestReview = card
        ? state.reviewLogs.find(review => review.cardId === card.id)
        : null;
      const score = clamp(card?.debtScore ?? 50, 0, 100);
      const debt = {
        id: crypto.randomUUID(),
        knowledgeAtomId: atom.id,
        projectId: atom.projectId,
        sourceEventIds: atom.sourceEventIds || (card?.sourceEventId ? [card.sourceEventId] : []),
        title: atom.concept,
        skill: atom.concept,
        aiTask: "Created before AI debt tracking was enabled.",
        evidence: atom.personalContext || "",
        microExercise: atom.recallQuestion || card?.front || "",
        cardType: card?.cardType || "recall",
        debtScore: score,
        level: debtLevel(score),
        status: latestReview?.result === "mastered"
          ? "cleared"
          : latestReview && latestReview.result !== "skip"
            ? "training"
            : "open",
        occurrences: atom.occurrences || 1,
        createdAt: atom.createdAt || card?.createdAt || new Date().toISOString(),
        updatedAt: latestReview?.reviewedAt || atom.updatedAt || atom.createdAt,
        clearedAt: latestReview?.result === "mastered" ? latestReview.reviewedAt : null,
        migrated: true
      };
      state.learningDebts.push(debt);
      if (card) card.debtId = debt.id;
      for (const review of state.reviewLogs.filter(item => item.cardId === card?.id)) {
        review.debtId = debt.id;
      }
      migrated += 1;
    }
    return migrated;
  }

  function normalizeKnowledgeCards() {
    let migrated = 0;
    for (const card of state.knowledgeCards) {
      const atom = state.knowledgeAtoms.find(item => item.id === card.knowledgeAtomId);
      if (!atom) continue;
      const front = clean(atom.concept).slice(0, 64);
      const back = clean(atom.answer || atom.plainExplanation).slice(0, 180);
      const prompt = clean(atom.recallQuestion).slice(0, 140);
      if (card.front === front && card.back === back && card.prompt === prompt) continue;
      card.front = front;
      card.back = back;
      card.prompt = prompt;
      migrated += 1;
    }
    return migrated;
  }

  function persist() {
    const snapshot = structuredClone(state);
    writeQueue = writeQueue.then(async () => {
      persistence.save(snapshot);
    });
    return writeQueue;
  }

  async function createEvent(input) {
    const rawText = String(input.rawText || "").trim();
    const eventId = clean(input.id || crypto.randomUUID()).slice(0, 100);
    const existing = state.sourceEvents.find(event => event.id === eventId);
    if (existing) return existing;
    const event = {
      id: eventId,
      sessionId: clean(input.sessionId || "").slice(0, 100),
      turnId: clean(input.turnId || "").slice(0, 100),
      source: clean(input.source || "manual").slice(0, 40),
      eventType: clean(input.eventType || input.sourceType || "Stop").slice(0, 40),
      projectId: clean(input.projectId || "general").slice(0, 120),
      title: clean(input.title || "").slice(0, 120),
      rawText: input.retainRaw === false ? "" : rawText.slice(0, 120000),
      analysisText: rawText.slice(0, 30000),
      excerpt: clean(rawText).slice(0, 240),
      charCount: rawText.length,
      privacyTags: Array.isArray(input.privacyTags)
        ? input.privacyTags.map(tag => clean(tag).slice(0, 30)).filter(Boolean).slice(0, 8)
        : [],
      processedAt: null,
      checkpointedAt: null,
      createdAt: new Date().toISOString()
    };
    state.sourceEvents.unshift(event);
    await persist();
    return event;
  }

  function pendingEvents(projectId = "") {
    const normalizedProject = clean(projectId);
    return state.sourceEvents
      .filter(event => !event.checkpointedAt && (!normalizedProject || event.projectId === normalizedProject))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async function saveCandidate(input) {
    const event = state.sourceEvents.find(item => item.id === input.eventId);
    if (!event) throw new Error("Source event not found");
    const concept = clean(input.concept).slice(0, 100);
    if (!concept) throw new Error("Candidate concept is required");
    const key = conceptKey(event.projectId, concept);
    const now = new Date().toISOString();
    const existing = state.learningCandidates.find(candidate => candidate.key === key);
    if (existing) {
      existing.sourceEventIds = [...new Set([...existing.sourceEventIds, event.id])].slice(-20);
      existing.occurrences = (existing.occurrences || 1) + 1;
      existing.updatedAt = now;
      event.checkpointedAt = now;
      event.processedAt = now;
      event.analysisText = "";
      await persist();
      return { candidate: existing, created: false };
    }
    const candidate = {
      id: crypto.randomUUID(),
      key,
      projectId: event.projectId,
      sourceEventIds: [event.id],
      concept,
      summary: clean(input.summary).slice(0, 240),
      explanation: clean(input.explanation).slice(0, 500),
      answer: clean(input.answer || input.explanation).slice(0, 500),
      recallQuestion: clean(input.recallQuestion).slice(0, 240),
      aiTask: clean(input.aiTask).slice(0, 240),
      skillGap: clean(input.skillGap || concept).slice(0, 160),
      microExercise: clean(input.microExercise).slice(0, 240),
      debtScore: clamp(input.debtScore ?? 50, 0, 100),
      confidence: clamp(input.confidence ?? 0.7, 0, 1),
      gateEvidence: {
        aiJudgment: clean(input.gateEvidence?.aiJudgment).slice(0, 300),
        missingExplainOrVerify: clean(input.gateEvidence?.missingExplainOrVerify).slice(0, 300),
        projectImpact: clean(input.gateEvidence?.projectImpact).slice(0, 300),
        transferValue: clean(input.gateEvidence?.transferValue).slice(0, 300),
        notLowValue: clean(input.gateEvidence?.notLowValue).slice(0, 300)
      },
      research: input.research || null,
      researchMode: clean(input.researchMode || "stub").slice(0, 20),
      status: "pending",
      decision: null,
      pathId: null,
      occurrences: 1,
      createdAt: now,
      updatedAt: now
    };
    state.learningCandidates.unshift(candidate);
    event.checkpointedAt = now;
    event.processedAt = now;
    event.summary = candidate.summary;
    event.analysisText = "";
    await persist();
    return { candidate, created: true };
  }

  async function markCheckpointed(eventId, summary = "") {
    const event = state.sourceEvents.find(item => item.id === eventId);
    if (!event) throw new Error("Source event not found");
    const now = new Date().toISOString();
    event.checkpointedAt = now;
    event.processedAt = now;
    event.summary = clean(summary).slice(0, 300);
    event.analysisText = "";
    await persist();
    return event;
  }

  function listCandidates(status = "") {
    const normalized = clean(status);
    return state.learningCandidates.filter(candidate => !normalized || candidate.status === normalized);
  }

  async function decideCandidate(candidateId, decision) {
    const candidate = state.learningCandidates.find(item => item.id === candidateId);
    if (!candidate) throw new Error("Learning candidate not found");
    const normalizedDecision = clean(decision).toLowerCase();
    if (!["accepted", "rejected"].includes(normalizedDecision)) {
      throw new Error("Candidate decision must be accepted or rejected");
    }
    if (candidate.status === "converted" && normalizedDecision === "accepted") {
      const path = state.learningPaths.find(item => item.id === candidate.pathId) || null;
      return { candidate, path, cards: path ? state.knowledgeCards.filter(card => card.pathId === path.id) : [] };
    }
    candidate.status = normalizedDecision;
    candidate.decision = normalizedDecision;
    candidate.updatedAt = new Date().toISOString();
    if (normalizedDecision === "rejected") {
      await persist();
      return { candidate, path: null, cards: [] };
    }
    return createPathForCandidate(candidate);
  }

  async function createPathForCandidate(candidate) {
    const now = new Date().toISOString();
    const event = state.sourceEvents.find(item => candidate.sourceEventIds.includes(item.id));
    const researchFinding = clean(candidate.research?.findings?.[0]?.text || candidate.explanation);
    const verification = clean(candidate.research?.verification || `说明如何验证 ${candidate.concept} 的修复或选择是否完整。`);
    const steps = [
      {
        kind: "practice",
        front: "真实情境",
        back: clean(event?.excerpt || candidate.summary).slice(0, 180),
        prompt: `这次实践真正要解决什么问题？`
      },
      {
        kind: "principle",
        front: candidate.concept,
        back: candidate.explanation,
        prompt: candidate.recallQuestion || `用自己的话解释 ${candidate.concept}。`
      },
      {
        kind: "judgment",
        front: "判断 AI 方案",
        back: researchFinding,
        prompt: `AI 的处理覆盖了哪些关键环节？`
      },
      {
        kind: "verification",
        front: "完整性验收",
        back: verification,
        prompt: `你会要求什么证据来证明修复完整？`
      },
      {
        kind: "active",
        front: "现在你来判断",
        back: candidate.answer,
        prompt: candidate.microExercise || candidate.recallQuestion
      }
    ];
    const atom = {
      id: crypto.randomUUID(),
      key: conceptKey(candidate.projectId, candidate.concept),
      projectId: candidate.projectId,
      concept: candidate.concept,
      plainExplanation: candidate.explanation,
      personalContext: candidate.summary,
      example: event?.excerpt || "",
      commonMistake: "",
      recallQuestion: candidate.recallQuestion,
      answer: candidate.answer,
      sourceEventIds: candidate.sourceEventIds,
      confidence: candidate.confidence,
      occurrences: candidate.occurrences,
      createdAt: now,
      updatedAt: now
    };
    const debt = {
      id: crypto.randomUUID(),
      knowledgeAtomId: atom.id,
      projectId: candidate.projectId,
      sourceEventIds: candidate.sourceEventIds,
      title: candidate.skillGap,
      skill: candidate.concept,
      aiTask: candidate.aiTask,
      evidence: candidate.summary,
      microExercise: candidate.microExercise,
      cardType: "path",
      debtScore: candidate.debtScore,
      level: debtLevel(candidate.debtScore),
      status: "open",
      occurrences: candidate.occurrences,
      createdAt: now,
      updatedAt: now,
      clearedAt: null
    };
    const path = {
      id: crypto.randomUUID(),
      candidateIds: [candidate.id],
      projectId: candidate.projectId,
      sourceEventIds: candidate.sourceEventIds,
      title: candidate.concept,
      targetDepth: "verify",
      status: "queued",
      cardIds: [],
      createdAt: now,
      updatedAt: now
    };
    const cards = steps.map((step, index) => ({
      id: crypto.randomUUID(),
      knowledgeAtomId: atom.id,
      debtId: debt.id,
      candidateId: candidate.id,
      pathId: path.id,
      pathOrder: index,
      sourceEventId: candidate.sourceEventIds[0],
      sourceEventIds: candidate.sourceEventIds,
      projectId: candidate.projectId,
      front: clean(step.front).slice(0, 64),
      back: clean(step.back).slice(0, 180),
      prompt: clean(step.prompt).slice(0, 140),
      tags: ["spiral", "learning-path", step.kind],
      cardType: step.kind,
      debtScore: candidate.debtScore,
      due: Date.now(),
      mastery: 0,
      repetitions: 0,
      reviewCount: 0,
      occurrences: candidate.occurrences,
      status: "due",
      createdAt: now
    }));
    path.cardIds = cards.map(card => card.id);
    state.knowledgeAtoms.unshift(atom);
    state.learningDebts.unshift(debt);
    state.learningPaths.unshift(path);
    state.knowledgeCards.unshift(...cards);
    candidate.status = "converted";
    candidate.pathId = path.id;
    candidate.updatedAt = now;
    await persist();
    return { candidate, path, cards };
  }

  async function saveExtraction(eventId, extraction) {
    const sourceEvent = state.sourceEvents.find(event => event.id === eventId);
    if (!sourceEvent) throw new Error("Source event not found");

    const createdAt = new Date().toISOString();
    const atoms = [];
    const debts = [];
    const cards = [];

    for (const input of (extraction.atoms || []).slice(0, 3)) {
      const concept = clean(input.concept).slice(0, 100);
      const recallQuestion = clean(input.recall_question || input.recallQuestion).slice(0, 120);
      if (!concept || !recallQuestion) continue;

      const key = conceptKey(sourceEvent.projectId, concept);
      const existingAtom = state.knowledgeAtoms.find(atom => atom.key === key);
      if (existingAtom) {
        existingAtom.sourceEventIds = [...new Set([...existingAtom.sourceEventIds, eventId])].slice(-20);
        existingAtom.occurrences = (existingAtom.occurrences || 1) + 1;
        existingAtom.confidence = Math.max(existingAtom.confidence, clamp(input.confidence, 0, 1));
        existingAtom.updatedAt = createdAt;
        const existingDebt = state.learningDebts.find(debt => debt.knowledgeAtomId === existingAtom.id);
        if (existingDebt) {
          existingDebt.sourceEventIds = [...new Set([...existingDebt.sourceEventIds, eventId])].slice(-20);
          existingDebt.occurrences = (existingDebt.occurrences || 1) + 1;
          existingDebt.debtScore = Math.max(existingDebt.debtScore, clamp(input.debt_score, 0, 100));
          existingDebt.level = debtLevel(existingDebt.debtScore);
          existingDebt.updatedAt = createdAt;
          if (existingDebt.status === "cleared") {
            existingDebt.status = "open";
            existingDebt.clearedAt = null;
          }
          debts.push(existingDebt);
        }
        atoms.push(existingAtom);
        continue;
      }

      const atom = {
        id: crypto.randomUUID(),
        key,
        projectId: sourceEvent.projectId,
        concept,
        plainExplanation: clean(input.plain_explanation || input.plainExplanation).slice(0, 220),
        personalContext: clean(input.personal_context || input.personalContext).slice(0, 220),
        example: clean(input.example).slice(0, 220),
        commonMistake: clean(input.common_mistake || input.commonMistake).slice(0, 180),
        recallQuestion,
        answer: clean(input.answer || input.plain_explanation || input.plainExplanation).slice(0, 220),
        sourceEventIds: [eventId],
        confidence: clamp(input.confidence ?? 0.7, 0, 1),
        occurrences: 1,
        createdAt,
        updatedAt: createdAt
      };
      const score = clamp(input.debt_score ?? input.debtScore ?? 50, 0, 100);
      const debt = {
        id: crypto.randomUUID(),
        knowledgeAtomId: atom.id,
        projectId: sourceEvent.projectId,
        sourceEventIds: [eventId],
        title: clean(input.skill_gap || input.skillGap || concept).slice(0, 120),
        skill: concept,
        aiTask: clean(input.ai_task || input.aiTask).slice(0, 180),
        evidence: clean(input.personal_context || input.personalContext || sourceEvent.excerpt).slice(0, 240),
        microExercise: clean(input.micro_exercise || input.microExercise || recallQuestion).slice(0, 180),
        cardType: clean(input.card_type || input.cardType || "recall").slice(0, 30),
        debtScore: score,
        level: debtLevel(score),
        status: "open",
        occurrences: 1,
        createdAt,
        updatedAt: createdAt,
        clearedAt: null
      };
      const card = {
        id: crypto.randomUUID(),
        knowledgeAtomId: atom.id,
        debtId: debt.id,
        sourceEventId: eventId,
        sourceEventIds: [eventId],
        projectId: sourceEvent.projectId,
        front: concept.slice(0, 64),
        back: atom.answer.slice(0, 180),
        prompt: recallQuestion.slice(0, 140),
        tags: ["spiral", "active-recall"].filter(Boolean),
        cardType: "application",
        debtScore: score,
        due: Date.now(),
        mastery: 0,
        repetitions: 0,
        reviewCount: 0,
        occurrences: 1,
        status: "due",
        createdAt
      };
      atoms.push(atom);
      debts.push(debt);
      cards.push(card);
      state.knowledgeAtoms.unshift(atom);
      state.learningDebts.unshift(debt);
      state.knowledgeCards.unshift(card);
    }

    sourceEvent.processedAt = createdAt;
    sourceEvent.summary = clean(extraction.summary || "").slice(0, 300);
    await persist();
    return { atoms, debts, cards };
  }

  async function recordReview(input) {
    const card = state.knowledgeCards.find(item => item.id === input.cardId);
    if (!card) throw new Error("Knowledge card not found");
    const result = clean(input.result || "partial").toLowerCase();
    if (!["mastered", "partial", "incorrect", "skip"].includes(result)) {
      throw new Error("Review result must be mastered, partial, incorrect, or skip");
    }

    const now = Date.now();
    const interval = result === "mastered"
      ? Math.min(14, Math.max(2, card.repetitions + 2)) * DAY_MS
      : result === "partial"
        ? DAY_MS
        : result === "skip"
          ? 2 * 60 * 60 * 1000
          : 4 * 60 * 60 * 1000;

    card.reviewCount += 1;
    card.repetitions += result === "mastered" ? 1 : 0;
    card.mastery = result === "mastered" ? Math.min(1, (card.mastery || 0) + 0.35)
      : result === "partial" ? Math.max(0.25, card.mastery || 0)
        : Math.max(0, (card.mastery || 0) - 0.15);
    card.due = now + interval;
    card.status = "scheduled";
    const debt = state.learningDebts.find(item => item.id === card.debtId);
    if (debt) {
      debt.status = result === "mastered" ? "cleared"
        : result === "skip" ? debt.status
          : "training";
      debt.clearedAt = result === "mastered" ? new Date(now).toISOString() : null;
      debt.updatedAt = new Date(now).toISOString();
    }

    const review = {
      id: crypto.randomUUID(),
      cardId: card.id,
      knowledgeAtomId: card.knowledgeAtomId,
      debtId: card.debtId,
      projectId: card.projectId,
      result,
      confidence: clamp(input.confidence, 0, 5),
      responseText: clean(input.responseText || "").slice(0, 500),
      source: clean(input.source || "phone").slice(0, 30),
      reviewedAt: new Date(now).toISOString(),
      nextDueAt: new Date(card.due).toISOString()
    };
    state.reviewLogs.unshift(review);
    await persist();
    return { review, card, debt };
  }

  function nextReview() {
    const now = Date.now();
    return [...state.knowledgeCards]
      .filter(card => card.due <= now)
      .sort((left, right) => priorityScore(right, now) - priorityScore(left, now))[0] || null;
  }

  function buildSession(durationInput) {
    const duration = [15, 60, 180].includes(Number(durationInput)) ? Number(durationInput) : 60;
    const limit = duration === 15 ? 1 : duration === 60 ? 3 : 5;
    const now = Date.now();
    const queuedPath = state.learningPaths.find(path => path.status === "queued");
    const pathCards = queuedPath
      ? state.knowledgeCards
        .filter(card => card.pathId === queuedPath.id && card.due <= now)
        .sort((left, right) => (left.pathOrder || 0) - (right.pathOrder || 0))
      : [];
    const cards = (pathCards.length
      ? pathCards
      : [...state.knowledgeCards]
        .filter(card => card.due <= now)
        .sort((left, right) => priorityScore(right, now) - priorityScore(left, now)))
      .slice(0, limit);
    return {
      id: crypto.randomUUID(),
      mode: "learn",
      duration,
      estimatedSeconds: Math.min(duration, cards.length * 30),
      cardCount: cards.length,
      cards
    };
  }

  function dashboard() {
    const now = Date.now();
    const dailyEvents = recent(state.sourceEvents, now);
    const dailyAtoms = recent(state.knowledgeAtoms, now);
    const dailyDebts = recent(state.learningDebts, now);
    const dailyReviews = recent(state.reviewLogs, now);
    const answeredReviews = dailyReviews.filter(review => review.result !== "skip");
    const practicedReviews = answeredReviews.filter(review => review.responseText);
    const clearedDebtReviews = dailyReviews.filter(review => review.result === "mastered" && review.debtId);
    const queuedPath = state.learningPaths.find(path => path.status === "queued");
    const queuedPathCards = queuedPath
      ? state.knowledgeCards
        .filter(card => card.pathId === queuedPath.id && card.due <= now)
        .sort((left, right) => (left.pathOrder || 0) - (right.pathOrder || 0))
      : [];
    const cards = (queuedPathCards.length
      ? queuedPathCards
      : [...state.knowledgeCards]
        .filter(card => card.due <= now)
        .sort((left, right) => priorityScore(right, now) - priorityScore(left, now)))
      .slice(0, 5);

    return {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      metrics: {
        eventsToday: dailyEvents.length,
        atomsToday: dailyAtoms.length,
        debtsToday: dailyDebts.length,
        openDebts: state.learningDebts.filter(debt => debt.status !== "cleared").length,
        clearable: cards.length,
        reviewedToday: dailyReviews.length,
        masteredToday: dailyReviews.filter(review => review.result === "mastered").length,
        debtsClearedToday: clearedDebtReviews.length,
        recallAccuracy: answeredReviews.length
          ? Math.round(answeredReviews.filter(review => review.result === "mastered").length / answeredReviews.length * 100)
          : 0,
        noAiPracticeRate: answeredReviews.length
          ? Math.round(practicedReviews.length / answeredReviews.length * 100)
          : 0
      },
      cards,
      candidates: state.learningCandidates.slice(0, 100),
      paths: state.learningPaths.slice(0, 100),
      atoms: state.knowledgeAtoms.slice(0, 100).map(atom => {
        const debt = state.learningDebts.find(item => item.knowledgeAtomId === atom.id);
        return debt ? {
          ...atom,
          debtId: debt.id,
          debtScore: debt.debtScore,
          debtLevel: debt.level,
          debtStatus: debt.status,
          microExercise: debt.microExercise,
          aiTask: debt.aiTask
        } : atom;
      }),
      debts: state.learningDebts.slice(0, 100),
      reviews: state.reviewLogs.slice(0, 40),
      report: {
        repeatedConcept: [...state.knowledgeAtoms]
          .sort((left, right) => (right.occurrences || 1) - (left.occurrences || 1))[0]?.concept || "",
        nextAction: cards[0]?.front || "等待下一次 Codex 学习增量",
        summary: dailyDebts.length
          ? `今天识别 ${dailyDebts.length} 笔 AI 债务，清偿 ${clearedDebtReviews.length} 笔，完成 ${dailyReviews.length} 次主动回忆。`
          : "今天尚未发现值得制卡的新知识。"
      }
    };
  }

  return {
    load,
    createEvent,
    pendingEvents,
    saveCandidate,
    markCheckpointed,
    listCandidates,
    decideCandidate,
    saveExtraction,
    recordReview,
    nextReview,
    buildSession,
    dashboard,
    getState: () => state
  };
}
