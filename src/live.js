import {
  ControlEvent,
  InvalidUniqueIdError,
  TikTokLiveConnection,
  UserOfflineError,
  WebcastEvent,
} from "tiktok-live-connector";
import { allTimeTotals, recordLive } from "./history.js";
import {
  addChat,
  addFollow,
  addGift,
  addJoin,
  addLike,
  addShare,
  createRankings,
  normalizeUniqueId,
  resetScores,
  resetScope,
  setViewers,
  snapshot,
  socialKind,
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
    eventListeners: new Set(),
    broadcastTimer: null,
    preview: null,
    previewTimer: null,
    flashTimers: [],
    historySaved: false,
    allTime: allTimeTotals(userId),
    seenSocial: new Map(),
  };

  return {
    getState() {
      return published(ctx);
    },
    subscribe(listener) {
      ctx.listeners.add(listener);
      return () => ctx.listeners.delete(listener);
    },
    subscribeEvents(listener) {
      ctx.eventListeners.add(listener);
      return () => ctx.eventListeners.delete(listener);
    },
    connect(rawUniqueId) {
      return connect(ctx, rawUniqueId);
    },
    disconnect() {
      return disconnect(ctx);
    },
    reset(scope) {
      return reset(ctx, scope);
    },
    preview() {
      return startPreview(ctx);
    },
    spin() {
      return spin(ctx);
    },
    countdown(minutes, stop) {
      return setCountdown(ctx, minutes, stop);
    },
  };
}

function published(ctx) {
  const state = ctx.preview || snapshot(ctx.rankings);
  return { ...state, allTime: ctx.allTime };
}

function emitFlash(ctx, event) {
  if (!event) return;
  for (const listener of ctx.eventListeners) listener(event);
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

function onceSocial(ctx, kind, uniqueId) {
  if (!uniqueId) return false;
  const key = `${kind}:${uniqueId}`;
  const now = Date.now();
  if (now - (ctx.seenSocial.get(key) || 0) < 2000) return false;
  ctx.seenSocial.set(key, now);
  return true;
}

function saveHistory(ctx) {
  if (ctx.historySaved || !ctx.rankings.uniqueId) return;
  ctx.historySaved = true;
  try {
    recordLive(ctx.userId, snapshot(ctx.rankings));
    ctx.allTime = allTimeTotals(ctx.userId);
  } catch (err) {
    ctx.historySaved = false;
    console.error("Falha ao gravar histórico:", err?.message || err);
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
    const event = addGift(ctx.rankings, withGiftInfo(data, current.availableGifts));
    if (!event) return;
    scheduleBroadcast(ctx);
    emitFlash(ctx, event);
  });

  current.on(WebcastEvent.CHAT, (data) => {
    if (!stillCurrent()) return;
    if (!addChat(ctx.rankings, data)) return;
    scheduleBroadcast(ctx);
  });

  current.on(WebcastEvent.FOLLOW, (data) => {
    if (!stillCurrent()) return;
    const identity = data?.user || data;
    if (!onceSocial(ctx, "follow", identity?.uniqueId || identity?.displayId)) return;
    const event = addFollow(ctx.rankings, data);
    if (!event) return;
    scheduleBroadcast(ctx);
    emitFlash(ctx, event);
  });

  current.on(WebcastEvent.SHARE, (data) => {
    if (!stillCurrent()) return;
    const identity = data?.user || data;
    if (!onceSocial(ctx, "share", identity?.uniqueId || identity?.displayId)) return;
    const event = addShare(ctx.rankings, data);
    if (!event) return;
    scheduleBroadcast(ctx);
    emitFlash(ctx, event);
  });

  current.on(WebcastEvent.SOCIAL, (data) => {
    if (!stillCurrent()) return;
    const kind = socialKind(data);
    if (!kind) return;
    const uniqueId = data?.user?.uniqueId || data?.uniqueId;
    if (!onceSocial(ctx, kind, uniqueId)) return;
    const event = kind === "share" ? addShare(ctx.rankings, data) : addFollow(ctx.rankings, data);
    if (!event) return;
    scheduleBroadcast(ctx);
    emitFlash(ctx, event);
  });

  current.on(WebcastEvent.MEMBER, (data) => {
    if (!stillCurrent()) return;
    const event = addJoin(ctx.rankings, data);
    if (!event) return;
    scheduleBroadcast(ctx);
    emitFlash(ctx, event);
  });

  current.on(WebcastEvent.ROOM_USER, (data) => {
    if (!stillCurrent()) return;
    const viewers = viewersFromRoomUser(data);
    if (viewers !== null && setViewers(ctx.rankings, viewers)) scheduleBroadcast(ctx);
  });

  current.on(WebcastEvent.STREAM_END, () => {
    if (!stillCurrent()) return;
    ctx.rankings.status = "offline";
    ctx.rankings.message = "A live encerrou.";
    saveHistory(ctx);
    emitNow(ctx);
  });

  current.on(ControlEvent.DISCONNECTED, () => {
    if (!stillCurrent()) return;
    if (ctx.rankings.status === "offline") return;
    ctx.rankings.status = "offline";
    ctx.rankings.message = "A conexão com a live caiu.";
    saveHistory(ctx);
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
  if (ctx.rankings.status === "live" || ctx.rankings.status === "offline") saveHistory(ctx);
  await closeConnection(ctx);

  ctx.rankings = createRankings();
  ctx.rankings.status = "connecting";
  ctx.rankings.uniqueId = uniqueId;
  ctx.rankings.message = "Conectando na live…";
  ctx.rankings.baselineOpen = false;
  ctx.rankings.holdEvents = true;
  ctx.rankings.startedAt = Date.now();
  ctx.historySaved = false;
  ctx.seenSocial = new Map();
  emitNow(ctx);

  const next = new TikTokLiveConnection(uniqueId, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
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
    if (viewerCount !== null) setViewers(ctx.rankings, viewerCount);
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
  if (ctx.rankings.status === "live" || ctx.rankings.status === "offline") saveHistory(ctx);
  await closeConnection(ctx);
  ctx.rankings = createRankings();
  emitNow(ctx);
  return published(ctx);
}

function reset(ctx, scope) {
  if (ctx.rankings.status !== "live" && ctx.rankings.status !== "connecting" && ctx.rankings.status !== "offline") {
    return published(ctx);
  }
  if (!scope) {
    clearPreview(ctx);
    resetScores(ctx.rankings);
    emitNow(ctx);
    return published(ctx);
  }
  if (!resetScope(ctx.rankings, scope)) {
    const error = new Error("Overlay desconhecido.");
    error.statusCode = 400;
    throw error;
  }
  if (ctx.preview) resetPreview(ctx.preview, scope);
  emitNow(ctx);
  return published(ctx);
}

function resetPreview(preview, scope) {
  if (scope === "likes") preview.topLikers = [];
  if (scope === "gifts") preview.topGifters = [];
  if (scope === "goals") {
    preview.goalBaseline = {
      likes: preview.totalLikes || 0,
      diamonds: preview.totalDiamonds || 0,
      viewers: preview.viewers || 0,
      follows: preview.followCount || 0,
      shares: preview.shareCount || 0,
      gifts: { ...(preview.giftCounts || {}) },
    };
  }
  if (scope === "alerts") preview.alertsEpoch = (preview.alertsEpoch || 0) + 1;
  if (scope === "ticker") preview.lastGift = null;
  if (scope === "recent") preview.recentGifters = [];
  if (scope === "combo") preview.likeCombo = null;
  if (scope === "stats") {
    preview.statsBaseline = {
      likes: preview.totalLikes || 0,
      diamonds: preview.totalDiamonds || 0,
      follows: preview.followCount || 0,
      shares: preview.shareCount || 0,
      startedAt: Date.now(),
    };
    preview.statsPeak = preview.viewers || 0;
  }
  if (scope === "countdown") preview.countdownEndsAt = 0;
  if (scope === "chat") preview.comments = [];
  if (scope === "wheel") preview.spin = null;
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

function clearFlashTimers(ctx) {
  for (const timer of ctx.flashTimers || []) clearTimeout(timer);
  ctx.flashTimers = [];
}

function laterFlash(ctx, delay, event) {
  ctx.flashTimers.push(setTimeout(() => emitFlash(ctx, event), delay));
}

function clearPreview(ctx) {
  if (ctx.previewTimer) {
    clearTimeout(ctx.previewTimer);
    ctx.previewTimer = null;
  }
  clearFlashTimers(ctx);
  ctx.preview = null;
}

function startPreview(ctx) {
  clearPreview(ctx);
  const people = previewPeople();
  const likeScores = [1840, 1260, 980, 410, 155];
  const giftScores = [860, 540, 310, 120, 40];
  const gifts = ["Rosa", "Universo", "Leão", "Rosa", "Coração"];
  const now = Date.now();
  const comments = [
    { kind: "chat", ...people[0], comment: "bora bater a meta!", at: now },
    { kind: "chat", ...people[1], comment: "live top demais", at: now },
    { kind: "chat", ...people[2], comment: "mande rosa 🌹", at: now },
  ];
  const recentGifts = people.map((person, index) => ({
    kind: "gift",
    ...person,
    giftName: gifts[index],
    giftPicture: "",
    diamonds: giftScores[index],
    count: index === 0 ? 12 : 1,
    at: now,
  }));
  const real = snapshot(ctx.rankings);
  ctx.preview = {
    ...real,
    message: "Teste de 15 segundos. Estes nomes não são da live.",
    totalLikesKnown: true,
    totalLikes: likeScores.reduce((sum, value) => sum + value, 0),
    trackedLikes: likeScores.reduce((sum, value) => sum + value, 0),
    totalDiamonds: giftScores.reduce((sum, value) => sum + value, 0),
    viewers: 842,
    peakViewers: 910,
    startedAt: now - 18 * 60_000,
    durationMs: 18 * 60_000,
    followCount: 37,
    shareCount: 11,
    joinCount: 64,
    topLikers: people.map((person, index) => ({ ...person, likes: likeScores[index] })),
    topGifters: [...people].reverse().map((person, index) => ({ ...person, diamonds: giftScores[index] })),
    comments,
    recentGifts,
    recentGifters: people.slice(0, 5),
    lastGift: recentGifts[0],
    likeCombo: { ...people[2], count: 42, at: now },
    giftCounts: { rosa: 48, universo: 3, leão: 1, coração: 9 },
    recentFollows: people.slice(0, 3).map((person) => ({ kind: "follow", ...person, at: now })),
    recentShares: people.slice(1, 3).map((person) => ({ kind: "share", ...person, at: now })),
    recentJoins: people.slice(0, 4).map((person) => ({ kind: "join", ...person, at: now })),
    spin: { ...people[0], at: now },
    countdownEndsAt: now + 8 * 60_000,
    allTime: ctx.allTime,
  };
  emitNow(ctx);
  laterFlash(ctx, 200, recentGifts[0]);
  laterFlash(ctx, 1800, { kind: "follow", ...people[1], at: now });
  laterFlash(ctx, 3600, { kind: "share", ...people[3], at: now });
  laterFlash(ctx, 5400, { kind: "join", ...people[4], at: now });
  laterFlash(ctx, 7200, { kind: "spin", ...people[0], at: now });
  ctx.previewTimer = setTimeout(() => {
    ctx.previewTimer = null;
    clearFlashTimers(ctx);
    ctx.preview = null;
    emitNow(ctx);
  }, PREVIEW_MS);
  return published(ctx);
}

function spin(ctx) {
  const state = published(ctx);
  const pool = (state.recentGifters?.length ? state.recentGifters : state.topGifters) || [];
  if (!pool.length) {
    const error = new Error("Ainda não há gifters para sortear. Conecte a live ou use o teste de 15 segundos.");
    error.statusCode = 400;
    throw error;
  }
  const winner = pool[Math.floor(Math.random() * pool.length)];
  const event = { kind: "spin", uniqueId: winner.uniqueId, nickname: winner.nickname, avatar: winner.avatar, at: Date.now() };
  ctx.rankings.spin = event;
  if (ctx.preview) ctx.preview = { ...ctx.preview, spin: event };
  emitFlash(ctx, event);
  emitNow(ctx);
  return published(ctx);
}

function setCountdown(ctx, minutes, stop) {
  if (stop) {
    ctx.rankings.countdownEndsAt = 0;
    if (ctx.preview) ctx.preview = { ...ctx.preview, countdownEndsAt: 0 };
    emitNow(ctx);
    return published(ctx);
  }
  const mins = Math.min(180, Math.max(1, Number.parseInt(minutes, 10) || 20));
  const endsAt = Date.now() + mins * 60_000;
  ctx.rankings.countdownEndsAt = endsAt;
  if (ctx.preview) ctx.preview = { ...ctx.preview, countdownEndsAt: endsAt };
  emitNow(ctx);
  return published(ctx);
}
