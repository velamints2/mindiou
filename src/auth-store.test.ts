// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createAuthStore } from "../auth-store.js";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDir = path.resolve("tmp");
const dbPath = path.join(tmpDir, "auth-store-test.sqlite");

async function cleanup() {
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
}

describe("auth store", () => {
  let store;

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    await cleanup();
    store = createAuthStore(dbPath);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("register", () => {
    it("registers an unverified candidate without an authenticated session", () => {
      const result = store.register("Alice@Example.com", "secret-1");
      expect(result.user.email).toBe("alice@example.com");
      expect(result.user.id).toBeTruthy();
      expect(result.sessionId).toBeNull();
      expect(result.user.emailVerified).toBe(false);
      expect(result.user.genesisIdentity).toBeUndefined();
    });

    it("normalizes email with lowercase and trim", () => {
      const result = store.register("  Bob@Example.COM  ", "secret-1");
      expect(result.user.email).toBe("bob@example.com");
    });

    it("rejects a duplicate email", () => {
      store.register("alice@example.com", "secret-1");
      expect(() => store.register("alice@example.com", "other-secret")).toThrow("Email already registered");
    });

    it("rejects a duplicate email after normalization", () => {
      store.register("Alice@Example.com", "secret-1");
      expect(() => store.register(" alice@example.COM ", "other-secret")).toThrow("Email already registered");
    });

    it("rejects missing email or password", () => {
      expect(() => store.register("", "secret-1")).toThrow("Email and password are required");
      expect(() => store.register("alice@example.com", "")).toThrow("Email and password are required");
    });
  });

  describe("login", () => {
    it("logs in with correct credentials and returns a session", () => {
      const registered = store.register("alice@example.com", "secret-1");
      store.verifyEmailToken(store.createEmailVerificationToken(registered.user.id));
      const result = store.login("alice@example.com", "secret-1");
      expect(result.user.emailVerified).toBe(true);
      expect(result.sessionId).toBeTruthy();
      expect(result.sessionId).toBeTruthy();
    });

    it("rejects correct credentials until email is verified", () => {
      store.register("alice@example.com", "secret-1");
      expect(() => store.login("alice@example.com", "secret-1")).toThrow("EMAIL_NOT_VERIFIED");
    });

    it("rejects a wrong password with a generic error", () => {
      store.register("alice@example.com", "secret-1");
      expect(() => store.login("alice@example.com", "wrong-password")).toThrow("Invalid email or password");
    });

    it("rejects an unknown email with the same generic error", () => {
      expect(() => store.login("nobody@example.com", "secret-1")).toThrow("Invalid email or password");
    });
  });

  describe("sessions", () => {
    it("returns the user for a valid session", () => {
      const registered = store.register("alice@example.com", "secret-1");
      store.verifyEmailToken(store.createEmailVerificationToken(registered.user.id));
      const { user, sessionId } = store.login("alice@example.com", "secret-1");
      expect(store.getUserBySession(sessionId)).toEqual(user);
    });

    it("returns null for an unknown session", () => {
      expect(store.getUserBySession("no-such-session")).toBeNull();
      expect(store.getUserBySession("")).toBeNull();
    });

    it("returns null after logout", () => {
      const registered = store.register("alice@example.com", "secret-1");
      store.verifyEmailToken(store.createEmailVerificationToken(registered.user.id));
      const { sessionId } = store.login("alice@example.com", "secret-1");
      store.logout(sessionId);
      expect(store.getUserBySession(sessionId)).toBeNull();
    });

    it("returns null for an expired session and removes it", () => {
      const registered = store.register("alice@example.com", "secret-1");
      store.verifyEmailToken(store.createEmailVerificationToken(registered.user.id));
      const { sessionId } = store.login("alice@example.com", "secret-1");
      const raw = new Database(dbPath);
      raw.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), sessionId);
      raw.close();
      expect(store.getUserBySession(sessionId)).toBeNull();
      const check = new Database(dbPath);
      expect(check.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id = ?").get(sessionId).count).toBe(0);
      check.close();
    });

    it("persists users across store instances", () => {
      const { user } = store.register("alice@example.com", "secret-1");
      const reopened = createAuthStore(dbPath);
      expect(reopened.getUserById(user.id)).toEqual(user);
      reopened.verifyEmailToken(reopened.createEmailVerificationToken(user.id));
      expect(reopened.login("alice@example.com", "secret-1").user.emailVerified).toBe(true);
    });
  });

  describe("getUserById", () => {
    it("returns the user when found and null otherwise", () => {
      const { user } = store.register("alice@example.com", "secret-1");
      expect(store.getUserById(user.id)).toEqual(user);
      expect(store.getUserById("no-such-user")).toBeNull();
    });
  });

  describe("genesis identity", () => {
    it("reserves sequential private identities at registration", () => {
      const alice = store.register("alice@example.com", "secret-1", "Alice").user;
      const bob = store.register("bob@example.com", "secret-2", "Bob").user;
      expect(alice.genesisIdentity).toBeUndefined();
      expect(bob.genesisIdentity).toBeUndefined();
      expect(store.getGenesisArchive()).toMatchObject({ joined: 0, completed: 0 });
    });

    it("activates once and keeps public listing opt-in", () => {
      const { user } = store.register("alice@example.com", "secret-1", "Alice");
      store.verifyEmailToken(store.createEmailVerificationToken(user.id));
      const verified = store.getUserById(user.id);
      const first = store.activateGenesisIdentity(verified.id, "2026-08-03T10:00:00.000Z");
      const second = store.activateGenesisIdentity(user.id, "2026-08-04T10:00:00.000Z");
      expect(second.activatedAt).toBe(first.activatedAt);
      expect(store.getGenesisArchive()).toMatchObject({ joined: 1, completed: 1 });
      expect(store.getGenesisArchive().members).toEqual([
        expect.objectContaining({
          number: "MIOU-001-0001",
          activatedAt: "2026-08-03T10:00:00.000Z",
          visibility: "anonymous"
        })
      ]);

      store.updateGenesisIdentity(user.id, { visibility: "public", displayName: "Alice", avatarUrl: "https://example.com/a.png" });
      expect(store.getGenesisArchive().members).toEqual([expect.objectContaining({
        number: "MIOU-001-0001", nickname: "Alice", visibility: "public"
      })]);

      store.updateGenesisIdentity(user.id, { visibility: "anonymous" });
      expect(store.getGenesisArchive().members[0]).not.toHaveProperty("nickname");
      store.updateGenesisIdentity(user.id, { visibility: "private" });
      expect(store.getGenesisArchive().members).toEqual([
        expect.objectContaining({ number: "MIOU-001-0001", visibility: "anonymous" })
      ]);
    });

    it("rejects profile changes before activation and unsafe avatar URLs", () => {
      const { user } = store.register("alice@example.com", "secret-1");
      expect(() => store.updateGenesisIdentity(user.id, { visibility: "public" })).toThrow("not active");
      store.verifyEmailToken(store.createEmailVerificationToken(user.id));
      store.activateGenesisIdentity(user.id);
      expect(() => store.updateGenesisIdentity(user.id, { visibility: "public", avatarUrl: "http://example.com/a.png" })).toThrow("HTTPS");
    });

    it("backfills identities for accounts created before the genesis migration", async () => {
      const legacyPath = path.join(tmpDir, "auth-store-legacy.sqlite");
      await rm(legacyPath, { force: true });
      const legacy = new Database(legacyPath);
      legacy.exec(`CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0
      )`);
      legacy.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run("legacy-1", "legacy@example.com", "unused", "2026-07-01T00:00:00.000Z");
      legacy.close();
      const migrated = createAuthStore(legacyPath);
      expect(migrated.getUserById("legacy-1").genesisIdentity).toBeUndefined();
      await rm(legacyPath, { force: true });
    });
  });

  describe("listUsersWithStats", () => {
    it("returns an empty array when no users exist", () => {
      const users = store.listUsersWithStats();
      expect(users).toEqual([]);
    });

    it("returns each user with base fields and never exposes password_hash", () => {
      store.register("alice@example.com", "secret-1");
      store.register("bob@example.com", "secret-2");
      const users = store.listUsersWithStats();
      expect(users).toHaveLength(2);
      for (const u of users) {
        expect(u.id).toBeTruthy();
        expect(u.email).toBeTruthy();
        expect(u.createdAt).toBeTruthy();
        expect(typeof u.emailVerified).toBe("boolean");
        expect(typeof u.activeSessionCount).toBe("number");
        expect(typeof u.activeDeviceTokenCount).toBe("number");
        // password_hash 绝不外泄
        expect(Object.keys(u)).not.toContain("passwordHash");
        expect(JSON.stringify(u)).not.toContain("password_hash");
      }
    });

    it("counts active sessions per user and updates lastSessionAt after login", () => {
      const registered = store.register("alice@example.com", "secret-1");
      store.verifyEmailToken(store.createEmailVerificationToken(registered.user.id));
      const { user, sessionId } = store.login("alice@example.com", "secret-1");
      store.login("alice@example.com", "secret-1"); // 再开一个会话
      const users = store.listUsersWithStats();
      const alice = users.find(u => u.id === user.id);
      expect(alice.activeSessionCount).toBe(2);
      expect(alice.lastSessionAt).toBeTruthy();
      // 首次登录会话 createdAt 应不晚于后续登录的会话
      expect(alice.lastSessionAt >= alice.createdAt).toBe(true);
      // 销毁一个会话后应剩 1
      store.logout(sessionId);
      const refreshed = store.listUsersWithStats().find(u => u.id === user.id);
      expect(refreshed.activeSessionCount).toBe(1);
    });

    it("does not count expired sessions as active", () => {
      const registered = store.register("alice@example.com", "secret-1");
      store.verifyEmailToken(store.createEmailVerificationToken(registered.user.id));
      const { sessionId } = store.login("alice@example.com", "secret-1");
      const raw = new Database(dbPath);
      raw.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), sessionId);
      raw.close();
      const users = store.listUsersWithStats();
      expect(users[0].activeSessionCount).toBe(0);
      expect(users[0].lastSessionAt).toBeTruthy(); // 仍记录历史会话时间
    });

    it("counts only non-revoked device tokens", () => {
      const { user } = store.register("alice@example.com", "secret-1");
      const t1 = store.generateDeviceToken(user.id, "phone");
      store.generateDeviceToken(user.id, "glasses");
      expect(store.listUsersWithStats()[0].activeDeviceTokenCount).toBe(2);
      store.revokeDeviceToken(t1.id, user.id);
      expect(store.listUsersWithStats()[0].activeDeviceTokenCount).toBe(1);
    });

    it("returns users ordered by created_at DESC", () => {
      store.register("alice@example.com", "secret-1");
      // 通过 SQLite 直接控制 created_at 以避免时钟精度问题
      const raw = new Database(dbPath);
      const aliceRow = raw.prepare("SELECT id FROM users WHERE email = ?").get("alice@example.com");
      raw.prepare("UPDATE users SET created_at = ? WHERE id = ?")
        .run("2026-01-01T00:00:00.000Z", aliceRow.id);
      raw.close();
      store.register("bob@example.com", "secret-2");
      const users = store.listUsersWithStats();
      expect(users[0].email).toBe("bob@example.com");
      expect(users[1].email).toBe("alice@example.com");
    });
  });
});
