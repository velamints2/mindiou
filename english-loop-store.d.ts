export declare function sanitizeEnglishLoopProfile(input?: unknown): any;
export declare function hashEnglishLoopClientId(clientId: string): string;

export declare function createEnglishLoopStore(dbPath: string): {
  dbPath: string;
  getProfile(ownerKey: string): any;
  getState(ownerKey: string): {
    profile: any;
    sessions: any[];
    feedback: any[];
  };
  listSessions(ownerKey: string, limit?: number): any[];
  listFeedback(ownerKey: string, limit?: number): any[];
  sync(input: Record<string, unknown>): {
    profile: any;
    sessions: any[];
    feedback: any[];
  };
  recordFeedback(input: Record<string, unknown>): any;
  sanitizeEnglishLoopProfile(input?: unknown): any;
};
