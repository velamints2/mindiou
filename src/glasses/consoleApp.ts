/**
 * MindIOU glasses phone console (framework-free TS + DOM).
 *
 * Responsibilities:
 * - own the GlassesCoreStore and wire it to the Even Hub adapters;
 * - load the deck from the backend (live) or the labelled DEMO fixture;
 * - mirror the glasses frame, show all four layers of the current card, list
 *   the queue with mark states, expose phone-side actions (known / review /
 *   later / retry / sync / exit), and surface API errors with the exact
 *   degradation path;
 * - persist the queue after every change and restore it after WebView kills;
 * - report bridge availability and the last glasses event for on-device debug.
 */
import { waitForEvenAppBridge, type EvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  GlassesCoreStore,
  buildSummary,
  createInitialState,
  currentCard,
  restoreState,
  DEMO_CARDS,
  type CoreAction,
  type DebtCard,
  type QueueState,
  type SessionSummary
} from "../glasses-core";
import { EvenHubDisplayAdapter, buildFrame } from "../glasses-evenhub/displayAdapter";
import { EvenHubInputAdapter } from "../glasses-evenhub/inputAdapter";
import { EvenHubLifecycleAdapter } from "../glasses-evenhub/lifecycleAdapter";
import { EvenHubStorageAdapter } from "../glasses-evenhub/storageAdapter";
import {
  BackendError,
  getDeck,
  submitMarks,
  type MarkPayload
} from "./backendClient";
import "./styles.css";

const STORAGE_KEY_QUEUE = "g2m.queue";
const STORAGE_KEY_BASE_URL = "g2m.apiBaseUrl";
const STORAGE_KEY_TOKEN = "g2m.apiToken";
const PERSIST_DEBOUNCE_MS = 200;
const BRIDGE_WAIT_MS = 2500;

type DeckSource = "demo" | "full" | "thin" | "none";

const SKELETON = `
<div class="g2m-header">
  <h1 class="g2m-title">MindIOU 认知欠条</h1>
  <span class="g2m-pill" data-role="status-pill">初始化</span>
</div>
<nav class="g2m-tabs">
  <button type="button" class="g2m-tab is-active" data-tab="session">当前卡</button>
  <button type="button" class="g2m-tab" data-tab="queue">复习队列</button>
  <button type="button" class="g2m-tab" data-tab="settings">连接与调试</button>
</nav>
<section class="g2m-panel is-active" data-panel="session">
  <div class="g2m-notice is-demo" data-role="demo-banner" hidden>DEMO 演示数据 · 非真实用户内容 · 离线运行</div>
  <div class="g2m-notice" data-role="mode-notice" hidden></div>
  <div class="g2m-notice is-error" data-role="error-area" hidden></div>
  <div class="g2m-mirror">
    <h4>眼镜当前层镜像</h4>
    <pre data-role="mirror"></pre>
  </div>
  <div class="g2m-card-stack" data-role="card-stack"></div>
  <div class="g2m-actions">
    <button type="button" class="g2m-primary" data-action="known">已掌握</button>
    <button type="button" data-action="review">待复习</button>
    <button type="button" data-action="later">稍后再看</button>
    <button type="button" data-action="retry">撤销误触</button>
  </div>
  <div class="g2m-actions">
    <button type="button" data-action="prev">上一张</button>
    <button type="button" data-action="next">下一张</button>
    <button type="button" data-action="sync">同步标记</button>
    <button type="button" data-action="exit">结束本轮</button>
  </div>
  <div class="g2m-card" data-role="summary" hidden></div>
</section>
<section class="g2m-panel" data-panel="queue">
  <ol class="g2m-queue-list" data-role="queue-list"></ol>
</section>
<section class="g2m-panel" data-panel="settings">
  <div class="g2m-field">
    <label for="g2m-base-url">API base URL</label>
    <input id="g2m-base-url" data-role="base-url" autocomplete="off" spellcheck="false" />
  </div>
  <div class="g2m-field">
    <label for="g2m-token">device token（仅存本机存储，不写日志）</label>
    <input id="g2m-token" data-role="token" type="password" autocomplete="off" spellcheck="false" />
  </div>
  <div class="g2m-actions">
    <button type="button" data-action="save-settings">保存连接设置</button>
    <button type="button" class="g2m-primary" data-action="load-deck">加载卡组</button>
    <button type="button" data-action="toggle-demo">使用演示 fixture：开</button>
    <button type="button" class="g2m-danger" data-action="clear-state">清除本地测试状态</button>
  </div>
  <p><a class="g2m-link" data-role="back-link" href="./">返回 Learn Coach</a></p>
  <div class="g2m-debug" data-role="debug"></div>
</section>
`;

function nowTime(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function defaultApiBaseUrl(): string {
  return window.location.pathname.startsWith("/mindiou/")
    ? `${window.location.origin}/mindiou-api/`
    : "/";
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

export async function bootMindIOUConsole(root: HTMLElement): Promise<void> {
  const params = new URL(window.location.href).searchParams;
  root.innerHTML = SKELETON;

  const el = <T extends HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`MindIOU 控制台缺少元素 ${selector}`);
    return node;
  };

  const statusPill = el<HTMLSpanElement>('[data-role="status-pill"]');
  const demoBanner = el<HTMLDivElement>('[data-role="demo-banner"]');
  const modeNotice = el<HTMLDivElement>('[data-role="mode-notice"]');
  const errorArea = el<HTMLDivElement>('[data-role="error-area"]');
  const mirrorEl = el<HTMLPreElement>('[data-role="mirror"]');
  const cardStackEl = el<HTMLDivElement>('[data-role="card-stack"]');
  const queueListEl = el<HTMLOListElement>('[data-role="queue-list"]');
  const debugEl = el<HTMLDivElement>('[data-role="debug"]');
  const summaryEl = el<HTMLDivElement>('[data-role="summary"]');
  const baseUrlInput = el<HTMLInputElement>('[data-role="base-url"]');
  const tokenInput = el<HTMLInputElement>('[data-role="token"]');
  const backLink = el<HTMLAnchorElement>('[data-role="back-link"]');
  const demoToggleButton = el<HTMLButtonElement>('[data-action="toggle-demo"]');
  const actionButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action]"));

  backLink.href = window.location.pathname || "./";

  const storage = new EvenHubStorageAdapter(null);

  let bridge: EvenAppBridge | null = null;
  let display: EvenHubDisplayAdapter | null = null;
  let inputAdapter: EvenHubInputAdapter | null = null;
  let lifecycle: EvenHubLifecycleAdapter | null = null;
  let glassesReady = false;

  let deckSource: DeckSource = "demo";
  let lastEventDescription = "（无）";
  let lastRenderDescription = "（无）";
  let bridgeDescription = "未连接（手机模式）";
  let lastSummary: SessionSummary | null = null;
  let persistTimer: number | null = null;

  const demoParam = params.get("demo");
  let demoMode = demoParam !== null ? demoParam !== "0" : true;
  // Simulator-visible boot marker; proves this surface (not the legacy one) is active.
  console.info(`[g2m-boot] surface=mindiou demo=${demoMode ? "1" : "0"}`);

  let apiBaseUrl = params.get("api") || (await storage.load(STORAGE_KEY_BASE_URL)) || defaultApiBaseUrl();
  let deviceToken = params.get("token") || (await storage.load(STORAGE_KEY_TOKEN)) || "";
  baseUrlInput.value = apiBaseUrl;
  tokenInput.value = deviceToken;

  function clientOptions(): { baseUrl: string; deviceToken?: string } {
    return deviceToken ? { baseUrl: apiBaseUrl, deviceToken } : { baseUrl: apiBaseUrl };
  }

  function modeMarker(): string {
    if (deckSource === "demo") return "DEMO";
    if (deckSource === "thin") return "薄模式";
    return "";
  }

  function marksFromState(state: QueueState): MarkPayload[] {
    return Object.values(state.progress)
      .filter(entry => entry.mark)
      .map(entry => ({
        cardId: entry.cardId,
        mark: entry.mark!,
        deepestLayer: entry.deepestLayer,
        answerRevealed: entry.answerRevealed
      }));
  }

  async function syncSnapshot(snapshot: string): Promise<void> {
    if (demoMode) {
      // DEMO mode never touches the network; the sync cycle is simulated
      // locally so the status flow stays visible.
      await new Promise(resolve => window.setTimeout(resolve, 250));
      return;
    }
    const state = restoreState(snapshot, []);
    await submitMarks(clientOptions(), marksFromState(state));
  }

  let store = new GlassesCoreStore(createInitialState(demoMode ? DEMO_CARDS : []), { syncFn: syncSnapshot });

  function setStatus(text: string): void {
    statusPill.textContent = text;
  }

  function setError(message: string, attempts: string[] = []): void {
    if (!message) {
      errorArea.hidden = true;
      errorArea.textContent = "";
      return;
    }
    errorArea.hidden = false;
    errorArea.textContent = attempts.length ? `${message}\n${attempts.join("\n")}` : message;
  }

  function setNotice(message: string): void {
    if (!message) {
      modeNotice.hidden = true;
      modeNotice.textContent = "";
      return;
    }
    modeNotice.hidden = false;
    modeNotice.textContent = message;
  }

  function updateDebug(): void {
    debugEl.textContent = [
      `bridge：${bridgeDescription}`,
      `最近事件：${lastEventDescription}`,
      `最近渲染：${lastRenderDescription}`,
      `卡组来源：${deckSource === "demo" ? "DEMO fixture" : deckSource === "thin" ? "后端（薄模式）" : "后端（完整卡组）"}`,
      `队列持久化：localStorage${bridge ? " + SDK" : ""}`
    ].join("\n");
  }

  function renderMirror(state: QueueState): void {
    const frame = buildFrame(state, { modeMarker: modeMarker() });
    mirrorEl.textContent = `${frame.main}\n— — — — — —\n${frame.footer}`;
  }

  function renderCardStack(state: QueueState): void {
    cardStackEl.replaceChildren();
    const card = currentCard(state);
    if (!card) {
      const empty = document.createElement("div");
      empty.className = "g2m-card";
      const text = document.createElement("p");
      text.textContent = demoMode ? "演示卡组为空。" : "尚未加载卡组：请在「连接与调试」中点击「加载卡组」。";
      empty.append(text);
      cardStackEl.append(empty);
      return;
    }
    const layers: Array<{ label: string; text: string }> = [
      { label: "问题层", text: card.title },
      { label: "为何重要层", text: card.whyItMatters },
      { label: "证据层", text: card.evidence },
      { label: "参考答案层", text: card.referenceAnswer }
    ];
    for (const layer of layers) {
      const block = document.createElement("div");
      block.className = "g2m-card";
      const heading = document.createElement("h4");
      heading.textContent = layer.label;
      const text = document.createElement("p");
      text.textContent = layer.text.trim() ? layer.text : "（本层暂无内容）";
      block.append(heading, text);
      cardStackEl.append(block);
    }
  }

  function renderQueueList(state: QueueState): void {
    queueListEl.replaceChildren();
    state.cards.forEach((card, index) => {
      const item = document.createElement("li");
      item.className = "g2m-queue-item";
      if (index === state.currentIndex) item.classList.add("is-current");
      const title = document.createElement("span");
      const progress = state.progress[card.id];
      const flags = progress?.answerRevealed ? "（已看答案）" : "";
      title.textContent = `${index + 1}. ${truncate(card.title, 60)}${flags}`;
      const mark = document.createElement("span");
      mark.className = "g2m-queue-mark";
      mark.textContent = progress?.mark === "known" ? "已掌握" : progress?.mark === "review" ? "待复习" : "未标记";
      item.append(title, mark);
      queueListEl.append(item);
    });
  }

  function renderSummary(summary: SessionSummary): void {
    summaryEl.hidden = false;
    summaryEl.replaceChildren();
    const heading = document.createElement("h4");
    heading.textContent = "本轮小结（仅本次会话证据，不代表持久掌握）";
    const body = document.createElement("p");
    body.textContent =
      `共 ${summary.totalCards} 张卡：已掌握 ${summary.known}，待复习 ${summary.review}，` +
      `未标记 ${summary.unseen}；查看过答案 ${summary.answerRevealedCount} 张。`;
    summaryEl.append(heading, body);
  }

  function updateActionButtons(state: QueueState): void {
    const hasCards = state.cards.length > 0;
    for (const button of actionButtons) {
      const action = button.dataset.action || "";
      if (["known", "review", "later", "retry", "prev", "next"].includes(action)) {
        button.disabled = !hasCards;
      }
    }
  }

  function renderAll(): void {
    const state = store.getState();
    renderMirror(state);
    renderCardStack(state);
    renderQueueList(state);
    updateActionButtons(state);
    demoBanner.hidden = deckSource !== "demo";
    setStatus(demoMode ? "demo" : glassesReady ? "live + g2" : "live");
    updateDebug();
  }

  function renderGlasses(): void {
    if (!display || !display.isReady()) return;
    display.render(store.getState());
    lastRenderDescription = display.getLastError()
      ? `失败：${display.getLastError()}`
      : `${nowTime()} 帧已发送`;
    updateDebug();
  }

  function persistNow(): void {
    void storage.save(STORAGE_KEY_QUEUE, store.toJSON());
  }

  function schedulePersist(): void {
    if (persistTimer !== null) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  function frameKeyOf(state: QueueState): string {
    return buildFrame(state, { modeMarker: modeMarker() }).key;
  }

  function ackFor(action: CoreAction, moved: boolean): string {
    if (!moved) {
      if (action === "RETRY") return "没有可撤销的标记";
      return "已到边界";
    }
    switch (action) {
      case "MARK_KNOWN":
        return "已标记：已掌握";
      case "MARK_REVIEW":
        return "已标记：待复习";
      case "RETRY":
        return "已撤销标记";
      default:
        return "";
    }
  }

  function dispatch(action: CoreAction): void {
    const beforeKey = frameKeyOf(store.getState());
    const result = store.dispatch(action);
    const state = store.getState();
    const moved = frameKeyOf(state) !== beforeKey;
    // Simulator-visible action log; never carries secrets or user data.
    console.info(`[g2m-action] ${action}`);
    lastEventDescription = `${nowTime()} ${action}`;
    schedulePersist();
    renderAll();
    renderGlasses();
    // The ack must render after the state frame: showTransient re-renders the
    // current state, so calling it first would let renderGlasses() overwrite
    // the acknowledgement before it ever reaches the glasses.
    const ack = ackFor(action, moved);
    if (ack && display?.isReady()) display.showTransient(ack);
    if (result.summary) {
      lastSummary = result.summary;
      renderSummary(result.summary);
    } else if (state.finished) {
      const summary = buildSummary(state);
      lastSummary = summary;
      renderSummary(summary);
    }
  }

  function cardIds(cards: DebtCard[]): Set<string> {
    return new Set(cards.map(card => card.id));
  }

  function rebuildStore(cards: DebtCard[], savedSnapshot: string | null): void {
    let initial = createInitialState(cards);
    if (savedSnapshot) {
      const restored = restoreState(savedSnapshot, cards);
      const restoredIds = cardIds(restored.cards);
      const deckIds = cardIds(cards);
      const allKnown = restored.cards.length > 0 && [...restoredIds].every(id => deckIds.has(id));
      if (allKnown) initial = restored;
    }
    store = new GlassesCoreStore(initial, { syncFn: syncSnapshot });
    persistNow();
  }

  async function loadDeck(): Promise<void> {
    if (demoMode) {
      deckSource = "demo";
      setNotice("演示模式：使用 DEMO fixture，不访问网络。");
      setError("");
      rebuildStore(DEMO_CARDS, await storage.load(STORAGE_KEY_QUEUE));
      if (display) await display.rebuild();
      renderAll();
      renderGlasses();
      return;
    }
    setNotice("正在加载卡组…");
    setError("");
    try {
      const result = await getDeck(clientOptions());
      deckSource = result.mode;
      setNotice(result.notice);
      rebuildStore(result.cards, await storage.load(STORAGE_KEY_QUEUE));
      if (display) await display.rebuild();
      renderAll();
      renderGlasses();
    } catch (error) {
      const attempts = error instanceof BackendError ? error.attempts : [];
      setError(error instanceof Error ? error.message : String(error), attempts);
      setNotice("");
      renderAll();
    }
  }

  async function connectBridge(): Promise<void> {
    try {
      const candidate = await Promise.race([
        waitForEvenAppBridge(),
        new Promise<null>(resolve => window.setTimeout(() => resolve(null), BRIDGE_WAIT_MS))
      ]);
      if (!candidate) {
        bridgeDescription = "未连接（手机模式）";
        updateDebug();
        return;
      }
      bridge = candidate;
      storage.setBridge(bridge);
      display = new EvenHubDisplayAdapter(bridge, { modeMarker: modeMarker() });
      const created = await display.init();
      glassesReady = created;
      bridgeDescription = created ? "已连接（G2）" : `异常：${display.getLastError() || "启动页创建失败"}`;

      inputAdapter = new EvenHubInputAdapter(bridge, {
        getLayer: () => store.getState().layer,
        onEvent: description => {
          lastEventDescription = `${nowTime()} ${description}`;
          updateDebug();
        }
      });
      inputAdapter.start(action => dispatch(action));

      lifecycle = new EvenHubLifecycleAdapter(bridge);
      lifecycle.onExit(() => persistNow());
      lifecycle.onForeground(() => {
        void (async () => {
          if (display) await display.rebuild();
          renderGlasses();
        })();
      });

      renderGlasses();
      renderAll();
    } catch (error) {
      bridgeDescription = `异常：${error instanceof Error ? error.message : String(error)}`;
      updateDebug();
    }
  }

  // ── DOM events ──

  for (const tab of root.querySelectorAll<HTMLButtonElement>(".g2m-tab")) {
    tab.addEventListener("click", () => {
      for (const other of root.querySelectorAll<HTMLButtonElement>(".g2m-tab")) {
        other.classList.toggle("is-active", other === tab);
      }
      for (const panel of root.querySelectorAll<HTMLElement>(".g2m-panel")) {
        panel.classList.toggle("is-active", panel.dataset.panel === tab.dataset.tab);
      }
    });
  }

  root.querySelector<HTMLButtonElement>('[data-action="known"]')!.addEventListener("click", () => dispatch("MARK_KNOWN"));
  root.querySelector<HTMLButtonElement>('[data-action="review"]')!.addEventListener("click", () => dispatch("MARK_REVIEW"));
  root.querySelector<HTMLButtonElement>('[data-action="later"]')!.addEventListener("click", () => dispatch("NEXT_CARD"));
  root.querySelector<HTMLButtonElement>('[data-action="retry"]')!.addEventListener("click", () => dispatch("RETRY"));
  root.querySelector<HTMLButtonElement>('[data-action="prev"]')!.addEventListener("click", () => dispatch("PREVIOUS_CARD"));
  root.querySelector<HTMLButtonElement>('[data-action="next"]')!.addEventListener("click", () => dispatch("NEXT_CARD"));
  root.querySelector<HTMLButtonElement>('[data-action="sync"]')!.addEventListener("click", () => {
    dispatch("SYNC");
    void store.sync().then(() => {
      schedulePersist();
      renderAll();
      renderGlasses();
    });
  });
  root.querySelector<HTMLButtonElement>('[data-action="exit"]')!.addEventListener("click", () => dispatch("EXIT"));
  root.querySelector<HTMLButtonElement>('[data-action="load-deck"]')!.addEventListener("click", () => void loadDeck());
  root.querySelector<HTMLButtonElement>('[data-action="save-settings"]')!.addEventListener("click", () => {
    apiBaseUrl = baseUrlInput.value.trim() || defaultApiBaseUrl();
    deviceToken = tokenInput.value.trim();
    void storage.save(STORAGE_KEY_BASE_URL, apiBaseUrl);
    void storage.save(STORAGE_KEY_TOKEN, deviceToken);
    setNotice("连接设置已保存（token 仅存本机存储）。");
    renderAll();
  });
  demoToggleButton.addEventListener("click", () => {
    demoMode = !demoMode;
    demoToggleButton.textContent = `使用演示 fixture：${demoMode ? "开" : "关"}`;
    summaryEl.hidden = true;
    lastSummary = null;
    void loadDeck();
  });
  root.querySelector<HTMLButtonElement>('[data-action="clear-state"]')!.addEventListener("click", () => {
    void storage.save(STORAGE_KEY_QUEUE, "");
    try {
      window.localStorage.removeItem(STORAGE_KEY_QUEUE);
    } catch {
      // Storage unavailable; the empty overwrite above already resets state.
    }
    rebuildStore(demoMode ? DEMO_CARDS : [], null);
    summaryEl.hidden = true;
    lastSummary = null;
    setNotice("本地测试状态已清除。");
    if (display) void display.rebuild();
    renderAll();
    renderGlasses();
  });

  window.addEventListener("pagehide", persistNow);

  // ── Boot ──

  demoToggleButton.textContent = `使用演示 fixture：${demoMode ? "开" : "关"}`;
  // Test/development affordance: ?fresh=1 clears the persisted queue so
  // headless simulator verification runs are hermetic and repeatable.
  if (params.get("fresh") === "1") {
    await storage.save(STORAGE_KEY_QUEUE, "");
  }
  const savedSnapshot = (await storage.load(STORAGE_KEY_QUEUE)) || null;
  if (demoMode) {
    deckSource = "demo";
    rebuildStore(DEMO_CARDS, savedSnapshot);
    setNotice("演示模式：使用 DEMO fixture，不访问网络。");
  } else {
    const restored = restoreState(savedSnapshot, []);
    store = new GlassesCoreStore(restored, { syncFn: syncSnapshot });
    deckSource = restored.cards.length ? "thin" : "demo";
    if (restored.cards.length) setNotice("已恢复上次会话；点击「加载卡组」刷新卡组。");
  }
  renderAll();
  void connectBridge();
  void lastSummary;
  void lifecycle;
}
