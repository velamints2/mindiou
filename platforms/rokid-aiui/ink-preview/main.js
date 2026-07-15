import { configNavigatorHost, configureNetwork, createInkView } from "@yodaos-pkg/ink";
import inkWasmUrl from "@yodaos-pkg/ink/pkg/ink_web_bg.wasm?url";

import agentsSource from "../AGENTS.md?raw";
import appSource from "../app.js?raw";
import appConfigSource from "../app.json?raw";
import appStylesSource from "../app.wxss?raw";
import configSource from "../config.js?raw";
import clearanceSource from "../pages/clearance/index.ink?raw";
import importSource from "../pages/import/index.ink?raw";
import reviewSource from "../pages/index/index.ink?raw";
import settingsSource from "../pages/settings/index.ink?raw";
import voiceActionSource from "../pages/voice-action/index.ink?raw";
import apiSource from "../utils/api.js?raw";
import learningSource from "../utils/learning.js?raw";

const bundleFiles = {
  "AGENTS.md": agentsSource,
  "app.js": appSource,
  "app.json": appConfigSource,
  "app.wxss": appStylesSource,
  "config.js": configSource,
  "pages/clearance/index.ink": clearanceSource,
  "pages/import/index.ink": importSource,
  "pages/index/index.ink": reviewSource,
  "pages/settings/index.ink": settingsSource,
  "pages/voice-action/index.ink": voiceActionSource,
  "utils/api.js": apiSource,
  "utils/learning.js": learningSource
};

const canvas = document.querySelector("#ink-root");
const frame = document.querySelector("#device-frame");
const routeSelect = document.querySelector("#page-route");
const apiInput = document.querySelector("#api-url");
const reloadButton = document.querySelector("#reload");
const statusDot = document.querySelector("#status-dot");
const statusText = document.querySelector("#status-text");
const errorPanel = document.querySelector("#error-panel");
const viewportLabel = document.querySelector("#viewport-label");
const pageLabel = document.querySelector("#page-label");
const voiceWakeupButton = document.querySelector("#voice-wakeup");
const speechResultInput = document.querySelector("#speech-result");
const submitSpeechButton = document.querySelector("#submit-speech");
const speechStatus = document.querySelector("#speech-status");

let inkView = null;
let removeDomBindings = null;
let speechRequest = null;

function selectedViewport() {
  const selected = document.querySelector('input[name="viewport"]:checked');
  const [width, height] = selected.value.split("x").map(Number);
  return { width, height };
}

function setStatus(label, tone = "loading") {
  statusText.textContent = label;
  statusDot.dataset.tone = tone;
}

function setError(error) {
  const message = error instanceof Error ? error.message : String(error);
  errorPanel.textContent = message;
  errorPanel.hidden = false;
  setStatus("Ink failed", "error");
}

function clearError() {
  errorPanel.hidden = true;
  errorPanel.textContent = "";
}

function localPreviewRequest(request) {
  const configuredBase = (apiInput.value.trim() || "http://localhost:8793").replace(/\/+$/, "");
  const isLocalBackend = /^http:\/\/(?:localhost|127\.0\.0\.1):8793$/i.test(configuredBase);
  if (isLocalBackend && request.url.startsWith(configuredBase)) {
    const suffix = request.url.slice(configuredBase.length);
    const rewrittenUrl = `${location.origin}/__mindiou_api${suffix}`;
    console.info(`[Ink request] ${request.method} ${request.url} -> ${rewrittenUrl}`);
    return {
      action: "rewrite",
      url: rewrittenUrl,
      method: request.method,
      headers: request.headers,
      body: request.body
    };
  }
  console.info(`[Ink request] ${request.method} ${request.url}`);
  return { action: "continue" };
}

function destroyView() {
  if (removeDomBindings) removeDomBindings();
  removeDomBindings = null;
  if (inkView) inkView.destroy();
  inkView = null;
  speechRequest = null;
  submitSpeechButton.disabled = true;
  speechStatus.textContent = "ASR idle";
}

function emitSpeechEvent(type, request, extra = {}) {
  if (!inkView || !request) return;
  inkView.hostCapabilitiesTarget.dispatchEvent(new CustomEvent(type, {
    detail: {
      targetId: request.targetId,
      sessionId: request.sessionId,
      ...extra
    }
  }));
}

function stopSpeechSession(request) {
  if (!request || speechRequest?.sessionId !== request.sessionId) return;
  emitSpeechEvent("speech.speechend", request);
  emitSpeechEvent("speech.soundend", request);
  emitSpeechEvent("speech.audioend", request);
  emitSpeechEvent("speech.end", request);
  speechRequest = null;
  submitSpeechButton.disabled = true;
  speechStatus.textContent = "ASR ended";
}

function speechHostCapabilities() {
  return {
    speech: {
      startRecognition(request) {
        speechRequest = request;
        submitSpeechButton.disabled = false;
        speechStatus.textContent = "ASR listening";
        emitSpeechEvent("speech.start", request);
        emitSpeechEvent("speech.audiostart", request);
        emitSpeechEvent("speech.soundstart", request);
        emitSpeechEvent("speech.speechstart", request);
      },
      stopRecognition: stopSpeechSession,
      abortRecognition: stopSpeechSession
    }
  };
}

async function loadInkApp() {
  clearError();
  setStatus("Loading bundle");
  reloadButton.disabled = true;
  destroyView();

  const { width, height } = selectedViewport();
  frame.style.setProperty("--ink-width", width);
  frame.style.setProperty("--ink-height", height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  viewportLabel.textContent = `${width} x ${height} logical pixels`;
  pageLabel.textContent = routeSelect.options[routeSelect.selectedIndex].text;

  try {
    configNavigatorHost("local-preview", "Rokid AIUI Web", "browser", ["zh-CN", "en-US"], "CN");
    configureNetwork({ interceptor: localPreviewRequest });
    inkView = await createInkView({
      width,
      height,
      scaleFactor: Math.min(window.devicePixelRatio || 1, 2),
      appFps: 30,
      canvas,
      wasm: { wasmUrl: inkWasmUrl }
    });
    inkView.setHostCapabilities(speechHostCapabilities());
    removeDomBindings = inkView.bindDomEvents({ canvas, focusTarget: canvas });
    inkView.openBundle({
      appId: "mindiou-local-preview",
      files: bundleFiles,
      initialPage: routeSelect.value,
      query: {
        api: apiInput.value.trim() || "http://localhost:8793",
        duration: 60
      }
    });
    inkView.startRendering();
    canvas.focus();
    setStatus("Ink running", "ready");
  } catch (error) {
    destroyView();
    setError(error);
  } finally {
    reloadButton.disabled = false;
  }
}

reloadButton.addEventListener("click", loadInkApp);
routeSelect.addEventListener("change", loadInkApp);
apiInput.addEventListener("change", loadInkApp);
document.querySelectorAll('input[name="viewport"]').forEach(input => {
  input.addEventListener("change", loadInkApp);
});
window.addEventListener("beforeunload", destroyView);

voiceWakeupButton.addEventListener("click", () => {
  if (!inkView) return;
  inkView.notifyUserInteraction();
  inkView.dispatchVoiceWakeup("leqi");
  speechStatus.textContent = "Wakeup sent";
  canvas.focus();
});

submitSpeechButton.addEventListener("click", () => {
  const transcript = speechResultInput.value.trim();
  if (!speechRequest || !transcript) return;
  emitSpeechEvent("speech.result", speechRequest, {
    resultIndex: 0,
    isFinal: true,
    alternatives: [{ transcript, confidence: 0.96 }]
  });
  speechStatus.textContent = "Transcript sent";
  canvas.focus();
});

speechResultInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !submitSpeechButton.disabled) submitSpeechButton.click();
});

window.addEventListener("keydown", event => {
  if (document.activeElement === canvas && ["ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) {
    event.preventDefault();
  }
}, { capture: true });

const requestedApi = new URLSearchParams(location.search).get("api");
if (requestedApi) apiInput.value = requestedApi;

loadInkApp();
