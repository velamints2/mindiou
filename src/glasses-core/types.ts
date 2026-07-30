/**
 * Platform-independent data model for the glasses card core.
 * No SDK, DOM, or network imports allowed in this module.
 */

/** One cognitive-debt card shown on glasses, rooted in a capability gap. */
export interface DebtCard {
  id: string;
  reportId: string;
  gapId: string;
  /** Layer 1: the question / debt title. */
  title: string;
  /** Layer 2: why this debt matters. */
  whyItMatters: string;
  /** Layer 3: source evidence / hint. */
  evidence: string;
  /** Layer 4: reference answer / clearance points. */
  referenceAnswer: string;
  /** Optional pointer back to the report or source. */
  sourceRef?: string;
}

/** The four reveal layers, in fixed progression order. */
export type CardLayer = "question" | "why" | "evidence" | "answer";

/** Explicit user marks. "Later" is not a mark: swiping next is enough. */
export type CardMark = "known" | "review";

export interface CardProgress {
  cardId: string;
  deepestLayer: CardLayer;
  answerRevealed: boolean;
  mark?: CardMark;
}

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export interface QueueState {
  cards: DebtCard[];
  currentIndex: number;
  layer: CardLayer;
  /** Progress keyed by card id; entries are created lazily on interaction. */
  progress: Record<string, CardProgress>;
  syncStatus: SyncStatus;
  /** User-readable sync error; marks are preserved for retry. */
  error?: string;
  /** Session-complete signal: set when the last card is marked. */
  finished: boolean;
}

/** Exactly nine platform actions. Anything else is an internal action. */
export type GlassesAction =
  | "NEXT_CARD"
  | "PREVIOUS_CARD"
  | "REVEAL_HINT"
  | "REVEAL_ANSWER"
  | "MARK_KNOWN"
  | "MARK_REVIEW"
  | "RETRY"
  | "EXIT"
  | "SYNC";

/** Internal-only action produced by gesture mapping, never by platforms. */
export type InternalAction = "LAYER_BACK";

export type CoreAction = GlassesAction | InternalAction;

export type Gesture = "click" | "double_click" | "swipe_up" | "swipe_down";

/** Session summary returned by EXIT. Describes current-session evidence only. */
export interface SessionSummary {
  totalCards: number;
  known: number;
  review: number;
  /** Cards without any mark. */
  unseen: number;
  /** Cards whose answer layer was revealed; counted separately, never as mastery. */
  answerRevealedCount: number;
}
