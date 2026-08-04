import Database from "better-sqlite3";

const databasePath = process.env.DATA_DB_PATH || "/var/lib/mindiou/mindiou.sqlite";
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const namespaces = Object.fromEntries(db.prepare(
    "SELECT namespace, payload FROM application_state ORDER BY namespace"
  ).all().map(row => {
    const payload = JSON.parse(row.payload);
    return [row.namespace, Object.fromEntries(Object.entries(payload).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.length : typeof value
    ]))];
  }));
  const result = {
    databasePath,
    integrity: db.pragma("integrity_check", { simple: true }),
    journalMode: db.pragma("journal_mode", { simple: true }),
    synchronous: db.pragma("synchronous", { simple: true }),
    foreignKeys: db.pragma("foreign_keys", { simple: true }),
    users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    sessions: db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,
    deviceTokens: db.prepare("SELECT COUNT(*) AS count FROM device_tokens").get().count,
    namespaces,
    migrations: db.prepare(
      "SELECT migration_key, source_path, record_count FROM data_migrations ORDER BY migration_key"
    ).all(),
    dailyUsageRows: db.prepare("SELECT COUNT(*) AS count FROM daily_usage").get().count
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
