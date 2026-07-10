/**
 * MVP-0 artifact preprocessing.
 *
 * Large Codex/Trae rollout JSONL files contain system prompts, tool schemas,
 * reasoning blobs, event telemetry, and long chronological output. Sequential
 * truncation loses the final engineering outcome, so rollout logs are converted
 * into a balanced evidence digest before the 30k prompt budget is applied.
 */

const DEFAULT_MAX_TEXT = 30000;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max) : text;
}

function compactJson(value, max) {
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return truncate(value, max);
  }
}

function parseJsonl(text) {
  const lines = String(text || "").split(/\r?\n/).filter(line => line.trim());
  const parsed = [];
  let failures = 0;
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") {
        parsed.push(item);
      } else {
        failures += 1;
      }
    } catch {
      failures += 1;
    }
  }
  return { lines, parsed, failures };
}

function looksLikeRolloutJsonl(parsed) {
  if (parsed.length < 5) return false;
  const typeCounts = new Map();
  for (const entry of parsed) {
    typeCounts.set(entry.type, (typeCounts.get(entry.type) || 0) + 1);
  }
  return (
    typeCounts.has("session_meta") ||
    typeCounts.has("turn_context") ||
    typeCounts.has("response_item")
  ) && typeCounts.has("response_item");
}

function getResponsePayload(entry) {
  if (entry?.type !== "response_item") return null;
  return entry.payload || entry.item || entry.response_item || null;
}

function extractMessageText(payload) {
  const content = payload?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (typeof part?.text === "string") return part.text;
    if (typeof part?.input_text?.text === "string") return part.input_text.text;
    if (typeof part?.content === "string") return part.content;
    return "";
  }).filter(Boolean).join("\n");
}

function extractCallText(payload) {
  const parts = [
    payload?.name,
    payload?.arguments,
    payload?.input,
    payload?.cmd,
    payload?.command,
    payload?.content,
    payload?.output
  ];
  return parts.map(part => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") return compactJson(part, 1200);
    return "";
  }).filter(Boolean).join(" ");
}

function extractOutputText(payload) {
  const content = payload?.output ?? payload?.content ?? payload?.result ?? payload;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") return compactJson(content, 2000);
  return "";
}

function isInstructionNoise(text) {
  return /<skills_instructions>|<plugins_instructions>|<environment_context>|AGENTS\.md|You are Codex|dynamic_tools|recommended_plugins|MEMORY_SUMMARY/i.test(text);
}

function isMeaningfulUserText(text) {
  if (!text || isInstructionNoise(text)) return false;
  return !/^\s*#\s*Files mentioned by the user:/i.test(text);
}

function isFinalOrMilestone(text) {
  return /(结论|结果|已完成|已经|通过|成功|失败|修复|验证|构建|安装|启动|提交|推送|下一步|current-state|Phone Deck|API 24|API 26|VM|HAP|hdc|DevEco|权限|permission|BUILD SUCCESSFUL|Install successfully|start ability successfully)/i.test(text);
}

function isKeyToolCall(text) {
  return /(apply_patch|build-profile|module\.json5|hvigorw|assembleHap|hdc\b|install\b|uninstall\b|aa start|pidof|list targets|update_current_state|git status|rg\b|grep\b|compileSdkVersion|compatibleSdkVersion|targetSdkVersion|minAPIVersion|targetAPIVersion|MANAGE_BLUETOOTH|ohos\.permission|com\.personal\.phoneDeck)/i.test(text);
}

function isKeyToolOutput(text) {
  return /(BUILD SUCCESSFUL|Install successfully|install bundle successfully|start ability successfully|Process exited with code 0|Connected|Success\. Updated|Phone Deck|current-state|compileSdkVersion|compatibleSdkVersion|targetSdkVersion|minAPIVersion|targetAPIVersion|Permission verification failed|MANAGE_BLUETOOTH|ohos\.permission\.INTERNET|com\.personal\.phoneDeck|API 26|API 24)/i.test(text);
}

const KEY_OUTPUT_PATTERN = /(BUILD SUCCESSFUL|Install successfully|install bundle successfully|failed to install bundle|start ability successfully|Connected|Success\. Updated|Phone Deck|current-state|compileSdkVersion|compatibleSdkVersion|targetSdkVersion|minAPIVersion|targetAPIVersion|Permission verification failed|MANAGE_BLUETOOTH|ohos\.permission\.INTERNET|com\.personal\.phoneDeck|API 26|API 24)/i;

function evidenceSnippet(text, max = 900) {
  const cleaned = clean(text);
  const match = cleaned.match(KEY_OUTPUT_PATTERN);
  if (!match || match.index === undefined) return truncate(cleaned, max);
  const start = Math.max(0, match.index - Math.floor(max / 3));
  const end = Math.min(cleaned.length, start + max);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < cleaned.length ? " ..." : "";
  return prefix + cleaned.slice(start, end) + suffix;
}

function validationScore(text) {
  let score = 0;
  if (/start ability successfully/i.test(text)) score += 100;
  if (/BUILD SUCCESSFUL/i.test(text)) score += 95;
  if (/install bundle successfully|Install successfully/i.test(text)) score += 90;
  if (/failed to install bundle|Permission verification failed/i.test(text)) score += 80;
  if (/API 26|HarmonyOS 7|7\.0\.0\(26\)|HAP|\.hap/i.test(text)) score += 60;
  if (/MANAGE_BLUETOOTH|ohos\.permission|module\.json5|build-profile/i.test(text)) score += 50;
  if (/current-state|Success\. Updated/i.test(text)) score += 40;
  if (/Process exited with code 0/i.test(text)) score += 10;
  return score;
}

function pushUnique(list, item, maxItems, keyFn = value => value) {
  const key = keyFn(item);
  if (!key || list.some(existing => keyFn(existing) === key)) return;
  if (list.length < maxItems) list.push(item);
}

function addSection(lines, title, items, itemLimit, itemCharLimit) {
  lines.push(`\n## ${title}`);
  if (items.length === 0) {
    lines.push("- none extracted");
    return;
  }
  for (const item of items.slice(0, itemLimit)) {
    lines.push(`- ${truncate(item, itemCharLimit)}`);
  }
}

function fitToBudget(sections, maxText) {
  const output = [];
  let used = 0;
  for (const line of sections) {
    const next = `${line}\n`;
    if (used + next.length > maxText) {
      const remaining = maxText - used;
      if (remaining > 80) output.push(next.slice(0, remaining - 30) + "\n[truncated]");
      break;
    }
    output.push(next);
    used += next.length;
  }
  return output.join("").trim();
}

function summarizeRolloutJsonl(rawText, parsed, maxText) {
  const session = parsed.find(entry => entry.type === "session_meta")?.payload || {};
  const counts = parsed.reduce((acc, entry) => {
    acc[entry.type] = (acc[entry.type] || 0) + 1;
    return acc;
  }, {});

  const userMessages = [];
  const finalAssistantMessages = [];
  const assistantMilestones = [];
  const keyToolCalls = [];
  const keyToolOutputs = [];
  const patchSummaries = [];

  const responsePayloads = parsed.map(getResponsePayload).filter(Boolean);
  for (let index = 0; index < responsePayloads.length; index += 1) {
    const payload = responsePayloads[index];
    if (payload.type === "message") {
      const role = payload.role || payload.author?.role;
      const message = extractMessageText(payload);
      if (role === "user" && isMeaningfulUserText(message)) {
        pushUnique(userMessages, message, 30, item => truncate(item, 180));
      }
      if (role === "assistant" && isFinalOrMilestone(message)) {
        pushUnique(assistantMilestones, message, 45, item => truncate(item, 220));
        finalAssistantMessages.push(message);
      }
      continue;
    }

    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      const callText = extractCallText(payload);
      if (isKeyToolCall(callText)) {
        pushUnique(keyToolCalls, callText, 40, item => truncate(item, 220));
      }
      if (/apply_patch/i.test(callText)) {
        pushUnique(patchSummaries, callText, 20, item => truncate(item, 220));
      }
      continue;
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const outputText = extractOutputText(payload);
      if (isKeyToolOutput(outputText)) {
        pushUnique(keyToolOutputs, { text: evidenceSnippet(outputText), index }, 500, item => truncate(item.text, 220));
      }
    }
  }

  const recentFinals = finalAssistantMessages.slice(-8);
  const prioritizedToolOutputs = keyToolOutputs
    .sort((a, b) => {
      const scoreDelta = validationScore(b.text) - validationScore(a.text);
      return scoreDelta !== 0 ? scoreDelta : b.index - a.index;
    })
    .map(item => item.text);
  const lines = [
    "# Structured Compression: Codex/Trae Rollout JSONL",
    "",
    `Source: rollout JSONL detected. Original chars: ${clean(rawText).length}. Parsed entries: ${parsed.length}.`,
    `Session: ${session.id || session.session_id || "unknown"}. CWD: ${session.cwd || "unknown"}.`,
    `Entry counts: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(", ")}.`,
    "",
    "Compression rule: system prompts, tool schemas, encrypted reasoning, event telemetry, and generic progress noise were removed before MVP-0 analysis. The final outcome and validation evidence are placed early to avoid chronological truncation bias."
  ];

  addSection(lines, "Final Outcomes And Late Assistant Summaries", recentFinals, 8, 800);
  addSection(lines, "Key Tool Outputs And Validation Evidence", prioritizedToolOutputs, 40, 420);
  addSection(lines, "User Decisions And Constraints", userMessages, 30, 420);
  addSection(lines, "Assistant Milestones Across Transcript", assistantMilestones, 32, 420);
  addSection(lines, "Key Tool Calls", keyToolCalls, 36, 320);
  addSection(lines, "Patch Or Edit Evidence", patchSummaries, 20, 360);

  return fitToBudget(lines, maxText);
}

export function prepareArtifactForReport(artifactText, artifactType = "other", options = {}) {
  const maxText = Number(options.maxText) || DEFAULT_MAX_TEXT;
  const rawText = String(artifactText || "");
  const cleaned = clean(rawText);
  const { parsed, failures } = parseJsonl(rawText);
  const typeHint = clean(artifactType).toLowerCase();

  if (looksLikeRolloutJsonl(parsed) || (typeHint === "codex" && parsed.length > 20 && failures < parsed.length)) {
    const text = summarizeRolloutJsonl(rawText, parsed, maxText);
    return {
      text,
      metadata: {
        strategy: "rollout-jsonl-structured",
        didCompress: true,
        originalCharCount: cleaned.length,
        preparedCharCount: clean(text).length,
        parsedEntries: parsed.length,
        parseFailures: failures
      }
    };
  }

  const text = cleaned.length > maxText ? cleaned.slice(0, maxText) : cleaned;
  return {
    text,
    metadata: {
      strategy: "plain-truncate",
      didCompress: false,
      originalCharCount: cleaned.length,
      preparedCharCount: clean(text).length,
      parsedEntries: parsed.length,
      parseFailures: failures
    }
  };
}
