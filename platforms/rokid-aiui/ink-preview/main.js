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

let inkView = null;
let removeDomBindings = null;

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

const requestedApi = new URLSearchParams(location.search).get("api");
if (requestedApi) apiInput.value = requestedApi;

loadInkApp();
