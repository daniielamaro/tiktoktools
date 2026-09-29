import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.js";

const scrypt = promisify(scryptCallback);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    overlayKey: row.overlay_key,
    tiktokUniqueId: row.tiktok_unique_id || "",
  };
}

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateCredentials(username, password) {
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    return "O nome precisa ter de 3 a 32 caracteres: letras, números ou _.";
  }
  if (String(password || "").length < 6) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }
  return "";
}

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 64);
  return { hash: Buffer.from(hash).toString("hex"), salt: salt.toString("hex") };
}

export async function registerUser(rawUsername, password) {
  const username = normalizeUsername(rawUsername);
  const problem = validateCredentials(username, password);
  if (problem) {
    const error = new Error(problem);
    error.statusCode = 400;
    throw error;
  }
  if (db.prepare("SELECT id FROM users WHERE username = ?").get(username)) {
    const error = new Error("Esse nome já está em uso.");
    error.statusCode = 409;
    throw error;
  }
  const { hash, salt } = await hashPassword(password);
  const overlayKey = randomBytes(24).toString("base64url");
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, password_salt, overlay_key, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, hash, salt, overlayKey, createdAt);
  return publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid));
}

export async function loginUser(rawUsername, password) {
  const username = normalizeUsername(rawUsername);
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  const invalid = () => {
    const error = new Error("Nome ou senha incorretos.");
    error.statusCode = 401;
    return error;
  };
  if (!row) throw invalid();
  const hash = await scrypt(password, Buffer.from(row.password_salt, "hex"), 64);
  const expected = Buffer.from(row.password_hash, "hex");
  const actual = Buffer.from(hash);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid();
  return publicUser(row);
}

export function createSession(userId) {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_MS;
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, expiresAt);
  return { id, maxAge: Math.floor(SESSION_MS / 1000) };
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function userFromSession(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > ?
  `).get(sessionId, Date.now());
  return row ? publicUser(row) : null;
}

export function userByOverlayKey(overlayKey) {
  if (!overlayKey) return null;
  const row = db.prepare("SELECT * FROM users WHERE overlay_key = ?").get(overlayKey);
  return row ? publicUser(row) : null;
}

export function saveTikTokId(userId, uniqueId) {
  db.prepare("UPDATE users SET tiktok_unique_id = ? WHERE id = ?").run(uniqueId, userId);
}
