export type LearningSessionState =
  | "idle"
  | "concept_prompt"
  | "ai_explaining"
  | "feynman_question"
  | "listening"
  | "evaluating"
  | "feedback"
  | "follow_up"
  | "summary"
  | "review_scheduled";

export type LearningSessionEvent =
  | "START"
  | "EXPLAIN"
  | "ASK"
  | "START_LISTENING"
  | "SUBMIT_ANSWER"
  | "FEEDBACK_READY"
  | "FOLLOW_UP"
  | "SUMMARIZE"
  | "SCHEDULE_REVIEW"
  | "NAVIGATE"
  | "END";

const transitions: Record<LearningSessionState, Partial<Record<LearningSessionEvent, LearningSessionState>>> = {
  idle: { START: "concept_prompt" },
  concept_prompt: {
    EXPLAIN: "ai_explaining",
    ASK: "feynman_question",
    START_LISTENING: "listening",
    NAVIGATE: "concept_prompt",
    END: "idle"
  },
  ai_explaining: { ASK: "feynman_question", START_LISTENING: "listening", END: "idle" },
  feynman_question: { START_LISTENING: "listening", END: "idle" },
  listening: { SUBMIT_ANSWER: "evaluating", END: "idle" },
  evaluating: { FEEDBACK_READY: "feedback", END: "idle" },
  feedback: {
    FOLLOW_UP: "follow_up",
    SUMMARIZE: "summary",
    NAVIGATE: "concept_prompt",
    END: "idle"
  },
  follow_up: { START_LISTENING: "listening", SUMMARIZE: "summary", END: "idle" },
  summary: { SCHEDULE_REVIEW: "review_scheduled", END: "idle" },
  review_scheduled: { NAVIGATE: "concept_prompt", END: "idle" }
};

export function transitionSession(
  state: LearningSessionState,
  event: LearningSessionEvent
): LearningSessionState {
  return transitions[state][event] || state;
}

export function sessionLabel(state: LearningSessionState): string {
  return state.replaceAll("_", " ").toUpperCase();
}
