import Database from "better-sqlite3";

const legacyPath = process.env.LEGACY_AUTH_DB_PATH || process.env.DATA_DB_PATH || "/var/lib/mindiou/mindiou.sqlite";
const targetPath = process.env.AUTH_STORE_PATH || "/var/lib/mindiou/auth-store.sqlite";
if (legacyPath === targetPath) throw new Error("Legacy and target auth databases must be different");

const legacy = new Database(legacyPath, { readonly: true });
const target = new Database(targetPath);
target.pragma("journal_mode = WAL");
target.pragma("foreign_keys = ON");
target.pragma("busy_timeout = 5000");

const columns = new Set(target.prepare("PRAGMA table_info(users)").all().map(row => row.name));
const requiredColumns = {
  display_name: "ALTER TABLE users ADD COLUMN display_name TEXT",
  genesis_number: "ALTER TABLE users ADD COLUMN genesis_number INTEGER",
  genesis_reserved_at: "ALTER TABLE users ADD COLUMN genesis_reserved_at TEXT",
  genesis_activated_at: "ALTER TABLE users ADD COLUMN genesis_activated_at TEXT",
  genesis_visibility: "ALTER TABLE users ADD COLUMN genesis_visibility TEXT NOT NULL DEFAULT 'private'",
  genesis_avatar_url: "ALTER TABLE users ADD COLUMN genesis_avatar_url TEXT"
};
for (const [column, sql] of Object.entries(requiredColumns)) {
  if (!columns.has(column)) target.exec(sql);
}
target.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_genesis_number ON users(genesis_number)");

const legacyUsers = legacy.prepare(`
  SELECT id, email, password_hash, created_at, email_verified,
         display_name, genesis_number, genesis_reserved_at,
         genesis_activated_at, genesis_visibility, genesis_avatar_url
  FROM users
`).all();
const targetUsersByEmail = new Map(target.prepare("SELECT id, email FROM users").all().map(row => [row.email, row]));
const userIdMap = new Map();
let insertedUsers = 0;
let remappedUsers = 0;
let renumberedUsers = 0;

const insertUser = target.prepare(`
  INSERT OR IGNORE INTO users
    (id, email, password_hash, created_at, email_verified, display_name,
     genesis_number, genesis_reserved_at, genesis_activated_at,
     genesis_visibility, genesis_avatar_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const targetGenesis = target.prepare("SELECT id FROM users WHERE genesis_number = ?");

const migrate = target.transaction(() => {
  for (const user of legacyUsers) {
    const existing = targetUsersByEmail.get(user.email);
    if (existing) {
      userIdMap.set(user.id, existing.id);
      if (existing.id !== user.id) remappedUsers += 1;
      continue;
    }

    let genesisNumber = user.genesis_number;
    let reservedAt = user.genesis_reserved_at;
    let activatedAt = user.genesis_activated_at;
    let visibility = user.genesis_visibility || "private";
    let avatarUrl = user.genesis_avatar_url;
    if (genesisNumber !== null && genesisNumber !== undefined && targetGenesis.get(genesisNumber)) {
      genesisNumber = null;
      reservedAt = null;
      activatedAt = null;
      visibility = "private";
      avatarUrl = null;
      renumberedUsers += 1;
    }

    const result = insertUser.run(
      user.id, user.email, user.password_hash, user.created_at,
      user.email_verified ? 1 : 0, user.display_name || null,
      genesisNumber, reservedAt, activatedAt, visibility, avatarUrl || null
    );
    if (result.changes === 1) insertedUsers += 1;
    userIdMap.set(user.id, user.id);
    targetUsersByEmail.set(user.email, { id: user.id, email: user.email });
  }

  const insertSession = target.prepare(
    "INSERT OR IGNORE INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  );
  for (const session of legacy.prepare("SELECT id, user_id, created_at, expires_at FROM sessions").all()) {
    const userId = userIdMap.get(session.user_id);
    if (userId) insertSession.run(session.id, userId, session.created_at, session.expires_at);
  }

  const insertVerification = target.prepare(
    "INSERT OR IGNORE INTO email_verification_tokens (id, user_id, token, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const token of legacy.prepare("SELECT id, user_id, token, created_at, expires_at, used_at FROM email_verification_tokens").all()) {
    const userId = userIdMap.get(token.user_id);
    if (userId) insertVerification.run(token.id, userId, token.token, token.created_at, token.expires_at, token.used_at);
  }

  const insertDeviceToken = target.prepare(
    "INSERT OR IGNORE INTO device_tokens (id, user_id, token_hash, name, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const token of legacy.prepare("SELECT id, user_id, token_hash, name, created_at, revoked_at FROM device_tokens").all()) {
    const userId = userIdMap.get(token.user_id);
    if (userId) insertDeviceToken.run(token.id, userId, token.token_hash, token.name, token.created_at, token.revoked_at);
  }
})();

const counts = table => Number(target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
console.log(JSON.stringify({
  ok: true,
  legacyUsers: legacyUsers.length,
  insertedUsers,
  remappedUsers,
  renumberedUsers,
  targetUsers: counts("users"),
  targetSessions: counts("sessions"),
  targetVerificationTokens: counts("email_verification_tokens"),
  targetDeviceTokens: counts("device_tokens")
}));

legacy.close();
target.close();
