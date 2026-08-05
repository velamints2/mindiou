/**
 * 把 clearanceFlow 的中立 ScreenSpec 映射为 Stamp 协议消息。
 * 纯函数，无网络/状态依赖，便于单测。
 *
 * 复用 mentra 的 ScreenSpec 类型与 displayText 分页常量，不重写业务逻辑。
 */
import type { ScreenSpec } from "../../../mentra/src/clearanceFlow.js";
import { FEEDBACK_PAGE_MAX, TITLE_MAX, concise, paginate, statusLabel } from "../../../mentra/src/displayText.js";
import {
  newMessageId,
  type CardType,
  type DisplayCardMessage,
  type DisplayTextMessage,
  type ServerMessage
} from "./protocol.js";

/** 把 ScreenSpec 的 layout 映射为卡片类型。 */
function cardTypeFor(screen: ScreenSpec): CardType {
  const title = String(screen.title || "");
  if (title.startsWith("追问") || title.includes("欠条") || title.startsWith("问题")) return "question";
  if (title.startsWith("结算") || title.includes("参考答案")) return "reference";
  if (title.startsWith("反馈")) return "feedback";
  return "status";
}

/**
 * ScreenSpec → display_card 消息。
 * referenceCard / textWall 统一走卡片；doubleTextWall 拆成 title/body。
 */
export function screenToCard(screen: ScreenSpec, messageId: string = newMessageId()): DisplayCardMessage {
  const title = concise(String(screen.title || ""), TITLE_MAX);
  let body = "";
  if (screen.layout === "doubleTextWall") {
    body = [screen.top, screen.bottom].map(s => String(s || "").trim()).filter(Boolean).join("\n");
  } else {
    body = String(screen.text || "");
  }
  const cardType = screen.layout === "textWall" && !title ? "status" : cardTypeFor(screen);
  return {
    type: "display_card",
    messageId,
    cardType,
    title,
    body: concise(body, FEEDBACK_PAGE_MAX),
    footer: ""
  };
}

/**
 * 长文本 → 一组 display_text 分页消息。
 * 返回数组，每项含正确的 page / pageCount。
 */
export function textToPages(title: string, text: string, messageIds?: string[]): DisplayTextMessage[] {
  const pages = paginate(text, FEEDBACK_PAGE_MAX);
  const total = pages.length || 1;
  const safePages = total ? pages : [""];
  return safePages.map((pageText, index) => ({
    type: "display_text",
    messageId: messageIds?.[index] || newMessageId(),
    title: concise(title, TITLE_MAX),
    text: pageText,
    page: index + 1,
    pageCount: safePages.length
  }));
}

/** ScreenSpec → 一条或多条 Stamp 消息。 */
export function screenToMessages(screen: ScreenSpec): ServerMessage[] {
  return [screenToCard(screen)];
}

export { statusLabel };
