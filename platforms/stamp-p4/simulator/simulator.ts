/**
 * Stamp-P4 浏览器模拟器。
 * 模拟设备端行为：连接 bridge、握手、ACK、messageId 去重、断线重连、按钮输入。
 * 显示 640×200 逻辑内容区，打印原始 JSON 与连接状态。
 */

type ServerMessage = {
  type: string;
  messageId?: string;
  title?: string;
  text?: string;
  cardType?: string;
  body?: string;
  footer?: string;
  page?: number;
  pageCount?: number;
  value?: number;
  code?: string;
  message?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const ctypeEl = $("ctype");
const titleEl = $("title");
const bodyEl = $("body");
const metaEl = $("meta");
const rawLogEl = $("rawLog");
const eventLogEl = $("eventLog");
const urlInput = $("url") as HTMLInputElement;
const deviceIdInput = $("deviceId") as HTMLInputElement;
const connectBtn = $("connectBtn") as HTMLButtonElement;
const disconnectBtn = $("disconnectBtn") as HTMLButtonElement;

let ws: WebSocket | null = null;
let autoReconnect = true;
let reconnectAttempts = 0;
let reconnectTimer: number | null = null;
const seenMessageIds = new Set<string>();
const DEDUP_MAX = 200;

const CAPABILITIES = {
  type: "capabilities",
  display: { physicalWidth: 1280, physicalHeight: 720, logicalWidth: 640, logicalHeight: 200, color: true, scroll: false },
  input: { buttons: true, touch: false, voice: false },
  camera: false,
  audio: false
};

function logEvent(text: string): void {
  const time = new Date().toLocaleTimeString();
  eventLogEl.textContent = `[${time}] ${text}\n` + eventLogEl.textContent;
}

function logRaw(obj: unknown): void {
  rawLogEl.textContent = JSON.stringify(obj) + "\n" + rawLogEl.textContent;
}

function setStatus(connected: boolean, label: string): void {
  statusEl.textContent = label;
  statusEl.className = `status ${connected ? "on" : "off"}`;
}

function showDisconnected(): void {
  ctypeEl.textContent = "状态";
  titleEl.textContent = "连接已断开";
  bodyEl.textContent = "正在重连…";
  metaEl.textContent = "";
}

function send(obj: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function sendHello(): void {
  send({ type: "device_hello", deviceId: deviceIdInput.value.trim() || "stamp-p4-sim", firmwareVersion: "0.1.0", protocolVersion: 1 });
  send(CAPABILITIES);
  logEvent("已发送 device_hello + capabilities");
}

function sendInput(event: string): void {
  send({ type: "input_event", event, timestamp: Date.now() });
  logEvent(`输入: ${event}`);
}

function renderMessage(msg: ServerMessage): void {
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
      metaEl.textContent = msg.pageCount && msg.pageCount > 1 ? `第 ${msg.page}/${msg.pageCount} 页` : "";
      break;
    case "clear_display":
      ctypeEl.textContent = "清屏";
      titleEl.textContent = "";
      bodyEl.textContent = "";
      metaEl.textContent = "";
      break;
    case "set_brightness":
      metaEl.textContent = `亮度 ${msg.value}`;
      break;
    case "ping":
      send({ type: "pong", timestamp: Date.now() });
      break;
    case "error":
      logEvent(`错误 ${msg.code}: ${msg.message}`);
      break;
  }
}

function handleMessage(raw: string): void {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    logEvent("收到无法解析的消息");
    return;
  }
  logRaw(msg);

  // messageId 去重：重复显示消息不重复翻页，但仍回 ACK。
  if (msg.messageId) {
    const isDisplay = ["display_text", "display_card", "clear_display", "set_brightness"].includes(msg.type);
    if (isDisplay) {
      send({ type: "ack", messageId: msg.messageId });
      if (seenMessageIds.has(msg.messageId)) {
        logEvent(`重复 messageId ${msg.messageId}，已忽略显示（仅 ACK）`);
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

function scheduleReconnect(): void {
  if (!autoReconnect) return;
  reconnectAttempts += 1;
  // 指数退避，最大 30 秒。
  const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempts - 1, 5));
  logEvent(`${Math.round(delay / 1000)}s 后重连（第 ${reconnectAttempts} 次）`);
  reconnectTimer = window.setTimeout(connect, delay);
}

function connect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { ws?.close(); } catch { /* ignore */ }
  ws = new WebSocket(urlInput.value.trim());
  ws.onopen = () => {
    reconnectAttempts = 0;
    setStatus(true, "已连接");
    logEvent("WebSocket 已连接");
    sendHello();
  };
  ws.onmessage = ev => handleMessage(String(ev.data));
  ws.onclose = () => {
    setStatus(false, "未连接");
    showDisconnected();
    logEvent("连接已断开");
    scheduleReconnect();
  };
  ws.onerror = () => logEvent("连接错误");
}

function disconnect(): void {
  autoReconnect = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  ws?.close();
  setStatus(false, "未连接");
  logEvent("已手动断开（不再自动重连）");
}

connectBtn.addEventListener("click", () => { autoReconnect = true; reconnectAttempts = 0; connect(); });
disconnectBtn.addEventListener("click", disconnect);

document.querySelectorAll<HTMLButtonElement>(".pad button").forEach(btn => {
  btn.addEventListener("click", () => sendInput(btn.dataset.ev || "next"));
});

// 键盘快捷键 n/r/f（模拟串口命令）。
document.addEventListener("keydown", e => {
  if (e.target instanceof HTMLInputElement) return;
  const map: Record<string, string> = { n: "next", r: "repeat", f: "finish" };
  const ev = map[e.key.toLowerCase()];
  if (ev) sendInput(ev);
});
