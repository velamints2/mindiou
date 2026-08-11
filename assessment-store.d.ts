export interface AssessmentCompletion {
  completionId: string;
  completedAt?: string;
  role?: string;
  locale?: string;
  mode?: string;
  source?: string;
}

export interface AssessmentStore {
  recordCompletion(input: AssessmentCompletion): { inserted: boolean; completionId: string };
  stats(dayStart?: string): {
    total: number;
    today: number;
    byRole: Record<string, number>;
    byLocale: Record<string, number>;
    byMode: Record<string, number>;
  };
  close(): void;
}

export function createAssessmentStore(dbPath: string): AssessmentStore;
