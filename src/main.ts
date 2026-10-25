import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge
} from "@evenrealities/even_hub_sdk";
import {
  sessionLabel,
  transitionSession,
  type LearningSessionEvent,
  type LearningSessionState
} from "./session";
import {
  localTutorResponse,
  tutorGlassesText,
  tutorPhoneText,
  tutorStateEvents,
  type TutorKind,
  type TutorResponse
} from "./tutor";
import { TranscriptIntake, voiceActionForContext, type VoiceAction } from "./voice";
import {
  MAX_PCM_BUFFER_BYTES,
  PCM_BATCH_MS,
  PCM_SAMPLE_RATE,
  STT_RETRY_BACKOFF_MS,
  isSpeechPcm,
  isFatalSttError,
  nextPcmFlushDelayMs,
  pcmDurationMs,
  shouldFlushUtterance
} from "./audio";
import {
  createInitialSpeakingProfile,
  attachEnglishTurnEvidence,
  chooseEnglishLoopAction,
  createEnglishLoopSessionPlan,
  englishCriterionLabel,
  englishMasteryStatusLabel,
  extractEnglishTurnEvidence,
  isUsefulEnglishLoopResponse,
  localEnglishLoopReply,
  markEnglishLoopSessionStarted,
  normalizeSpeakingProfile,
  recordInterventionFeedback,
  refreshEnglishMasteryReviewStates,
  reflectEnglishLoopSession,
  updateEnglishMasteryFromSession,
  observeEnglishTurn,
  type EnglishSuccessCriterion,
  type EnglishLoopActionType,
  type SessionPlan,
  type SessionReflection,
  type TurnEvidence,
  type LoopDecision,
  type SpeakingMoveType,
  type SpeakingProfile
} from "./english-loop";
import "./styles.css";

type LearningCard = {
  id: string;
  knowledgeAtomId?: string;
  sourceEventId?: string;
  sourceEventIds?: string[];
  projectId?: string;
  front: string;
  back: string;
  prompt: string;
  tags: string[];
  debtScore?: number;
  mastery?: number;
  due: number;
  repetitions: number;
};

type KnowledgeAtom = {
  id: string;
  projectId: string;
  concept: string;
  plainExplanation: string;
  personalContext: string;
  recallQuestion: string;
  confidence: number;
  occurrences: number;
  sourceEventIds: string[];
  debtScore?: number;
  debtLevel?: string;
  debtStatus?: string;
  microExercise?: string;
  aiTask?: string;
};

type SpiralDashboard = {
  ok: boolean;
  metrics: {
    atomsToday: number;
    debtsToday: number;
    clearable: number;
    reviewedToday: number;
    recallAccuracy: number;
    noAiPracticeRate: number;
  };
  cards: LearningCard[];
  atoms: KnowledgeAtom[];
  reviews: Array<{
    id: string;
    result: string;
    projectId: string;
    reviewedAt: string;
  }>;
  report: {
    repeatedConcept: string;
    nextAction: string;
    summary: string;
  };
};

type ImportResponse = {
  ok: boolean;
  cards?: LearningCard[];
  fallback?: boolean;
  error?: string;
};

type PlanResponse = {
  ok: boolean;
  cards?: LearningCard[];
  overview?: string;
  error?: string;
};

type TranscriptResponse = {
  ok: boolean;
  text?: string;
  confidence?: number;
  latencyMs?: number;
  error?: string;
};

type EnglishLoopResponse = {
  ok: boolean;
  reply?: string;
  feedback?: string;
  nextPrompt?: string;
  g2Text?: string;
  shouldContinue?: boolean;
  outputType?: "update" | "debt" | "information" | "experiment" | "nothing";
  moveType?: SpeakingMoveType;
  state?: "in_progress" | "completed" | "stuck" | "off_topic" | "unclear_audio";
  action?: EnglishLoopActionType;
  decision?: LoopDecision;
  fallback?: boolean;
  error?: string;
};

type EnglishLoopStateResponse = {
  ok: boolean;
  state?: {
    profile?: SpeakingProfile | null;
    sessions?: Array<{
      id: string;
      topic: string;
      turnCount: number;
      startedAt: string;
      endedAt: string;
      summary?: EnglishLoopSessionSummary;
    }>;
    feedback?: Array<{ interventionId: string; status: string; note: string; createdAt: string }>;
  };
  error?: string;
};

type EnglishLoopSessionSummary = {
  turnCount: number;
  evidenceCount: number;
  minutes: number;
  decisionType: string;
  decisionTitle: string;
  decisionReason: string;
  nextPracticeType: string;
  nextPracticeTitle: string;
  nextPracticeTask: string;
  completedAt: string;
  reflection?: SessionReflection;
};

type HealthResponse = {
  ok: boolean;
  ai: boolean;
  provider?: string;
  model: string;
  stt?: boolean;
  sttModel: string;
  providerStatus?: {
    reachable: boolean;
    status?: number;
    error?: string;
  };
};

type EvenBridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>;

declare global {
  interface Window {
    EvenAppBridge?: unknown;
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
};

const DISPLAY_ID = 1;
const CONCEPT_IMAGE_ID = 2;
type StudyAction = VoiceAction | "previous";
const runtimeParams = new URL(window.location.href).searchParams;
const simulatorTestMode = runtimeParams.get("testMode") === "1";

const cardFrontEl = document.querySelector<HTMLHeadingElement>("#card-front")!;
const cardBackEl = document.querySelector<HTMLParagraphElement>("#card-back")!;
const coachLineEl = document.querySelector<HTMLParagraphElement>("#coach-line")!;
const voiceLineEl = document.querySelector<HTMLParagraphElement>("#voice-line")!;
const sessionStateEl = document.querySelector<HTMLParagraphElement>("#session-state")!;
const statusPillEl = document.querySelector<HTMLSpanElement>("#status-pill")!;
const importTextEl = document.querySelector<HTMLTextAreaElement>("#import-text")!;
const importFileEl = document.querySelector<HTMLInputElement>("#import-file")!;
const apiBaseUrlEl = document.querySelector<HTMLInputElement>("#api-base-url")!;
const apiTokenEl = document.querySelector<HTMLInputElement>("#api-token")!;
const subjectInputEl = document.querySelector<HTMLInputElement>("#subject-input")!;
const levelInputEl = document.querySelector<HTMLInputElement>("#level-input")!;
const answerTextEl = document.querySelector<HTMLTextAreaElement>("#answer-text")!;
const importAiButton = document.querySelector<HTMLButtonElement>("#import-ai")!;
const planCourseButton = document.querySelector<HTMLButtonElement>("#plan-course")!;
const submitAnswerButton = document.querySelector<HTMLButtonElement>("#submit-answer")!;
const repeatButton = document.querySelector<HTMLButtonElement>("#repeat-card")!;
const askButton = document.querySelector<HTMLButtonElement>("#ask-card")!;
const nextButton = document.querySelector<HTMLButtonElement>("#next-card")!;
const knownButton = document.querySelector<HTMLButtonElement>("#known-card")!;
const toggleVoiceButton = document.querySelector<HTMLButtonElement>("#toggle-voice")!;
const mockRepeatButton = document.querySelector<HTMLButtonElement>("#mock-repeat")!;
const saveSettingsButton = document.querySelector<HTMLButtonElement>("#save-settings")!;
const ingestButton = document.querySelector<HTMLButtonElement>("#ingest-debt")!;
const syncTodayButton = document.querySelector<HTMLButtonElement>("#sync-today")!;
const captureSourceEl = document.querySelector<HTMLSelectElement>("#capture-source")!;
const captureProjectEl = document.querySelector<HTMLInputElement>("#capture-project")!;
const retainSourceEl = document.querySelector<HTMLInputElement>("#retain-source")!;
const captureStatusEl = document.querySelector<HTMLParagraphElement>("#capture-status")!;
const metricAtomsEl = document.querySelector<HTMLSpanElement>("#metric-debts")!;
const metricClearableEl = document.querySelector<HTMLSpanElement>("#metric-clearable")!;
const metricReviewedEl = document.querySelector<HTMLSpanElement>("#metric-reviewed")!;
const currentScoreEl = document.querySelector<HTMLSpanElement>("#current-debt-score")!;
const atomListEl = document.querySelector<HTMLDivElement>("#debt-list")!;
const reviewSummaryEl = document.querySelector<HTMLParagraphElement>("#review-summary")!;
const reviewConceptEl = document.querySelector<HTMLElement>("#review-blindspot")!;
const reviewNextActionEl = document.querySelector<HTMLElement>("#review-next-action")!;
const reviewListEl = document.querySelector<HTMLDivElement>("#review-list")!;
const reviewAccuracyEl = document.querySelector<HTMLElement>("#review-accuracy")!;
const reviewPracticeRateEl = document.querySelector<HTMLElement>("#review-practice-rate")!;
const studyNoticeEl = document.querySelector<HTMLParagraphElement>("#study-notice")!;
const testAiConnectionButton = document.querySelector<HTMLButtonElement>("#test-ai-connection")!;
const aiConnectionStatusEl = document.querySelector<HTMLParagraphElement>("#ai-connection-status")!;
const englishLoopToggleButton = document.querySelector<HTMLButtonElement>("#english-loop-toggle")!;
const englishLoopStartVoiceButton = document.querySelector<HTMLButtonElement>("#english-loop-start-voice")!;
const englishLoopTopicEl = document.querySelector<HTMLInputElement>("#english-loop-topic")!;
const englishLoopGoalEl = document.querySelector<HTMLInputElement>("#english-loop-goal")!;
const englishLoopStatusEl = document.querySelector<HTMLParagraphElement>("#english-loop-status")!;
const englishLoopReplyEl = document.querySelector<HTMLParagraphElement>("#english-loop-reply")!;
const englishLoopFeedbackEl = document.querySelector<HTMLParagraphElement>("#english-loop-feedback")!;
const englishLoopNextEl = document.querySelector<HTMLParagraphElement>("#english-loop-next")!;
const englishLoopDecisionEl = document.querySelector<HTMLParagraphElement>("#english-loop-decision")!;
const englishLoopSessionSummaryEl = document.querySelector<HTMLParagraphElement>("#english-loop-session-summary")!;
const englishLoopInterventionEl = document.querySelector<HTMLDivElement>("#english-loop-intervention")!;
const englishLoopProfileEl = document.querySelector<HTMLDivElement>("#english-loop-profile")!;
const englishLoopDebtListEl = document.querySelector<HTMLDivElement>("#english-loop-expression-debts")!;
const englishLoopSyncStatusEl = document.querySelector<HTMLParagraphElement>("#english-loop-sync-status")!;

let bridge: EvenBridge | null = null;
let bridgeReady = false;
let voiceEnabled = false;
let speechRecognition: SpeechRecognitionLike | null = null;
let cards: LearningCard[] = simulatorTestMode ? sampleCards() : loadCards();
let cardIndex = simulatorTestMode ? 0 : Number(localStorage.getItem("g2LearningIndex") || "0");
const publicApiBaseUrl = window.location.pathname.startsWith('/mindiou/')
  ? `${window.location.origin}/mindiou-api/`
  : `${window.location.origin}/`
let apiBaseUrl = window.location.pathname.startsWith('/mindiou/')
  ? publicApiBaseUrl
  : readSetting("g2LearningApiBaseUrl", "api", publicApiBaseUrl);
let apiToken = readSetting("g2LearningApiToken", "token", "");
let audioChunks: Uint8Array[] = [];
let lastAudioSendAt = 0;
let lastTranscribeSkipAt = 0;
let pcmFlushTimer: number | null = null;
let transcriptionInFlight = false;
let transcriptionBlocked = false;
let transcribeRetryAt = 0;
let utteranceStartedAt = 0;
let lastSpeechAt = 0;
let utteranceHasSpeech = false;
let g2AudioActive = false;
let audioCaptureStartedAt = 0;
let audioEventCount = 0;
let audioByteCount = 0;
let audioTelemetryAt = 0;
let audioTelemetryEventCount = 0;
let audioTelemetryByteCount = 0;
let sessionState: LearningSessionState = transitionSession("idle", "START");
const transcriptIntake = new TranscriptIntake();
let englishLoopEnabled = localStorage.getItem("g2EnglishLoopEnabled") === "1";
let englishLoopProfile = loadEnglishLoopProfile();
let englishLoopTopic = localStorage.getItem("g2EnglishLoopTopic") || "AI, products, work, or something you genuinely care about";
let englishLoopSessionActive = false;
let englishLoopSessionId = "";
let englishLoopSessionStartedAt = "";
let englishLoopSessionStartTurns = 0;
let englishLoopSessionStartMinutes = 0;
let englishLoopSessionStartEvidence = 0;
let englishLoopLastSessionSummary = loadEnglishLoopSessionSummary();
let englishLoopNotice = "";
let englishLoopHistory: Array<{ speaker: "user" | "assistant"; text: string }> = [];
let englishLoopSessionEvidence: TurnEvidence[] = [];
const englishLoopClientId = loadEnglishLoopClientId();
let englishLoopSyncState: "local" | "syncing" | "synced" | "offline" = "local";
const englishLoopOutboxKey = "g2EnglishLoopOutbox";
let englishLoopOutbox = loadEnglishLoopOutbox();
let englishLoopFlushPromise: Promise<void> | null = null;
let englishLoopRetryTimer: number | null = null;
// ── Projects mode: cross-machine project progress on glasses ──
type ProgressProject = {
  projectName: string;
  projectPath: string;
  tools: string[];
  machines: string[];
  sessions: number;
  lastActiveAt: string;
  staleDays: number | null;
  lastTask: string;
};
type ProgressResponse = { ok: boolean; projects: ProgressProject[]; focus: { note: string; projectPath: string | null; setAt: string } | null };
let projectsMode = false;
let progressProjects: ProgressProject[] = [];
let progressIndex = 0;

// ── Debts mode: cognitive debt review + micro check on glasses ──
type DebtItem = { id: string; gapText: string; evidenceLevel?: string; status?: string };
let debtMode = false;
let debtList: DebtItem[] = [];
let debtIndex = 0;
let quizStep = 0; // 0 = debt card, 1-3 = micro check questions
let quizAnswers: string[] = [];
const DEBT_QUESTIONS = 3;

const NAVIGATION_IMAGE_DELAY_MS = 420;
const GESTURE_DEBOUNCE_MS = 240;
const IMAGE_UPLOAD_TIMEOUT_MS = 6500;
const debugImageHoldMs = Number(runtimeParams.get("imageHoldMs") || "0");
const debugImageUploadFailure = runtimeParams.get("imageFail") === "1";

apiBaseUrlEl.value = apiBaseUrl;
apiTokenEl.value = apiToken;
englishLoopTopicEl.value = englishLoopTopic;
englishLoopGoalEl.value = englishLoopProfile.goal.statement;

function readSetting(key: string, queryKey: string, fallback: string): string {
  const url = new URL(window.location.href);
  return url.searchParams.get(queryKey) || localStorage.getItem(key) || fallback;
}

function loadCards(): LearningCard[] {
  const raw = localStorage.getItem("g2LearningCards");
  if (!raw) return sampleCards();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return sampleCards();
    const fronts = parsed.map(card => clean(String(card?.front || "")).toLowerCase());
    const legacyDemo = ["apple", "resilient", "context", "iterate"].every(
      (front, index) => fronts[index] === front
    );
    return legacyDemo ? sampleCards() : parsed.map(normalizeCard);
  } catch {
    return sampleCards();
  }
}

function loadEnglishLoopProfile(): SpeakingProfile {
  const raw = localStorage.getItem("g2EnglishSpeakingProfile");
  if (!raw) return createInitialSpeakingProfile();
  try {
    return normalizeSpeakingProfile(JSON.parse(raw));
  } catch {
    return createInitialSpeakingProfile();
  }
}

function loadEnglishLoopClientId(): string {
  const stored = localStorage.getItem("g2EnglishLoopClientId") || "";
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(stored)) return stored;
  const generated = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `g2client${Date.now()}${Math.random().toString(36).slice(2, 14)}`;
  localStorage.setItem("g2EnglishLoopClientId", generated);
  return generated;
}

function loadEnglishLoopSessionSummary(): EnglishLoopSessionSummary | null {
  try {
    const raw = localStorage.getItem("g2EnglishLoopLastSessionSummary");
    return raw ? JSON.parse(raw) as EnglishLoopSessionSummary : null;
  } catch {
    return null;
  }
}

function saveEnglishLoopSessionSummary(summary: EnglishLoopSessionSummary): void {
  localStorage.setItem("g2EnglishLoopLastSessionSummary", JSON.stringify(summary));
}

function saveEnglishLoopProfile(): void {
  englishLoopProfile.goal.statement = englishLoopGoalEl.value.trim() || englishLoopProfile.goal.statement;
  localStorage.setItem("g2EnglishSpeakingProfile", JSON.stringify(englishLoopProfile));
  localStorage.setItem("g2EnglishLoopEnabled", englishLoopEnabled ? "1" : "0");
  localStorage.setItem("g2EnglishLoopTopic", englishLoopTopic);
}

function setEnglishLoopSyncStatus(text: string): void {
  englishLoopSyncStatusEl.textContent = text;
}

function englishLoopSessionSnapshot(overrides: Partial<{
  id: string;
  startedAt: string;
  endedAt: string;
  summary?: EnglishLoopSessionSummary;
}> = {}): { id: string; topic: string; goal: SpeakingProfile["goal"]; startedAt: string; endedAt?: string; summary?: EnglishLoopSessionSummary } | undefined {
  const id = overrides.id || englishLoopSessionId;
  if (!id) return undefined;
  return {
    id,
    topic: englishLoopTopic,
    goal: englishLoopProfile.goal,
    startedAt: overrides.startedAt || englishLoopSessionStartedAt || englishLoopProfile.lastSessionAt,
    ...(overrides.endedAt ? { endedAt: overrides.endedAt } : {}),
    ...(overrides.summary ? { summary: overrides.summary } : {})
  };
}

type EnglishLoopSyncInput = {
  event: string;
  profile?: SpeakingProfile;
  sessionPlan?: SessionPlan;
  sessionId?: string;
  session?: ReturnType<typeof englishLoopSessionSnapshot>;
  feedback?: {
    interventionId: string;
    status: "helpful" | "not_helpful";
    note?: string;
  };
  turn?: {
    id: string;
    observedAt: string;
    wordCount: number;
    signals: TurnEvidence["signals"];
    decisionType: string;
    nextMoveType?: string;
    learnerState?: TurnEvidence["state"];
    action?: TurnEvidence["action"];
    criteriaMet?: TurnEvidence["criteriaMet"];
    missingCriteria?: TurnEvidence["missingCriteria"];
    evidenceType?: TurnEvidence["evidenceType"];
    fallback?: boolean;
  };
};

type EnglishLoopOutboxJob = EnglishLoopSyncInput & {
  id: string;
  kind: "state" | "feedback";
  feedback?: {
    interventionId: string;
    status: "helpful" | "not_helpful";
    note?: string;
  };
};

function loadEnglishLoopOutbox(): EnglishLoopOutboxJob[] {
  try {
    const raw = localStorage.getItem(englishLoopOutboxKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-50) as EnglishLoopOutboxJob[] : [];
  } catch {
    return [];
  }
}

function saveEnglishLoopOutbox(): void {
  localStorage.setItem(englishLoopOutboxKey, JSON.stringify(englishLoopOutbox.slice(-50)));
}

function outboxJobId(input: EnglishLoopSyncInput, kind: EnglishLoopOutboxJob["kind"]): string {
  const stablePart = input.turn?.id || input.sessionId || input.session?.id || `${input.event}-${Date.now()}`;
  const feedbackPart = input.feedback?.interventionId || "";
  return `${kind}-${input.event}-${stablePart}-${feedbackPart}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 180);
}

async function syncEnglishLoopStateNow(input: EnglishLoopSyncInput): Promise<void> {
  englishLoopSyncState = "syncing";
  setEnglishLoopSyncStatus("正在保存本次 Loop 的结构化进展…");
  const payload = await apiPost<EnglishLoopStateResponse>("/api/learn/english-loop/state", {
    clientId: englishLoopClientId,
    event: input.event,
    profile: input.profile || englishLoopProfile,
    sessionPlan: input.sessionPlan || input.profile?.sessionPlan || englishLoopProfile.sessionPlan,
    sessionId: input.sessionId || input.session?.id || englishLoopSessionId,
    session: input.session,
    turn: input.turn
  }, { "x-english-loop-client-id": englishLoopClientId });
  if (!payload.ok) throw new Error(payload.error || "English Loop state sync failed");
  englishLoopSyncState = "synced";
  setEnglishLoopSyncStatus(`已保存到内部 Loop · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · 原始转写不保存`);
}

async function syncEnglishLoopFeedbackNow(job: EnglishLoopOutboxJob): Promise<void> {
  if (!job.feedback) throw new Error("English Loop feedback payload is missing");
  const payload = await apiPost<EnglishLoopStateResponse>("/api/learn/english-loop/feedback", {
    clientId: englishLoopClientId,
    interventionId: job.feedback.interventionId,
    status: job.feedback.status,
    note: job.feedback.note || "",
    sessionId: job.sessionId,
    profile: job.profile || englishLoopProfile,
    session: job.session
  }, { "x-english-loop-client-id": englishLoopClientId });
  if (!payload.ok) throw new Error(payload.error || "English Loop feedback sync failed");
}

async function flushEnglishLoopOutbox(): Promise<void> {
  if (englishLoopFlushPromise) return englishLoopFlushPromise;
  englishLoopFlushPromise = (async () => {
    while (englishLoopOutbox.length) {
      const job = englishLoopOutbox[0];
      try {
        englishLoopSyncState = "syncing";
        setEnglishLoopSyncStatus("正在补同步离线期间的 Loop 进展…");
        if (job.kind === "feedback") await syncEnglishLoopFeedbackNow(job);
        else await syncEnglishLoopStateNow(job);
        englishLoopOutbox.shift();
        saveEnglishLoopOutbox();
      } catch (error) {
        englishLoopSyncState = "offline";
        setEnglishLoopSyncStatus(`当前仅保存在本设备 · 待同步 ${englishLoopOutbox.length} 项`);
        void logEvent("english_loop_sync_failed", {
          reason: error instanceof Error ? error.message : "sync_failed",
          pending: englishLoopOutbox.length
        });
        if (englishLoopRetryTimer === null) {
          englishLoopRetryTimer = window.setTimeout(() => {
            englishLoopRetryTimer = null;
            void flushEnglishLoopOutbox();
          }, 30_000);
        }
        break;
      }
    }
    if (!englishLoopOutbox.length) {
      if (englishLoopRetryTimer !== null) {
        window.clearTimeout(englishLoopRetryTimer);
        englishLoopRetryTimer = null;
      }
      englishLoopSyncState = "synced";
      setEnglishLoopSyncStatus("内部 Loop 已同步 · 原始转写不保存");
    }
  })().finally(() => {
    englishLoopFlushPromise = null;
  });
  return englishLoopFlushPromise;
}

function enqueueEnglishLoopSync(input: EnglishLoopSyncInput): Promise<void> {
  const job: EnglishLoopOutboxJob = {
    ...input,
    id: outboxJobId(input, "state"),
    kind: "state"
  };
  if (!englishLoopOutbox.some(item => item.id === job.id)) {
    englishLoopOutbox.push(job);
    saveEnglishLoopOutbox();
  }
  return flushEnglishLoopOutbox();
}

function enqueueEnglishLoopFeedback(input: EnglishLoopSyncInput & {
  feedback: { interventionId: string; status: "helpful" | "not_helpful"; note?: string };
}): Promise<void> {
  const job: EnglishLoopOutboxJob = {
    ...input,
    id: outboxJobId(input, "feedback"),
    kind: "feedback"
  };
  if (!englishLoopOutbox.some(item => item.id === job.id)) {
    englishLoopOutbox.push(job);
    saveEnglishLoopOutbox();
  }
  return flushEnglishLoopOutbox();
}

function profileProgress(profile: SpeakingProfile): number {
  return profile.turns * 10 + profile.sessions * 100 + profile.evidenceEvents.length;
}

function buildEnglishLoopSessionSummary(sessionId: string, completedAt = new Date().toISOString()): EnglishLoopSessionSummary {
  const turnCount = Math.max(0, englishLoopProfile.turns - englishLoopSessionStartTurns);
  const evidenceCount = Math.max(0, englishLoopProfile.evidenceEvents.length - englishLoopSessionStartEvidence);
  const minutes = Math.max(0, Math.round((englishLoopProfile.minutes - englishLoopSessionStartMinutes) * 10) / 10);
  return {
    turnCount,
    evidenceCount,
    minutes,
    decisionType: englishLoopProfile.lastDecision.type,
    decisionTitle: englishLoopProfile.lastDecision.title,
    decisionReason: englishLoopProfile.lastDecision.reason,
    nextPracticeType: englishLoopProfile.nextPractice.type,
    nextPracticeTitle: englishLoopProfile.nextPractice.title,
    nextPracticeTask: englishLoopProfile.nextPractice.task,
    completedAt,
    ...(englishLoopProfile.lastSessionReflection
      && englishLoopProfile.lastSessionReflection.sessionId === sessionId
      ? { reflection: englishLoopProfile.lastSessionReflection }
      : {})
  };
}

function renderEnglishLoopSessionSummary(summary: EnglishLoopSessionSummary | null): void {
  if (!summary) {
    englishLoopSessionSummaryEl.textContent = "结束一次真实对话后，这里会留下本次观察和下一步建议。";
    return;
  }
  const reflection = summary.reflection;
  const reflectionText = reflection?.nextExperiment ? ` 本轮复盘：${reflection.nextExperiment}` : "";
  englishLoopSessionSummaryEl.textContent = `本次完成 ${summary.turnCount} 次表达 · ${summary.minutes.toFixed(1)} 分钟 · ${summary.decisionTitle}。下一步：${summary.nextPracticeTitle}：${summary.nextPracticeTask}${reflectionText}`;
}

async function restoreEnglishLoopState(): Promise<void> {
  try {
    await flushEnglishLoopOutbox();
    const payload = await apiGet<EnglishLoopStateResponse>("/api/learn/english-loop/state", {
      "x-english-loop-client-id": englishLoopClientId
    });
    const remote = payload.state?.profile ? normalizeSpeakingProfile(payload.state.profile) : null;
    if (remote && profileProgress(remote) >= profileProgress(englishLoopProfile)) {
      englishLoopProfile = remote;
      englishLoopGoalEl.value = remote.goal.statement;
      saveEnglishLoopProfile();
      renderEnglishLoop();
      englishLoopSyncState = "synced";
      setEnglishLoopSyncStatus("已从内部 Loop 恢复 · 原始转写不保存");
      const latestSummary = payload.state?.sessions?.[0]?.summary;
      if (latestSummary?.completedAt) {
        englishLoopLastSessionSummary = latestSummary;
        saveEnglishLoopSessionSummary(latestSummary);
        renderEnglishLoopSessionSummary(latestSummary);
      }
      return;
    }
    if (englishLoopProfile.turns > 0) {
      await enqueueEnglishLoopSync({ event: "local_recovery", profile: englishLoopProfile });
    } else {
      englishLoopSyncState = "synced";
      setEnglishLoopSyncStatus("内部 Loop 已连接 · 原始转写不保存");
    }
  } catch (error) {
    englishLoopSyncState = "offline";
    setEnglishLoopSyncStatus("当前仅保存在本设备 · 可继续练习，服务恢复后会同步");
    void logEvent("english_loop_restore_failed", {
      reason: error instanceof Error ? error.message : "restore_failed"
    });
  }
}

function renderEnglishLoop(): void {
  englishLoopToggleButton.textContent = englishLoopEnabled ? "关闭英语 Loop" : "开启英语 Loop";
  englishLoopStartVoiceButton.textContent = voiceEnabled ? "结束本次口语" : "开始本次口语";
  englishLoopStatusEl.textContent = englishLoopEnabled
    ? `英语 Loop 已${englishLoopSessionActive ? "进入本次对话" : "准备好"} · ${englishLoopProfile.turns} 次表达 · ${englishLoopProfile.minutes.toFixed(1)} 分钟 · ${englishLoopProfile.evidenceEvents.length} 条证据`
    : "先开启英语 Loop，再用 G2 麦克风进行 10–20 分钟真实对话。";
  if (englishLoopSyncState === "local") setEnglishLoopSyncStatus("本设备本地保存 · 正在连接内部 Loop");
  renderEnglishLoopSessionSummary(englishLoopLastSessionSummary);
  const activePlan = englishLoopSessionActive ? englishLoopProfile.sessionPlan : undefined;
  const latestEvidence = englishLoopProfile.lastTurnEvidence;
  const difficultyLabels = {
    calibration: "校准",
    current: "当前难度",
    slightly_above_current: "略高于当前水平",
    transfer: "迁移验证",
    review: "复核"
  } as const;
  englishLoopNextEl.textContent = activePlan
    ? `本轮目标：${activePlan.task}\n难度：${difficultyLabels[activePlan.difficulty]}${activePlan.reviewCriterion ? ` · 重点复核：${englishCriterionLabel(activePlan.reviewCriterion)}` : ""}\n成功标准：${activePlan.successCriteria.map(englishCriterionLabel).join(" · ")}\n${latestEvidence ? `当前状态：${latestEvidence.state} · 下一动作：${latestEvidence.action}` : "先自然开始表达。"}`
    : `${englishLoopProfile.nextPractice.title}：${englishLoopProfile.nextPractice.task}\n${englishLoopProfile.nextPractice.reason}`;
  const decision = englishLoopProfile.lastDecision;
  englishLoopDecisionEl.textContent = `${latestEvidence ? `本轮：${latestEvidence.state} · ${latestEvidence.action}\n` : ""}${decision.title} · ${decision.reason}（证据 ${decision.evidenceCount} 条，跨 ${decision.sessionCount} 次对话，置信度 ${Math.round(decision.confidence * 100)}%）${decision.action ? `\n行动：${decision.action}` : ""}${decision.hypothesis ? `\n假设：${decision.hypothesis}` : ""}`;
  renderEnglishIntervention();

  englishLoopProfileEl.replaceChildren();
  const masteryCriterionByAbility: Partial<Record<SpeakingProfile["abilities"][number]["key"], EnglishSuccessCriterion>> = {
    daily_conversation: "relevant_response",
    complex_opinion: "gives_opinion",
    causal_explanation: "explains_cause",
    tradeoff: "discusses_tradeoff"
  };
  englishLoopProfile.abilities.forEach(ability => {
    const row = document.createElement("div");
    row.className = "english-profile-row";
    const label = document.createElement("span");
    label.textContent = ability.label;
    const value = document.createElement("strong");
    const criterion = masteryCriterionByAbility[ability.key];
    const mastery = criterion
      ? englishLoopProfile.masteryRecords.find(item => item.criterion === criterion)
      : undefined;
    value.textContent = mastery
      ? `${englishMasteryStatusLabel(mastery.status)} · ${mastery.evidenceCount} 次证据`
      : "待观察";
    row.append(label, value);
    englishLoopProfileEl.append(row);
  });

  englishLoopDebtListEl.replaceChildren();
  if (!englishLoopProfile.expressionDebts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "还没有稳定出现的表达缺口。先自然聊几次，Loop 会自己发现。";
    englishLoopDebtListEl.append(empty);
  } else {
    englishLoopProfile.expressionDebts.slice(0, 6).forEach(debt => {
      const item = document.createElement("article");
      item.className = "english-debt-item";
      const title = document.createElement("strong");
      title.textContent = debt.phrase;
      const meta = document.createElement("span");
      const debtStatus = {
        candidate: "候选",
        active: "待练习",
        practicing: "正在巩固",
        stable: "已稳定"
      }[debt.status];
      meta.textContent = `${debt.meaning} · ${debtStatus} · 出现 ${debt.occurrences} 次`;
      item.append(title, meta);
      englishLoopDebtListEl.append(item);
    });
  }
}

function renderEnglishIntervention(): void {
  englishLoopInterventionEl.replaceChildren();
  const open = englishLoopProfile.interventions.find(item => item.status === "open");
  if (!open) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "目前没有待验证干预。Loop 会在证据足够时只提出一件事。";
    englishLoopInterventionEl.append(empty);
    return;
  }
  const title = document.createElement("strong");
  title.textContent = `${open.title} · 待验证`;
  const body = document.createElement("p");
  body.textContent = `假设：${open.hypothesis}\n预期结果：${open.expectedOutcome}`;
  const helpful = document.createElement("button");
  helpful.type = "button";
  helpful.textContent = "这次有帮助";
  helpful.addEventListener("click", () => {
    englishLoopProfile = recordInterventionFeedback(englishLoopProfile, open.id, "helpful");
    saveEnglishLoopProfile();
    renderEnglishLoop();
    syncEnglishLoopFeedback(open.id, "helpful");
  });
  const notHelpful = document.createElement("button");
  notHelpful.type = "button";
  notHelpful.textContent = "没有帮助";
  notHelpful.addEventListener("click", () => {
    englishLoopProfile = recordInterventionFeedback(englishLoopProfile, open.id, "not_helpful");
    saveEnglishLoopProfile();
    renderEnglishLoop();
    syncEnglishLoopFeedback(open.id, "not_helpful");
  });
  const actions = document.createElement("div");
  actions.className = "inline-controls intervention-actions";
  actions.append(helpful, notHelpful);
  englishLoopInterventionEl.append(title, body, actions);
}

function syncEnglishLoopFeedback(interventionId: string, status: "helpful" | "not_helpful"): void {
  void enqueueEnglishLoopFeedback({
    event: "intervention_feedback",
    profile: englishLoopProfile,
    sessionId: englishLoopSessionId,
    session: englishLoopSessionSnapshot(),
    feedback: { interventionId, status }
  });
}

function setEnglishLoopNotice(text: string): void {
  englishLoopNotice = fit(text, 42);
  void requestFooterUpdate();
  scheduleConceptImageUpdate(currentCard(), false, 0);
}

function sampleCards(): LearningCard[] {
  return [
    makeCard("Active Recall", "主动从记忆中提取答案。", "为什么主动回忆比重复阅读更有效？", ["demo"]),
    makeCard("Feynman Method", "用简单语言解释，暴露理解缺口。", "请用自己的话解释费曼学习法。", ["demo"]),
    makeCard("CORS", "控制浏览器能否读取跨域响应。", "CORS 和网络白名单有什么区别？", ["demo"]),
    makeCard("Backpressure", "消费者跟不上时让生产者减速。", "没有 backpressure 会发生什么？", ["demo"])
  ];
}

function makeCard(front: string, back: string, prompt = "跟读后说出答案。", tags: string[] = []): LearningCard {
  return {
    id: crypto.randomUUID(),
    front: fit(front, 36),
    back: fit(back, 120),
    prompt: fit(prompt, 120),
    tags,
    due: Date.now(),
    repetitions: 0
  };
}

function normalizeCard(input: Partial<LearningCard>): LearningCard {
  return {
    id: String(input.id || crypto.randomUUID()),
    knowledgeAtomId: input.knowledgeAtomId ? String(input.knowledgeAtomId) : undefined,
    sourceEventId: input.sourceEventId ? String(input.sourceEventId) : undefined,
    sourceEventIds: Array.isArray(input.sourceEventIds) ? input.sourceEventIds.map(String) : undefined,
    projectId: input.projectId ? String(input.projectId) : undefined,
    front: fit(input.front || "Untitled", 36),
    back: clean(input.back || "").slice(0, 120),
    prompt: clean(input.prompt || "跟读后说出答案。").slice(0, 120),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 4) : [],
    debtScore: Number(input.debtScore || 0),
    mastery: Number(input.mastery || 0),
    due: Number(input.due || Date.now()),
    repetitions: Number(input.repetitions || 0)
  };
}

function saveCards(): void {
  localStorage.setItem("g2LearningCards", JSON.stringify(cards));
  localStorage.setItem("g2LearningIndex", String(cardIndex));
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fit(text: string, max: number): string {
  const trimmed = clean(text);
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function importCardLimit(text: string): number {
  const normalized = clean(text);
  const sentenceCount = text
    .split(/(?:[.!?。！？]+|\r?\n+)/)
    .map(part => clean(part))
    .filter(part => part.length >= 12)
    .length;
  const densityEstimate = Math.ceil(normalized.length / 240);
  return Math.max(1, Math.min(8, Math.max(sentenceCount, densityEstimate)));
}

function wrappedLines(text: string, maxChars: number, maxLines: number): string[] {
  const normalized = clean(text);
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const hasUsefulSpaces = words.length > 1 && words.every(word => word.length <= maxChars);
  const lines: string[] = [];

  if (hasUsefulSpaces) {
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
      if (lines.length === maxLines) break;
    }
    if (current && lines.length < maxLines) lines.push(current);
  } else {
    for (let index = 0; index < normalized.length && lines.length < maxLines; index += maxChars) {
      lines.push(normalized.slice(index, index + maxChars));
    }
  }

  if (lines.length === maxLines && normalized.length > lines.join("").length) {
    lines[maxLines - 1] = fit(lines[maxLines - 1], Math.max(2, lines[maxLines - 1].length));
  }
  return lines;
}

function currentCard(): LearningCard | null {
  if (!cards.length) return null;
  cardIndex = Math.max(0, Math.min(cardIndex, cards.length - 1));
  return cards[cardIndex] || null;
}

function setStatus(text: string): void {
  statusPillEl.textContent = text;
  void logEvent("status", { text });
}

function activateTab(target: string): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(tab => {
    tab.classList.toggle("is-active", tab.dataset.tab === target);
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach(panel => {
    panel.hidden = panel.dataset.panel !== target;
  });
  if (target === "projects") void loadProgress(true);
  if (target === "debts") void loadDebts();
  if (target === "today") { projectsMode = false; updateProgressListSelection(); }
}

function showStudyNotice(text: string, kind: "success" | "fallback" | "error" = "success"): void {
  studyNoticeEl.textContent = text;
  studyNoticeEl.dataset.kind = kind;
  studyNoticeEl.hidden = false;
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}

function apiAddressWarning(): string {
  try {
    const apiHost = new URL(apiBaseUrl).hostname;
    const pageHost = window.location.hostname;
    if (isLoopbackHost(apiHost) && !isLoopbackHost(pageHost)) {
      return "当前 API 仅在本机可用。手机、眼镜或公开页面必须使用可访问的 HTTPS Learning API。";
    }
  } catch {
    return "Learning API 地址格式无效。";
  }
  return "";
}

function showApiAddressHint(): void {
  const warning = apiAddressWarning();
  if (warning) {
    aiConnectionStatusEl.textContent = warning;
    aiConnectionStatusEl.dataset.state = "warning";
  } else if (aiConnectionStatusEl.dataset.state === "warning") {
    aiConnectionStatusEl.textContent = "尚未测试 AI 连接。";
    delete aiConnectionStatusEl.dataset.state;
  }
}

async function testAiConnection(): Promise<boolean> {
  testAiConnectionButton.disabled = true;
  aiConnectionStatusEl.textContent = "正在检查学习 API 和模型服务...";
  aiConnectionStatusEl.dataset.state = "checking";
  try {
    const payload = await apiGet<HealthResponse>("/health?live=1");
    if (!payload.ai) {
      throw new Error("学习 API 已连接，但后端没有启用 AI_API_KEY。");
    }
    if (!payload.providerStatus?.reachable) {
      throw new Error(payload.providerStatus?.error || "学习 API 已连接，但模型服务不可达。");
    }
    aiConnectionStatusEl.textContent = `AI 可用 · ${payload.provider || "compatible"} · ${payload.model} · HTTP ${payload.providerStatus.status || 200}`;
    aiConnectionStatusEl.dataset.state = "success";
    return true;
  } catch (error) {
    const warning = apiAddressWarning();
    const detail = error instanceof Error ? error.message : "连接失败";
    aiConnectionStatusEl.textContent = warning ? `${warning} ${detail}` : `AI 不可用：${detail}`;
    aiConnectionStatusEl.dataset.state = "error";
    return false;
  } finally {
    testAiConnectionButton.disabled = false;
  }
}

function advanceSession(event: LearningSessionEvent): void {
  sessionState = transitionSession(sessionState, event);
  sessionStateEl.textContent = sessionLabel(sessionState);
  void logEvent("session_state", { state: sessionState, event });
  void requestFooterUpdate();
}

function setCoach(text: string): void {
  coachLineEl.textContent = text;
  void renderGlasses(false);
}

function setVoice(text: string): void {
  voiceLineEl.textContent = `语音：${text}`;
  void logEvent("voice", { text });
}

async function logEvent(type: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    await fetch(apiUrl("/api/learn/events"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiToken ? { "authorization": `Bearer ${apiToken}` } : {})
      },
      body: JSON.stringify({ type, data })
    });
  } catch {
    // Validation telemetry should never interrupt learning.
  }
}

function progressText(): string {
  return cards.length ? `${cardIndex + 1}/${cards.length}` : "0/0";
}

function updateWebView(): void {
  const card = currentCard();
  if (!card) {
    cardFrontEl.textContent = "No cards";
    cardBackEl.textContent = "等待导入";
    coachLineEl.textContent = "Ready";
    return;
  }

  cardFrontEl.textContent = card.front;
  cardBackEl.textContent = card.back;
  coachLineEl.textContent = card.prompt;
  currentScoreEl.hidden = !card.debtScore;
  currentScoreEl.textContent = card.debtScore ? `priority ${Math.round(card.debtScore)}` : "";
  renderEnglishLoop();
}

let glassesNotice = "";
let voiceActivity = "";

function glassesContent(card: LearningCard | null): string {
  if (englishLoopEnabled) {
    const headline = englishLoopNotice || englishLoopProfile.nextPractice.title;
    return `English Loop\n${fit(headline, 30)}\n${englishLoopProfile.turns} turns · swipe for phone`;
  }
  if (glassesNotice) {
    const detail = glassesNotice === "Image failed" ? "Swipe to retry" : "Updating image...";
    return `${glassesNotice}  ${progressText()}\n${detail}`;
  }
  if (voiceActivity) return `${voiceActivity}  ${progressText()}\nUp Previous  Down Next`;
  return `${sessionLabel(sessionState)}  ${progressText()}\nUp Previous  Down Next`;
}

function setVoiceActivity(text: string): void {
  voiceActivity = fit(text, 28);
  void requestFooterUpdate();
}

function displayText(card: LearningCard | null): TextContainerProperty {
  return new TextContainerProperty({
    containerID: DISPLAY_ID,
    containerName: "learn-display",
    content: debtMode ? debtGlassesText() : projectsMode ? projectGlassesText() : glassesContent(card),
    xPosition: 16,
    yPosition: 176,
    width: 536,
    height: 96,
    paddingLength: 4,
    isEventCapture: 1
  });
}

function projectGlassesText(): string {
  const p = progressProjects[progressIndex];
  if (!p) return "PROJECTS\nNo data. Open phone tab.";
  const tools = p.tools.join("/");
  const age = p.staleDays === null ? "-" : p.staleDays === 0 ? "today" : `${p.staleDays}d`;
  const task = p.lastTask ? `\n${p.lastTask.slice(0, 60)}` : "";
  return `${p.projectName.slice(0, 24)}\n${tools} · ${p.sessions} sessions · ${age}${task}`;
}

function debtGlassesText(): string {
  const debt = debtList[debtIndex];
  if (!debt) return "DEBTS\nNo cognitive debts.\nSay: go learn";
  if (quizStep === 0) {
    const level = debt.evidenceLevel || "E0";
    return `DEBT ${debtIndex + 1}/${debtList.length} [${level}]\n${debt.gapText.slice(0, 70)}`;
  }
  if (quizStep <= DEBT_QUESTIONS) {
    return `Q${quizStep}/${DEBT_QUESTIONS}\n${microCheckQuestion(debt, quizStep - 1)}`;
  }
  return "Answers recorded.\nSay: record";
}

function microCheckQuestion(debt: DebtItem, index: number): string {
  const questions = [
    `Explain: ${debt.gapText.slice(0, 50)}`,
    "What breaks in the project if this is wrong?",
    "How would you handle a similar but different case?"
  ];
  return questions[index] || questions[0];
}

async function loadDebts(): Promise<void> {
  try {
    const data = await apiGet<{ ok: boolean; debts: DebtItem[]; dueReviews?: { total: number } }>("/api/projects/_/agent-context");
    debtList = Array.isArray(data?.debts) ? data.debts : [];
    debtIndex = 0;
    quizStep = 0;
    quizAnswers = [];
    debtMode = true;
    projectsMode = false;
    renderDebtPanel(data);
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
  } catch (error) {
    showStudyNotice(`欠条加载失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

function renderDebtPanel(data: { debts?: DebtItem[]; dueReviews?: { total: number } }): void {
  const panel = document.querySelector<HTMLElement>("#debt-g2-list");
  if (!panel) return;
  panel.replaceChildren();
  const debts = data?.debts || [];
  if (!debts.length) {
    const empty = document.createElement("p");
    empty.className = "result-notice";
    empty.textContent = "当前项目暂无认知欠条。在三端编码工具中通过 MCP capture_project_session 生成。";
    panel.append(empty);
    return;
  }
  debts.forEach((d, i) => {
    const row = document.createElement("div");
    row.className = "progress-row";
    const title = document.createElement("strong");
    title.textContent = `[${d.evidenceLevel || "E0"}] ${d.gapText.slice(0, 80)}`;
    row.append(title);
    if (i === debtIndex) row.classList.add("is-selected");
    panel.append(row);
  });
}

async function submitDebtEvidence(): Promise<void> {
  const debt = debtList[debtIndex];
  if (!debt) return;
  const summary = quizAnswers.length
    ? quizAnswers.map((a, i) => `Q${i + 1}: ${a}`).join(" | ")
    : "眼镜端快速清偿（未答检查题）";
  try {
    await apiPost(`/api/debts/${encodeURIComponent(debt.id)}/evidence`, {
      evidenceType: "self_explained",
      evidenceLevel: quizAnswers.length >= DEBT_QUESTIONS ? "E2" : "E1",
      result: quizAnswers.length ? "answered" : "unverified",
      evidenceSummary: summary.slice(0, 2000)
    });
    quizStep = 0;
    quizAnswers = [];
    if (voiceEnabled) setVoiceActivity("Evidence recorded");
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
  } catch (error) {
    if (voiceEnabled) setVoiceActivity("Record failed");
    console.warn("debt evidence failed", error);
  }
}

function conceptImage(): ImageContainerProperty {
  return new ImageContainerProperty({
    containerID: CONCEPT_IMAGE_ID,
    containerName: "concept-image",
    xPosition: 144,
    yPosition: 16,
    width: 288,
    height: 144
  });
}

type ConceptImageRequest = {
  card: LearningCard | null;
  force: boolean;
  key: string;
  prompt: string;
  revision: number;
};

let footerInFlight = false;
let footerNeedsRefresh = false;
let latestFooterContent = "";
let footerRenderPromise: Promise<void> = Promise.resolve();
let conceptImageTimer: number | null = null;
let conceptImageInFlight = false;
let conceptImageDrainPromise: Promise<void> = Promise.resolve();
let pendingConceptImage: ConceptImageRequest | null = null;
let lastRenderedConcept = "";
let imageRequestRevision = 0;
let lastGestureAt = 0;

function visualPrompt(card: LearningCard | null): string {
  if (englishLoopEnabled) return fit(englishLoopProfile.nextPractice.title || "Speak naturally", 34);
  return fit(card?.prompt || "Explain aloud", 34);
}

function conceptVisualKey(card: LearningCard | null, prompt = visualPrompt(card)): string {
  return [card?.id || "no-cards", prompt].join("|");
}

async function conceptPng(card: LearningCard | null, promptText = visualPrompt(card)): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 288;
  canvas.height = 144;
  const context = canvas.getContext("2d");
  if (!context) return new Uint8Array();

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const titleLines = wrappedLines(englishLoopEnabled ? englishLoopProfile.nextPractice.title : (card?.front || "No cards"), 11, 2);
  let fontSize = titleLines.length > 1 ? 38 : 58;
  context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  while (fontSize > 28 && titleLines.some(line => context.measureText(line).width > 264)) {
    fontSize -= 2;
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  }
  const titleStartY = titleLines.length > 1 ? 44 : 56;
  titleLines.forEach((line, index) => {
    context.fillText(line, 144, titleStartY + index * (fontSize + 4), 264);
  });

  const prompt = promptText;
  context.fillStyle = "#cfeee7";
  let promptSize = 17;
  context.font = `500 ${promptSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  while (promptSize > 12 && context.measureText(prompt).width > 264) {
    promptSize -= 1;
    context.font = `500 ${promptSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  }
  context.fillText(prompt, 144, 118, 264);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
}

function makeConceptImageRequest(card: LearningCard | null, force = false): ConceptImageRequest {
  const prompt = visualPrompt(card);
  return {
    card,
    force,
    key: conceptVisualKey(card, prompt),
    prompt,
    revision: ++imageRequestRevision
  };
}

function requestFooterUpdate(): Promise<void> {
  if (!bridge || !bridgeReady) return Promise.resolve();
  // Shared with displayText: projects/debts modes must keep their content when
  // the footer refresh upgrades the same text container.
  latestFooterContent = (debtMode ? debtGlassesText() : projectsMode ? projectGlassesText() : glassesContent(currentCard()));
  if (footerInFlight) {
    footerNeedsRefresh = true;
    return footerRenderPromise;
  }

  footerInFlight = true;
  footerRenderPromise = (async () => {
    try {
      while (true) {
        footerNeedsRefresh = false;
        const content = latestFooterContent;
        await bridge!.textContainerUpgrade(new TextContainerUpgrade({
          containerID: DISPLAY_ID,
          containerName: "learn-display",
          content
        }));
        if (!footerNeedsRefresh || latestFooterContent === content) break;
      }
    } finally {
      footerInFlight = false;
    }
  })();
  return footerRenderPromise;
}

function clearGlassesNotice(): void {
  if (!glassesNotice) return;
  glassesNotice = "";
  void requestFooterUpdate();
}

function setNavigationNotice(action: "next" | "previous"): void {
  glassesNotice = action === "next" ? "Next accepted" : "Previous accepted";
  void requestFooterUpdate();
}

function scheduleConceptImageUpdate(card: LearningCard | null, force = false, delayMs = 0): void {
  if (!bridge || !bridgeReady) return;
  const request = makeConceptImageRequest(card, force);
  if (!force && request.key === lastRenderedConcept && !conceptImageInFlight) {
    pendingConceptImage = null;
    if (conceptImageTimer !== null) {
      window.clearTimeout(conceptImageTimer);
      conceptImageTimer = null;
    }
    clearGlassesNotice();
    return;
  }

  pendingConceptImage = request.key === lastRenderedConcept && conceptImageInFlight
    ? { ...request, force: true }
    : request;

  if (conceptImageTimer !== null) window.clearTimeout(conceptImageTimer);
  conceptImageTimer = window.setTimeout(() => {
    conceptImageTimer = null;
    void drainConceptImageUpdates();
  }, delayMs);
}

async function flushConceptImageUpdate(card: LearningCard | null, force = false): Promise<void> {
  if (!bridge || !bridgeReady) return;
  pendingConceptImage = makeConceptImageRequest(card, force);
  if (conceptImageTimer !== null) {
    window.clearTimeout(conceptImageTimer);
    conceptImageTimer = null;
  }
  await drainConceptImageUpdates();
}

function drainConceptImageUpdates(): Promise<void> {
  if (!bridge || !bridgeReady) return Promise.resolve();
  if (conceptImageInFlight) return conceptImageDrainPromise;

  conceptImageInFlight = true;
  conceptImageDrainPromise = (async () => {
    try {
      while (pendingConceptImage) {
        const request = pendingConceptImage;
        pendingConceptImage = null;
        if (!request.force && request.key === lastRenderedConcept) {
          if (request.revision === imageRequestRevision) clearGlassesNotice();
          continue;
        }

        const imageData = await conceptPng(request.card, request.prompt);
        if (debugImageHoldMs > 0) await new Promise(resolve => window.setTimeout(resolve, debugImageHoldMs));
        if (request.revision !== imageRequestRevision) {
          void logEvent("g2_concept_image_skipped", { reason: "stale_before_upload", conceptKey: request.key });
          continue;
        }

        let result: string;
        try {
          if (debugImageUploadFailure) throw new Error("Simulated image upload failure");
          result = await Promise.race([
            bridge!.updateImageRawData(new ImageRawDataUpdate({
              containerID: CONCEPT_IMAGE_ID,
              containerName: "concept-image",
              imageData
            })),
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error("Image upload timed out")), IMAGE_UPLOAD_TIMEOUT_MS);
            })
          ]);
        } catch (error) {
          if (request.revision === imageRequestRevision) {
            glassesNotice = "Image failed";
            void requestFooterUpdate();
          }
          void logEvent("g2_concept_image_failed", {
            message: error instanceof Error ? error.message : String(error),
            latest: request.revision === imageRequestRevision
          });
          continue;
        }
        if (result === "success" && request.revision === imageRequestRevision) {
          lastRenderedConcept = request.key;
          clearGlassesNotice();
        } else if (request.revision === imageRequestRevision) {
          glassesNotice = "Image failed";
          void requestFooterUpdate();
        }
        void logEvent("g2_concept_image", {
          bytes: imageData.length,
          result,
          latest: request.revision === imageRequestRevision
        });
      }
    } finally {
      conceptImageInFlight = false;
      if (pendingConceptImage) void drainConceptImageUpdates();
    }
  })();
  return conceptImageDrainPromise;
}

async function renderGlasses(rebuild = false, imageDelayMs = 0): Promise<void> {
  if (!bridge) return;
  const card = currentCard();
  try {
    if (rebuild) {
      await bridge.rebuildPageContainer(new RebuildPageContainer({
        containerTotalNum: 2,
        textObject: [displayText(card)],
        imageObject: [conceptImage()]
      }));
      await new Promise(resolve => window.setTimeout(resolve, 800));
      await flushConceptImageUpdate(card, true);
      await requestFooterUpdate();
      return;
    }

    await requestFooterUpdate();
    scheduleConceptImageUpdate(card, false, imageDelayMs);
  } catch (error) {
    setStatus("bridge error");
    console.warn("Failed to render glasses learning page", error);
  }
}

async function initBridge(): Promise<void> {
  try {
    const sdkBridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), 2500))
    ]);
    if (!sdkBridge) {
      setStatus("phone");
      return;
    }

    bridge = sdkBridge;
    const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [displayText(currentCard())],
      imageObject: [conceptImage()]
    }));
    bridgeReady = result === StartUpPageCreateResult.success;
    void logEvent("bridge_startup", { result, bridgeReady });
    setStatus(bridgeReady ? "g2" : "phone");

    bridge.onEvenHubEvent(event => {
      const sysType = event.sysEvent?.eventType;
      const textType = event.textEvent?.eventType;
      const now = Date.now();
      // Gesture events may also carry a sysEvent (e.g. eventSource on the
      // simulator), so scroll gestures must be matched before the click-ignore
      // branch, otherwise every gesture is swallowed as an ignored click.
      const isScrollGesture = textType === OsEventTypeList.SCROLL_TOP_EVENT
        || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT;
      if (isScrollGesture && textType === OsEventTypeList.SCROLL_TOP_EVENT && now - lastGestureAt > GESTURE_DEBOUNCE_MS) {
        lastGestureAt = now;
        void logEvent("g2_gesture", { action: "previous", textType });
        void performAction("previous");
      } else if (isScrollGesture && textType === OsEventTypeList.SCROLL_BOTTOM_EVENT && now - lastGestureAt > GESTURE_DEBOUNCE_MS) {
        lastGestureAt = now;
        void logEvent("g2_gesture", { action: "next", textType });
        void performAction("next");
      } else if (isScrollGesture) {
        void logEvent("g2_gesture_ignored", { reason: "debounce", textType });
      } else if (event.sysEvent && (sysType === undefined || sysType === OsEventTypeList.CLICK_EVENT)) {
        void logEvent("g2_ignored_input", { input: "click", sysType });
      }

      if (event.audioEvent && voiceEnabled) {
        void handlePcmAudio(event.audioEvent.audioPcm, event.audioEvent.source);
      }
    });

    await renderGlasses(true);
  } catch (error) {
    setStatus("phone");
    void logEvent("bridge_unavailable", { message: error instanceof Error ? error.message : String(error) });
    console.warn("Even App bridge unavailable", error);
  }
}

function localImport(text: string): LearningCard[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result: LearningCard[] = [];

  for (const line of lines) {
    const csv = line.split(",").map(part => part.trim()).filter(Boolean);
    if (csv.length >= 2) {
      result.push(makeCard(csv[0], csv.slice(1).join(" "), `跟读：${csv[0]}。说出意思。`, ["import"]));
      continue;
    }

    const pair = line.match(/^(.+?)(?:\s+[-:：]\s+|\s{2,})(.+)$/);
    if (pair) {
      result.push(makeCard(pair[1], pair[2], `跟读：${pair[1]}。说出意思。`, ["import"]));
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      result.push(makeCard(parts[0], parts.slice(1).join(" "), `跟读：${parts[0]}。说出意思。`, ["import"]));
    } else {
      result.push(makeCard(line, "用自己的话解释。", "给出定义，再造一个例子。", ["note"]));
    }
  }

  return result.slice(0, 80);
}

function apiUrl(path: string): string {
  const url = new URL(path.replace(/^\/+/, ""), apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`);
  return url.toString();
}

async function apiPost<T>(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      ...extraHeaders,
      ...(apiToken ? { "authorization": `Bearer ${apiToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as T;
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload;
}

async function apiGet<T>(path: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: {
      "accept": "application/json",
      ...extraHeaders,
      ...(apiToken ? { "authorization": `Bearer ${apiToken}` } : {})
    }
  });
  const payload = await response.json() as T;
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload;
}

function renderAtomList(atoms: KnowledgeAtom[]): void {
  atomListEl.replaceChildren();
  if (!atoms.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No knowledge atoms yet.";
    atomListEl.append(empty);
    return;
  }
  for (const atom of atoms) {
    const item = document.createElement("article");
    item.className = "debt-item";
    const meta = document.createElement("p");
    meta.className = "item-meta";
    const debtLabel = atom.debtLevel ? ` · ${atom.debtLevel} debt ${Math.round(atom.debtScore || 0)}` : "";
    meta.textContent = `${atom.projectId}${debtLabel} · ${Math.round(atom.confidence * 100)}% confidence · ${atom.sourceEventIds.length} source`;
    const title = document.createElement("h3");
    title.textContent = atom.concept;
    const explanation = document.createElement("p");
    explanation.textContent = atom.plainExplanation;
    const context = document.createElement("p");
    context.className = "item-context";
    context.textContent = atom.personalContext;
    item.append(meta, title, explanation, context);
    if (atom.microExercise) {
      const exercise = document.createElement("p");
      exercise.className = "item-exercise";
      exercise.textContent = `No-AI exercise: ${atom.microExercise}`;
      item.append(exercise);
    }
    atomListEl.append(item);
  }
}

function renderReviewList(reviews: SpiralDashboard["reviews"]): void {
  reviewListEl.replaceChildren();
  if (!reviews.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No reviews yet.";
    reviewListEl.append(empty);
    return;
  }
  for (const review of reviews.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "review-row";
    const result = document.createElement("strong");
    result.textContent = review.result;
    const detail = document.createElement("span");
    detail.textContent = `${review.projectId} · ${new Date(review.reviewedAt).toLocaleString()}`;
    row.append(result, detail);
    reviewListEl.append(row);
  }
}

function applyDashboard(payload: SpiralDashboard, replaceCards = false): void {
  metricAtomsEl.textContent = String(payload.metrics.debtsToday ?? payload.metrics.atomsToday);
  metricClearableEl.textContent = String(payload.metrics.clearable);
  metricReviewedEl.textContent = String(payload.metrics.reviewedToday);
  reviewSummaryEl.textContent = payload.report.summary;
  reviewConceptEl.textContent = payload.report.repeatedConcept || "None";
  reviewNextActionEl.textContent = payload.report.nextAction;
  reviewAccuracyEl.textContent = `${payload.metrics.recallAccuracy || 0}%`;
  reviewPracticeRateEl.textContent = `${payload.metrics.noAiPracticeRate || 0}%`;
  renderAtomList(payload.atoms);
  renderReviewList(payload.reviews);
  if (replaceCards && payload.cards.length) {
    cards = payload.cards.map(normalizeCard);
    cardIndex = 0;
    saveCards();
    updateWebView();
  }
}

async function startTimedSession(duration: number): Promise<void> {
  try {
    const payload = await apiGet<{
      ok: boolean;
      session: { duration: number; cardCount: number; cards: LearningCard[] };
    }>(`/api/g2/session?duration=${duration}`);
    if (!payload.session.cards.length) {
      setCoach("当前没有到期卡片。");
      return;
    }
    cards = payload.session.cards.map(normalizeCard);
    cardIndex = 0;
    saveCards();
    updateWebView();
    setCoach(`${payload.session.duration} 秒 session · ${payload.session.cardCount} 张卡`);
    await renderGlasses(true);
  } catch (error) {
    showStudyNotice(
      `Session 创建失败：${error instanceof Error ? error.message : "API unavailable"}`,
      "error"
    );
    setStatus(bridgeReady ? "g2 offline" : "phone offline");
  }
}

async function syncSpiralToday(replaceCards = true): Promise<void> {
  syncTodayButton.disabled = true;
  try {
    const payload = await apiGet<SpiralDashboard>("/api/spiral/today");
    applyDashboard(payload, replaceCards);
    if (replaceCards && payload.cards.length) await renderGlasses(true);
  } catch (error) {
    showStudyNotice(
      `学习队列同步失败：${error instanceof Error ? error.message : "API unavailable"}`,
      "error"
    );
    setStatus(bridgeReady ? "g2 offline" : "phone offline");
  } finally {
    syncTodayButton.disabled = false;
  }
}

async function ingestLearningIncrement(): Promise<void> {
  const rawText = importTextEl.value.trim();
  if (!rawText) {
    captureStatusEl.textContent = "Add the goal, key failure, decision, and verified result first.";
    return;
  }
  ingestButton.disabled = true;
  captureStatusEl.textContent = "Capturing practice evidence...";
  try {
    const payload = await apiPost<{
      ok: boolean;
      status: string;
      atoms: KnowledgeAtom[];
      cards: LearningCard[];
      today: SpiralDashboard;
    }>("/api/spiral/ingest", {
      source: captureSourceEl.value,
      projectId: captureProjectEl.value.trim() || "general",
      event_type: "ManualImport",
      rawText,
      retainRaw: retainSourceEl.checked
    });
    applyDashboard(payload.today, false);
    captureStatusEl.textContent = payload.status === "captured"
      ? "Practice captured. Run a desktop checkpoint before any learning card is created."
      : "Practice capture completed.";
  } catch (error) {
    captureStatusEl.textContent = error instanceof Error ? error.message : "Compile failed";
  } finally {
    ingestButton.disabled = false;
  }
}

async function persistReview(card: LearningCard, result: "mastered" | "partial" | "incorrect" | "skip", responseText = ""): Promise<void> {
  if (!card.knowledgeAtomId) return;
  try {
    const payload = await apiPost<{ ok: boolean; today: SpiralDashboard }>("/v1/reviews", {
      cardId: card.id,
      result,
      responseText,
      source: bridgeReady ? "g2" : "phone"
    });
    applyDashboard(payload.today);
  } catch (error) {
    console.warn("Spiral review persistence failed", error);
  }
}

async function importWithAi(): Promise<void> {
  importAiButton.disabled = true;
  setStatus("importing");
  try {
    const rawText = clean(importTextEl.value);
    if (!rawText) {
      captureStatusEl.textContent = "请先粘贴或导入学习材料。";
      return;
    }
    let imported: LearningCard[];
    let usedFallback = false;
    let fallbackReason = "";
    try {
      const payload = await apiPost<ImportResponse>("/api/learn/import", {
        text: rawText,
        mode: "flashcards",
        maxCards: importCardLimit(rawText)
      });
      if (!payload.ok || !payload.cards?.length) throw new Error(payload.error || "No cards returned");
      imported = payload.cards.map(normalizeCard);
      usedFallback = Boolean(payload.fallback);
      fallbackReason = payload.error || "";
    } catch (error) {
      imported = localImport(rawText).map(normalizeCard);
      usedFallback = true;
      fallbackReason = error instanceof Error ? error.message : "AI unavailable";
      console.warn("AI import fallback", error);
    }

    cards = imported.length ? imported : cards;
    cardIndex = 0;
    saveCards();
    updateWebView();
    const firstCard = currentCard()?.front || "第一张卡片";
    if (usedFallback) {
      const message = `AI 未生成内容，已使用本地解析生成 ${imported.length} 张卡片。原因：${fit(fallbackReason || "AI unavailable", 80)}`;
      captureStatusEl.textContent = message;
      showStudyNotice(message, "fallback");
    } else {
      const message = `AI 已生成 ${imported.length} 张卡片，已打开第一张：${firstCard}`;
      captureStatusEl.textContent = message;
      showStudyNotice(message, "success");
    }
    activateTab("today");
    await renderGlasses(true);
    setStatus(bridgeReady ? "g2" : "phone");
  } finally {
    importAiButton.disabled = false;
  }
}

async function planCourse(): Promise<void> {
  planCourseButton.disabled = true;
  setStatus("planning");
  try {
    const subject = clean(subjectInputEl.value);
    const level = clean(levelInputEl.value || "zero basis");
    if (!subject) {
      setCoach("请输入学科。");
      return;
    }
    const payload = await apiPost<PlanResponse>("/api/learn/plan", {
      subject,
      level,
      maxUnits: 8
    });
    if (!payload.ok || !payload.cards?.length) throw new Error(payload.error || "No units returned");
    cards = payload.cards.map(normalizeCard);
    cardIndex = 0;
    saveCards();
    updateWebView();
    setCoach(payload.overview || "课程已生成。先理解，再用自己的话回答问题。");
    await renderGlasses(true);
  } catch (error) {
    setCoach(error instanceof Error ? error.message : "课程生成失败。");
  } finally {
    planCourseButton.disabled = false;
    setStatus(bridgeReady ? "g2" : "phone");
  }
}

async function askTutor(kind: TutorKind, transcript = ""): Promise<void> {
  const card = currentCard();
  if (!card) return;
  let reviewResult: "mastered" | "partial" | "incorrect" | null = null;
  if (kind === "ask") advanceSession("ASK");
  if (kind === "repeat") advanceSession("EXPLAIN");
  if (kind === "answer") {
    if (sessionState !== "listening") advanceSession("START_LISTENING");
    advanceSession("SUBMIT_ANSWER");
    setVoiceActivity("Evaluating");
  }
  setStatus("ai");
  const fallback = localTutorResponse(kind, card, transcript);
  try {
    const payload = await apiPost<TutorResponse>("/api/learn/tutor", {
      kind,
      card,
      transcript,
      progress: { index: cardIndex, total: cards.length }
    });
    const response = payload.ok ? payload : fallback;
    for (const event of tutorStateEvents(kind, response)) advanceSession(event);
    cardBackEl.textContent = tutorPhoneText(response, fallback);
    setCoach(tutorGlassesText(response, fallback));
    if (kind === "ask") {
      setVoice("问题已显示，请直接回答");
      setVoiceActivity("Answer now");
    }
    if (kind === "answer") {
      reviewResult = response.assessment === "correct" ? "mastered"
        : response.assessment === "incorrect" ? "incorrect"
          : "partial";
    }
  } catch {
    for (const event of tutorStateEvents(kind, fallback)) advanceSession(event);
    cardBackEl.textContent = tutorPhoneText(fallback, fallback);
    setCoach(tutorGlassesText(fallback, fallback));
    if (kind === "answer") reviewResult = "partial";
  } finally {
    if (reviewResult) await persistReview(card, reviewResult, transcript);
    if (kind === "answer") answerTextEl.value = "";
    if (kind === "answer" && voiceEnabled) {
      setVoiceActivity(sessionState === "follow_up" ? "Answer follow-up" : "Listening");
    }
    setStatus(bridgeReady ? "g2" : "phone");
  }
}

async function loadProgress(force = false): Promise<void> {
  try {
    const data = await apiGet<ProgressResponse>("/api/progress");
    progressProjects = Array.isArray(data?.projects) ? data.projects : [];
    progressIndex = 0;
    projectsMode = true;
    renderProgressPanel(data);
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
  } catch (error) {
    console.warn("[progress] load failed", { href: window.location.href, base: apiBaseUrl, hasToken: Boolean(apiToken), error: String(error) });
    if (force) showStudyNotice(`项目进度加载失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

function renderProgressPanel(data: ProgressResponse): void {
  const listEl = document.querySelector<HTMLElement>("#progress-list");
  if (!listEl) return;
  listEl.replaceChildren();
  if (!progressProjects.length) {
    const empty = document.createElement("p");
    empty.className = "result-notice";
    empty.textContent = "暂无项目数据。先在电脑上运行 progress-collector --push。";
    listEl.append(empty);
    return;
  }
  progressProjects.forEach((p, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "progress-row";
    row.dataset.index = String(i);
    const title = document.createElement("strong");
    title.textContent = p.projectName;
    const meta = document.createElement("small");
    const age = p.staleDays === null ? "-" : p.staleDays === 0 ? "今天" : `${p.staleDays} 天前`;
    meta.textContent = `${p.tools.join("/")} · ${p.sessions} 会话 · ${age} · ${p.machines.join("/")}`;
    const task = document.createElement("p");
    task.textContent = p.lastTask || "（无最近任务记录）";
    row.append(title, meta, task);
    row.addEventListener("click", () => {
      progressIndex = i;
      updateProgressListSelection();
    });
    listEl.append(row);
  });
  const focusEl = document.querySelector<HTMLElement>("#progress-focus-current");
  if (focusEl) focusEl.textContent = data?.focus ? `当前推进：${data.focus.note}` : "尚未设定推进焦点";
  updateProgressListSelection();
}

function updateProgressListSelection(): void {
  document.querySelectorAll<HTMLElement>(".progress-row").forEach(row => {
    row.classList.toggle("is-selected", Number(row.dataset.index) === progressIndex && projectsMode);
  });
}

async function submitProgressFocus(note: string): Promise<void> {
  const p = progressProjects[progressIndex];
  const text = note && note.trim() ? note.trim() : (p ? `继续推进 ${p.projectName}` : "");
  if (!text) return;
  try {
    await apiPost("/api/progress/focus", { note: text, projectPath: p?.projectPath || null, source: "glasses" });
    const focusEl = document.querySelector<HTMLElement>("#progress-focus-current");
    if (focusEl) focusEl.textContent = `当前推进：${text}`;
    if (voiceEnabled) setVoiceActivity(`Focus set: ${text.slice(0, 30)}`);
  } catch (error) {
    if (voiceEnabled) setVoiceActivity("Focus failed");
    console.warn("progress focus failed", error);
  }
}

async function performAction(action: StudyAction, transcript = ""): Promise<void> {
  if (debtMode && (action === "next" || action === "previous")) {
    if (!debtList.length) return;
    debtIndex = action === "next"
      ? (debtIndex + 1) % debtList.length
      : (debtIndex - 1 + debtList.length) % debtList.length;
    quizStep = 0;
    quizAnswers = [];
    renderDebtPanel({ debts: debtList });
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
    return;
  }
  if (projectsMode && (action === "next" || action === "previous")) {
    if (!progressProjects.length) return;
    progressIndex = action === "next"
      ? (progressIndex + 1) % progressProjects.length
      : (progressIndex - 1 + progressProjects.length) % progressProjects.length;
    updateProgressListSelection();
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
    return;
  }
  if (action === "debts") {
    await loadDebts();
    return;
  }
  if (debtMode && (action === "quiz" || action === "ask")) {
    quizStep = Math.min(quizStep + 1, DEBT_QUESTIONS);
    quizAnswers = [];
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
    return;
  }
  if (debtMode && action === "record") {
    await submitDebtEvidence();
    return;
  }
  if (action === "projects") {
    debtMode = false;
    await loadProgress(true);
    return;
  }
  if (action === "learn") {
    debtMode = false;
    projectsMode = false;
    renderDebtPanel({ debts: [] });
    updateProgressListSelection();
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
    return;
  }
  if (action === "focus") {
    await submitProgressFocus(transcript);
    return;
  }
  const card = currentCard();
  if (!card) return;

  if (action === "next") {
    if (transcript !== "__reviewed__") await persistReview(card, "skip");
    cardIndex = cards.length ? (cardIndex + 1) % cards.length : 0;
    saveCards();
    updateWebView();
    advanceSession("NAVIGATE");
    setNavigationNotice("next");
    await renderGlasses(false, NAVIGATION_IMAGE_DELAY_MS);
    return;
  }

  if (action === "previous") {
    cardIndex = cards.length ? (cardIndex - 1 + cards.length) % cards.length : 0;
    saveCards();
    updateWebView();
    advanceSession("NAVIGATE");
    setNavigationNotice("previous");
    await renderGlasses(false, NAVIGATION_IMAGE_DELAY_MS);
    return;
  }

  if (action === "known") {
    card.repetitions += 1;
    card.due = Date.now() + Math.min(7, card.repetitions + 1) * 24 * 60 * 60 * 1000;
    await persistReview(card, "mastered", transcript);
    await askTutor("known", transcript);
    await performAction("next", "__reviewed__");
    return;
  }

  if (action === "record") return;
  // Outside debt mode, quiz-style commands ("出题"/"test me") behave like ask.
  await askTutor(action === "quiz" ? "ask" : action, transcript);
}

function startEnglishLoopSession(): void {
  if (englishLoopSessionActive) return;
  englishLoopProfile.goal.statement = englishLoopGoalEl.value.trim() || englishLoopProfile.goal.statement;
  englishLoopSessionStartTurns = englishLoopProfile.turns;
  englishLoopSessionStartMinutes = englishLoopProfile.minutes;
  englishLoopSessionStartEvidence = englishLoopProfile.evidenceEvents.length;
  englishLoopProfile = refreshEnglishMasteryReviewStates(englishLoopProfile);
  englishLoopProfile = markEnglishLoopSessionStarted(englishLoopProfile);
  englishLoopSessionActive = true;
  englishLoopSessionId = `session-${Date.now()}`;
  englishLoopSessionStartedAt = new Date().toISOString();
  englishLoopHistory = [];
  englishLoopSessionEvidence = [];
  englishLoopProfile.sessionPlan = createEnglishLoopSessionPlan(englishLoopProfile, englishLoopTopic);
  delete englishLoopProfile.lastSessionReflection;
  saveEnglishLoopProfile();
  renderEnglishLoop();
  void enqueueEnglishLoopSync({
    event: "session_start",
    profile: englishLoopProfile,
    sessionPlan: englishLoopProfile.sessionPlan,
    sessionId: englishLoopSessionId,
    session: englishLoopSessionSnapshot()
  });
  setEnglishLoopNotice(englishLoopProfile.sessionPlan.taskType);
  setCoach(englishLoopProfile.sessionPlan.task);
}

function stopEnglishLoopSession(): void {
  const sessionId = englishLoopSessionId;
  const startedAt = englishLoopSessionStartedAt;
  const endedAt = new Date().toISOString();
  if (sessionId && englishLoopProfile.sessionPlan) {
    const reflection = reflectEnglishLoopSession(
      englishLoopProfile,
      englishLoopProfile.sessionPlan,
      englishLoopSessionEvidence,
      Date.parse(endedAt)
    );
    englishLoopProfile.lastSessionReflection = reflection;
    englishLoopProfile = updateEnglishMasteryFromSession(
      englishLoopProfile,
      englishLoopProfile.sessionPlan,
      englishLoopSessionEvidence,
      reflection,
      Date.parse(endedAt)
    );
    saveEnglishLoopProfile();
  }
  const summary = sessionId ? buildEnglishLoopSessionSummary(sessionId, endedAt) : null;
  if (summary) {
    englishLoopLastSessionSummary = summary;
    saveEnglishLoopSessionSummary(summary);
    renderEnglishLoopSessionSummary(summary);
  }
  const session = sessionId ? {
    id: sessionId,
    topic: englishLoopTopic,
    goal: englishLoopProfile.goal,
    startedAt,
    endedAt,
    ...(summary ? { summary } : {})
  } : undefined;
  void enqueueEnglishLoopSync({
    event: "session_end",
    profile: englishLoopProfile,
    sessionPlan: englishLoopProfile.sessionPlan,
    sessionId,
    session
  });
  englishLoopSessionActive = false;
  englishLoopSessionId = "";
  englishLoopSessionStartedAt = "";
  englishLoopHistory = [];
  englishLoopSessionEvidence = [];
  saveEnglishLoopProfile();
  renderEnglishLoop();
  setEnglishLoopNotice("Session saved");
}

async function handleEnglishCommand(action: VoiceAction): Promise<void> {
  const practice = englishLoopProfile.nextPractice;
  if (action === "repeat" || action === "ask") {
    const prompt = practice.task || "Tell me what you think and why.";
    setEnglishLoopNotice(action === "repeat" ? "Repeat the prompt" : practice.title);
    englishLoopNextEl.textContent = prompt;
    setCoach(prompt);
    setVoiceActivity(action === "repeat" ? "Repeat prompt" : "Prompt ready");
    return;
  }
  if (action === "next") {
    setEnglishLoopNotice("New topic");
    setCoach("Choose a new topic. What are you working on or thinking about today?");
    englishLoopNextEl.textContent = "Choose a new topic and speak for 30 seconds.";
    setVoiceActivity("New topic");
    return;
  }
  setEnglishLoopNotice("Keep speaking");
  setCoach("Good. Keep the idea in English and add one example.");
  setVoiceActivity("Keep speaking");
}

async function handleEnglishTurn(transcript: string, audioDurationMs = 0): Promise<void> {
  const sessionId = englishLoopSessionId || `session-${englishLoopProfile.sessions || 1}`;
  const sessionPlan = englishLoopProfile.sessionPlan || createEnglishLoopSessionPlan(englishLoopProfile, englishLoopTopic);
  const observedAt = Date.now();
  const observed = observeEnglishTurn(englishLoopProfile, transcript, {
    durationMs: audioDurationMs,
    sessionId,
    topic: englishLoopTopic,
    plan: sessionPlan,
    now: observedAt
  });
  const turnEvidence = extractEnglishTurnEvidence({
    profile: observed.profile,
    plan: sessionPlan,
    transcript,
    sessionId,
    signals: observed.signals,
    now: observedAt
  });
  englishLoopProfile = attachEnglishTurnEvidence(observed.profile, turnEvidence);
  englishLoopProfile.sessionPlan = sessionPlan;
  englishLoopSessionEvidence.push(turnEvidence);
  saveEnglishLoopProfile();
  renderEnglishLoop();
  void logEvent("english_loop_turn", {
    durationMs: audioDurationMs,
    wordCount: observed.signals.wordCount,
    hasChinese: observed.signals.hasChinese,
    givesOpinion: observed.signals.givesOpinion,
    explainsCause: observed.signals.explainsCause,
    discussesTradeoff: observed.signals.discussesTradeoff,
    expressionCandidates: observed.signals.expressionCandidates,
    learnerState: turnEvidence.state,
    action: turnEvidence.action,
    criteriaMet: turnEvidence.criteriaMet,
    missingCriteria: turnEvidence.missingCriteria
  });

  const control = chooseEnglishLoopAction(turnEvidence.state, sessionPlan, turnEvidence.criteriaMet);
  const local = localEnglishLoopReply(englishLoopProfile, transcript, control);
  englishLoopHistory.push({ speaker: "user", text: transcript });
  let response: EnglishLoopResponse = { ok: true, ...local };
  const previousPrompt = englishLoopNextEl.textContent || "";
  try {
    const payload = await apiPost<EnglishLoopResponse>("/api/learn/english-loop", {
      transcript,
      topic: englishLoopTopic,
      goal: englishLoopProfile.goal,
      sessionPlan,
      control,
      turnEvidence,
      nextMove: {
        prompt: local.nextPrompt,
        outputType: local.outputType,
        decision: local.decision,
        moveType: local.moveType
      },
      profile: {
        turns: englishLoopProfile.turns,
        minutes: englishLoopProfile.minutes,
        currentFocus: englishLoopProfile.currentFocus,
        nextPractice: englishLoopProfile.nextPractice,
        abilities: englishLoopProfile.abilities,
        patterns: englishLoopProfile.patterns,
        expressionDebts: englishLoopProfile.expressionDebts.slice(0, 6),
        masteryRecords: englishLoopProfile.masteryRecords,
        evidenceCount: englishLoopProfile.evidenceEvents.length,
        sessionCount: new Set(englishLoopProfile.evidenceEvents.map(event => event.sessionId)).size
      },
      recentTurns: englishLoopHistory.slice(-5)
    });
    if (payload.ok && isUsefulEnglishLoopResponse(payload, transcript, previousPrompt, local.moveType, control.action)) {
      response = payload;
    } else {
      void logEvent("english_loop_response_rejected", {
        reason: payload.ok ? "generic_unanchored_or_wrong_action" : "invalid_payload",
        expectedAction: control.action,
        receivedAction: payload.action || "missing"
      });
    }
  } catch (error) {
    void logEvent("english_loop_fallback", {
      reason: error instanceof Error ? error.message : "API unavailable"
    });
  }

  const reply = response.reply || local.reply;
  const feedback = response.feedback || local.feedback;
  const nextPrompt = response.nextPrompt || local.nextPrompt;
  englishLoopHistory.push({ speaker: "assistant", text: reply });
  englishLoopHistory = englishLoopHistory.slice(-8);
  englishLoopReplyEl.textContent = reply;
  englishLoopFeedbackEl.textContent = feedback;
  englishLoopNextEl.textContent = nextPrompt;
  setEnglishLoopNotice(response.g2Text || englishLoopProfile.nextPractice.title);
  setCoach(nextPrompt);
  setVoiceActivity("Listening");
  setStatus(response.fallback ? "g2 · local fallback" : bridgeReady ? "g2" : "phone");
  void enqueueEnglishLoopSync({
    event: "turn",
    profile: englishLoopProfile,
    sessionId,
    session: englishLoopSessionSnapshot({ id: sessionId }),
    turn: {
      id: turnEvidence.id,
      observedAt: turnEvidence.observedAt,
      wordCount: turnEvidence.wordCount,
      signals: turnEvidence.signals,
      decisionType: englishLoopProfile.lastDecision.type,
      nextMoveType: response.moveType,
      learnerState: turnEvidence.state,
      action: turnEvidence.action,
      criteriaMet: turnEvidence.criteriaMet,
      missingCriteria: turnEvidence.missingCriteria,
      evidenceType: turnEvidence.evidenceType,
      fallback: Boolean(response.fallback)
    }
  });
}

async function handleTranscript(text: string, audioDurationMs = 0): Promise<void> {
  const intake = transcriptIntake.accept(text);
  if (!intake.accepted) {
    void logEvent("transcript_ignored", {
      reason: intake.reason,
      text: fit(text, 42),
      normalized: intake.normalized
    });
    if (voiceEnabled) setVoiceActivity("Listening");
    return;
  }

  if (!englishLoopEnabled) {
    void logEvent("transcript", { text: intake.text, normalized: intake.normalized });
  }
  setVoice(englishLoopEnabled ? "English turn received" : fit(intake.text, 42));
  if (englishLoopEnabled) {
    const action = voiceActionForContext(intake.text, { answerExpected: false, audioDurationMs });
    if (action) {
      void logEvent("english_loop_command", { action });
      await handleEnglishCommand(action);
    } else {
      await handleEnglishTurn(intake.text, audioDurationMs);
    }
    return;
  }
  const answerExpected = sessionState === "feynman_question" || sessionState === "follow_up";
  const action = voiceActionForContext(intake.text, { answerExpected, audioDurationMs });
  void logEvent("voice_action", { action, answerExpected, audioDurationMs, text: intake.text });
  if (action) {
    setVoiceActivity(`Voice: ${action}`);
    await performAction(action, intake.text);
    if (voiceEnabled && action !== "ask") setVoiceActivity("Listening");
  } else if (debtMode && quizStep > 0 && quizStep <= DEBT_QUESTIONS) {
    quizAnswers.push(intake.text.slice(0, 400));
    quizStep += 1;
    if (bridge) { try { await renderGlasses(true); } catch { /* glasses optional */ } }
    if (voiceEnabled) setVoiceActivity(`Answered ${quizAnswers.length}/${DEBT_QUESTIONS}`);
  } else {
    await askTutor("answer", intake.text);
  }
}

async function handlePcmAudio(chunk: Uint8Array, source: AudioInputSource): Promise<void> {
  audioEventCount += 1;
  audioByteCount += chunk.length;
  audioTelemetryEventCount += 1;
  audioTelemetryByteCount += chunk.length;
  const now = Date.now();
  if (now - audioTelemetryAt >= 1000) {
    void logEvent("g2_audio_event", {
      source,
      events: audioTelemetryEventCount,
      bytes: audioTelemetryByteCount,
      latestChunkBytes: chunk.length,
      windowMs: now - audioTelemetryAt
    });
    audioTelemetryAt = now;
    audioTelemetryEventCount = 0;
    audioTelemetryByteCount = 0;
  }
  if (transcriptionBlocked || now < transcribeRetryAt) return;
  const containsSpeech = isSpeechPcm(chunk);
  if (!utteranceHasSpeech && !containsSpeech) return;
  if (!utteranceHasSpeech) {
    utteranceHasSpeech = true;
    utteranceStartedAt = now;
    setVoiceActivity("Listening");
  }
  if (containsSpeech) lastSpeechAt = now;
  audioChunks.push(chunk);
  trimAudioBuffer();
  if (shouldFlushUtterance(now, utteranceStartedAt, lastSpeechAt)) await flushPcmAudio();
}

function trimAudioBuffer(): void {
  let total = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  while (audioChunks.length > 1 && total > MAX_PCM_BUFFER_BYTES) {
    total -= audioChunks.shift()?.length || 0;
  }
}

function schedulePcmFlush(minimumDelayMs = 250): void {
  if (transcriptionBlocked) return;
  if (pcmFlushTimer !== null) return;
  const delayMs = nextPcmFlushDelayMs(
    Date.now(),
    lastAudioSendAt,
    transcribeRetryAt,
    minimumDelayMs
  );
  pcmFlushTimer = window.setTimeout(() => {
    pcmFlushTimer = null;
    void flushPcmAudio();
  }, delayMs);
}

async function flushPcmAudio(): Promise<void> {
  if (transcriptionBlocked) return;
  if (transcriptionInFlight) {
    const now = Date.now();
    if (now - lastTranscribeSkipAt > 1000) {
      lastTranscribeSkipAt = now;
      void logEvent("transcribe_skipped", { reason: "in_flight", chunks: audioChunks.length });
    }
    return;
  }

  lastAudioSendAt = Date.now();

  const merged = mergeChunks(audioChunks.splice(0));
  if (!merged.length) return;
  resetUtterance();

  const audioDurationMs = pcmDurationMs(merged.length);
  const requestStartedAt = Date.now();
  transcriptionInFlight = true;
  setVoice(`识别中 ${audioDurationMs}ms`);
  setVoiceActivity("Transcribing");
  void logEvent("transcribe_start", {
    bytes: merged.length,
    audioDurationMs,
    sampleRate: PCM_SAMPLE_RATE,
    format: "pcm_s16le_mono"
  });
  try {
    const payload = await apiPost<TranscriptResponse>("/api/learn/transcribe", {
      source: "even-g2",
      format: "pcm16",
      sampleRate: PCM_SAMPLE_RATE,
      language: englishLoopEnabled ? "en" : "zh",
      audioBase64: bytesToBase64(merged)
    });
    const latencyMs = Date.now() - requestStartedAt;
    if (payload.ok && !payload.text) {
      transcribeRetryAt = 0;
      setVoice("没有识别到语音，请再说一次");
      setVoiceActivity("Listening");
      void logEvent("transcribe_empty", {
        latencyMs,
        bytes: merged.length,
        audioDurationMs
      });
      return;
    }
    if (!payload.ok) {
      const message = fit(payload.error || "没有识别到语音", 34);
      setVoice(`转写失败：${message}`);
      void logEvent("transcribe_error", {
        error: payload.error || "empty transcript",
        latencyMs,
        bytes: merged.length,
        audioDurationMs
      });
      if (isFatalSttError(message)) {
        await blockVoiceAfterFatalSttError(message);
      } else {
        audioChunks = [];
        resetUtterance();
        transcribeRetryAt = Date.now() + STT_RETRY_BACKOFF_MS;
        setVoiceActivity("STT paused 5s");
      }
      return;
    }
    transcribeRetryAt = 0;
    const transcript = payload.text || "";
    void logEvent("transcribe_complete", {
      latencyMs,
      bytes: merged.length,
      audioDurationMs,
      ...(englishLoopEnabled ? { wordCount: transcript.split(/\s+/).filter(Boolean).length } : { text: fit(transcript, 42) })
    });
    await handleTranscript(transcript, audioDurationMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setVoice(`转写失败：${fit(message, 34)}`);
    void logEvent("transcribe_error", {
      error: message,
      latencyMs: Date.now() - requestStartedAt,
      bytes: merged.length,
      audioDurationMs
    });
    if (isFatalSttError(message)) {
      await blockVoiceAfterFatalSttError(message);
    } else {
      audioChunks = [];
      resetUtterance();
      transcribeRetryAt = Date.now() + STT_RETRY_BACKOFF_MS;
      setVoiceActivity("STT paused 5s");
    }
    console.warn("PCM transcription failed", error);
  } finally {
    transcriptionInFlight = false;
    if (
      audioChunks.length
      && utteranceHasSpeech
      && shouldFlushUtterance(Date.now(), utteranceStartedAt, lastSpeechAt)
      && !transcriptionBlocked
    ) {
      schedulePcmFlush();
    }
  }
}

function resetUtterance(): void {
  utteranceStartedAt = 0;
  lastSpeechAt = 0;
  utteranceHasSpeech = false;
}

async function blockVoiceAfterFatalSttError(message: string): Promise<void> {
  transcriptionBlocked = true;
  voiceEnabled = false;
  audioChunks = [];
  resetUtterance();
  if (pcmFlushTimer !== null) {
    window.clearTimeout(pcmFlushTimer);
    pcmFlushTimer = null;
  }
  toggleVoiceButton.textContent = "开启语音";
  if (bridge && g2AudioActive) await bridge.audioControl(false);
  g2AudioActive = false;
  if (englishLoopEnabled && englishLoopSessionActive) stopEnglishLoopSession();
  advanceSession("END");
  setVoice(`转写不可用：${fit(message, 30)}`);
  setVoiceActivity("STT setup required");
  void logEvent("audio_control", {
    open: false,
    source: "glasses",
    reason: "fatal_stt_error",
    audioEventCount,
    audioByteCount,
    captureDurationMs: audioCaptureStartedAt ? Date.now() - audioCaptureStartedAt : 0
  });
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function startVoice(): Promise<void> {
  voiceEnabled = true;
  g2AudioActive = false;
  transcriptionBlocked = false;
  transcribeRetryAt = 0;
  transcriptIntake.reset();
  audioChunks = [];
  resetUtterance();
  lastAudioSendAt = Date.now();
  audioCaptureStartedAt = lastAudioSendAt;
  audioEventCount = 0;
  audioByteCount = 0;
  audioTelemetryAt = lastAudioSendAt;
  audioTelemetryEventCount = 0;
  audioTelemetryByteCount = 0;
  if (pcmFlushTimer !== null) {
    window.clearTimeout(pcmFlushTimer);
    pcmFlushTimer = null;
  }
  advanceSession("START_LISTENING");
  if (englishLoopEnabled) startEnglishLoopSession();
  toggleVoiceButton.textContent = "关闭语音";
  setVoice("开启中");
  setVoiceActivity("Listening");

  if (bridge) {
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses);
    g2AudioActive = ok;
    void logEvent("audio_control", { open: true, source: "glasses", ok });
    setVoice(ok ? "G2 MIC 已开启" : "G2 MIC 不可用，尝试手机语音");
    if (ok) {
      await renderGlasses(false);
      return;
    }
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    speechRecognition = new Recognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = false;
    speechRecognition.lang = englishLoopEnabled ? "en-US" : "zh-CN";
    speechRecognition.onresult = event => {
      const latest = event.results[event.results.length - 1]?.[0]?.transcript || "";
      void handleTranscript(latest);
    };
    speechRecognition.onerror = event => {
      const reason = event.error || "unknown";
      setVoice(`浏览器识别错误 ${reason}`.trim());
      if (reason === "not-allowed" || reason === "service-not-allowed") {
        voiceEnabled = false;
        speechRecognition = null;
        toggleVoiceButton.textContent = "开启语音";
        setVoiceActivity("Mic permission needed");
        advanceSession("END");
      }
    };
    speechRecognition.onend = () => {
      if (voiceEnabled) {
        try {
          speechRecognition?.start();
        } catch {
          setVoice("等待重新开启");
        }
      }
    };
    try {
      speechRecognition.start();
      if (speechRecognition && voiceEnabled) {
        setVoice(bridge ? "手机语音识别" : "浏览器识别");
      }
    } catch {
      setVoice("浏览器识别启动失败");
    }
  } else {
    voiceEnabled = false;
    toggleVoiceButton.textContent = "开启语音";
    setVoice("没有可用的语音输入");
    setVoiceActivity("Voice unavailable");
    advanceSession("END");
  }

  await renderGlasses(false);
}

async function stopVoice(): Promise<void> {
  voiceEnabled = false;
  transcriptIntake.reset();
  if (englishLoopEnabled && englishLoopSessionActive) stopEnglishLoopSession();
  advanceSession("END");
  toggleVoiceButton.textContent = "开启语音";
  speechRecognition?.stop();
  speechRecognition = null;
  if (bridge) await bridge.audioControl(false);
  const captureDurationMs = audioCaptureStartedAt ? Date.now() - audioCaptureStartedAt : 0;
  void logEvent("audio_control", {
    open: false,
    source: g2AudioActive ? "glasses" : "browser",
    audioEventCount,
    audioByteCount,
    captureDurationMs
  });
  g2AudioActive = false;
  transcriptionBlocked = false;
  transcribeRetryAt = 0;
  audioChunks = [];
  resetUtterance();
  if (pcmFlushTimer !== null) {
    window.clearTimeout(pcmFlushTimer);
    pcmFlushTimer = null;
  }
  setVoiceActivity("");
  setVoice("未开启");
  await renderGlasses(false);
}

importFileEl.addEventListener("change", async () => {
  const file = importFileEl.files?.[0];
  if (!file) return;
  importTextEl.value = await file.text();
});

importAiButton.addEventListener("click", () => void importWithAi());
ingestButton.addEventListener("click", () => void ingestLearningIncrement());
syncTodayButton.addEventListener("click", () => void syncSpiralToday());
planCourseButton.addEventListener("click", () => void planCourse());
submitAnswerButton.addEventListener("click", () => void askTutor("answer", clean(answerTextEl.value)));
repeatButton.addEventListener("click", () => void performAction("repeat"));
askButton.addEventListener("click", () => void performAction("ask"));
nextButton.addEventListener("click", () => void performAction("next"));
knownButton.addEventListener("click", () => void performAction("known"));
mockRepeatButton.addEventListener("click", () => void handleTranscript(currentCard()?.front || "next"));

toggleVoiceButton.addEventListener("click", () => {
  void (voiceEnabled ? stopVoice() : startVoice());
});

englishLoopToggleButton.addEventListener("click", () => {
  if (englishLoopEnabled && voiceEnabled) {
    void stopVoice();
  }
  englishLoopEnabled = !englishLoopEnabled;
  englishLoopTopic = englishLoopTopicEl.value.trim() || englishLoopTopic;
  saveEnglishLoopProfile();
  renderEnglishLoop();
  setEnglishLoopNotice(englishLoopEnabled ? "English Loop ready" : "English Loop off");
  setCoach(englishLoopEnabled
    ? "开启本次口语后，直接聊你真正关心的事情。"
    : "已回到普通 Spiral 学习模式。");
});

englishLoopStartVoiceButton.addEventListener("click", () => {
  englishLoopEnabled = true;
  englishLoopTopic = englishLoopTopicEl.value.trim() || englishLoopTopic;
  saveEnglishLoopProfile();
  renderEnglishLoop();
  void (voiceEnabled ? stopVoice() : startVoice());
});

englishLoopTopicEl.addEventListener("change", () => {
  englishLoopTopic = englishLoopTopicEl.value.trim() || englishLoopTopic;
  saveEnglishLoopProfile();
});

saveSettingsButton.addEventListener("click", () => {
  apiBaseUrl = apiBaseUrlEl.value.trim() || apiBaseUrl;
  apiToken = apiTokenEl.value.trim();
  localStorage.setItem("g2LearningApiBaseUrl", apiBaseUrl);
  localStorage.setItem("g2LearningApiToken", apiToken);
  setCoach("设置已保存，正在测试 AI 连接。");
  showApiAddressHint();
  void testAiConnection();
});

testAiConnectionButton.addEventListener("click", () => void testAiConnection());

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab || "today");
    if (button.dataset.tab === "settings") showApiAddressHint();  });
});

const progressFocusSubmitEl = document.querySelector<HTMLButtonElement>("#progress-focus-submit");
const progressFocusInputEl = document.querySelector<HTMLInputElement>("#progress-focus-input");
progressFocusSubmitEl?.addEventListener("click", () => {
  void submitProgressFocus(progressFocusInputEl?.value || "");
});
progressFocusInputEl?.addEventListener("keydown", event => {
  if (event.key === "Enter") void submitProgressFocus(progressFocusInputEl.value || "");
});

document.querySelectorAll<HTMLButtonElement>("[data-session-duration]").forEach(button => {
  button.addEventListener("click", () => {
    void startTimedSession(Number(button.dataset.sessionDuration || 60));
  });
});

updateWebView();
renderEnglishLoop();
// Deep link: ?tab=projects|debts opens that panel (and its glasses mode) on load.
const initialTab = new URLSearchParams(window.location.search).get("tab");
if (initialTab === "projects" || initialTab === "debts") activateTab(initialTab);
window.addEventListener("online", () => void flushEnglishLoopOutbox());
void restoreEnglishLoopState();
sessionStateEl.textContent = sessionLabel(sessionState);
showApiAddressHint();
void logEvent("app_loaded", {
  cards: cards.length,
  url: window.location.href,
  hasEvenBridge: Boolean(window.EvenAppBridge)
});
void initBridge().catch(error => {
  setStatus("error");
  setCoach(error.message);
});
if (!simulatorTestMode) void syncSpiralToday(true);
