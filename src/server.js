import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const PORT = 8787;
const HOST = "0.0.0.0";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const STATIC = {
  "/": "index.html",
  "/login": "login.html",
  "/register": "register.html",
  "/overlay/likes": "overlay.html",
  "/overlay/gifts": "overlay.html",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
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

async function serveStatic(res, fileName) {
  const filePath = path.resolve(publicDir, fileName);
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendJson(res, 403, { error: "Caminho negado." });
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
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

    if (req.method === "GET" && pathname === "/api/state") {
      const key = url.searchParams.get("key");
      const user = key ? userByOverlayKey(key) : requireUser(req);
      if (!user) {
        sendJson(res, 404, { error: "Chave do overlay inválida." });
        return;
      }
      sendJson(res, 200, getLiveSession(user.id).getState());
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
      sendJson(res, 200, getLiveSession(user.id).reset());
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
  const live = getLiveSession(user.id);
  const send = (state) => {
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "state", state }));
  };
  send(live.getState());
  const unsubscribe = live.subscribe(send);
  socket.on("close", unsubscribe);
});

server.listen(PORT, HOST, () => {
  console.log(`Painel: http://127.0.0.1:${PORT}`);
});
