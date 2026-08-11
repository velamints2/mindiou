/**
 * 共享后端 HTTP 客户端。复用与 Rokid/G2 相同的设备凭证模型：
 * Authorization: Bearer LEARNING_API_TOKEN。
 */
export class BackendError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.name = "BackendError";
        this.kind = kind;
        this.status = status;
    }
}
async function parseErrorMessage(response) {
    try {
        const data = (await response.json());
        return String(data?.error || `HTTP ${response.status}`);
    }
    catch {
        return `HTTP ${response.status}`;
    }
}
export function createBackendClient(config) {
    const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl)
        throw new BackendError("data", "MINDIOU_API_BASE 未配置");
    const fetchImpl = config.fetchImpl || fetch;
    async function request(method, path, body) {
        let response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, {
                method,
                headers: {
                    "content-type": "application/json",
                    ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
        }
        catch (error) {
            throw new BackendError("network", String(error?.message || "network error"));
        }
        if (!response.ok) {
            const message = await parseErrorMessage(response);
            if (response.status === 429)
                throw new BackendError("rate_limited", message, 429);
            if (response.status === 503)
                throw new BackendError("unavailable", message, 503);
            throw new BackendError("http", message, response.status);
        }
        return (await response.json());
    }
    return {
        async fetchClearanceEntry() {
            const data = await request("GET", "/api/mentra/clearance-entry");
            return data?.entry || null;
        },
        async startSession(reportId, cardId) {
            const data = await request("POST", "/api/mvp1/sessions", { reportId, cardId });
            if (!data?.session?.id)
                throw new BackendError("data", "后端未返回清偿会话");
            return data.session;
        },
        async submitAnswer(sessionId, answer) {
            const data = await request("POST", `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/answers`, { answer });
            if (!data?.attempt?.analysis)
                throw new BackendError("data", "后端未返回回答分析");
            return { attempt: data.attempt, session: data.session };
        },
        async endSession(sessionId) {
            const data = await request("POST", `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/end`);
            if (!data?.result?.status)
                throw new BackendError("data", "后端未返回结算结果");
            return { result: data.result, session: data.session };
        }
    };
}
/** 面向眼镜屏的错误文案，区分网络/限流/服务未就绪/其他。 */
export function friendlyError(error) {
    if (error instanceof BackendError) {
        if (error.kind === "network")
            return "网络暂时不可用，请检查手机网络后说「重复」重试。";
        if (error.kind === "rate_limited")
            return "请求过于频繁，请稍等片刻后说「重复」重试。";
        if (error.kind === "unavailable")
            return "AI 服务暂未就绪，请稍后再试。";
    }
    const message = String(error?.message || error || "").trim();
    if (/fetch failed|network|socket|dns|timeout|timed out/i.test(message)) {
        return "网络暂时不可用，请检查手机网络后说「重复」重试。";
    }
    return `暂时无法继续：${message.slice(0, 36) || "未知错误"}`;
}
//# sourceMappingURL=backendClient.js.map