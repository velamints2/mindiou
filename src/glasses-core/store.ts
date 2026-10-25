/**
 * Pure state machine for the glasses card queue.
 * No side effects, no SDK/DOM/fetch imports. Sync work is injected by the caller.
 *
 * Navigation policy: clamped. NEXT/PREVIOUS stop at the last/first card
 * instead of wrapping, so the session end stays explicit.
 */
import type {
  CardLayer,
  CardMark,
  CardProgress,
  CoreAction,
  DebtCard,
  Gesture,
  QueueState,
  SessionSummary,
  SyncStatus
} from "./types";

/** Fixed reveal order: question -> why -> evidence -> answer. */
export const CARD_LAYERS: readonly CardLayer[] = ["question", "why", "evidence", "answer"];

const LAYER_SET = new Set<string>(CARD_LAYERS);
const MARK_SET = new Set<string>(["known", "review"]);
const SYNC_STATUS_SET = new Set<string>(["idle", "syncing", "synced", "error"]);

export interface ReduceResult {
  state: QueueState;
  /** Present only for EXIT. */
  summary?: SessionSummary;
}

export function createInitialState(cards: DebtCard[]): QueueState {
  return {
    cards: [...cards],
    currentIndex: 0,
    layer: "question",
    progress: {},
    syncStatus: "idle",
    finished: false
  };
}

export function currentCard(state: QueueState): DebtCard | undefined {
  return state.cards[state.currentIndex];
}

function nextLayer(layer: CardLayer): CardLayer {
  const index = CARD_LAYERS.indexOf(layer);
  return CARD_LAYERS[Math.min(index + 1, CARD_LAYERS.length - 1)];
}

function prevLayer(layer: CardLayer): CardLayer {
  const index = CARD_LAYERS.indexOf(layer);
  return CARD_LAYERS[Math.max(index - 1, 0)];
}

function deeperLayer(a: CardLayer, b: CardLayer): CardLayer {
  return CARD_LAYERS.indexOf(a) >= CARD_LAYERS.indexOf(b) ? a : b;
}

function updateProgress(
  state: QueueState,
  cardId: string,
  update: (entry: CardProgress) => CardProgress
): Record<string, CardProgress> {
  const existing = state.progress[cardId] ?? {
    cardId,
    deepestLayer: "question" as CardLayer,
    answerRevealed: false
  };
  return { ...state.progress, [cardId]: update(existing) };
}

export function buildSummary(state: QueueState): SessionSummary {
  let known = 0;
  let review = 0;
  let answerRevealedCount = 0;
  for (const card of state.cards) {
    const entry = state.progress[card.id];
    if (entry?.mark === "known") known += 1;
    else if (entry?.mark === "review") review += 1;
    if (entry?.answerRevealed) answerRevealedCount += 1;
  }
  return {
    totalCards: state.cards.length,
    known,
    review,
    unseen: state.cards.length - known - review,
    answerRevealedCount
  };
}

/**
 * Centralized gesture mapping, kept pure for unit tests.
 * double_click marks for review on the question layer; on deeper layers it
 * steps one layer back (internal LAYER_BACK, not a platform action).
 */
export function mapGestureToAction(gesture: Gesture, layer: CardLayer): CoreAction {
  switch (gesture) {
    case "swipe_down":
      return "NEXT_CARD";
    case "swipe_up":
      return "PREVIOUS_CARD";
    case "click":
      return "REVEAL_HINT";
    case "double_click":
      return layer === "question" ? "MARK_REVIEW" : "LAYER_BACK";
  }
}

export function reduce(state: QueueState, action: CoreAction): ReduceResult {
  switch (action) {
    case "NEXT_CARD": {
      const currentIndex = Math.max(0, Math.min(state.cards.length - 1, state.currentIndex + 1));
      const moved = currentIndex !== state.currentIndex;
      return { state: { ...state, currentIndex, layer: "question", finished: moved ? false : state.finished } };
    }

    case "PREVIOUS_CARD": {
      const currentIndex = Math.max(0, state.currentIndex - 1);
      const moved = currentIndex !== state.currentIndex;
      return { state: { ...state, currentIndex, layer: "question", finished: moved ? false : state.finished } };
    }

    case "REVEAL_HINT": {
      const card = currentCard(state);
      if (!card) return { state };
      const layer = nextLayer(state.layer);
      const progress = updateProgress(state, card.id, (entry) => ({
        ...entry,
        deepestLayer: deeperLayer(entry.deepestLayer, layer),
        answerRevealed: entry.answerRevealed || layer === "answer"
      }));
      return { state: { ...state, layer, progress } };
    }

    case "REVEAL_ANSWER": {
      const card = currentCard(state);
      if (!card) return { state };
      const progress = updateProgress(state, card.id, (entry) => ({
        ...entry,
        deepestLayer: "answer",
        answerRevealed: true
      }));
      return { state: { ...state, layer: "answer", progress } };
    }

    case "MARK_KNOWN":
    case "MARK_REVIEW": {
      const card = currentCard(state);
      if (!card) return { state };
      const mark: CardMark = action === "MARK_KNOWN" ? "known" : "review";
      const progress = updateProgress(state, card.id, (entry) => ({ ...entry, mark }));
      const isLast = state.currentIndex >= state.cards.length - 1;
      // Marking auto-advances; on the last card stay put and signal completion.
      if (isLast) return { state: { ...state, progress, finished: true } };
      return {
        state: { ...state, progress, currentIndex: state.currentIndex + 1, layer: "question", finished: false }
      };
    }

    case "RETRY": {
      // Undo the current card's mark, else the nearest marked card before it.
      const current = currentCard(state);
      let targetIndex = -1;
      if (current && state.progress[current.id]?.mark) {
        targetIndex = state.currentIndex;
      } else {
        for (let i = state.currentIndex - 1; i >= 0; i -= 1) {
          if (state.progress[state.cards[i].id]?.mark) {
            targetIndex = i;
            break;
          }
        }
      }
      if (targetIndex < 0) return { state };
      const target = state.cards[targetIndex];
      const cleared: CardProgress = { ...state.progress[target.id] };
      delete cleared.mark;
      // answerRevealed stays: it records what the user saw this session.
      const progress = { ...state.progress, [target.id]: cleared };
      return {
        state: { ...state, progress, currentIndex: targetIndex, layer: "question", finished: false }
      };
    }

    case "EXIT":
      return { state, summary: buildSummary(state) };

    case "SYNC": {
      if (state.syncStatus === "syncing") return { state };
      return { state: { ...state, syncStatus: "syncing", error: undefined } };
    }

    case "LAYER_BACK": {
      const layer = prevLayer(state.layer);
      if (layer === state.layer) return { state };
      return { state: { ...state, layer } };
    }
  }
}

/**
 * Burst-input policy: every action is reduced in order (pure and cheap), but
 * only the final state is rendered. Last input wins for the frame;
 * intermediate frames are skipped.
 */
export function reduceBurst(state: QueueState, actions: CoreAction[]): ReduceResult {
  let result: ReduceResult = { state };
  for (const action of actions) {
    result = reduce(result.state, action);
  }
  return result;
}

export function serializeState(state: QueueState): string {
  return JSON.stringify(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCard(value: unknown): value is DebtCard {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.reportId === "string" &&
    typeof value.gapId === "string" &&
    typeof value.title === "string" &&
    typeof value.whyItMatters === "string" &&
    typeof value.evidence === "string" &&
    typeof value.referenceAnswer === "string" &&
    (value.sourceRef === undefined || typeof value.sourceRef === "string")
  );
}

function sanitizeProgress(value: unknown, cards: DebtCard[]): Record<string, CardProgress> {
  if (!isRecord(value)) return {};
  const knownIds = new Set(cards.map((card) => card.id));
  const progress: Record<string, CardProgress> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    if (typeof entry.cardId !== "string" || !knownIds.has(entry.cardId) || entry.cardId !== key) continue;
    if (typeof entry.deepestLayer !== "string" || !LAYER_SET.has(entry.deepestLayer)) continue;
    if (typeof entry.answerRevealed !== "boolean") continue;
    if (entry.mark !== undefined && (typeof entry.mark !== "string" || !MARK_SET.has(entry.mark))) continue;
    progress[key] = {
      cardId: entry.cardId,
      deepestLayer: entry.deepestLayer as CardLayer,
      answerRevealed: entry.answerRevealed,
      ...(entry.mark !== undefined ? { mark: entry.mark as CardMark } : {})
    };
  }
  return progress;
}

/**
 * Restore a serialized queue. Invalid or missing critical fields fall back to
 * a safe initial state built from fallbackCards, so a killed WebView never
 * restores into a broken session.
 */
export function restoreState(json: string | null | undefined, fallbackCards: DebtCard[]): QueueState {
  if (!json) return createInitialState(fallbackCards);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return createInitialState(fallbackCards);
  }
  if (!isRecord(raw)) return createInitialState(fallbackCards);
  if (!Array.isArray(raw.cards) || !raw.cards.every(isValidCard)) {
    return createInitialState(fallbackCards);
  }
  const cards = raw.cards as DebtCard[];
  const currentIndex =
    typeof raw.currentIndex === "number" && Number.isFinite(raw.currentIndex)
      ? Math.max(0, Math.min(Math.floor(raw.currentIndex), Math.max(cards.length - 1, 0)))
      : 0;
  const layer =
    typeof raw.layer === "string" && LAYER_SET.has(raw.layer) ? (raw.layer as CardLayer) : "question";
  const syncStatus =
    typeof raw.syncStatus === "string" && SYNC_STATUS_SET.has(raw.syncStatus)
      ? (raw.syncStatus as SyncStatus)
      : "idle";
  return {
    cards,
    currentIndex,
    layer,
    progress: sanitizeProgress(raw.progress, cards),
    syncStatus,
    error: typeof raw.error === "string" ? raw.error : undefined,
    finished: raw.finished === true
  };
}

/** Injected by the caller; receives a serialized snapshot to persist. */
export type SyncFn = (snapshot: string) => Promise<void>;

function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message) return `同步失败：${error.message}`;
  return "同步失败，请稍后重试";
}

/**
 * Run one sync cycle: idle -> syncing -> synced/error. On failure the error
 * message is user-readable and all marks are preserved for a later retry.
 */
export async function runSync(state: QueueState, syncFn: SyncFn): Promise<QueueState> {
  const syncing = reduce(state, "SYNC").state;
  try {
    await syncFn(serializeState(syncing));
    return { ...syncing, syncStatus: "synced" };
  } catch (error) {
    return { ...syncing, syncStatus: "error", error: toUserMessage(error) };
  }
}

/**
 * Thin stateful wrapper around the pure reducer. The only side effect is the
 * caller-injected sync function.
 */
export class GlassesCoreStore {
  private state: QueueState;
  private readonly syncFn?: SyncFn;

  constructor(initial: QueueState, deps: { syncFn?: SyncFn } = {}) {
    this.state = initial;
    this.syncFn = deps.syncFn;
  }

  getState(): QueueState {
    return this.state;
  }

  dispatch(action: CoreAction): ReduceResult {
    if (action === "SYNC") {
      if (!this.syncFn) {
        this.state = { ...this.state, syncStatus: "error", error: "同步不可用：未注入同步函数" };
        return { state: this.state };
      }
      if (this.state.syncStatus !== "syncing") {
        this.state = reduce(this.state, "SYNC").state;
        void this.sync();
      }
      return { state: this.state };
    }
    const result = reduce(this.state, action);
    this.state = result.state;
    return result;
  }

  async sync(): Promise<QueueState> {
    if (!this.syncFn || this.state.syncStatus !== "syncing") return this.state;
    this.state = await runSync(this.state, this.syncFn);
    return this.state;
  }

  toJSON(): string {
    return serializeState(this.state);
  }

  static fromJSON(
    json: string | null | undefined,
    fallbackCards: DebtCard[],
    deps: { syncFn?: SyncFn } = {}
  ): GlassesCoreStore {
    return new GlassesCoreStore(restoreState(json, fallbackCards), deps);
  }
}
