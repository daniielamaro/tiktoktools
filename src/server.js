import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WebSocketServer } from "ws";
import {
  createSession,
  destroySession,
  loginUser,
  registerUser,
  saveTikTokId,
  userByOverlayKey,
  userFromSession,
} from "./auth.js";
import { dropLiveSession, getLiveSession } from "./live.js";
import { listHistory } from "./history.js";
import { listFrames, readStyles, saveStyle } from "./overlay-style.js";

const PORT = 8787;
const HOST = "0.0.0.0";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const STATIC = {
  "/": "index.html",
  "/login": "login.html",
  "/register": "register.html",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function cookiesOf(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(sessionId, maxAge) {
  const parts = [`sid=${encodeURIComponent(sessionId)}`, "HttpOnly", "SameSite=Lax", "Path=/"];
  if (maxAge === 0) parts.push("Max-Age=0");
  else parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function currentUser(req) {
  return userFromSession(cookiesOf(req).sid);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 100_000) {
        reject(Object.assign(new Error("Pedido grande demais."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("JSON inválido."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const resizedAssets = new Map();

async function resizedAsset(filePath, ext) {
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return null;
  if (!filePath.includes(`${path.sep}assets${path.sep}`)) return null;
  const info = await stat(filePath);
  const key = `${filePath}:${info.mtimeMs}`;
  if (resizedAssets.has(key)) return resizedAssets.get(key);
  const image = sharp(filePath, { failOn: "none" });
  const meta = await image.metadata();
  const largest = Math.max(meta.width || 0, meta.height || 0);
  if (largest <= 256) {
    resizedAssets.set(key, null);
    return null;
  }
  const buffer = await image
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  resizedAssets.set(key, buffer);
  return buffer;
}

async function serveStatic(res, fileName) {
  const filePath = path.resolve(publicDir, fileName);
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendJson(res, 403, { error: "Caminho negado." });
    return;
  }
  try {
    const ext = path.extname(filePath);
    let data = await readFile(filePath);
    let type = TYPES[ext] || "application/octet-stream";
    const smaller = await resizedAsset(filePath, ext).catch(() => null);
    if (smaller) {
      data = smaller;
      type = "image/png";
    }
    const cacheable = Boolean(smaller) || /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(ext);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": cacheable ? "public, max-age=86400" : "no-store",
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Não encontrado." });
  }
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

const socketsByUser = new Map();

function trackSocket(userId, socket) {
  let sockets = socketsByUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(userId, sockets);
  }
  sockets.add(socket);
  socket.on("close", () => {
    sockets.delete(socket);
    if (!sockets.size) socketsByUser.delete(userId);
  });
}

function pushStyle(userId) {
  const payload = JSON.stringify({ type: "style", style: readStyles(userId) });
  for (const socket of socketsByUser.get(userId) || []) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

function userFromKeyOrSession(req, key) {
  const user = key ? userByOverlayKey(key) : requireUser(req);
  if (!user) {
    const error = new Error("Chave do overlay inválida.");
    error.statusCode = 404;
    throw error;
  }
  return user;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) {
    const error = new Error("Entre na sua conta para continuar.");
    error.statusCode = 401;
    throw error;
  }
  return user;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "POST" && pathname === "/api/register") {
      const body = await readBody(req);
      const user = await registerUser(body.username, body.password);
      const session = createSession(user.id);
      sendJson(res, 200, user, { "Set-Cookie": sessionCookie(session.id, session.maxAge) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readBody(req);
      const user = await loginUser(body.username, body.password);
      const session = createSession(user.id);
      sendJson(res, 200, user, { "Set-Cookie": sessionCookie(session.id, session.maxAge) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const sid = cookiesOf(req).sid;
      const user = userFromSession(sid);
      destroySession(sid);
      if (user) await dropLiveSession(user.id);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      sendJson(res, 200, requireUser(req));
      return;
    }

    if (req.method === "GET" && pathname === "/api/frames") {
      sendJson(res, 200, listFrames());
      return;
    }

    if (req.method === "GET" && pathname === "/api/overlay-style") {
      const user = userFromKeyOrSession(req, url.searchParams.get("key"));
      sendJson(res, 200, readStyles(user.id));
      return;
    }

    if (req.method === "POST" && pathname === "/api/overlay-style") {
      const user = requireUser(req);
      const body = await readBody(req);
      const style = saveStyle(user.id, body.mode, body);
      pushStyle(user.id);
      sendJson(res, 200, style);
      return;
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const user = userFromKeyOrSession(req, url.searchParams.get("key"));
      sendJson(res, 200, getLiveSession(user.id).getState());
      return;
    }

    if (req.method === "POST" && pathname === "/api/preview") {
      const user = requireUser(req);
      sendJson(res, 200, getLiveSession(user.id).preview());
      return;
    }

    if (req.method === "POST" && pathname === "/api/connect") {
      const user = requireUser(req);
      const body = await readBody(req);
      const state = await getLiveSession(user.id).connect(body.uniqueId);
      saveTikTokId(user.id, state.uniqueId || "");
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && pathname === "/api/disconnect") {
      const user = requireUser(req);
      sendJson(res, 200, await getLiveSession(user.id).disconnect());
      return;
    }

    if (req.method === "POST" && pathname === "/api/reset") {
      const user = requireUser(req);
      const body = await readBody(req);
      sendJson(res, 200, getLiveSession(user.id).reset(body.scope));
      return;
    }

    if (req.method === "POST" && pathname === "/api/spin") {
      const user = requireUser(req);
      sendJson(res, 200, getLiveSession(user.id).spin());
      return;
    }

    if (req.method === "POST" && pathname === "/api/countdown") {
      const user = requireUser(req);
      const body = await readBody(req);
      sendJson(res, 200, getLiveSession(user.id).countdown(body.minutes, body.stop));
      return;
    }

    if (req.method === "GET" && pathname === "/api/history") {
      sendJson(res, 200, listHistory(requireUser(req).id));
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      if (!currentUser(req)) {
        redirect(res, "/login");
        return;
      }
      await serveStatic(res, STATIC[pathname]);
      return;
    }

    if (req.method === "GET" && (pathname === "/login" || pathname === "/register")) {
      if (currentUser(req)) {
        redirect(res, "/");
        return;
      }
      await serveStatic(res, STATIC[pathname]);
      return;
    }

    if (req.method === "GET" && /^\/overlay\/[a-z]+$/.test(pathname)) {
      await serveStatic(res, "overlay.html");
      return;
    }

    if (req.method === "GET" && STATIC[pathname]) {
      await serveStatic(res, STATIC[pathname]);
      return;
    }

    if (req.method === "GET" && (pathname.startsWith("/assets/") || /\.(css|js|svg|png|ico)$/.test(pathname))) {
      await serveStatic(res, pathname.slice(1));
      return;
    }

    sendJson(res, 404, { error: "Não encontrado." });
  } catch (err) {
    const status = err.statusCode || 500;
    sendJson(res, status, { error: err.message || "Erro interno." });
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    if (!res.headersSent) sendJson(res, 500, { error: err.message || "Erro interno." });
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, req) => {
  const url = new URL(req.url || "/ws", "http://127.0.0.1");
  const key = url.searchParams.get("key");
  const user = key ? userByOverlayKey(key) : currentUser(req);
  if (!user) {
    socket.close(1008, "sem conta");
    return;
  }
  trackSocket(user.id, socket);
  const live = getLiveSession(user.id);
  const send = (state) => {
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "state", state }));
  };
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "style", style: readStyles(user.id) }));
  }
  send(live.getState());
  const unsubscribe = live.subscribe(send);
  const unsubscribeEvents = live.subscribeEvents((event) => {
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "event", event }));
  });
  socket.on("close", () => {
    unsubscribe();
    unsubscribeEvents();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Painel: http://127.0.0.1:${PORT}`);
});
