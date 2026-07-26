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
    it("registers a user and returns a session", () => {
      const result = store.register("Alice@Example.com", "secret-1");
      expect(result.user.email).toBe("alice@example.com");
      expect(result.user.id).toBeTruthy();
      expect(result.sessionId).toBeTruthy();
      expect(store.getUserBySession(result.sessionId)).toEqual(result.user);
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
      const result = store.login("alice@example.com", "secret-1");
      expect(result.user).toEqual(registered.user);
      expect(result.sessionId).toBeTruthy();
      expect(result.sessionId).not.toBe(registered.sessionId);
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
      const { user, sessionId } = store.register("alice@example.com", "secret-1");
      expect(store.getUserBySession(sessionId)).toEqual(user);
    });

    it("returns null for an unknown session", () => {
      expect(store.getUserBySession("no-such-session")).toBeNull();
      expect(store.getUserBySession("")).toBeNull();
    });

    it("returns null after logout", () => {
      const { sessionId } = store.register("alice@example.com", "secret-1");
      store.logout(sessionId);
      expect(store.getUserBySession(sessionId)).toBeNull();
    });

    it("returns null for an expired session and removes it", () => {
      const { sessionId } = store.register("alice@example.com", "secret-1");
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
      expect(reopened.login("alice@example.com", "secret-1").user).toEqual(user);
    });
  });

  describe("getUserById", () => {
    it("returns the user when found and null otherwise", () => {
      const { user } = store.register("alice@example.com", "secret-1");
      expect(store.getUserById(user.id)).toEqual(user);
      expect(store.getUserById("no-such-user")).toBeNull();
    });
  });
});
