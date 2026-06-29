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
const LIST_ACTIONS = ["repeat", "ask", "next", "known"] as const;
type ListAction = typeof LIST_ACTIONS[number];
type StudyAction = ListAction | "previous";

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
let sessionState: LearningSessionState = transitionSession("idle", "START");

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

function glassesContent(card: LearningCard | null): string {
  const prompt = fit(coachLineEl.textContent || card?.prompt || "Explain aloud", 42);
  return `${prompt}\n${sessionLabel(sessionState)}  Up Previous  Down Next  ${progressText()}`;
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

let imageRenderQueue: Promise<void> = Promise.resolve();
let lastRenderedConcept = "";
let lastGestureAt = 0;

async function conceptPng(card: LearningCard | null): Promise<Uint8Array> {
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
  let fontSize = 68;
  context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  while (fontSize > 32 && context.measureText(text).width > 264) {
    fontSize -= 2;
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif`;
  }
  context.fillText(text, 144, 72, 264);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
}

async function updateConceptImage(card: LearningCard | null, force = false): Promise<void> {
  if (!bridge || !bridgeReady) return;
  const conceptKey = card?.id || "no-cards";
  if (!force && conceptKey === lastRenderedConcept) return;
  const imageData = await conceptPng(card);
  imageRenderQueue = imageRenderQueue.catch(() => undefined).then(async () => {
    const result = await bridge!.updateImageRawData(new ImageRawDataUpdate({
      containerID: CONCEPT_IMAGE_ID,
      containerName: "concept-image",
      imageData
    }));
    if (result === "success") lastRenderedConcept = conceptKey;
    void logEvent("g2_concept_image", { bytes: imageData.length, result });
  });
  await imageRenderQueue;
}

async function renderGlasses(rebuild = false): Promise<void> {
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
      await updateConceptImage(card, true);
      return;
    }

    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: DISPLAY_ID,
      containerName: "learn-display",
      content: glassesContent(card)
    }));
    await updateConceptImage(card);
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
      } else if (textType === OsEventTypeList.SCROLL_TOP_EVENT && now - lastGestureAt > 500) {
        lastGestureAt = now;
        void logEvent("g2_gesture", { action: "previous", textType });
        void performAction("previous");
      } else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT && now - lastGestureAt > 500) {
        lastGestureAt = now;
        void logEvent("g2_gesture", { action: "next", textType });
        void performAction("next");
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
    await renderGlasses(false);
    return;
  }

  if (action === "previous") {
    cardIndex = cards.length ? (cardIndex - 1 + cards.length) % cards.length : 0;
    saveCards();
    updateWebView();
    advanceSession("NAVIGATE");
    await renderGlasses(false);
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

function parseVoiceAction(text: string): ListAction | null {
  const value = text.toLowerCase().trim();
  if (!value) return null;
  if (/下一个|下一张|next|skip|过/.test(value)) return "next";
  if (/会了|记住了|known|done|got it/.test(value)) return "known";
  if (/提问|问我|quiz|ask/.test(value)) return "ask";
  if (/跟读|再读|repeat|again/.test(value)) return "repeat";

  return null;
}

async function handleTranscript(text: string): Promise<void> {
  void logEvent("transcript", { text });
  setVoice(fit(text, 42));
  const action = parseVoiceAction(text);
  void logEvent("voice_action", { action, text });
  if (action) await performAction(action, text);
  else await askTutor("answer", text);
}

async function handlePcmAudio(chunk: Uint8Array): Promise<void> {
  audioChunks.push(chunk);
  const now = Date.now();
  if (now - lastAudioSendAt < 2200) return;
  lastAudioSendAt = now;

  const merged = mergeChunks(audioChunks.splice(0));
  if (!merged.length) return;

  try {
    const payload = await apiPost<TranscriptResponse>("/api/learn/transcribe", {
      source: "even-g2",
      format: "pcm16",
      sampleRate: 16000,
      audioBase64: bytesToBase64(merged)
    });
    if (payload.ok && payload.text) await handleTranscript(payload.text);
  } catch (error) {
    console.warn("PCM transcription failed", error);
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
  advanceSession("START_LISTENING");
  toggleVoiceButton.textContent = "关闭语音";
  setVoice("开启中");

  if (bridge) {
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses);
    void logEvent("audio_control", { open: true, source: "glasses", ok });
    setVoice(ok ? "G2 MIC 已开启" : "G2 MIC 不可用，尝试手机语音");
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
    speechRecognition.onerror = event => setVoice(`浏览器识别错误 ${event.error || ""}`.trim());
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
      setVoice(bridge ? "G2 MIC + 浏览器识别" : "浏览器识别");
    } catch {
      setVoice("浏览器识别启动失败");
    }
  }

  await renderGlasses(false);
}

async function stopVoice(): Promise<void> {
  voiceEnabled = false;
  advanceSession("END");
  toggleVoiceButton.textContent = "开启语音";
  speechRecognition?.stop();
  speechRecognition = null;
  if (bridge) await bridge.audioControl(false);
  void logEvent("audio_control", { open: false });
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
