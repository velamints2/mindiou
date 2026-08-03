/**
 * MVP-0 collaboration timeline generator (step 1 of the report pipeline).
 *
 * Washes a raw AI-collaboration conversation into 3-10 natural steps that
 * actually moved work forward. When AI is unavailable or fails, falls back
 * to a deterministic structural timeline that is visibly labeled via
 * generation.fallback=true, so the demo path keeps working.
 *
 * Each step carries a userConfusion field (default "") that is filled by the
 * USER later on the timeline page — never by the AI.
 *
 * No UI. No server endpoints. No persistence.
 */

const MAX_TEXT = 30000;
const MIN_STEPS = 3;
const MAX_STEPS = 10;
const MAX_ACTIONS = 6;
const MAX_CONCEPTS = 3;

const VALID_ARTIFACT_TYPES = [
  "chatgpt", "claude", "cursor", "codex", "hackathon", "meeting", "article", "other"
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max) : text;
}

function textArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => truncate(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

const timelineSystemPrompt = [
  "你是 MindIOU 的协作时间线整理器。",
  "",
  "你的任务不是总结内容，而是把一段原始的 AI 协作对话清洗成 3-10 个真正推动工作前进的自然步骤。",
  "跳过寒暄、重复确认、与推进工作无关的闲聊。",
  "每个步骤必须基于原文中真实发生的行为，不得编造命令、修改或概念。",
  "title 用一句话说明这一步在做什么；aiDid 写 AI 的具体分析、修改、解释或操作；",
  "keyActions 列出真实出现的命令、配置、代码改动或排查动作（没有就留空数组）；",
  "keyConcepts 只保留真正影响用户理解的 1-3 个概念，不要堆砌术语。",
  "不要复述完整对话；只保留真正推动工作前进的内容。",
  "用户载荷含 outputLanguage 时，title、aiDid、keyActions、keyConcepts 和 note 必须使用该语言；原始引用保留原文。",
  "",
  "只返回合法 JSON，不要 Markdown、解释或额外文字：",
  '{"steps":[{"title":"一句话说明这一步在做什么","aiDid":"AI 的具体分析、修改、解释或操作","keyActions":["命令/配置/代码改动/排查动作"],"keyConcepts":["真正影响理解的 1-3 个概念"]}]}',
  "",
  "如果输入不是 AI 协作材料（例如百科词条、随机文本、与 AI 协作无关的笔记），返回 {\"steps\":[], \"note\":\"原因\"}。"
].join("\n");

function normalizeStep(rawStep, idx) {
  const id = `step-${idx + 1}`;
  if (typeof rawStep !== "object" || rawStep === null) {
    return {
      id,
      title: truncate(String(rawStep), 120) || `步骤 ${idx + 1}`,
      aiDid: "",
      keyActions: [],
      keyConcepts: [],
      userConfusion: ""
    };
  }
  return {
    id,
    title: truncate(rawStep.title, 120) || `步骤 ${idx + 1}`,
    aiDid: truncate(rawStep.aiDid, 400),
    keyActions: textArray(rawStep.keyActions, MAX_ACTIONS, 200),
    keyConcepts: textArray(rawStep.keyConcepts, MAX_CONCEPTS, 80),
    userConfusion: truncate(rawStep.userConfusion, 1000)
  };
}

/**
 * Normalize any timeline-like input into a schema-valid timeline.
 * Accepts { steps } or a raw steps array. Assigns stable ids (step-1..N),
 * clamps arrays, caps at MAX_STEPS steps, defaults userConfusion to "".
 *
 * @param {unknown} raw - Raw timeline object or steps array
 * @returns {{steps: Array<{id:string,title:string,aiDid:string,keyActions:string[],keyConcepts:string[],userConfusion:string}>}}
 */
export function normalizeTimeline(raw) {
  const rawSteps = Array.isArray(raw) ? raw : (Array.isArray(raw?.steps) ? raw.steps : []);
  return {
    steps: rawSteps.slice(0, MAX_STEPS).map((step, idx) => normalizeStep(step, idx))
  };
}

function splitIntoSentences(text) {
  const trimmed = clean(text);
  if (!trimmed) return [];
  const rough = trimmed.split(/(?<=[.!?。！？;；\n])\s+/);
  return rough.map(s => clean(s)).filter(s => s.length > 10);
}

/**
 * Deterministic structural fallback timeline built from text chunking.
 * Same input always produces the same steps. Visibly degraded: titles are
 * labeled as structural splits, not AI analysis. Used when AI is unavailable;
 * callers must label it via generation.fallback=true.
 */
export function generateFallbackTimeline(artifactText, locale = "zh-CN") {
  const text = truncate(artifactText, MAX_TEXT);
  const english = locale === "en";
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return normalizeTimeline([{
      title: english ? "Material excerpt 1 (structural split, not AI analysis)" : "材料片段 1（结构性拆分，非 AI 分析）",
      aiDid: truncate(text, 300) || (english ? "The material is too short or empty to split into collaboration steps." : "材料过短或为空，无法拆分协作步骤。")
    }]);
  }
  const stepCount = Math.min(Math.max(Math.ceil(sentences.length / 4), MIN_STEPS), 5);
  const chunkSize = Math.ceil(sentences.length / stepCount);
  const steps = [];
  for (let i = 0; i < stepCount; i++) {
    const chunk = sentences.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
    if (!chunk) continue;
    steps.push({
      title: english
        ? `Material excerpt ${steps.length + 1} (structural split, not AI analysis)`
        : `材料片段 ${steps.length + 1}（结构性拆分，非 AI 分析）`,
      aiDid: truncate(chunk, 300)
    });
  }
  return normalizeTimeline(steps);
}

/**
 * Generate a collaboration timeline using AI, with labeled fallback on failure.
 *
 * @param {string} artifactText - Raw input text from the user
 * @param {string} artifactType - Type of artifact (chatgpt, claude, etc.)
 * @param {function|null} chatFn - Injected chatJson(messages, fallbackFn). null = fallback only.
 * @returns {Promise<{steps:Array, note?:string, generation:{fallback:boolean, error:string}}>}
 */
export async function generateCollaborationTimeline(artifactText, artifactType, chatFn, options = {}) {
  const text = truncate(artifactText, MAX_TEXT);
  const type = VALID_ARTIFACT_TYPES.includes(artifactType) ? artifactType : "other";

  function fallbackResult(error) {
    return {
      ...generateFallbackTimeline(text, options.locale),
      generation: { fallback: true, error: truncate(error, 300) }
    };
  }

  if (!chatFn) {
    return fallbackResult("AI is not configured");
  }

  try {
    const messages = [
      { role: "system", content: timelineSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          artifactText: text,
          artifactType: type,
          outputLanguage: options.locale === "en" ? "English" : "Chinese",
          charCount: clean(text).length
        })
      }
    ];
    const fallbackMarker = () => ({ __useFallback: true });
    const result = await chatFn(messages, fallbackMarker);

    if (result.__fallback || result.__useFallback) {
      return fallbackResult(result.__fallbackError || "AI generation was unavailable");
    }

    if (result && Array.isArray(result.steps)) {
      const note = truncate(result.note, 300);
      return {
        ...normalizeTimeline(result.steps),
        ...(note ? { note } : {}),
        generation: { fallback: false, error: "" }
      };
    }

    return fallbackResult("AI returned malformed timeline output");
  } catch (error) {
    return fallbackResult(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Get the system prompt used for timeline generation. Exported for testing.
 */
export function getTimelineSystemPrompt() {
  return timelineSystemPrompt;
}
