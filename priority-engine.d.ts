export declare const PRIORITY_ENGINE_SCHEMA_VERSION: string;
export declare function selectPriorityInterventions(input?: {
  knowledgeDebts?: unknown[];
  aiUsageDebts?: unknown[];
  contentItems?: unknown[];
  max?: number;
  now?: string;
}): Array<Record<string, any>>;
