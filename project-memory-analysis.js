import crypto from "node:crypto";

const MAX_TEXT = 120_000;
const MAX_MESSAGES = 2_000;
const PLATFORM_VALUES = new Set([
  "codex", "trae", "claude_code", "cursor", "github_copilot", "chatgpt", "manual", "other"
]);

function text(value, limit = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function compact(value, limit = 4000) {
  return text(value, limit).replace(/\s+/g, " ").trim();
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function fingerprint(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function redactContent(value, limit = 12_000) {
  return text(value, limit)
    .replace(/(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[PRIVATE_KEY_REDACTED]");
}

export function sanitizeRepositoryPath(value) {
  const raw = text(value, 500);
  if (!raw) return "";
  const normalized = raw.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    const marker = normalized.match(/\/(?:src|app|lib|server|web|packages|tests?)\/.*$/i);
    return marker ? marker[0].slice(1) : `[local-path-redacted]/${normalized.split("/").pop() || "file"}`;
  }
  return normalized.replace(/^\.\//, "").replace(/^(\.\.\/)+/, "").slice(0, 500);
}

function parseMessages(input) {
  if (Array.isArray(input?.messages)) {
    return input.messages.slice(0, MAX_MESSAGES).map((item, index) => ({
      id: text(item?.id || `message-${index + 1}`, 120),
      role: text(item?.role || item?.author || "unknown", 40),
      content: text(item?.content || item?.text || item?.message, 16_000),
      createdAt: item?.createdAt || item?.timestamp || undefined
    })).filter(item => item.content);
  }
  const raw = text(input?.fileContent || input?.rawContent || input?.content || input?.text, MAX_TEXT);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parseMessages({ messages: parsed });
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.messages)) return parseMessages(parsed);
  } catch { /* markdown, txt, or jsonl continues below */ }
  const lines = raw.split(/\r?\n/);
  const messages = [];
  let current = null;
  for (const line of lines) {
    const jsonLine = line.trim();
    if (jsonLine.startsWith("{") && jsonLine.endsWith("}")) {
      try {
        const parsed = JSON.parse(jsonLine);
        if (parsed?.role || parsed?.content || parsed?.text) {
          messages.push({ role: text(parsed.role || parsed.author || "unknown", 40), content: text(parsed.content || parsed.text, 16_000), createdAt: parsed.timestamp });
          continue;
        }
      } catch { /* normal text line */ }
    }
    const heading = line.match(/^\s*(?:#{1,6}\s*)?(user|human|用户|assistant|agent|codex|trae|claude(?:\s+code)?|AI)\s*[:：]?\s*(.*)$/i);
    if (heading) {
      current = { role: /user|human|用户/i.test(heading[1]) ? "user" : "assistant", content: heading[2] || "" };
      messages.push(current);
    } else if (current) {
      current.content += `\n${line}`;
    } else if (line.trim()) {
      current = { role: "unknown", content: line };
      messages.push(current);
    }
  }
  return messages.slice(0, MAX_MESSAGES).map((item, index) => ({ id: `message-${index + 1}`, ...item, content: text(item.content, 16_000) })).filter(item => item.content);
}

export function sessionText(session) {
  return (session.messages || []).map(message => `${message.role}: ${message.content}`).join("\n").slice(0, MAX_TEXT);
}

function unique(values) {
  return [...new Set(values.map(value => compact(value, 300)).filter(Boolean))];
}

function guessLanguage(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", go: "go", rs: "rust", sql: "sql", md: "markdown", json: "json", css: "css", html: "html" })[extension] || undefined;
}

export function extractArtifacts(source) {
  const body = typeof source === "string" ? source : sessionText(source);
  const pathCandidates = unique([
    ...(body.match(/(?:^|[\s`"'(])((?:src|app|lib|server|web|packages|tests?|scripts|platforms)\/[A-Za-z0-9_./@-]+\.[A-Za-z0-9_-]+)/g) || []).map(item => item.replace(/^[\s`"'(]+/, "")),
    ...(body.match(/\b[A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx|py|go|rs|sql|md|json|css|html)\b/g) || [])
  ]);
  const qualified = pathCandidates.filter(item => item.includes("/"));
  const qualifiedBasenames = new Set(qualified.map(item => item.split("/").pop()));
  const paths = pathCandidates.filter(item => item.includes("/") || !qualifiedBasenames.has(item));
  const commits = unique(body.match(/\b[0-9a-f]{7,40}\b/gi) || []).filter(item => /^[0-9a-f]{7,40}$/i.test(item));
  const functions = unique([
    ...(body.match(/\b(?:function|def|func|class)\s+([A-Za-z_$][\w$]*)/g) || []).map(item => item.split(/\s+/).pop()),
    ...(body.match(/\b([A-Za-z_$][\w$]*)\s*\([^\n]{0,120}\)/g) || []).map(item => item.split("(")[0].trim()).filter(item => !["if", "for", "while", "catch", "switch"].includes(item))
  ]);
  const result = [];
  for (const path of paths) result.push({ type: "file", path: sanitizeRepositoryPath(path), relation: /create|add|new|implement/i.test(body) ? "modified" : "modified", language: guessLanguage(path), confidence: 0.88 });
  for (const symbolName of functions.slice(0, 40)) result.push({ type: "function", symbolName, relation: "modified", confidence: 0.78 });
  for (const gitCommitHash of commits.slice(0, 20)) result.push({ type: "commit", gitCommitHash, name: `Commit ${gitCommitHash}`, relation: "created", confidence: 0.96 });
  return result;
}

function userText(messages) {
  return messages.filter(item => /user|human|用户/i.test(item.role)).map(item => item.content).join("\n");
}

function assistantText(messages) {
  return messages.filter(item => !/user|human|用户/i.test(item.role)).map(item => item.content).join("\n");
}

function inferWorkItemType(body) {
  if (/实现|implement|create|创建/i.test(body) && !/bug|故障|修复问题|修复故障/i.test(body)) return "feature";
  if (/bug|fix|修复|错误|失败|崩溃/i.test(body)) return "bug";
  if (/refactor|重构|整理/i.test(body)) return "refactor";
  if (/deploy|部署|发布/i.test(body)) return "deployment";
  if (/research|调研|研究/i.test(body)) return "research";
  if (/design|设计/i.test(body)) return "design";
  if (/decision|方案|决策/i.test(body)) return "decision";
  return "feature";
}

function inferTitle(messages, body) {
  const keywords = [
    [/激活码|activation code/i, "激活码兑换与防重复使用"],
    [/websocket|断线重连|reconnect/i, "连接断线重连"],
    [/jwt|登录|鉴权|auth/i, "用户登录与鉴权"],
    [/支付|payment/i, "支付回调与幂等"],
    [/并发|concurren|竞态|race/i, "并发控制与竞态修复"]
  ];
  const matched = keywords.find(([pattern]) => pattern.test(body));
  if (matched) return matched[1];
  const user = userText(messages);
  const first = user.split(/\r?\n/).map(line => compact(line)).find(line => line.length >= 6);
  if (first) {
    const cleaned = first.replace(/^(请|帮我|需要|我想|实现|implement|please)\s*/i, "").replace(/[。.!！?？].*$/, "");
    if (cleaned.length >= 6) return cleaned.slice(0, 120);
  }
  return keywords.find(([pattern]) => pattern.test(body))?.[1] || "Agent 协作实现任务";
}

function extractDecisions(body, artifacts) {
  const decisions = [];
  const rules = [
    { pattern: /条件更新|唯一约束|conditional update|unique constraint/i, title: "使用条件更新和唯一约束控制重复写入", decision: "使用数据库条件更新和唯一约束避免并发重复操作。", type: "database", importance: "high" },
    { pattern: /事务|transaction|atomic/i, title: "使用事务保证状态变更原子性", decision: "将相关读写放入事务边界内，避免中间状态被并发请求观察。", type: "database", importance: "high" },
    { pattern: /指数退避|jitter|exponential backoff/i, title: "重试采用指数退避与随机抖动", decision: "使用指数退避和随机抖动降低重试风暴。", type: "architecture", importance: "medium" },
    { pattern: /jwt|session cookie|httpOnly|鉴权/i, title: "采用服务端会话与安全认证边界", decision: "将身份验证保留在服务端，并限制客户端可见凭据。", type: "security", importance: "high" },
    { pattern: /迁移|migration|schema/i, title: "通过可回滚迁移扩展数据模型", decision: "使用增量迁移扩展持久化模型，同时保留旧数据兼容路径。", type: "database", importance: "high" }
  ];
  for (const rule of rules) {
    if (!rule.pattern.test(body)) continue;
    decisions.push({ title: rule.title, decision: rule.decision, type: rule.type, importance: rule.importance, rationale: compact(body.slice(0, 500) || "由会话上下文推断，需用户确认。"), alternatives: [], risks: [], userParticipation: /用户选择|我决定|we chose|user selected/i.test(body) ? "selected" : "accepted", decisionMaker: /用户选择|我决定|we chose|user selected/i.test(body) ? "collaborative" : "agent" });
  }
  if (!decisions.length && artifacts.length) decisions.push({ title: "保留现有框架并做局部扩展", decision: "在当前项目结构内增加实现，避免无关重构。", rationale: "会话出现了真实代码产出，但没有明确记录替代方案。", alternatives: [], risks: ["需要人工确认方案背景"], decisionType: "architecture", importance: "low", userParticipation: "unknown", decisionMaker: "unknown" });
  return decisions;
}

function extractDebtCandidates(body, decisions, artifacts, title) {
  const sensitive = /security|auth|jwt|password|token|payment|支付|数据库|migration|迁移|concurren|并发|race|privacy|隐私|deploy|部署|架构/i.test(body);
  const userAccepted = !/用户选择|我决定|明确解释|independently|独立说明/i.test(body) && /agent|assistant|AI|创建|实现|改为|修复|implemented/i.test(body);
  if (!sensitive && !userAccepted) return [];
  const concurrency = /concurren|并发|竞态|race|激活码/i.test(body);
  const candidate = concurrency
    ? { title: "尚未掌握并发控制中的竞态条件", description: "用户知道功能结果，但尚未证明能够解释为什么简单的先查询再更新会产生并发窗口。", reason: "关键并发控制方案由 Agent 提出，用户未显示参与事务与条件更新的选择。", risk: "可能在支付、库存或兑换等场景中重新引入重复处理。", requiredEvidence: ["独立解释竞态条件", "识别错误实现", "迁移到另一个幂等场景", "完成真实项目修改验证"] }
    : { title: `尚未证明能够负责：${title}`, description: "会话显示 Agent 产出了关键实现，但没有足够的用户解释、错误识别或真实修改证据。", reason: "关键实现由 Agent 主导，当前只有代码产出或用户接受信号。", risk: "后续故障处理可能继续依赖 Agent，难以判断边界和风险。", requiredEvidence: ["独立解释关键机制", "识别错误实现和边界", "完成场景迁移", "在真实项目中修改并验证"] };
  return [{ ...candidate, relatedDecisionIndexes: decisions.map((_, index) => index), relatedArtifactIndexes: artifacts.map((_, index) => index), priority: sensitive ? "high" : "medium", confidence: sensitive && userAccepted ? 0.9 : 0.68 }];
}

function normalizeExplicitDebtCandidates(candidates, decisions, artifacts) {
  return (Array.isArray(candidates) ? candidates : []).map(candidate => {
    const description = compact(candidate?.description || candidate?.gapText || candidate?.title, 500);
    if (!description) return null;
    return {
      title: compact(candidate.title || description, 300),
      description,
      reason: compact(candidate.reason || "由 Agent 显式标记，需要用户确认是否形成认知欠条。", 1000),
      risk: compact(candidate.risk, 1000) || undefined,
      requiredEvidence: Array.isArray(candidate.requiredEvidence) ? candidate.requiredEvidence.slice(0, 8).map(item => compact(item, 300)).filter(Boolean) : [],
      relatedDecisionIndexes: decisions.map((_, index) => index),
      relatedArtifactIndexes: artifacts.map((_, index) => index),
      priority: candidate.priority === "medium" ? "medium" : "high",
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.9)))
    };
  }).filter(Boolean);
}

export function analyzeNormalizedSession(session) {
  const body = sessionText(session);
  const user = userText(session.messages || []);
  const assistant = assistantText(session.messages || []);
  const artifacts = extractArtifacts(body);
  const title = inferTitle(session.messages || [], body);
  const decisions = extractDecisions(body, artifacts);
  const workItem = { title, summary: compact(user || body.slice(0, 500), 500), type: inferWorkItemType(body), confidence: title !== "Agent 协作实现任务" ? 0.9 : 0.62 };
  const inferredDebtCandidates = extractDebtCandidates(body, decisions, artifacts, title);
  const explicitDebtCandidates = normalizeExplicitDebtCandidates(session.explicitDebtCandidates, decisions, artifacts);
  // An explicit debt_candidate event is already a deliberate signal from the
  // caller. Prefer it over the heuristic candidate for this session so the
  // acceptance UI does not show two versions of the same gap.
  const debtCandidates = explicitDebtCandidates.length ? explicitDebtCandidates : inferredDebtCandidates;
  const keyTopics = unique([title, ...decisions.map(item => item.title), ...(body.match(/\b(?:JWT|WebSocket|SQLite|MIPI|API|MCP|Git|TypeScript|JavaScript|Python|SQL|OAuth|CORS|idempotency|幂等|并发|事务)\b/gi) || [])]).slice(0, 20);
  const technologies = unique(body.match(/\b(?:Node(?:\.js)?|TypeScript|JavaScript|Python|SQLite|PostgreSQL|Redis|React|Vite|Express|JWT|WebSocket|Git|Docker|MCP|API)\b/gi) || []).slice(0, 20);
  return {
    userIntent: compact(user || "未从会话中识别出明确用户任务。", 1000),
    implementationSummary: compact(assistant || body.slice(0, 1000) || "未识别到 Agent 实现内容。", 1500),
    outcomeSummary: /完成|implemented|fixed|通过|pass|成功/i.test(body) ? "会话出现完成、修复或验证信号；仍需用户确认最终结果。" : "未识别到明确完成信号，需要人工确认。",
    workItemCandidates: [workItem],
    artifactCandidates: artifacts,
    decisionCandidates: decisions,
    cognitiveDebtCandidates: debtCandidates,
    keyTopics,
    technologies,
    messages: session.messages || []
  };
}

export function normalizeSessionImport(input = {}, method = "manual_paste") {
  const platform = PLATFORM_VALUES.has(input.platform) ? input.platform : "manual";
  const messages = parseMessages(input);
  const raw = text(input.fileContent || input.rawContent || input.content || input.text, MAX_TEXT);
  const source = input.sourceFingerprint || fingerprint({ platform, externalSessionId: input.externalSessionId, messages, raw });
  const normalized = {
    platform,
    externalSessionId: text(input.externalSessionId, 200) || undefined,
    sourceFingerprint: source,
    startedAt: input.startedAt || undefined,
    endedAt: input.endedAt || undefined,
    messages,
    projectHints: {
      repositoryUrl: text(input.projectHints?.repositoryUrl || input.repositoryUrl, 1000) || undefined,
      workspaceName: text(input.projectHints?.workspaceName || input.workspaceName, 200) || undefined,
      gitRootFingerprint: text(input.projectHints?.gitRootFingerprint || input.localWorkspaceFingerprint, 200) || undefined
    },
    changedArtifacts: Array.isArray(input.changedArtifacts) ? input.changedArtifacts : [],
    commits: Array.isArray(input.commits) ? input.commits : [],
    testResults: Array.isArray(input.testResults) ? input.testResults : [],
    explicitDebtCandidates: Array.isArray(input.explicitDebtCandidates)
      ? input.explicitDebtCandidates
      : Array.isArray(input.events)
        ? input.events.filter(event => event?.type === "debt_candidate").map(event => event.payload || {})
        : [],
    importMethod: method,
    rawContent: raw
  };
  normalized.messages = normalized.messages.length ? normalized.messages : [{ id: "message-1", role: "user", content: raw }].filter(item => item.content);
  return normalized;
}

export function createManualAdapter() {
  return {
    platform: "manual",
    async canHandle(input) { return Boolean(input?.text || input?.content || input?.rawContent || input?.messages); },
    async parse(input) { return normalizeSessionImport(input, input.importMethod || "manual_paste"); }
  };
}

export function createHookAdapter() {
  return {
    platform: "hook",
    async canHandle(input) { return Array.isArray(input?.events); },
    async parse(input) {
      const events = Array.isArray(input.events) ? input.events : [];
      const messages = events.filter(event => ["user_prompted", "agent_message"].includes(event.type)).map(event => ({ id: event.id, role: event.type === "user_prompted" ? "user" : "assistant", content: event.payload?.content || event.payload?.text || "", createdAt: event.occurredAt }));
      return normalizeSessionImport({
        ...input,
        messages,
        changedArtifacts: events.filter(event => event.type === "file_changed").map(event => event.payload || {}),
        commits: events.filter(event => event.type === "commit_created").map(event => event.payload || {}),
        explicitDebtCandidates: events.filter(event => event.type === "debt_candidate").map(event => event.payload || {})
      }, "hook");
    }
  };
}

export function createAgentSessionAdapters() {
  return [createManualAdapter(), createHookAdapter()];
}
