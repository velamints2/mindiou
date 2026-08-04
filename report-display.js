function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function titleFromArtifact(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(line => clean(line
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*(user|assistant|system|用户|助手|ai)\s*[:：]\s*/i, "")))
    .filter(line => line.length >= 6);
  const candidate = lines.find(line => !/^(好的|可以|确认|继续|谢谢|ok|sure|thanks)[。.!！]?$/i.test(line)) || lines[0] || "";
  return truncate(candidate.split(/(?<=[。！？!?])\s+/)[0] || candidate, 72);
}

const KIND_LABELS = {
  "zh-CN": {
    ai_workflow_transcript: "AI 协作记录", ai_chat: "AI 对话", ai_coding_log: "AI 编程记录",
    ai_generated_document: "AI 生成文档", meeting_notes: "会议记录", unknown: "认知债务分析"
  },
  en: {
    ai_workflow_transcript: "AI workflow", ai_chat: "AI conversation", ai_coding_log: "AI coding session",
    ai_generated_document: "AI-generated document", meeting_notes: "Meeting notes", unknown: "Cognitive debt analysis"
  }
};

export function deriveReportDisplay(report) {
  const locale = report?.locale === "en" ? "en" : "zh-CN";
  const kind = clean(report?.analysis?.artifactKind || "unknown");
  const explicitTitle = clean(report?.display?.title || report?.analysis?.artifactTitle);
  const title = truncate(explicitTitle || titleFromArtifact(report?.input?.artifactText) || KIND_LABELS[locale][kind] || KIND_LABELS[locale].unknown, 72);
  const rawDomain = clean(report?.display?.domain || report?.analysis?.userCapability?.currentDomain);
  const domain = !rawDomain || /^(unknown|未知|未识别)$/i.test(rawDomain)
    ? (KIND_LABELS[locale][kind] || KIND_LABELS[locale].unknown)
    : truncate(rawDomain, 60);
  return { title, domain };
}

export function sessionLastActivityAt(session) {
  const attempts = Array.isArray(session?.attempts) ? session.attempts : [];
  return clean(session?.updatedAt || session?.endedAt || attempts.at(-1)?.createdAt || session?.createdAt);
}
