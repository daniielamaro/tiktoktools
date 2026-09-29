import {
  ControlEvent,
  InvalidUniqueIdError,
  TikTokLiveConnection,
  UserOfflineError,
  WebcastEvent,
} from "tiktok-live-connector";
import {
  addGift,
  addLike,
  applyGiftRanks,
  createRankings,
  normalizeUniqueId,
  resetScores,
  snapshot,
} from "./rankings.js";

const sessions = new Map();

export function getLiveSession(userId) {
  let session = sessions.get(userId);
  if (!session) {
    session = createSession(userId);
    sessions.set(userId, session);
  }
  return session;
}

export async function dropLiveSession(userId) {
  const session = sessions.get(userId);
  if (!session) return;
  sessions.delete(userId);
  await session.disconnect();
}

function createSession(userId) {
  const ctx = {
    userId,
    rankings: createRankings(),
    connection: null,
    generation: 0,
    listeners: new Set(),
    broadcastTimer: null,
    preview: null,
    previewTimer: null,
  };

  return {
    getState() {
      return published(ctx);
    },
    subscribe(listener) {
      ctx.listeners.add(listener);
      return () => ctx.listeners.delete(listener);
    },
    connect(rawUniqueId) {
      return connect(ctx, rawUniqueId);
    },
    disconnect() {
      return disconnect(ctx);
    },
    reset() {
      return reset(ctx);
    },
    preview() {
      return startPreview(ctx);
    },
  };
}

function published(ctx) {
  return ctx.preview || snapshot(ctx.rankings);
}

function emitNow(ctx) {
  if (ctx.broadcastTimer) {
    clearTimeout(ctx.broadcastTimer);
    ctx.broadcastTimer = null;
  }
  const state = published(ctx);
  for (const listener of ctx.listeners) listener(state);
}

function scheduleBroadcast(ctx) {
  if (ctx.broadcastTimer) return;
  ctx.broadcastTimer = setTimeout(() => {
    ctx.broadcastTimer = null;
    const state = published(ctx);
    for (const listener of ctx.listeners) listener(state);
  }, 250);
}

function describeError(err) {
  const message = String(err?.message || err || "");
  if (err instanceof UserOfflineError || /offline|isn.?t online|not live|is not live/i.test(message)) {
    return "Essa conta não está ao vivo agora.";
  }
  if (err instanceof InvalidUniqueIdError) {
    return "Esse @ não é válido.";
  }
  if (/rate limit|429|too many/i.test(message)) {
    return "Muitas tentativas seguidas. Espere um pouco e tente de novo.";
  }
  if (/business plan|premium feature|status code 402/i.test(message)) {
    return "O serviço que libera a conexão com a live recusou o pedido. Tente de novo em alguns minutos.";
  }
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message)) {
    return "Não foi possível falar com o TikTok. Verifique a internet e tente de novo.";
  }
  if (/blocked by TikTok|captcha/i.test(message)) {
    return "O TikTok bloqueou a consulta deste computador. Espere um pouco e tente de novo.";
  }
  return "Não foi possível conectar. Confira o @ e tente de novo.";
}

function countFrom(candidates) {
  for (const value of candidates) {
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return null;
}

function viewersFromRoomUser(data) {
  return countFrom([data?.total]);
}

function viewersFromRoomInfo(roomInfo) {
  const data = roomInfo?.data && typeof roomInfo.data === "object" ? roomInfo.data : roomInfo;
  return countFrom([data?.user_count, data?.userCount, data?.viewer_count, data?.viewerCount]);
}

function likesFromRoomInfo(roomInfo) {
  const data = roomInfo?.data && typeof roomInfo.data === "object" ? roomInfo.data : roomInfo;
  if (!data) return null;
  const total = countFrom([
    data.like_count,
    data.likeCount,
    data.stats?.like_count,
    data.stats?.digg_count,
  ]);
  return total > 0 ? total : null;
}

function withGiftInfo(data, gifts) {
  if (!data || data.extendedGiftInfo || !Array.isArray(gifts)) return data;
  const giftId = String(data.giftId ?? data.gift?.id ?? "");
  if (!giftId) return data;
  const info = gifts.find((gift) => String(gift?.id) === giftId);
  return info ? { ...data, extendedGiftInfo: info } : data;
}

async function closeConnection(ctx) {
  const current = ctx.connection;
  ctx.connection = null;
  if (!current) return;
  current.removeAllListeners();
  try {
    await current.disconnect();
  } catch {
    // A live já pode ter caído.
  }
}

function bindConnection(ctx, current, generation) {
  const stillCurrent = () => generation === ctx.generation && ctx.connection === current;

  current.on(WebcastEvent.LIKE, (data) => {
    if (!stillCurrent()) return;
    addLike(ctx.rankings, data);
    scheduleBroadcast(ctx);
  });

  current.on(WebcastEvent.GIFT, (data) => {
    if (!stillCurrent()) return;
    if (addGift(ctx.rankings, withGiftInfo(data, current.availableGifts))) scheduleBroadcast(ctx);
  });

  current.on(WebcastEvent.ROOM_USER, (data) => {
    if (!stillCurrent()) return;
    const viewers = viewersFromRoomUser(data);
    if (viewers !== null) ctx.rankings.viewers = viewers;
    if (applyGiftRanks(ctx.rankings, data?.ranks)) scheduleBroadcast(ctx);
    else if (viewers !== null) scheduleBroadcast(ctx);
  });

  current.on(WebcastEvent.STREAM_END, () => {
    if (!stillCurrent()) return;
    ctx.rankings.status = "offline";
    ctx.rankings.message = "A live encerrou.";
    emitNow(ctx);
  });

  current.on(ControlEvent.DISCONNECTED, () => {
    if (!stillCurrent()) return;
    if (ctx.rankings.status === "offline") return;
    ctx.rankings.status = "offline";
    ctx.rankings.message = "A conexão com a live caiu.";
    emitNow(ctx);
  });
}

async function connect(ctx, rawUniqueId) {
  const uniqueId = normalizeUniqueId(rawUniqueId);
  if (!uniqueId) {
    const error = new Error("Informe o @ da conta.");
    error.statusCode = 400;
    throw error;
  }

  const generation = ++ctx.generation;
  await closeConnection(ctx);

  ctx.rankings = createRankings();
  ctx.rankings.status = "connecting";
  ctx.rankings.uniqueId = uniqueId;
  ctx.rankings.message = "Conectando na live…";
  ctx.rankings.holdEvents = true;
  emitNow(ctx);

  const next = new TikTokLiveConnection(uniqueId, {
    processInitialData: true,
  });
  ctx.connection = next;
  bindConnection(ctx, next, generation);

  try {
    const state = await next.connect();
    if (generation !== ctx.generation) return snapshot(ctx.rankings);
    ctx.rankings.status = "live";
    ctx.rankings.roomId = String(state?.roomId || next.roomId || "");
    ctx.rankings.message = "";
    const viewerCount = viewersFromRoomInfo(next.roomInfo);
    if (viewerCount !== null) ctx.rankings.viewers = viewerCount;
    const roomLikes = likesFromRoomInfo(next.roomInfo);
    if (roomLikes !== null) {
      ctx.rankings.totalLikes = roomLikes;
      ctx.rankings.totalLikesKnown = true;
    }
    ctx.rankings.holdEvents = false;
    emitNow(ctx);
    return snapshot(ctx.rankings);
  } catch (err) {
    if (generation !== ctx.generation) throw err;
    next.removeAllListeners();
    try {
      await next.disconnect();
    } catch {
      // A conexão não chegou a abrir.
    }
    if (ctx.connection === next) ctx.connection = null;
    ctx.rankings.status = "error";
    ctx.rankings.message = describeError(err);
    console.error("Falha ao conectar:", err?.message || err);
    emitNow(ctx);
    const error = new Error(ctx.rankings.message);
    error.statusCode = 400;
    throw error;
  }
}

async function disconnect(ctx) {
  ctx.generation += 1;
  clearPreview(ctx);
  await closeConnection(ctx);
  ctx.rankings = createRankings();
  emitNow(ctx);
  return published(ctx);
}

function reset(ctx) {
  if (ctx.rankings.status !== "live" && ctx.rankings.status !== "connecting" && ctx.rankings.status !== "offline") {
    return published(ctx);
  }
  clearPreview(ctx);
  resetScores(ctx.rankings);
  emitNow(ctx);
  return published(ctx);
}

const PREVIEW_MS = 15_000;
const PREVIEW_NAMES = ["Luna", "Miguel", "Helena", "Caio", "Alice", "Bruno", "Valentina", "Davi", "Sofia", "Enzo"];

function avatarFor(name, hue) {
  const letter = name.charAt(0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${hue} 52% 42%)"/><text x="48" y="62" text-anchor="middle" font-size="42" font-family="Segoe UI,sans-serif" fill="white">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function previewPeople() {
  const names = [...PREVIEW_NAMES].sort(() => Math.random() - 0.5).slice(0, 5);
  return names.map((name, index) => ({
    uniqueId: name.toLowerCase(),
    nickname: name,
    avatar: avatarFor(name, (index * 67 + name.length * 40) % 360),
  }));
}

function clearPreview(ctx) {
  if (ctx.previewTimer) {
    clearTimeout(ctx.previewTimer);
    ctx.previewTimer = null;
  }
  ctx.preview = null;
}

function startPreview(ctx) {
  clearPreview(ctx);
  const people = previewPeople();
  const likeScores = [1840, 1260, 980, 410, 155];
  const giftScores = [860, 540, 310, 120, 40];
  const real = snapshot(ctx.rankings);
  ctx.preview = {
    ...real,
    message: "Teste de 15 segundos. Estes nomes não são da live.",
    totalLikesKnown: true,
    totalLikes: likeScores.reduce((sum, value) => sum + value, 0),
    trackedLikes: likeScores.reduce((sum, value) => sum + value, 0),
    totalDiamonds: giftScores.reduce((sum, value) => sum + value, 0),
    viewers: 842,
    topLikers: people.map((person, index) => ({ ...person, likes: likeScores[index] })),
    topGifters: [...people].reverse().map((person, index) => ({ ...person, diamonds: giftScores[index] })),
  };
  emitNow(ctx);
  ctx.previewTimer = setTimeout(() => {
    ctx.previewTimer = null;
    ctx.preview = null;
    emitNow(ctx);
  }, PREVIEW_MS);
  return published(ctx);
}
