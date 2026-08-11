export interface CognitiveLoopRun {
  id: string;
  userId: string;
  projectId: string;
  clientRunId: string;
  activitySessionId?: string;
  windowStart: string;
  windowEnd: string;
  source: string;
  result: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CognitiveLoopFeedback {
  id: string;
  runId: string;
  userId: string;
  kind: string;
  targetId?: string;
  payload: Record<string, any>;
  createdAt: string;
}

export interface CognitiveLoopStore {
  getRun(runId: string, userId: string): CognitiveLoopRun | null;
  getByClientRunId(clientRunId: string, userId: string): CognitiveLoopRun | null;
  getLatestRun(projectId: string, userId: string): CognitiveLoopRun | null;
  saveRun(input: Record<string, any>): CognitiveLoopRun;
  listFeedback(runId: string, userId: string): CognitiveLoopFeedback[];
  listRecentFeedback(projectId: string, userId: string, limit?: number): CognitiveLoopFeedback[];
  recordFeedback(input: Record<string, any>): CognitiveLoopFeedback;
}

export declare function createCognitiveLoopStore(dbPath: string): CognitiveLoopStore;

