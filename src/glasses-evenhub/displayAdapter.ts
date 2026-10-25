/**
 * Even Hub display adapter for the MindIOU glasses surface.
 *
 * Renders the current card's current layer into two fixed text containers on
 * the 576x288 monochrome viewport: a large main area (one layer at a time) and
 * a footer (progress, layer, sync mark, control hints). No scrolling, no
 * content-driven growth; long text is truncated by character count (CJK
 * friendly). Old large text is cleared before a different card is shown.
 */
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge
} from "@evenrealities/even_hub_sdk";
import type { GlassesDisplayAdapter } from "../glasses-core/adapters";
import { currentCard } from "../glasses-core/store";
import type { CardLayer, QueueState } from "../glasses-core/types";

const MAIN_CONTAINER_ID = 1;
const FOOTER_CONTAINER_ID = 2;
const MAIN_CONTAINER_NAME = "g2m-main";
const FOOTER_CONTAINER_NAME = "g2m-footer";

/** Per-layer text budgets: chars per line x max lines (CJK counts per char). */
const LAYER_TEXT_BUDGET: Record<CardLayer, { perLine: number; maxLines: number }> = {
  question: { perLine: 14, maxLines: 5 },
  why: { perLine: 18, maxLines: 6 },
  evidence: { perLine: 18, maxLines: 6 },
  answer: { perLine: 18, maxLines: 6 }
};

const LAYER_LABEL: Record<CardLayer, string> = {
  question: "问题",
  why: "为何重要",
  evidence: "证据",
  answer: "参考答案"
};

const LAYER_HINT: Record<CardLayer, string> = {
  question: "点按提示 双击待复习",
  why: "点按证据 双击返回",
  evidence: "点按答案 双击返回",
  answer: "下滑下一卡 双击返回"
};

export interface FrameOptions {
  /** Short mode marker appended to the footer, e.g. "DEMO" or "薄模式". */
  modeMarker?: string;
  /** One-shot acknowledgement shown in the footer instead of progress. */
  transient?: string;
}

export interface GlassesFrame {
  cardId: string;
  main: string;
  footer: string;
  key: string;
}

function fit(text: string, maxChars: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > maxChars ? `${chars.slice(0, Math.max(1, maxChars - 1)).join("")}…` : chars.join("");
}

/** Wrap text into a fixed number of lines, truncating overflow with an ellipsis. */
export function wrapGlassesText(text: string, perLine: number, maxLines: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (!chars.length) return "";
  const lines: string[] = [];
  for (let index = 0; index < chars.length && lines.length < maxLines; index += perLine) {
    lines.push(chars.slice(index, index + perLine).join(""));
  }
  if (chars.length > perLine * maxLines) {
    lines[maxLines - 1] = `${Array.from(lines[maxLines - 1]).slice(0, Math.max(1, perLine - 1)).join("")}…`;
  }
  return lines.join("\n");
}

function layerText(state: QueueState): string {
  const card = currentCard(state);
  if (!card) return "";
  const text =
    state.layer === "question"
      ? card.title
      : state.layer === "why"
        ? card.whyItMatters
        : state.layer === "evidence"
          ? card.evidence
          : card.referenceAnswer;
  return text.trim() ? text : "（本层暂无内容）";
}

function syncMark(state: QueueState): string {
  if (state.syncStatus === "syncing") return " · 同步中";
  if (state.syncStatus === "synced") return " · 已同步";
  if (state.syncStatus === "error") return " · 同步失败";
  return "";
}

/** Build the exact viewport text for a queue state. Pure; shared with the phone mirror. */
export function buildFrame(state: QueueState, options: FrameOptions = {}): GlassesFrame {
  const card = currentCard(state);
  const cardId = card?.id || "";
  const budget = LAYER_TEXT_BUDGET[state.layer];
  const main = card ? wrapGlassesText(layerText(state), budget.perLine, budget.maxLines) : "未加载卡组";

  let footerLine1: string;
  let footerLine2: string;
  if (options.transient) {
    footerLine1 = fit(options.transient, 24);
    footerLine2 = LAYER_HINT[state.layer];
  } else if (state.finished) {
    const marks = Object.values(state.progress);
    const known = marks.filter(entry => entry.mark === "known").length;
    const review = marks.filter(entry => entry.mark === "review").length;
    footerLine1 = fit(`本轮完成 已掌握${known} 待复习${review}`, 24);
    footerLine2 = "手机端查看小结";
  } else {
    const progress = state.cards.length ? `${state.currentIndex + 1}/${state.cards.length}` : "0/0";
    const marker = options.modeMarker ? ` · ${options.modeMarker}` : "";
    footerLine1 = fit(`${progress} ${LAYER_LABEL[state.layer]}${marker}${syncMark(state)}`, 28);
    footerLine2 = LAYER_HINT[state.layer];
  }
  const footer = `${footerLine1}\n${footerLine2}`;
  return { cardId, main, footer, key: `${cardId}${main}${footer}` };
}

function mainContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    containerID: MAIN_CONTAINER_ID,
    containerName: MAIN_CONTAINER_NAME,
    content,
    xPosition: 16,
    yPosition: 12,
    width: 544,
    height: 160,
    paddingLength: 4,
    isEventCapture: 1
  });
}

function footerContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    containerID: FOOTER_CONTAINER_ID,
    containerName: FOOTER_CONTAINER_NAME,
    content,
    xPosition: 16,
    yPosition: 184,
    width: 544,
    height: 92,
    paddingLength: 4,
    isEventCapture: 0
  });
}

export class EvenHubDisplayAdapter implements GlassesDisplayAdapter {
  private ready = false;
  private lastState: QueueState | null = null;
  private transient = "";
  private pending: GlassesFrame | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastWrittenKey = "";
  private lastWrittenMain = "";
  private lastWrittenFooter = "";
  private lastCardId = "";
  private lastError = "";

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly options: { modeMarker?: string } = {}
  ) {}

  /** Create the two fixed containers. Must succeed before render() writes. */
  async init(): Promise<boolean> {
    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 2,
        textObject: [mainContainer(""), footerContainer("")]
      })
    );
    this.ready = result === StartUpPageCreateResult.success;
    if (!this.ready) this.lastError = `启动页创建失败：${String(result)}`;
    return this.ready;
  }

  isReady(): boolean {
    return this.ready;
  }

  getLastError(): string {
    return this.lastError;
  }

  /** Recreate containers after the host drops them (e.g. foreground re-enter). */
  async rebuild(): Promise<boolean> {
    if (!this.ready) return false;
    this.lastWrittenKey = "";
    this.lastWrittenMain = "";
    this.lastWrittenFooter = "";
    this.lastCardId = "";
    try {
      return await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [mainContainer(""), footerContainer("")]
        })
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  render(state: QueueState): void {
    this.lastState = state;
    this.pending = buildFrame(state, { modeMarker: this.options.modeMarker, transient: this.transient });
    this.transient = "";
    void this.drain();
  }

  showTransient(message: string): void {
    this.transient = message;
    if (this.lastState) this.render(this.lastState);
  }

  clear(): void {
    this.pending = { cardId: "", main: "", footer: "", key: "clear" };
    void this.drain();
  }

  /**
   * Serialize container writes. Every render updates `pending`; a queued write
   * picks up only the latest frame, so burst input coalesces onto the final
   * frame and stale frames are skipped.
   */
  private drain(): Promise<void> {
    const job = this.writeQueue.then(async () => {
      const frame = this.pending;
      this.pending = null;
      if (!frame || !this.ready) return;
      if (frame.key === this.lastWrittenKey) return;
      try {
        if (frame.cardId !== this.lastCardId && frame.main !== this.lastWrittenMain) {
          // Clear the old large text before moving to another card.
          await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: MAIN_CONTAINER_ID,
              containerName: MAIN_CONTAINER_NAME,
              content: ""
            })
          );
        }
        if (frame.main !== this.lastWrittenMain) {
          await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: MAIN_CONTAINER_ID,
              containerName: MAIN_CONTAINER_NAME,
              content: frame.main
            })
          );
          this.lastWrittenMain = frame.main;
        }
        if (frame.footer !== this.lastWrittenFooter) {
          await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: FOOTER_CONTAINER_ID,
              containerName: FOOTER_CONTAINER_NAME,
              content: frame.footer
            })
          );
          this.lastWrittenFooter = frame.footer;
        }
        this.lastWrittenKey = frame.key;
        this.lastCardId = frame.cardId;
        this.lastError = "";
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    });
    this.writeQueue = job.catch(() => undefined);
    return job;
  }
}
