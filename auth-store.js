import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 10;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Auth store for web user accounts and sessions.
 * Backed by SQLite (synchronous better-sqlite3 API).
 * Completely independent from spiral-store.js, mvp0-store.js and mvp1-store.js.
 */
export function createAuthStore(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      email_verified INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  function publicUser(row) {
    return { id: row.id, email: row.email };
  }

  function createSession(userId) {
    const sessionId = crypto.randomUUID();
    const now = new Date();
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, userId, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString());
    return sessionId;
  }

  function register(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const rawPassword = String(password || "");
    if (!normalizedEmail || !rawPassword) {
      throw new Error("Email and password are required");
    }
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
    if (existing) {
      throw new Error("Email already registered");
    }
    const user = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash: bcrypt.hashSync(rawPassword, BCRYPT_COST),
      createdAt: new Date().toISOString()
    };
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
    ).run(user.id, user.email, user.passwordHash, user.createdAt);
    const sessionId = createSession(user.id);
    return { user: { id: user.id, email: user.email }, sessionId };
  }

  function login(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
    // Always run a bcrypt comparison so the response time does not reveal
    // whether the email exists.
    const hash = row ? row.password_hash : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid12";
    const matches = bcrypt.compareSync(String(password || ""), hash);
    if (!row || !matches) {
      throw new Error("Invalid email or password");
    }
    const sessionId = createSession(row.id);
    return { user: publicUser(row), sessionId };
  }

  function logout(sessionId) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(String(sessionId || ""));
  }

  function getUserBySession(sessionId) {
    if (!sessionId) return null;
    const row = db.prepare(
      `SELECT users.id, users.email, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`
    ).get(String(sessionId));
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(String(sessionId));
      return null;
    }
    return { id: row.id, email: row.email };
  }

  function getUserById(id) {
    const row = db.prepare("SELECT id, email FROM users WHERE id = ?").get(String(id || ""));
    return row ? publicUser(row) : null;
  }

  // The plaintext token is returned exactly once here; only its bcrypt hash
  // is persisted. Device tokens stay valid until manually revoked.
  function generateDeviceToken(userId, name) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO device_tokens (id, user_id, token_hash, name, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, String(userId), bcrypt.hashSync(token, BCRYPT_COST), name ? String(name) : null, createdAt);
    return { id, token, name: name ? String(name) : null, createdAt };
  }

  function revokeDeviceToken(tokenId, userId) {
    const result = db.prepare(
      "UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
    ).run(new Date().toISOString(), String(tokenId || ""), String(userId || ""));
    return result.changes > 0;
  }

  function validateDeviceToken(token) {
    const raw = String(token || "");
    if (!raw) return null;
    const rows = db.prepare(
      "SELECT id, user_id, token_hash FROM device_tokens WHERE revoked_at IS NULL"
    ).all();
    for (const row of rows) {
      if (bcrypt.compareSync(raw, row.token_hash)) {
        return { userId: row.user_id, tokenId: row.id };
      }
    }
    return null;
  }

  function listDeviceTokens(userId) {
    return db.prepare(
      "SELECT id, name, created_at, revoked_at FROM device_tokens WHERE user_id = ? ORDER BY created_at DESC"
    ).all(String(userId || "")).map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      revokedAt: row.revoked_at
    }));
  }

  return {
    register,
    login,
    logout,
    getUserBySession,
    getUserById,
    generateDeviceToken,
    revokeDeviceToken,
    validateDeviceToken,
    listDeviceTokens
  };
}
