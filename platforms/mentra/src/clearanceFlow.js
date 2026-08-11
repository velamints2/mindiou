import { friendlyError } from "./backendClient.js";
import { FEEDBACK_PAGE_MAX, QUESTION_MAX, concise, paginate, statusLabel } from "./displayText.js";
import { commandFromUtterance, controlFromCommand, controlFromGesture } from "./voiceCommands.js";
export function initialState() {
    return {
        phase: "idle",
        entry: null,
        sessionId: "",
        question: "",
        lastAnalysis: null,
        pages: [],
        pageIndex: 0,
        lastResult: null,
        referenceAnswer: "",
        error: "",
        busy: false,
        pending: null
    };
}
/* ---------- 屏幕构造 ---------- */
function cardTitle(entry) {
    return entry ? `欠条 ${entry.cardNumber}/${entry.cardCount}` : "认知欠条";
}
function questionScreen(state, prefix = "") {
    return {
        layout: "referenceCard",
        title: `${prefix}${cardTitle(state.entry)}`,
        text: concise(state.question, QUESTION_MAX)
    };
}
function feedbackPages(analysis) {
    const parts = [analysis.feedback, analysis.teaching]
        .map(item => String(item || "").trim())
        .filter(Boolean);
    return paginate(parts.join("\n") || "已记录本次回答。", FEEDBACK_PAGE_MAX);
}
function pageScreen(state, kind) {
    const total = state.pages.length || 1;
    const index = Math.min(state.pageIndex, total - 1);
    const label = kind === "反馈"
        ? statusLabel(state.lastAnalysis?.status || "")
        : statusLabel(state.lastResult?.status || "");
    return {
        layout: "referenceCard",
        title: `${kind} ${index + 1}/${total} · ${label}`,
        text: state.pages[index] || ""
    };
}
function followupScreen(state) {
    return {
        layout: "referenceCard",
        title: `追问 · ${cardTitle(state.entry)}`,
        text: concise(state.lastAnalysis?.nextQuestion || "", QUESTION_MAX)
    };
}
function conclusionPages(result, referenceAnswer) {
    const lines = [];
    if (referenceAnswer)
        lines.push(`参考答案：${referenceAnswer}`);
    if (Array.isArray(result.demonstrated) && result.demonstrated.length) {
        lines.push(`已体现：${result.demonstrated.slice(0, 2).join("；")}`);
    }
    if (Array.isArray(result.remainingGaps) && result.remainingGaps.length) {
        lines.push(`仍未覆盖：${result.remainingGaps.slice(0, 2).join("；")}`);
    }
    if (result.nextRecommendation)
        lines.push(`下一步：${result.nextRecommendation}`);
    return paginate(lines.join("\n") || "本次清偿已结束。", FEEDBACK_PAGE_MAX);
}
/** 参考答案来自后端结算会话中已揭示的 scaffold；缺失时回退到教学文本。 */
export function referenceFromSession(session, fallback = "") {
    const points = (session?.scaffold || []).map(item => String(item?.point || "").trim()).filter(Boolean);
    if (points.length)
        return points.join("；");
    return String(fallback || "").trim();
}
function textWall(text) {
    return { layout: "textWall", text };
}
function hint(text) {
    return { type: "show", screen: textWall(text) };
}
function show(screen) {
    return { type: "show", screen };
}
function beginAsync(state, effect, ack) {
    return {
        state: { ...state, busy: true, pending: effect },
        effects: [show(ack), effect]
    };
}
function beginEndSession(state) {
    return {
        ...beginAsync(state, { type: "endSession" }, textWall("正在结算…")),
        state: { ...state, phase: "ending", busy: true, pending: { type: "endSession" } }
    };
}
function beginNextCard(state) {
    const entry = state.entry;
    if (entry?.nextCardId) {
        const effect = { type: "startSession", reportId: entry.reportId, cardId: entry.nextCardId };
        return {
            state: { ...state, phase: "starting", busy: true, pending: effect },
            effects: [show(textWall("正在打开下一张欠条…")), effect]
        };
    }
    // 没有下一张：重新读取入口（后端会挑出下一张未答卡或给出空态）。
    return {
        state: { ...state, phase: "loading", busy: true, pending: { type: "fetchEntry" } },
        effects: [show(textWall("正在读取最新欠条…")), { type: "fetchEntry" }]
    };
}
/* ---------- 控制动作 ---------- */
function reduceControl(state, action) {
    const noop = { state, effects: [] };
    if (state.busy)
        return noop;
    switch (state.phase) {
        case "question":
        case "followup": {
            if (action === "end")
                return beginEndSession(state);
            if (action === "next")
                return beginNextCard(state);
            if (action === "repeat")
                return { state, effects: [show(questionScreen(state))] };
            return { state, effects: [hint("请直接说出你的解释；说「结束」结算，说「重复」再看问题。")] };
        }
        case "feedback": {
            const total = state.pages.length;
            if (action === "pageUp") {
                if (state.pageIndex <= 0)
                    return { state, effects: [hint("已是第一页。")] };
                const next = { ...state, pageIndex: state.pageIndex - 1 };
                return { state: next, effects: [show(pageScreen(next, "反馈"))] };
            }
            if (action === "pageDown") {
                if (state.pageIndex >= total - 1)
                    return { state, effects: [hint("已是最后一页，说「继续」前进。")] };
                const next = { ...state, pageIndex: state.pageIndex + 1 };
                return { state: next, effects: [show(pageScreen(next, "反馈"))] };
            }
            if (action === "repeat")
                return { state, effects: [show(pageScreen(state, "反馈"))] };
            if (action === "end")
                return beginEndSession(state);
            if (action === "next")
                return beginNextCard(state);
            if (action === "continue") {
                if (state.pageIndex < total - 1) {
                    const next = { ...state, pageIndex: state.pageIndex + 1 };
                    return { state: next, effects: [show(pageScreen(next, "反馈"))] };
                }
                if (state.lastAnalysis?.nextQuestion) {
                    const next = { ...state, phase: "followup" };
                    return { state: next, effects: [show(followupScreen(next))] };
                }
                return beginEndSession(state);
            }
            return noop;
        }
        case "conclusion": {
            const total = state.pages.length;
            if (action === "pageUp" && state.pageIndex > 0) {
                const next = { ...state, pageIndex: state.pageIndex - 1 };
                return { state: next, effects: [show(pageScreen(next, "结算"))] };
            }
            if (action === "pageDown" && state.pageIndex < total - 1) {
                const next = { ...state, pageIndex: state.pageIndex + 1 };
                return { state: next, effects: [show(pageScreen(next, "结算"))] };
            }
            if (action === "repeat")
                return { state, effects: [show(pageScreen(state, "结算"))] };
            if (action === "continue" || action === "next")
                return beginNextCard(state);
            if (action === "end") {
                return {
                    state: { ...initialState() },
                    effects: [show(textWall("已结束。完整报告与结论请在 Web 端查看。"))]
                };
            }
            return noop;
        }
        case "empty": {
            if (action === "continue" || action === "retry" || action === "repeat") {
                return {
                    state: { ...state, phase: "loading", busy: true, pending: { type: "fetchEntry" } },
                    effects: [show(textWall("正在重新读取…")), { type: "fetchEntry" }]
                };
            }
            if (action === "end") {
                return { state: { ...initialState() }, effects: [show(textWall("已退出。"))] };
            }
            return noop;
        }
        case "error": {
            if (action === "retry" || action === "repeat" || action === "continue") {
                const pending = state.pending || { type: "fetchEntry" };
                return {
                    state: { ...state, busy: true, pending },
                    effects: [show(textWall("正在重试…")), pending]
                };
            }
            if (action === "end") {
                return { state: { ...initialState() }, effects: [show(textWall("已退出。"))] };
            }
            return noop;
        }
        default:
            return noop;
    }
}
/* ---------- 主 reducer ---------- */
export function reduce(state, event) {
    // 异步完成事件不被 busy 拦截；控制/回答事件在 busy 时忽略。
    switch (event.type) {
        case "start": {
            // 会话重入：任何时候都允许从头开始（仅重新读取入口，无副作用）。
            return {
                state: { ...initialState(), phase: "loading", busy: true, pending: { type: "fetchEntry" } },
                effects: [show(textWall("正在读取最新欠条…")), { type: "fetchEntry" }]
            };
        }
        case "entryLoaded": {
            const entry = event.entry;
            if (!entry) {
                return {
                    state: { ...state, phase: "empty", busy: false, pending: null, entry: null },
                    effects: [
                        show({
                            layout: "referenceCard",
                            title: "暂无欠条",
                            text: "后端还没有可清偿的卡片。请先在 Web 端生成报告。"
                        })
                    ]
                };
            }
            const effect = { type: "startSession", reportId: entry.reportId, cardId: entry.cardId };
            return {
                state: { ...state, phase: "starting", entry, busy: true, pending: effect },
                effects: [show(textWall(`正在打开${cardTitle(entry)}…`)), effect]
            };
        }
        case "sessionStarted": {
            const session = event.session;
            const next = {
                ...state,
                phase: "question",
                sessionId: session.id,
                question: session.clearanceQuestion || state.entry?.prompt || "请用自己的话解释这个问题。",
                lastAnalysis: null,
                lastResult: null,
                referenceAnswer: "",
                pages: [],
                pageIndex: 0,
                busy: false,
                pending: null
            };
            // 安全边界：session.scaffold 在此刻绝不进入显示文本。
            return { state: next, effects: [show(questionScreen(next))] };
        }
        case "utterance": {
            if (state.busy)
                return { state, effects: [] };
            if (state.phase !== "question" && state.phase !== "followup")
                return { state, effects: [] };
            const answer = String(event.text || "").trim();
            if (!answer)
                return { state, effects: [] };
            const effect = { type: "submitAnswer", answer };
            return {
                state: { ...state, phase: "submitting", busy: true, pending: effect },
                effects: [show(textWall("已收到，正在分析…")), effect]
            };
        }
        case "analysisReady": {
            const analysis = event.attempt.analysis;
            const next = {
                ...state,
                phase: "feedback",
                lastAnalysis: analysis,
                pages: feedbackPages(analysis),
                pageIndex: 0,
                busy: false,
                pending: null
            };
            return { state: next, effects: [show(pageScreen(next, "反馈"))] };
        }
        case "endReady": {
            const reference = referenceFromSession(event.session, state.lastAnalysis?.teaching || "");
            const next = {
                ...state,
                phase: "conclusion",
                lastResult: event.result,
                referenceAnswer: reference,
                pages: conclusionPages(event.result, reference),
                pageIndex: 0,
                busy: false,
                pending: null
            };
            return { state: next, effects: [show(pageScreen(next, "结算"))] };
        }
        case "failed": {
            const next = { ...state, phase: "error", busy: false, error: event.error };
            return {
                state: next,
                effects: [
                    show({
                        layout: "referenceCard",
                        title: "出错了",
                        text: concise(`${event.error}\n说「重试」或点击触控重试；说「结束」退出。`, FEEDBACK_PAGE_MAX)
                    })
                ]
            };
        }
        case "control":
            return reduceControl(state, event.action);
        default:
            return { state, effects: [] };
    }
}
export class ClearanceRuntime {
    ports;
    state = initialState();
    constructor(ports) {
        this.ports = ports;
    }
    getState() {
        return this.state;
    }
    async dispatch(event) {
        const { state, effects } = reduce(this.state, event);
        this.state = state;
        for (const effect of effects) {
            await this.run(effect);
        }
    }
    /** 语音入口：短指令走控制，长句走回答。 */
    async handleUtterance(text) {
        const command = commandFromUtterance(text);
        if (command === "answer") {
            await this.dispatch({ type: "utterance", text });
            return;
        }
        const action = controlFromCommand(command);
        if (action)
            await this.dispatch({ type: "control", action });
    }
    /** 触控手势入口。 */
    async handleGesture(gestureName) {
        const action = controlFromGesture(gestureName);
        if (action)
            await this.dispatch({ type: "control", action });
    }
    /** 物理按键：短按=继续，长按=结束。 */
    async handleButton(pressType) {
        if (pressType === "short")
            await this.dispatch({ type: "control", action: "continue" });
        else if (pressType === "long")
            await this.dispatch({ type: "control", action: "end" });
    }
    async run(effect) {
        switch (effect.type) {
            case "show":
                this.ports.show(effect.screen);
                return;
            case "fetchEntry":
                await this.guard(() => this.ports.fetchEntry(), entry => ({ type: "entryLoaded", entry }));
                return;
            case "startSession":
                await this.guard(() => this.ports.startSession(effect.reportId, effect.cardId), session => ({ type: "sessionStarted", session }));
                return;
            case "submitAnswer":
                await this.guard(() => this.ports.submitAnswer(this.state.sessionId, effect.answer), ({ attempt, session }) => ({ type: "analysisReady", attempt, session }));
                return;
            case "endSession":
                await this.guard(() => this.ports.endSession(this.state.sessionId), ({ result, session }) => ({ type: "endReady", result, session }));
                return;
        }
    }
    async guard(operation, onSuccess) {
        try {
            const value = await operation();
            await this.dispatch(onSuccess(value));
        }
        catch (error) {
            await this.dispatch({ type: "failed", error: friendlyError(error) });
        }
    }
}
/** 由共享后端客户端构造端口（app.ts 使用）。 */
export function portsFromBackend(backend, show) {
    return {
        show,
        fetchEntry: () => backend.fetchClearanceEntry(),
        startSession: (reportId, cardId) => backend.startSession(reportId, cardId),
        submitAnswer: (sessionId, answer) => backend.submitAnswer(sessionId, answer),
        endSession: sessionId => backend.endSession(sessionId)
    };
}
//# sourceMappingURL=clearanceFlow.js.map