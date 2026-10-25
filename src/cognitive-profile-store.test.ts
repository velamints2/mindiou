import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createUserCognitiveProfileStore } from "../cognitive-profile-store.js";

describe("user cognitive profile store", () => {
  it("persists one profile per user and keeps users isolated", async () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "mindiou-profile-")), "state.sqlite");
    const store = createUserCognitiveProfileStore(dbPath);
    await store.load();
    await store.saveProfile({ userId: "user-a", domainCapabilityProfiles: [], aiCollaborationProfile: [], knowledgeDebts: [], aiUsageDebts: [] });
    await store.saveProfile({ userId: "user-b", domainCapabilityProfiles: [], aiCollaborationProfile: [], knowledgeDebts: [], aiUsageDebts: [] });

    expect(store.getProfile("user-a")?.userId).toBe("user-a");
    expect(store.getProfile("user-b")?.userId).toBe("user-b");
    expect(store.listProfiles()).toHaveLength(2);

    const reloaded = createUserCognitiveProfileStore(dbPath);
    await reloaded.load();
    expect(reloaded.getProfile("user-a")?.schemaVersion).toBe("user-cognitive-profile-v1");
  });
});
