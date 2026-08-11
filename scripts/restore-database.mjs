import { mkdir, chmod, stat, readFile, writeFile, rm } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const sourceArg = process.env.RESTORE_SOURCE || process.argv[2] || "";
if (!sourceArg) throw new Error("Usage: node scripts/restore-database.mjs <backup.sqlite[.enc]> [target-directory]");
const sourcePath = path.resolve(sourceArg);
const targetDir = path.resolve(process.env.RESTORE_TARGET || process.argv[3] || "tmp/restore-drill");
const startedAt = Date.now();
await mkdir(targetDir, { recursive: true, mode: 0o750 });
const targetPath = path.join(targetDir, "mindiou.sqlite");
let readableSourcePath = sourcePath;
let decryptedSourcePath = "";
if (sourcePath.endsWith(".enc")) {
  const keyText = process.env.DATABASE_BACKUP_ENCRYPTION_KEY || "";
  if (!keyText) throw new Error("Encrypted backup requires DATABASE_BACKUP_ENCRYPTION_KEY");
  const envelope = JSON.parse(await readFile(sourcePath, "utf8"));
  const key = crypto.createHash("sha256").update(keyText).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  decryptedSourcePath = path.join(targetDir, ".restore-source.sqlite");
  await writeFile(decryptedSourcePath, plain, { mode: 0o640 });
  readableSourcePath = decryptedSourcePath;
}
const source = new Database(readableSourcePath, { readonly: true, fileMustExist: true });
try {
  if (source.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed");
  await source.backup(targetPath);
} finally { source.close(); }
const restored = new Database(targetPath, { readonly: true, fileMustExist: true });
try {
  const integrity = restored.pragma("integrity_check", { simple: true });
  const journalMode = String(restored.pragma("journal_mode", { simple: true })).toLowerCase();
  if (integrity !== "ok") throw new Error(`Restored integrity check failed: ${integrity}`);
  if (journalMode !== "wal") throw new Error(`Restored database is not WAL mode: ${journalMode}`);
  const tables = restored.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get().count;
  const elapsedMs = Date.now() - startedAt;
  const sourceStat = await stat(sourcePath);
  console.log(JSON.stringify({ ok: true, sourcePath, targetPath, sourceBytes: sourceStat.size, encryptedSource: sourcePath.endsWith(".enc"), tables, journalMode, elapsedMs, rtoTargetMs: 2 * 60 * 60 * 1000, rtoMet: elapsedMs <= 2 * 60 * 60 * 1000, rpoTargetHours: 24 }));
} finally { restored.close(); }
await chmod(targetDir, 0o750);
if (decryptedSourcePath) await rm(decryptedSourcePath, { force: true });
