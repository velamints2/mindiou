/**
 * MindIOU 后端 HTTP 客户端（MCP Server 与 TRAE hooks 共用）。
 *
 * 只使用项目级 hook token（Bearer）鉴权，不接触用户账号密码。
 * 所有请求带超时，失败抛出带状态码的 Error，由调用方降级。
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:8793";
const DEFAULT_TIMEOUT_MS = 5000;

export function createBackendClient(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.MINDIOU_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const hookToken = String(options.hookToken || process.env.MINDIOU_HOOK_TOKEN || "").trim();
  const projectId = String(options.projectId || process.env.MINDIOU_PROJECT_ID || "_").trim() || "_";
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || fetch;

  function ensureConfigured() {
    if (!hookToken) {
      throw new Error("MindIOU 未配置 MINDIOU_HOOK_TOKEN（在 TRAE MCP 设置的环境变量中添加，不要写入 Git）");
    }
  }

  async function request(method, path, body) {
    ensureConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${hookToken}`
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(`MindIOU API ${method} ${path} 失败（HTTP ${response.status}）：${data.error || "未知错误"}`);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`MindIOU API ${method} ${path} 超时（${timeoutMs}ms），请确认后端已启动（npm run api）`);
      }
      if (error.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(String(error.message))) {
        throw new Error(`无法连接 MindIOU 后端 ${baseUrl}，请确认后端已启动（npm run api）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl,
    projectId,
    getAgentContext(pid = projectId) {
      return request("GET", `/api/projects/${encodeURIComponent(pid)}/agent-context`);
    },
    postEvents(events, extra = {}) {
      const list = Array.isArray(events) ? events : [events];
      // "_" 表示使用 hook token 绑定的项目，不能把字面量发给后端
      const body = { ...extra, events: list };
      if (projectId && projectId !== "_") body.projectId = projectId;
      return request("POST", "/api/agent-sessions/events", body);
    },
    acceptDebtCandidate(sessionId, candidateIndex) {
      return request("POST", `/api/agent-sessions/${encodeURIComponent(sessionId)}/debt-candidates/${encodeURIComponent(candidateIndex)}/accept`, {});
    },
    appendSessionEvents(sessionId, events) {
      return request("POST", `/api/agent-sessions/${encodeURIComponent(sessionId)}/events`, { events });
    },
    createDecision(input, pid = projectId) {
      return request("POST", `/api/projects/${encodeURIComponent(pid)}/decisions`, input);
    },
    createEvidence(debtId, input) {
      return request("POST", `/api/debts/${encodeURIComponent(debtId)}/evidence`, input);
    }
  };
}
