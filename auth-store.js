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
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
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
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map(column => column.name));
  const migrations = [
    ["display_name", "ALTER TABLE users ADD COLUMN display_name TEXT"],
    ["genesis_number", "ALTER TABLE users ADD COLUMN genesis_number INTEGER"],
    ["genesis_reserved_at", "ALTER TABLE users ADD COLUMN genesis_reserved_at TEXT"],
    ["genesis_activated_at", "ALTER TABLE users ADD COLUMN genesis_activated_at TEXT"],
    ["genesis_visibility", "ALTER TABLE users ADD COLUMN genesis_visibility TEXT NOT NULL DEFAULT 'private'"],
    ["genesis_avatar_url", "ALTER TABLE users ADD COLUMN genesis_avatar_url TEXT"]
  ];
  for (const [column, sql] of migrations) {
    if (!userColumns.has(column)) db.exec(sql);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_genesis_number ON users(genesis_number)");
  const unnumberedUsers = db.prepare(
    "SELECT id, created_at FROM users WHERE genesis_number IS NULL ORDER BY created_at ASC, id ASC"
  ).all();
  if (unnumberedUsers.length) {
    let nextNumber = Number(db.prepare("SELECT COALESCE(MAX(genesis_number), 0) + 1 AS value FROM users").get().value);
    const reserve = db.prepare(
      "UPDATE users SET genesis_number = ?, genesis_reserved_at = COALESCE(genesis_reserved_at, created_at) WHERE id = ?"
    );
    db.transaction(() => {
      for (const user of unnumberedUsers) reserve.run(nextNumber++, user.id);
    })();
  }

  function formatGenesisNumber(value) {
    return value ? `MIOU-001-${String(value).padStart(4, "0")}` : null;
  }

  function publicUser(row) {
    const verified = row.email_verified === 1;
    return {
      id: row.id,
      email: row.email,
      name: row.display_name || undefined,
      emailVerified: verified,
      // A reserved number is only a candidate until email verification. Never
      // expose it as a formal Genesis identity before that gate is complete.
      genesisIdentity: verified && row.genesis_number ? {
        number: formatGenesisNumber(row.genesis_number),
        reservedAt: row.genesis_reserved_at,
        activatedAt: row.genesis_activated_at,
        visibility: row.genesis_visibility || "private",
        avatarUrl: row.genesis_avatar_url || undefined
      } : undefined
    };
  }

  function createSession(userId) {
    const sessionId = crypto.randomUUID();
    const now = new Date();
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, userId, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString());
    return sessionId;
  }

  function register(email, password, name) {
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
    const nextNumber = Number(db.prepare("SELECT COALESCE(MAX(genesis_number), 0) + 1 AS value FROM users").get().value);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at, display_name, genesis_number, genesis_reserved_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(user.id, user.email, user.passwordHash, user.createdAt, cleanName(name), nextNumber, user.createdAt);
    // Registration creates a candidate only. No authenticated session is
    // issued until the email ownership check succeeds.
    return { user: getUserById(user.id), sessionId: null };
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
    if (row.email_verified !== 1) {
      const error = new Error("EMAIL_NOT_VERIFIED");
      error.code = "EMAIL_NOT_VERIFIED";
      error.userId = row.id;
      error.email = row.email;
      throw error;
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
      `SELECT users.*, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`
    ).get(String(sessionId));
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(String(sessionId));
      return null;
    }
    return publicUser(row);
  }

  function getUserById(id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(String(id || ""));
    return row ? publicUser(row) : null;
  }

  function cleanName(value) {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    return name ? name.slice(0, 80) : null;
  }

  function activateGenesisIdentity(userId, activatedAt = new Date().toISOString()) {
    if (!isEmailVerified(userId)) throw new Error("Email must be verified before activating Genesis identity");
    db.prepare(
      "UPDATE users SET genesis_activated_at = COALESCE(genesis_activated_at, ?) WHERE id = ?"
    ).run(activatedAt, String(userId));
    return getUserById(userId)?.genesisIdentity || null;
  }

  function updateGenesisIdentity(userId, { visibility, displayName, avatarUrl } = {}) {
    const allowed = new Set(["public", "anonymous", "private"]);
    if (!allowed.has(visibility)) throw new Error("Invalid genesis visibility");
    const user = getUserById(userId);
    if (!user?.genesisIdentity?.activatedAt) throw new Error("Genesis identity is not active");
    const safeAvatar = String(avatarUrl || "").trim();
    if (safeAvatar && !/^https:\/\//i.test(safeAvatar)) throw new Error("Avatar URL must use HTTPS");
    db.prepare(
      "UPDATE users SET genesis_visibility = ?, display_name = COALESCE(?, display_name), genesis_avatar_url = ? WHERE id = ?"
    ).run(visibility, cleanName(displayName), safeAvatar ? safeAvatar.slice(0, 500) : null, String(userId));
    return getUserById(userId).genesisIdentity;
  }

  function getGenesisArchive() {
    const totals = db.prepare(
      `SELECT COUNT(*) AS joined,
       SUM(CASE WHEN genesis_activated_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
       FROM users WHERE genesis_number IS NOT NULL AND email_verified = 1`
    ).get();
    const members = db.prepare(
      `SELECT display_name, genesis_number, genesis_activated_at, genesis_visibility, genesis_avatar_url
       FROM users
       WHERE genesis_number IS NOT NULL AND email_verified = 1
         AND (
           genesis_number <= 5
           OR (genesis_activated_at IS NOT NULL AND genesis_visibility IN ('public', 'anonymous'))
         )
       ORDER BY genesis_number ASC`
    ).all().map(row => ({
      number: formatGenesisNumber(row.genesis_number),
      activatedAt: row.genesis_activated_at,
      // 首批五位注册用户作为真实首发体验者展示，但未主动公开前只显示匿名编号。
      visibility: row.genesis_number <= 5 && row.genesis_visibility === "private" ? "anonymous" : row.genesis_visibility,
      ...(row.genesis_visibility === "public" ? {
        nickname: row.display_name || "首发体验者",
        avatarUrl: row.genesis_avatar_url || undefined
      } : {})
    }));
    return { joined: Number(totals.joined || 0), completed: Number(totals.completed || 0), members };
  }

  const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

  function createEmailVerificationToken(userId) {
    db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(String(userId));
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    db.prepare("INSERT INTO email_verification_tokens (id, user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), String(userId), token, now.toISOString(), new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS).toISOString());
    return token;
  }

  function verifyEmailToken(token) {
    const raw = String(token || "");
    if (!raw) return { ok: false, error: "Token is required" };
    const row = db.prepare("SELECT * FROM email_verification_tokens WHERE token = ?").get(raw);
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      if (row && new Date(row.expires_at).getTime() <= Date.now()) db.prepare("DELETE FROM email_verification_tokens WHERE id = ?").run(row.id);
      return { ok: false, error: "Invalid or expired token" };
    }
    db.transaction(() => {
      db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(row.user_id);
      db.prepare("UPDATE email_verification_tokens SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    })();
    return { ok: true, userId: row.user_id };
  }

  function isEmailVerified(userId) {
    const row = db.prepare("SELECT email_verified FROM users WHERE id = ?").get(String(userId || ""));
    return row ? row.email_verified === 1 : false;
  }

  function getUserEmail(userId) {
    const row = db.prepare("SELECT email FROM users WHERE id = ?").get(String(userId || ""));
    return row ? row.email : null;
  }

  function findUserForVerification(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const row = db.prepare("SELECT id, email, email_verified FROM users WHERE email = ?").get(normalized);
    return row ? { id: row.id, email: row.email, emailVerified: row.email_verified === 1 } : null;
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

  /**
   * 列出所有用户及其基础活跃度统计（供运营后台使用）。
   * 不返回 password_hash。活跃会话指未过期的 session。
   * 设备 Token 数仅统计未撤销的。
   */
  function listUsersWithStats() {
    const now = new Date().toISOString();
    const rows = db.prepare(
      `SELECT
         u.id, u.email, u.created_at, u.email_verified,
         (SELECT COUNT(*) FROM sessions s
            WHERE s.user_id = u.id AND s.expires_at > ?) AS active_session_count,
         (SELECT MAX(s.created_at) FROM sessions s
            WHERE s.user_id = u.id) AS last_session_at,
         (SELECT COUNT(*) FROM device_tokens dt
            WHERE dt.user_id = u.id AND dt.revoked_at IS NULL) AS active_device_token_count
       FROM users u
       ORDER BY u.created_at DESC`
    ).all(now);
    return rows.map(row => ({
      id: row.id,
      email: row.email,
      createdAt: row.created_at,
      emailVerified: row.email_verified === 1,
      activeSessionCount: row.active_session_count,
      lastSessionAt: row.last_session_at,
      activeDeviceTokenCount: row.active_device_token_count
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
    listDeviceTokens,
    listUsersWithStats,
    activateGenesisIdentity,
    updateGenesisIdentity,
    getGenesisArchive,
    createEmailVerificationToken,
    verifyEmailToken,
    isEmailVerified,
    getUserEmail,
    findUserForVerification
  };
}
