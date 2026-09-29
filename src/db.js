import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "app.sqlite"));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    overlay_key TEXT NOT NULL UNIQUE,
    tiktok_unique_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
if (!userColumns.has("overlay_likes")) {
  db.exec("ALTER TABLE users ADD COLUMN overlay_likes TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.has("overlay_gifts")) {
  db.exec("ALTER TABLE users ADD COLUMN overlay_gifts TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.has("overlay_goals")) {
  db.exec("ALTER TABLE users ADD COLUMN overlay_goals TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.has("overlay_tools")) {
  db.exec("ALTER TABLE users ADD COLUMN overlay_tools TEXT NOT NULL DEFAULT ''");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS live_history (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    unique_id TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    peak_viewers INTEGER NOT NULL DEFAULT 0,
    total_likes INTEGER NOT NULL DEFAULT 0,
    total_diamonds INTEGER NOT NULL DEFAULT 0,
    follow_count INTEGER NOT NULL DEFAULT 0,
    share_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
