import type { LearningSessionEvent } from "./session";

export type TutorKind = "ask" | "repeat" | "known" | "answer";
export type TutorAssessment = "correct" | "partial" | "incorrect" | "unknown";

export type TutorCard = {
  front: string;
  back: string;
  prompt: string;
};

export type TutorResponse = {
  ok: boolean;
  action?: TutorKind;
  assessment?: TutorAssessment;
  message?: string;
  missingPoints?: string[];
  nextQuestion?: string;
  summary?: string;
  g2Text?: string;
  shouldFollowUp?: boolean;
  error?: string;
};

const assessmentLabels: Record<TutorAssessment, string> = {
  correct: "理解到位",
  partial: "部分理解",
  incorrect: "需要重讲",
  unknown: "继续解释"
};

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fit(text: string, max: number): string {
  const trimmed = clean(text);
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function localTutorResponse(kind: TutorKind, card: TutorCard, transcript = ""): TutorResponse {
  if (kind === "repeat") {
    return {
      ok: true,
      action: kind,
      assessment: "unknown",
      message: `再听一遍：${card.front}。先说核心意思，再补一个例子。`,
      nextQuestion: `用自己的话解释 ${card.front}，不要照读。`,
      g2Text: `Explain ${fit(card.front, 24)}`
    };
  }

  if (kind === "known") {
    return {
      ok: true,
      action: kind,
      assessment: "correct",
      message: `已标记会了。下一次复习前，记住它和一个真实例子的连接。`,
      summary: `${card.front}: ${card.back}`,
      g2Text: "Marked known"
    };
  }

  if (kind === "answer") {
    if (!transcript) {
      return {
        ok: true,
        action: kind,
        assessment: "incorrect",
        message: "还没有收到你的解释。先用一句自己的话说核心意思。",
        missingPoints: ["需要主动解释，而不是只看答案"],
        nextQuestion: `如果讲给朋友听，${card.front} 是什么意思？`,
        g2Text: "Try explaining"
      };
    }

    return {
      ok: true,
      action: kind,
      assessment: "partial",
      message: `收到你的回答：“${fit(transcript, 32)}”。先保留这个理解，再补一个具体例子。`,
      missingPoints: ["还需要把概念和真实情境连接起来"],
      nextQuestion: `请举一个生活或工作里的 ${card.front} 例子。`,
      g2Text: "Add one example"
    };
  }

  return {
    ok: true,
    action: kind,
    assessment: "unknown",
    message: `小测：${card.front} 的核心意思是什么？`,
    nextQuestion: `请用简单语言解释 ${card.front}。`,
    g2Text: `Explain ${fit(card.front, 24)}`
  };
}

export function tutorPhoneText(response: TutorResponse, fallback: TutorResponse): string {
  const source = response.ok ? response : fallback;
  const lines = [];
  const assessment = source.assessment || "unknown";

  if (source.message) lines.push(source.message);
  if (assessment !== "unknown") lines.push(`理解度：${assessmentLabels[assessment]}`);
  if (source.missingPoints?.length) lines.push(`可补充：${source.missingPoints.slice(0, 3).join("；")}`);
  if (source.nextQuestion) lines.push(`追问：${source.nextQuestion}`);
  if (source.summary) lines.push(`总结：${source.summary}`);

  return lines.join("\n") || fallback.message || "继续用自己的话解释。";
}

export function tutorGlassesText(response: TutorResponse, fallback: TutorResponse): string {
  const source = response.ok ? response : fallback;
  return fit(
    source.g2Text || source.nextQuestion || source.summary || source.message || fallback.g2Text || "Explain aloud",
    42
  );
}

export function tutorStateEvents(kind: TutorKind, response: TutorResponse): LearningSessionEvent[] {
  if (kind !== "answer") return [];

  const events: LearningSessionEvent[] = ["FEEDBACK_READY"];
  if (response.nextQuestion && response.shouldFollowUp !== false) {
    events.push("FOLLOW_UP");
  } else if (response.summary) {
    events.push("SUMMARIZE");
  }
  return events;
}
