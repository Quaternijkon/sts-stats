import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const tokenHash = (value) => createHash("sha256").update(value).digest("hex");
export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vaults (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL CHECK(game IN ('sts1','sts2')), revision INTEGER NOT NULL, updated INTEGER NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id,game));
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    PRAGMA user_version=1;`);
  return db;
}
export function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try { const value = operation(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function createInvite(db, hours = 72) {
  const code = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO invites(hash,expires) VALUES (?,?)").run(tokenHash(code), Date.now() + hours * 3600000);
  return code;
}
