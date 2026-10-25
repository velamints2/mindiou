export type VoiceAction = "repeat" | "ask" | "next" | "known" | "focus" | "projects" | "learn" | "debts" | "quiz" | "record";
export type TranscriptIgnoreReason = "empty" | "duplicate";

export type TranscriptIntakeResult =
  | { accepted: true; text: string; normalized: string }
  | { accepted: false; text: string; normalized: string; reason: TranscriptIgnoreReason };

const chinesePrefixes = ["请帮我", "麻烦你", "请你", "帮我", "麻烦", "可以", "请"];
const englishPrefixes = ["please ", "can you ", "could you ", "ok ", "okay "];

const chineseCommands: Record<VoiceAction, string[]> = {
  next: ["下一个", "下一张", "下一張", "下一章", "下一项", "下一题", "跳过", "略过", "过"],
  known: ["会了", "我会了", "记住了", "懂了", "明白了"],
  ask: ["提问", "问我", "考我", "考我一下", "问一个", "问一下"],
  repeat: ["跟读", "再读", "重复", "再来一次", "再说一遍", "重来"],
  focus: ["继续这个", "继续推进", "就做这个", "推进这个"],
  projects: ["看项目", "项目", "项目进度", "查项目"],
  learn: ["去学习", "学习模式", "背单词", "回到学习"],
  debts: ["看欠条", "欠条", "认知欠条", "我的欠条"],
  quiz: ["考我", "考我一下", "出题", "问我"],
  record: ["记录", "记录证据", "提交", "记下来"]
};

const englishCommands: Record<VoiceAction, string[]> = {
  next: ["next", "next one", "next card", "skip", "skip this"],
  known: ["known", "done", "got it", "i got it", "understood"],
  ask: ["ask", "quiz", "quiz me", "ask me", "question"],
  repeat: ["repeat", "again", "say again", "read again", "one more time"],
  focus: ["continue this", "focus this", "work on this"],
  projects: ["projects", "show projects", "project status"],
  learn: ["learn mode", "back to learning", "study"],
  debts: ["debts", "show debts", "my debts", "cognitive debts"],
  quiz: ["quiz me on this", "test me", "check me"],
  record: ["record", "save evidence", "log it", "submit"]
};

function normalizeVoiceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[，。！？、；：,.!?;:()[\]{}"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripChinesePrefix(text: string): string {
  let result = text;
  for (const prefix of chinesePrefixes) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break;
    }
  }
  return result;
}

function stripEnglishPrefix(text: string): string {
  let result = text;
  for (const prefix of englishPrefixes) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break;
    }
  }
  return result.trim();
}

function isShortCommandCandidate(normalized: string): boolean {
  if (!normalized) return false;
  const compact = normalized.replace(/\s+/g, "");
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasChinese = /[\u3400-\u9fff]/.test(normalized);
  return hasChinese ? compact.length <= 10 : wordCount <= 4;
}

export function parseVoiceAction(text: string): VoiceAction | null {
  const normalized = normalizeVoiceText(text);
  if (!isShortCommandCandidate(normalized)) return null;

  const compactChinese = stripChinesePrefix(normalized.replace(/\s+/g, ""));
  const english = stripEnglishPrefix(normalized);

  for (const action of Object.keys(chineseCommands) as VoiceAction[]) {
    if (chineseCommands[action].includes(compactChinese)) return action;
    if (englishCommands[action].includes(english)) return action;
  }

  return null;
}

export function voiceActionForContext(
  text: string,
  options: { answerExpected?: boolean; audioDurationMs?: number } = {}
): VoiceAction | null {
  if (options.answerExpected) return null;
  if ((options.audioDurationMs || 0) > 3500) return null;
  return parseVoiceAction(text);
}

export class TranscriptIntake {
  private lastNormalized = "";
  private lastAcceptedAt = 0;

  constructor(private readonly duplicateWindowMs = 3500) {}

  accept(text: string, now = Date.now()): TranscriptIntakeResult {
    const normalized = normalizeVoiceText(text);
    if (!normalized) return { accepted: false, text, normalized, reason: "empty" };

    const isDuplicate = normalized === this.lastNormalized && now - this.lastAcceptedAt < this.duplicateWindowMs;
    if (isDuplicate) return { accepted: false, text, normalized, reason: "duplicate" };

    this.lastNormalized = normalized;
    this.lastAcceptedAt = now;
    return { accepted: true, text, normalized };
  }

  reset(): void {
    this.lastNormalized = "";
    this.lastAcceptedAt = 0;
  }
}
