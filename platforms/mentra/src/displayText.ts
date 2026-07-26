/**
 * 单色 640×200、约 5 行文本屏的显示文本助手。
 * 约束来源：Mentra 硬件能力档案（maxTextLines: 5），无原生滚动，
 * 因此长内容必须显式分页，每次显示整屏替换。
 */

/** 问题区（大字号）单屏最大字符数。 */
export const QUESTION_MAX = 48;
/** 反馈/教学区（小字号）单页最大字符数。 */
export const FEEDBACK_PAGE_MAX = 92;
/** 标题区最大字符数。 */
export const TITLE_MAX = 18;

const SENTENCE_ENDINGS = ["。", "！", "？", "；", ".", "!", "?", ";", "\n"];

/** 截断到 maxLength，优先落在完整句子边界。 */
export function concise(value: string, maxLength = QUESTION_MAX): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;

  let boundary = 0;
  Array.from(text).forEach((char, index) => {
    if (SENTENCE_ENDINGS.includes(char) && index + 1 <= maxLength) boundary = index + 1;
  });
  if (boundary >= Math.min(8, maxLength)) return text.slice(0, boundary).trim();

  const candidate = text.slice(0, maxLength - 1).trim();
  const wordBoundary = candidate.lastIndexOf(" ");
  const safe = wordBoundary >= Math.floor(maxLength * 0.6)
    ? candidate.slice(0, wordBoundary)
    : candidate;
  return `${safe.trim()}…`;
}

/** 把长文本按句子边界切成不超过 perPage 字符的页。 */
export function paginate(value: string, perPage = FEEDBACK_PAGE_MAX): string[] {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.length <= perPage) return [text];

  const pages: string[] = [];
  let rest = text;
  while (rest.length > perPage) {
    const window = rest.slice(0, perPage);
    let cut = -1;
    for (const ending of SENTENCE_ENDINGS) {
      const idx = window.lastIndexOf(ending);
      if (idx > cut) cut = idx;
    }
    // 句子边界太靠前就硬切，避免产生过短碎片页。
    const splitAt = cut >= Math.floor(perPage * 0.5) ? cut + 1 : perPage;
    pages.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) pages.push(rest);
  return pages.filter(Boolean);
}

const STATUS_LABELS: Record<string, string> = {
  provisionally_cleared: "暂时清偿",
  needs_practice: "继续练习",
  needs_verification: "需要查证",
  no_valid_attempt: "尚未作答",
  invalid_attempt: "本次无效"
};

/** 谨慎状态标签；未知状态保守显示「继续解释」。 */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || "继续解释";
}
