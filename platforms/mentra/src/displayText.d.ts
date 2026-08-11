/**
 * 单色 640×200、约 5 行文本屏的显示文本助手。
 * 约束来源：Mentra 硬件能力档案（maxTextLines: 5），无原生滚动，
 * 因此长内容必须显式分页，每次显示整屏替换。
 */
/** 问题区（大字号）单屏最大字符数。 */
export declare const QUESTION_MAX = 48;
/** 反馈/教学区（小字号）单页最大字符数。 */
export declare const FEEDBACK_PAGE_MAX = 92;
/** 标题区最大字符数。 */
export declare const TITLE_MAX = 18;
/** 截断到 maxLength，优先落在完整句子边界。 */
export declare function concise(value: string, maxLength?: number): string;
/** 把长文本按句子边界切成不超过 perPage 字符的页。 */
export declare function paginate(value: string, perPage?: number): string[];
/** 谨慎状态标签；未知状态保守显示「继续解释」。 */
export declare function statusLabel(status: string): string;
