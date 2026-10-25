export interface CognitiveLoopEvidence {
  activityId: string;
  occurredAt: string;
  excerpt: string;
  signal: string;
}

export interface CognitiveLoopProfile {
  dimension: string;
  label: string;
  labelEn: string;
  score: number;
  confidence: string;
  evidenceStatus: string;
  evidence: CognitiveLoopEvidence[];
  diagnosis: string;
  diagnosisEn: string;
  nextAction: string;
}

export interface CognitiveLoopResult {
  schemaVersion: string;
  runId?: string;
  source: string;
  sourceLabel: string;
  generatedAt: string;
  window: { days: number; start: string; end: string };
  projectContext: string;
  inputSummary: { activityCount: number; sourceTypes: string[]; contentCandidateCount: number; previousFeedbackCount: number };
  activities: Array<Record<string, string>>;
  aiCollaborationProfile: CognitiveLoopProfile[];
  aiUsageDebts: Array<{
    id: string;
    kind: string;
    dimension: string;
    title: string;
    status: string;
    priority: string;
    score: number;
    confidence: string;
    why: string;
    evidence: CognitiveLoopEvidence[];
    nextAction: string;
    interventionType?: string;
    successCriteria: string[];
  }>;
  briefing: {
    attentionBudget: number;
    items: Array<Record<string, any>>;
    informationDiet: { candidateCount: number; uniqueCount: number; duplicateCount: number; recommendedCount: number };
    [key: string]: any;
  };
  experiment: Record<string, any>;
  verification: Record<string, any>;
  evidencePolicy: string;
}

export declare const COGNITIVE_LOOP_SCHEMA_VERSION: string;
export declare const AI_COLLABORATION_DIMENSIONS: string[];
export declare function defaultContentCandidates(): Array<Record<string, any>>;
export declare function normalizeActivityEvents(inputs?: unknown[], fallbackNow?: string): Array<Record<string, any>>;
export declare function analyzeCognitiveLoop(input?: Record<string, any>): CognitiveLoopResult;
