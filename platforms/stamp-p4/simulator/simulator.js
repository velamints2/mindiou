// simulator.ts
var $ = (id) => document.getElementById(id);
var statusEl = $("status");
var ctypeEl = $("ctype");
var titleEl = $("title");
var bodyEl = $("body");
var metaEl = $("meta");
var rawLogEl = $("rawLog");
var eventLogEl = $("eventLog");
var urlInput = $("url");
var deviceIdInput = $("deviceId");
var connectBtn = $("connectBtn");
var disconnectBtn = $("disconnectBtn");
var ws = null;
var autoReconnect = true;
var reconnectAttempts = 0;
var reconnectTimer = null;
var seenMessageIds = /* @__PURE__ */ new Set();
var DEDUP_MAX = 200;
var CAPABILITIES = {
  type: "capabilities",
  display: { physicalWidth: 1280, physicalHeight: 720, logicalWidth: 640, logicalHeight: 200, color: true, scroll: false },
  input: { buttons: true, touch: false, voice: false },
  camera: false,
  audio: false
};
function logEvent(text) {
  const time = (/* @__PURE__ */ new Date()).toLocaleTimeString();
  eventLogEl.textContent = `[${time}] ${text}
` + eventLogEl.textContent;
}
function logRaw(obj) {
  rawLogEl.textContent = JSON.stringify(obj) + "\n" + rawLogEl.textContent;
}
function setStatus(connected, label) {
  statusEl.textContent = label;
  statusEl.className = `status ${connected ? "on" : "off"}`;
}
function showDisconnected() {
  ctypeEl.textContent = "\u72B6\u6001";
  titleEl.textContent = "\u8FDE\u63A5\u5DF2\u65AD\u5F00";
  bodyEl.textContent = "\u6B63\u5728\u91CD\u8FDE\u2026";
  metaEl.textContent = "";
}
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function sendHello() {
  send({ type: "device_hello", deviceId: deviceIdInput.value.trim() || "stamp-p4-sim", firmwareVersion: "0.1.0", protocolVersion: 1 });
  send(CAPABILITIES);
  logEvent("\u5DF2\u53D1\u9001 device_hello + capabilities");
}
function sendInput(event) {
  send({ type: "input_event", event, timestamp: Date.now() });
  logEvent(`\u8F93\u5165: ${event}`);
}
function renderMessage(msg) {
  switch (msg.type) {
    case "display_card":
      ctypeEl.textContent = msg.cardType || "card";
      titleEl.textContent = msg.title || "";
      bodyEl.textContent = msg.body || "";
      metaEl.textContent = msg.footer || "";
      break;
    case "display_text":
      ctypeEl.textContent = "text";
      titleEl.textContent = msg.title || "";
      bodyEl.textContent = msg.text || "";
      metaEl.textContent = msg.pageCount && msg.pageCount > 1 ? `\u7B2C ${msg.page}/${msg.pageCount} \u9875` : "";
      break;
    case "clear_display":
      ctypeEl.textContent = "\u6E05\u5C4F";
      titleEl.textContent = "";
      bodyEl.textContent = "";
      metaEl.textContent = "";
      break;
    case "set_brightness":
      metaEl.textContent = `\u4EAE\u5EA6 ${msg.value}`;
      break;
    case "ping":
      send({ type: "pong", timestamp: Date.now() });
      break;
    case "error":
      logEvent(`\u9519\u8BEF ${msg.code}: ${msg.message}`);
      break;
  }
}
function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    logEvent("\u6536\u5230\u65E0\u6CD5\u89E3\u6790\u7684\u6D88\u606F");
    return;
  }
  logRaw(msg);
  if (msg.messageId) {
    const isDisplay = ["display_text", "display_card", "clear_display", "set_brightness"].includes(msg.type);
    if (isDisplay) {
      send({ type: "ack", messageId: msg.messageId });
      if (seenMessageIds.has(msg.messageId)) {
        logEvent(`\u91CD\u590D messageId ${msg.messageId}\uFF0C\u5DF2\u5FFD\u7565\u663E\u793A\uFF08\u4EC5 ACK\uFF09`);
        return;
      }
      seenMessageIds.add(msg.messageId);
      if (seenMessageIds.size > DEDUP_MAX) {
        const first = seenMessageIds.values().next().value;
        if (first) seenMessageIds.delete(first);
      }
    }
  }
  renderMessage(msg);
}
function scheduleReconnect() {
  if (!autoReconnect) return;
  reconnectAttempts += 1;
  const delay = Math.min(3e4, 1e3 * 2 ** Math.min(reconnectAttempts - 1, 5));
  logEvent(`${Math.round(delay / 1e3)}s \u540E\u91CD\u8FDE\uFF08\u7B2C ${reconnectAttempts} \u6B21\uFF09`);
  reconnectTimer = window.setTimeout(connect, delay);
}
function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    ws?.close();
  } catch {
  }
  ws = new WebSocket(urlInput.value.trim());
  ws.onopen = () => {
    reconnectAttempts = 0;
    setStatus(true, "\u5DF2\u8FDE\u63A5");
    logEvent("WebSocket \u5DF2\u8FDE\u63A5");
    sendHello();
  };
  ws.onmessage = (ev) => handleMessage(String(ev.data));
  ws.onclose = () => {
    setStatus(false, "\u672A\u8FDE\u63A5");
    showDisconnected();
    logEvent("\u8FDE\u63A5\u5DF2\u65AD\u5F00");
    scheduleReconnect();
  };
  ws.onerror = () => logEvent("\u8FDE\u63A5\u9519\u8BEF");
}
function disconnect() {
  autoReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  setStatus(false, "\u672A\u8FDE\u63A5");
  logEvent("\u5DF2\u624B\u52A8\u65AD\u5F00\uFF08\u4E0D\u518D\u81EA\u52A8\u91CD\u8FDE\uFF09");
}
connectBtn.addEventListener("click", () => {
  autoReconnect = true;
  reconnectAttempts = 0;
  connect();
});
disconnectBtn.addEventListener("click", disconnect);
document.querySelectorAll(".pad button").forEach((btn) => {
  btn.addEventListener("click", () => sendInput(btn.dataset.ev || "next"));
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const map = { n: "next", r: "repeat", f: "finish" };
  const ev = map[e.key.toLowerCase()];
  if (ev) sendInput(ev);
});
