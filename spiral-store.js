import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyState() {
  return {
    version: 2,
    sourceEvents: [],
    knowledgeAtoms: [],
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

function priorityScore(card, now) {
  const overdue = card.due <= now ? 1 : 0;
  const masteryGap = 1 - clamp(card.mastery || 0, 0, 1);
  const repetition = clamp(card.occurrences || 1, 1, 5) / 5;
  const recency = now - new Date(card.createdAt).getTime() < 7 * DAY_MS ? 1 : 0.4;
  return 0.35 * overdue + 0.25 * recency + 0.2 * masteryGap + 0.2 * repetition;
}

export function createSpiralStore(filePath) {
  const resolvedPath = path.resolve(filePath);
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
      state = {
        ...emptyState(),
        ...parsed,
        version: 2,
        sourceEvents: Array.isArray(parsed.sourceEvents) ? parsed.sourceEvents : [],
        knowledgeAtoms: Array.isArray(parsed.knowledgeAtoms) ? parsed.knowledgeAtoms : [],
        knowledgeCards: Array.isArray(parsed.knowledgeCards) ? parsed.knowledgeCards : [],
        reviewLogs: Array.isArray(parsed.reviewLogs) ? parsed.reviewLogs : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Spiral store could not be loaded: ${error.message}`);
      }
    }
    return state;
  }

  function persist() {
    const snapshot = JSON.stringify(state, null, 2);
    writeQueue = writeQueue.then(async () => {
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      const temporaryPath = `${resolvedPath}.tmp`;
      await writeFile(temporaryPath, snapshot);
      await rename(temporaryPath, resolvedPath);
    });
    return writeQueue;
  }

  async function createEvent(input) {
    const rawText = String(input.rawText || "").trim();
    const event = {
      id: clean(input.id || crypto.randomUUID()).slice(0, 100),
      sessionId: clean(input.sessionId || "").slice(0, 100),
      turnId: clean(input.turnId || "").slice(0, 100),
      source: clean(input.source || "manual").slice(0, 40),
      eventType: clean(input.eventType || input.sourceType || "Stop").slice(0, 40),
      projectId: clean(input.projectId || "general").slice(0, 120),
      title: clean(input.title || "").slice(0, 120),
      rawText: input.retainRaw === false ? "" : rawText.slice(0, 120000),
      excerpt: clean(rawText).slice(0, 240),
      charCount: rawText.length,
      privacyTags: Array.isArray(input.privacyTags)
        ? input.privacyTags.map(tag => clean(tag).slice(0, 30)).filter(Boolean).slice(0, 8)
        : [],
      processedAt: null,
      createdAt: new Date().toISOString()
    };
    state.sourceEvents.unshift(event);
    await persist();
    return event;
  }

  async function saveExtraction(eventId, extraction) {
    const sourceEvent = state.sourceEvents.find(event => event.id === eventId);
    if (!sourceEvent) throw new Error("Source event not found");

    const createdAt = new Date().toISOString();
    const atoms = [];
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
      const card = {
        id: crypto.randomUUID(),
        knowledgeAtomId: atom.id,
        sourceEventId: eventId,
        sourceEventIds: [eventId],
        projectId: sourceEvent.projectId,
        front: recallQuestion.slice(0, 96),
        back: atom.answer.slice(0, 180),
        prompt: atom.personalContext.slice(0, 150),
        tags: ["spiral", "active-recall"].filter(Boolean),
        cardType: "application",
        debtScore: clamp(input.debt_score ?? input.debtScore ?? 50, 0, 100),
        due: Date.now(),
        mastery: 0,
        repetitions: 0,
        reviewCount: 0,
        occurrences: 1,
        status: "due",
        createdAt
      };
      atoms.push(atom);
      cards.push(card);
      state.knowledgeAtoms.unshift(atom);
      state.knowledgeCards.unshift(card);
    }

    sourceEvent.processedAt = createdAt;
    sourceEvent.summary = clean(extraction.summary || "").slice(0, 300);
    await persist();
    return { atoms, cards };
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

    const review = {
      id: crypto.randomUUID(),
      cardId: card.id,
      knowledgeAtomId: card.knowledgeAtomId,
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
    return { review, card };
  }

  function nextReview() {
    const now = Date.now();
    return [...state.knowledgeCards]
      .filter(card => card.due <= now)
      .sort((left, right) => priorityScore(right, now) - priorityScore(left, now))[0] || null;
  }

  function dashboard() {
    const now = Date.now();
    const dailyEvents = recent(state.sourceEvents, now);
    const dailyAtoms = recent(state.knowledgeAtoms, now);
    const dailyReviews = recent(state.reviewLogs, now);
    const cards = [...state.knowledgeCards]
      .filter(card => card.due <= now)
      .sort((left, right) => priorityScore(right, now) - priorityScore(left, now))
      .slice(0, 5);

    return {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      metrics: {
        eventsToday: dailyEvents.length,
        atomsToday: dailyAtoms.length,
        clearable: cards.length,
        reviewedToday: dailyReviews.length,
        masteredToday: dailyReviews.filter(review => review.result === "mastered").length
      },
      cards,
      atoms: state.knowledgeAtoms.slice(0, 100),
      reviews: state.reviewLogs.slice(0, 40),
      report: {
        repeatedConcept: [...state.knowledgeAtoms]
          .sort((left, right) => (right.occurrences || 1) - (left.occurrences || 1))[0]?.concept || "",
        nextAction: cards[0]?.front || "等待下一次 Codex 学习增量",
        summary: dailyAtoms.length
          ? `今天编译了 ${dailyAtoms.length} 个知识原子，完成 ${dailyReviews.length} 次主动回忆。`
          : "今天尚未发现值得制卡的新知识。"
      }
    };
  }

  return {
    load,
    createEvent,
    saveExtraction,
    recordReview,
    nextReview,
    dashboard,
    getState: () => state
  };
}
