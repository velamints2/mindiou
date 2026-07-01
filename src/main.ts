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

let bridge: EvenBridge | null = null;
let bridgeReady = false;
let voiceEnabled = false;
let speechRecognition: SpeechRecognitionLike | null = null;
let cards: LearningCard[] = simulatorTestMode ? sampleCards() : loadCards();
let cardIndex = simulatorTestMode ? 0 : Number(localStorage.getItem("g2LearningIndex") || "0");
let apiBaseUrl = readSetting("g2LearningApiBaseUrl", "api", "http://localhost:8793");
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
const NAVIGATION_IMAGE_DELAY_MS = 420;
const GESTURE_DEBOUNCE_MS = 240;
const debugImageHoldMs = Number(runtimeParams.get("imageHoldMs") || "0");

apiBaseUrlEl.value = apiBaseUrl;
apiTokenEl.value = apiToken;

function readSetting(key: string, queryKey: string, fallback: string): string {
  const url = new URL(window.location.href);
  return url.searchParams.get(queryKey) || localStorage.getItem(key) || fallback;
}

function loadCards(): LearningCard[] {
  const raw = localStorage.getItem("g2LearningCards");
  if (!raw) return sampleCards();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.map(normalizeCard) : sampleCards();
  } catch {
    return sampleCards();
  }
}

function sampleCards(): LearningCard[] {
  return [
    makeCard("apple", "苹果", "跟读：apple。然后说出中文意思。", ["word"]),
    makeCard("resilient", "有韧性的", "造一个短句。", ["word"]),
    makeCard("context", "上下文", "解释它在 AI 对话里的含义。", ["word"]),
    makeCard("iterate", "迭代", "说出一个你今天可以迭代的东西。", ["word"])
  ];
}

function makeCard(front: string, back: string, prompt = "跟读后说出答案。", tags: string[] = []): LearningCard {
  return {
    id: crypto.randomUUID(),
    front: front.trim(),
    back: back.trim(),
    prompt: prompt.trim(),
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
    front: clean(input.front || "Untitled").slice(0, 64),
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

function currentCard(): LearningCard | null {
  if (!cards.length) return null;
  cardIndex = Math.max(0, Math.min(cardIndex, cards.length - 1));
  return cards[cardIndex] || null;
}

function setStatus(text: string): void {
  statusPillEl.textContent = text;
  void logEvent("status", { text });
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
}

let glassesNotice = "";
let voiceActivity = "";

function glassesContent(card: LearningCard | null): string {
  if (glassesNotice) return `${glassesNotice}  ${progressText()}\nUpdating image...`;
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
    content: glassesContent(card),
    xPosition: 16,
    yPosition: 176,
    width: 536,
    height: 96,
    paddingLength: 4,
    isEventCapture: 1
  });
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
  return fit(coachLineEl.textContent || card?.prompt || "Explain aloud", 34);
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

  const text = fit(card?.front || "No cards", 20);
  let fontSize = 58;
  context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  while (fontSize > 32 && context.measureText(text).width > 264) {
    fontSize -= 2;
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  }
  context.fillText(text, 144, 56, 264);

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
  latestFooterContent = glassesContent(currentCard());
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

        const result = await bridge!.updateImageRawData(new ImageRawDataUpdate({
          containerID: CONCEPT_IMAGE_ID,
          containerName: "concept-image",
          imageData
        }));
        if (result === "success" && request.revision === imageRequestRevision) {
          lastRenderedConcept = request.key;
        }
        if (request.revision === imageRequestRevision) clearGlassesNotice();
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
      setStatus("mock");
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
    setStatus(bridgeReady ? "g2" : `bridge ${result}`);

    bridge.onEvenHubEvent(event => {
      const sysType = event.sysEvent?.eventType;
      const textType = event.textEvent?.eventType;
      const now = Date.now();
      if (event.sysEvent && (sysType === undefined || sysType === OsEventTypeList.CLICK_EVENT)) {
        void logEvent("g2_ignored_input", { input: "click", sysType });
      } else if (textType === OsEventTypeList.SCROLL_TOP_EVENT && now - lastGestureAt > GESTURE_DEBOUNCE_MS) {
        lastGestureAt = now;
        void logEvent("g2_gesture", { action: "previous", textType });
        void performAction("previous");
      } else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT && now - lastGestureAt > GESTURE_DEBOUNCE_MS) {
        lastGestureAt = now;
        void logEvent("g2_gesture", { action: "next", textType });
        void performAction("next");
      } else if (
        textType === OsEventTypeList.SCROLL_TOP_EVENT ||
        textType === OsEventTypeList.SCROLL_BOTTOM_EVENT
      ) {
        void logEvent("g2_gesture_ignored", { reason: "debounce", textType });
      }

      if (event.audioEvent && voiceEnabled) {
        void handlePcmAudio(event.audioEvent.audioPcm, event.audioEvent.source);
      }
    });

    await renderGlasses(true);
  } catch (error) {
    setStatus("mock");
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
  const url = new URL(path, apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`);
  return url.toString();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      ...(apiToken ? { "authorization": `Bearer ${apiToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as T;
  if (!response.ok) throw new Error((payload as { error?: string }).error || `HTTP ${response.status}`);
  return payload;
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: {
      "accept": "application/json",
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
    setCoach(error instanceof Error ? error.message : "Session 创建失败");
  }
}

async function syncSpiralToday(replaceCards = true): Promise<void> {
  syncTodayButton.disabled = true;
  try {
    const payload = await apiGet<SpiralDashboard>("/api/spiral/today");
    applyDashboard(payload, replaceCards);
    if (replaceCards && payload.cards.length) await renderGlasses(true);
  } catch (error) {
    setCoach(error instanceof Error ? error.message : "同步失败");
  } finally {
    syncTodayButton.disabled = false;
  }
}

async function ingestLearningIncrement(): Promise<void> {
  const rawText = importTextEl.value.trim();
  if (!rawText) {
    captureStatusEl.textContent = "Add a Codex goal, failure, decision, and result first.";
    return;
  }
  ingestButton.disabled = true;
  captureStatusEl.textContent = "Compiling learning increment...";
  try {
    const payload = await apiPost<{
      ok: boolean;
      atoms: KnowledgeAtom[];
      cards: LearningCard[];
      today: SpiralDashboard;
    }>("/v1/events/codex", {
      source: captureSourceEl.value,
      projectId: captureProjectEl.value.trim() || "general",
      event_type: "ManualImport",
      rawText,
      retainRaw: retainSourceEl.checked
    });
    applyDashboard(payload.today, true);
    captureStatusEl.textContent = payload.atoms.length
      ? `Created ${payload.atoms.length} knowledge atom${payload.atoms.length === 1 ? "" : "s"}.`
      : "No reusable learning increment found. No card was created.";
    if (payload.cards.length) await renderGlasses(true);
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
    if (!rawText) return;
    let imported: LearningCard[];
    try {
      const payload = await apiPost<ImportResponse>("/api/learn/import", {
        text: rawText,
        mode: "flashcards",
        maxCards: 40
      });
      if (!payload.ok || !payload.cards?.length) throw new Error(payload.error || "No cards returned");
      imported = payload.cards.map(normalizeCard);
      setCoach("AI 已把内容转成学习卡片。");
    } catch (error) {
      imported = localImport(rawText);
      setCoach("本地解析完成。连接 AI API 后可生成更好的卡片。");
      console.warn("AI import fallback", error);
    }

    cards = imported.length ? imported : cards;
    cardIndex = 0;
    saveCards();
    updateWebView();
    await renderGlasses(true);
    setStatus(bridgeReady ? "g2" : "mock");
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
    setStatus(bridgeReady ? "g2" : "mock");
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
    setStatus(bridgeReady ? "g2" : "mock");
  }
}

async function performAction(action: StudyAction, transcript = ""): Promise<void> {
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

  await askTutor(action, transcript);
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

  void logEvent("transcript", { text: intake.text, normalized: intake.normalized });
  setVoice(fit(intake.text, 42));
  const answerExpected = sessionState === "feynman_question" || sessionState === "follow_up";
  const action = voiceActionForContext(intake.text, { answerExpected, audioDurationMs });
  void logEvent("voice_action", { action, answerExpected, audioDurationMs, text: intake.text });
  if (action) {
    setVoiceActivity(`Voice: ${action}`);
    await performAction(action, intake.text);
    if (voiceEnabled && action !== "ask") setVoiceActivity("Listening");
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
      text: fit(transcript, 42)
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
    speechRecognition.lang = "zh-CN";
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

saveSettingsButton.addEventListener("click", () => {
  apiBaseUrl = apiBaseUrlEl.value.trim() || apiBaseUrl;
  apiToken = apiTokenEl.value.trim();
  localStorage.setItem("g2LearningApiBaseUrl", apiBaseUrl);
  localStorage.setItem("g2LearningApiToken", apiToken);
  setCoach("设置已保存。");
});

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    const target = button.dataset.tab;
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(tab => {
      tab.classList.toggle("is-active", tab === button);
    });
    document.querySelectorAll<HTMLElement>("[data-panel]").forEach(panel => {
      panel.hidden = panel.dataset.panel !== target;
    });
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-session-duration]").forEach(button => {
  button.addEventListener("click", () => {
    void startTimedSession(Number(button.dataset.sessionDuration || 60));
  });
});

updateWebView();
sessionStateEl.textContent = sessionLabel(sessionState);
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
