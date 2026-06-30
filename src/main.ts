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
import { parseVoiceAction, TranscriptIntake, type VoiceAction } from "./voice";
import "./styles.css";

type LearningCard = {
  id: string;
  front: string;
  back: string;
  prompt: string;
  tags: string[];
  due: number;
  repetitions: number;
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

let bridge: EvenBridge | null = null;
let bridgeReady = false;
let voiceEnabled = false;
let speechRecognition: SpeechRecognitionLike | null = null;
let cards: LearningCard[] = loadCards();
let cardIndex = Number(localStorage.getItem("g2LearningIndex") || "0");
let apiBaseUrl = readSetting("g2LearningApiBaseUrl", "api", "http://localhost:8793");
let apiToken = readSetting("g2LearningApiToken", "token", "");
let audioChunks: Uint8Array[] = [];
let lastAudioSendAt = 0;
let lastTranscribeSkipAt = 0;
let pcmFlushScheduled = false;
let transcriptionInFlight = false;
let g2AudioActive = false;
let audioCaptureStartedAt = 0;
let audioEventCount = 0;
let audioByteCount = 0;
let sessionState: LearningSessionState = transitionSession("idle", "START");
const transcriptIntake = new TranscriptIntake();
const NAVIGATION_IMAGE_DELAY_MS = 420;
const GESTURE_DEBOUNCE_MS = 240;
const debugImageHoldMs = Number(new URL(window.location.href).searchParams.get("imageHoldMs") || "0");

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
    front: clean(input.front || "Untitled").slice(0, 64),
    back: clean(input.back || "").slice(0, 120),
    prompt: clean(input.prompt || "跟读后说出答案。").slice(0, 120),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 4) : [],
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
        void logEvent("g2_audio_event", {
          source: event.audioEvent.source,
          bytes: event.audioEvent.audioPcm.length
        });
        void handlePcmAudio(event.audioEvent.audioPcm);
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
  } catch {
    for (const event of tutorStateEvents(kind, fallback)) advanceSession(event);
    cardBackEl.textContent = tutorPhoneText(fallback, fallback);
    setCoach(tutorGlassesText(fallback, fallback));
  } finally {
    if (kind === "answer") answerTextEl.value = "";
    if (kind === "answer" && voiceEnabled) setVoiceActivity("Listening");
    setStatus(bridgeReady ? "g2" : "mock");
  }
}

async function performAction(action: StudyAction, transcript = ""): Promise<void> {
  const card = currentCard();
  if (!card) return;

  if (action === "next") {
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
    await askTutor("known", transcript);
    await performAction("next");
    return;
  }

  await askTutor(action, transcript);
}

async function handleTranscript(text: string): Promise<void> {
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
  const action = parseVoiceAction(intake.text);
  void logEvent("voice_action", { action, text: intake.text });
  if (action) {
    setVoiceActivity(`Voice: ${action}`);
    await performAction(action, intake.text);
    if (voiceEnabled) setVoiceActivity("Listening");
  } else {
    await askTutor("answer", intake.text);
  }
}

async function handlePcmAudio(chunk: Uint8Array): Promise<void> {
  audioEventCount += 1;
  audioByteCount += chunk.length;
  audioChunks.push(chunk);
  const now = Date.now();
  if (now - lastAudioSendAt < 2200) return;

  await flushPcmAudio();
}

function schedulePcmFlush(delayMs = 250): void {
  if (pcmFlushScheduled) return;
  pcmFlushScheduled = true;
  window.setTimeout(() => {
    pcmFlushScheduled = false;
    void flushPcmAudio();
  }, delayMs);
}

async function flushPcmAudio(): Promise<void> {
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

  const audioDurationMs = Math.round(merged.length / 32);
  const requestStartedAt = Date.now();
  transcriptionInFlight = true;
  setVoice(`识别中 ${audioDurationMs}ms`);
  setVoiceActivity("Transcribing");
  void logEvent("transcribe_start", {
    bytes: merged.length,
    audioDurationMs,
    sampleRate: 16000,
    format: "pcm_s16le_mono"
  });
  try {
    const payload = await apiPost<TranscriptResponse>("/api/learn/transcribe", {
      source: "even-g2",
      format: "pcm16",
      sampleRate: 16000,
      audioBase64: bytesToBase64(merged)
    });
    const latencyMs = Date.now() - requestStartedAt;
    if (!payload.ok || !payload.text) {
      const message = fit(payload.error || "没有识别到语音", 34);
      setVoice(`转写失败：${message}`);
      setVoiceActivity("STT unavailable");
      void logEvent("transcribe_error", {
        error: payload.error || "empty transcript",
        latencyMs,
        bytes: merged.length,
        audioDurationMs
      });
      return;
    }
    void logEvent("transcribe_complete", {
      latencyMs,
      bytes: merged.length,
      audioDurationMs,
      text: fit(payload.text, 42)
    });
    await handleTranscript(payload.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setVoice(`转写失败：${fit(message, 34)}`);
    setVoiceActivity("STT unavailable");
    void logEvent("transcribe_error", {
      error: message,
      latencyMs: Date.now() - requestStartedAt,
      bytes: merged.length,
      audioDurationMs
    });
    console.warn("PCM transcription failed", error);
  } finally {
    transcriptionInFlight = false;
    if (audioChunks.length) schedulePcmFlush();
  }
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
  transcriptIntake.reset();
  audioChunks = [];
  lastAudioSendAt = Date.now();
  audioCaptureStartedAt = lastAudioSendAt;
  audioEventCount = 0;
  audioByteCount = 0;
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
  audioChunks = [];
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
