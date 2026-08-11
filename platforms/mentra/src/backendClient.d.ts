/**
 * 共享后端 HTTP 客户端。复用与 Rokid/G2 相同的设备凭证模型：
 * Authorization: Bearer LEARNING_API_TOKEN。
 */
export interface ClearanceEntry {
    reportId: string;
    cardId: string;
    nextCardId: string;
    createdAt: string;
    domain: string;
    target: string;
    prompt: string;
    cardNumber: number;
    cardCount: number;
}
export interface ClearanceSource {
    id: string;
    title?: string;
    url?: string;
    type?: string;
    credibility?: string;
}
export interface ClearanceSession {
    id: string;
    reportId: string;
    cardId: string;
    state: string;
    clearanceQuestion: string;
    researchSummary?: string;
    researchMode?: string;
    sources: ClearanceSource[];
    scaffold?: {
        id?: string;
        point: string;
    }[];
    attempts: unknown[];
    finalResult?: ClearanceFinalResult | null;
}
export interface ClearanceAnalysis {
    status: string;
    coverage: number;
    demonstrated: string[];
    missing: string[];
    misconceptions: string[];
    evidence: string[];
    feedback: string;
    teaching: string;
    nextQuestion: string;
    recommendation: "end" | "continue";
}
export interface ClearanceAttempt {
    id: string;
    createdAt: string;
    answer: string;
    analysis: ClearanceAnalysis;
}
export interface ClearanceFinalResult {
    status: string;
    sourceReviewRequired: boolean;
    evidence: string[];
    demonstrated: string[];
    remainingGaps: string[];
    nextRecommendation: string;
}
export type BackendErrorKind = "network" | "rate_limited" | "unavailable" | "http" | "data";
export declare class BackendError extends Error {
    kind: BackendErrorKind;
    status?: number;
    constructor(kind: BackendErrorKind, message: string, status?: number);
}
export interface BackendClientConfig {
    /** 例：http://127.0.0.1:8793 或 https://demo.mindiou.top/mindiou-api（旧 IP 已弃用） */
    baseUrl: string;
    /** LEARNING_API_TOKEN；本地无鉴权部署可为空。 */
    token?: string;
    fetchImpl?: typeof fetch;
}
export interface BackendClient {
    fetchClearanceEntry(): Promise<ClearanceEntry | null>;
    startSession(reportId: string, cardId: string): Promise<ClearanceSession>;
    submitAnswer(sessionId: string, answer: string): Promise<{
        attempt: ClearanceAttempt;
        session: ClearanceSession;
    }>;
    endSession(sessionId: string): Promise<{
        result: ClearanceFinalResult;
        session: ClearanceSession;
    }>;
}
export declare function createBackendClient(config: BackendClientConfig): BackendClient;
/** 面向眼镜屏的错误文案，区分网络/限流/服务未就绪/其他。 */
export declare function friendlyError(error: unknown): string;
