export declare function createUserCognitiveProfileStore(dbPath: string, options?: Record<string, unknown>): {
  load(): Promise<unknown>;
  persist(): Promise<unknown>;
  saveProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>>;
  getProfile(userId: string): Record<string, unknown> | null;
  listProfiles(): Record<string, unknown>[];
  dbPath: string;
};
