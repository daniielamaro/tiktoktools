const TOP_LIMIT = 20;
const FEED_LIMIT = 8;

export function createRankings() {
  return {
    status: "idle",
    message: "",
    uniqueId: "",
    roomId: "",
    viewers: 0,
    peakViewers: 0,
    startedAt: 0,
    totalLikes: 0,
    totalLikesKnown: false,
    baselineOpen: true,
    holdEvents: false,
    likers: new Map(),
    gifters: new Map(),
    followCount: 0,
    shareCount: 0,
    joinCount: 0,
    comments: [],
    recentGifts: [],
    recentGifters: [],
    lastGift: null,
    likeCombo: null,
    giftCounts: {},
    recentFollows: [],
    recentShares: [],
    recentJoins: [],
    spin: null,
    countdownEndsAt: 0,
    diamondBank: 0,
    goalBaseline: null,
    statsBaseline: null,
    statsPeak: 0,
    alertsEpoch: 0,
  };
}

export function normalizeUniqueId(input) {
  let value = String(input || "").trim();
  const fromUrl = value.match(/tiktok\.com\/@([^/?#]+)/i);
  if (fromUrl) value = decodeURIComponent(fromUrl[1]);
  return value.replace(/^@+/, "").trim();
}

function avatarOf(user) {
  if (!user || typeof user !== "object") return "";
  if (typeof user.profilePictureUrl === "string" && user.profilePictureUrl) {
    return user.profilePictureUrl;
  }
  const pictures = [user.avatarThumb, user.avatarMedium, user.avatarLarge, user.profilePicture];
  for (const pic of pictures) {
    if (!pic) continue;
    if (typeof pic === "string") return pic;
    const urls = pic.urlList || pic.url_list || pic.url || pic.urls || pic.mUrls;
    if (Array.isArray(urls) && urls.length && urls[0]) return String(urls[0]);
  }
  return "";
}

function pictureOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const urls = value.urlList || value.url_list || value.url || value.urls;
  if (Array.isArray(urls) && urls[0]) return String(urls[0]);
  if (typeof urls === "string") return urls;
  return "";
}

export function identityFrom(data) {
  const user = data?.user && typeof data.user === "object" ? data.user : {};
  const uniqueId = String(
    user.uniqueId || user.displayId || user.display_id || data?.uniqueId || "",
  ).trim();
  const nickname = String(user.nickname || data?.nickname || uniqueId).trim() || uniqueId;
  return { uniqueId, nickname, avatar: avatarOf(user) };
}

function touch(map, identity, extras) {
  let row = map.get(identity.uniqueId);
  if (!row) {
    row = { uniqueId: identity.uniqueId, nickname: identity.nickname, avatar: identity.avatar, ...extras };
    map.set(identity.uniqueId, row);
    return row;
  }
  if (identity.nickname) row.nickname = identity.nickname;
  if (identity.avatar) row.avatar = identity.avatar;
  return row;
}

function prepend(list, item, limit) {
  return [item, ...list].slice(0, limit);
}

export function setViewers(rankings, count) {
  if (!Number.isFinite(count) || count < 0) return false;
  rankings.viewers = count;
  if (count > rankings.peakViewers) rankings.peakViewers = count;
  if (count > rankings.statsPeak) rankings.statsPeak = count;
  return true;
}

export function giftNameOf(data) {
  return String(
    data?.giftName
    || data?.gift?.name
    || data?.extendedGiftInfo?.name
    || data?.giftDetails?.giftName
    || data?.describe
    || "Presente",
  ).trim() || "Presente";
}

export function giftPictureOf(data) {
  return pictureOf(
    data?.giftPictureUrl
    || data?.gift?.image
    || data?.gift?.icon
    || data?.extendedGiftInfo?.image
    || data?.extendedGiftInfo?.icon
    || data?.giftDetails?.icon,
  );
}

export function addLike(rankings, data) {
  const total = Number(data?.totalLikeCount ?? data?.total);
  const likeCount = Number(data?.likeCount ?? data?.count);
  if (rankings.baselineOpen) {
    if (Number.isFinite(total) && total >= rankings.totalLikes) {
      rankings.totalLikes = total;
      rankings.totalLikesKnown = true;
    }
  } else if (Number.isFinite(likeCount) && likeCount > 0) {
    rankings.totalLikes += likeCount;
    rankings.totalLikesKnown = true;
  }
  if (rankings.holdEvents) return;
  if (!Number.isFinite(likeCount) || likeCount <= 0) return;
  const identity = identityFrom(data);
  if (!identity.uniqueId) return;
  const row = touch(rankings.likers, identity, { likes: 0 });
  row.likes += likeCount;
  const now = Date.now();
  if (rankings.likeCombo?.uniqueId === identity.uniqueId && now - rankings.likeCombo.at < 2500) {
    rankings.likeCombo.count += likeCount;
    rankings.likeCombo.at = now;
    rankings.likeCombo.nickname = identity.nickname;
    if (identity.avatar) rankings.likeCombo.avatar = identity.avatar;
  } else {
    rankings.likeCombo = { ...identity, count: likeCount, at: now };
  }
}

export function applyGiftRanks(rankings, ranks) {
  if (!rankings.baselineOpen || !Array.isArray(ranks)) return false;
  let applied = false;
  for (const row of ranks) {
    const identity = identityFrom(row);
    const score = Number(row?.score);
    if (!identity.uniqueId || !Number.isFinite(score) || score <= 0) continue;
    const current = touch(rankings.gifters, identity, { diamonds: 0, giftCount: 0 });
    if (score > current.diamonds) current.diamonds = score;
    applied = true;
  }
  return applied;
}

export function diamondUnit(data) {
  const candidates = [
    data?.gift?.diamondCount,
    data?.gift?.diamond_count,
    data?.extendedGiftInfo?.diamondCount,
    data?.extendedGiftInfo?.diamond_count,
    data?.giftDetails?.diamondCount,
    data?.giftDetails?.diamond_count,
    data?.diamondCount,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

export function isStreakGift(data) {
  const type = data?.giftDetails?.giftType
    ?? data?.gift?.gift_type
    ?? data?.gift?.type
    ?? data?.extendedGiftInfo?.gift_type
    ?? data?.extendedGiftInfo?.type
    ?? data?.giftType;
  if (Number(type) === 1) return true;
  return data?.gift?.combo === true || data?.extendedGiftInfo?.combo === true;
}

export function streakFinished(data) {
  return data?.repeatEnd === true || Number(data?.repeatEnd) === 1;
}

export function addGift(rankings, data) {
  if (rankings.holdEvents) return null;
  if (isStreakGift(data) && !streakFinished(data)) return null;

  const identity = identityFrom(data);
  if (!identity.uniqueId) return null;

  const repeatCount = Math.max(1, Number(data?.repeatCount) || 1);
  const diamonds = diamondUnit(data) * repeatCount;
  const row = touch(rankings.gifters, identity, { diamonds: 0, giftCount: 0 });
  row.diamonds += diamonds;
  row.giftCount += repeatCount;

  const giftName = giftNameOf(data);
  const key = giftName.toLowerCase();
  rankings.giftCounts[key] = (rankings.giftCounts[key] || 0) + repeatCount;
  const event = {
    kind: "gift",
    ...identity,
    giftName,
    giftPicture: giftPictureOf(data),
    diamonds,
    count: repeatCount,
    at: Date.now(),
  };
  rankings.lastGift = event;
  rankings.recentGifts = prepend(rankings.recentGifts, event, FEED_LIMIT);
  rankings.recentGifters = [
    identity,
    ...rankings.recentGifters.filter((item) => item.uniqueId !== identity.uniqueId),
  ].slice(0, 5);
  return event;
}

function rememberPerson(rankings, listKey, identity, kind) {
  if (!identity.uniqueId) return null;
  const event = { kind, ...identity, at: Date.now() };
  rankings[listKey] = prepend(rankings[listKey], event, FEED_LIMIT);
  return event;
}

export function addFollow(rankings, data) {
  if (rankings.holdEvents) return null;
  const identity = identityFrom(data);
  const event = rememberPerson(rankings, "recentFollows", identity, "follow");
  if (!event) return null;
  rankings.followCount += 1;
  return event;
}

export function addShare(rankings, data) {
  if (rankings.holdEvents) return null;
  const identity = identityFrom(data);
  const event = rememberPerson(rankings, "recentShares", identity, "share");
  if (!event) return null;
  rankings.shareCount += 1;
  return event;
}

export function addJoin(rankings, data) {
  if (rankings.holdEvents) return null;
  const action = Number(data?.action ?? data?.actionId);
  if (Number.isFinite(action) && action === 2) return null;
  const identity = identityFrom(data);
  const event = rememberPerson(rankings, "recentJoins", identity, "join");
  if (!event) return null;
  rankings.joinCount += 1;
  return event;
}

export function addChat(rankings, data) {
  if (rankings.holdEvents) return null;
  const identity = identityFrom(data);
  const comment = String(data?.comment || data?.content || "").trim();
  if (!identity.uniqueId || !comment) return null;
  const event = { kind: "chat", ...identity, comment: comment.slice(0, 140), at: Date.now() };
  rankings.comments = prepend(rankings.comments, event, 12);
  return event;
}

export function socialKind(data) {
  const display = String(data?.displayType || data?.display_type || data?.label || "").toLowerCase();
  if (display.includes("follow")) return "follow";
  if (display.includes("share")) return "share";
  return "";
}

function sumGifters(rankings) {
  let sum = 0;
  for (const row of rankings.gifters.values()) sum += row.diamonds;
  return sum;
}

function captureBaseline(rankings) {
  return {
    likes: rankings.totalLikes,
    diamonds: sumGifters(rankings) + (rankings.diamondBank || 0),
    viewers: rankings.viewers,
    follows: rankings.followCount,
    shares: rankings.shareCount,
    gifts: { ...rankings.giftCounts },
  };
}

export const RESET_SCOPES = [
  "likes",
  "gifts",
  "goals",
  "alerts",
  "ticker",
  "recent",
  "combo",
  "stats",
  "countdown",
  "chat",
  "wheel",
];

export function resetScope(rankings, scope) {
  if (scope === "likes") {
    rankings.likers = new Map();
    return true;
  }
  if (scope === "gifts") {
    rankings.diamondBank = (rankings.diamondBank || 0) + sumGifters(rankings);
    rankings.gifters = new Map();
    return true;
  }
  if (scope === "goals") {
    rankings.goalBaseline = captureBaseline(rankings);
    return true;
  }
  if (scope === "alerts") {
    rankings.alertsEpoch = (rankings.alertsEpoch || 0) + 1;
    return true;
  }
  if (scope === "ticker") {
    rankings.lastGift = null;
    return true;
  }
  if (scope === "recent") {
    rankings.recentGifters = [];
    return true;
  }
  if (scope === "combo") {
    rankings.likeCombo = null;
    return true;
  }
  if (scope === "stats") {
    rankings.statsBaseline = {
      likes: rankings.totalLikes,
      diamonds: sumGifters(rankings) + (rankings.diamondBank || 0),
      follows: rankings.followCount,
      shares: rankings.shareCount,
      startedAt: Date.now(),
    };
    rankings.statsPeak = rankings.viewers;
    return true;
  }
  if (scope === "countdown") {
    rankings.countdownEndsAt = 0;
    return true;
  }
  if (scope === "chat") {
    rankings.comments = [];
    return true;
  }
  if (scope === "wheel") {
    rankings.spin = null;
    return true;
  }
  return false;
}

export function resetScores(rankings) {
  rankings.likers = new Map();
  rankings.gifters = new Map();
  rankings.totalLikes = 0;
  rankings.totalLikesKnown = false;
  rankings.baselineOpen = false;
  rankings.holdEvents = false;
  rankings.followCount = 0;
  rankings.shareCount = 0;
  rankings.joinCount = 0;
  rankings.comments = [];
  rankings.recentGifts = [];
  rankings.recentGifters = [];
  rankings.lastGift = null;
  rankings.likeCombo = null;
  rankings.giftCounts = {};
  rankings.recentFollows = [];
  rankings.recentShares = [];
  rankings.recentJoins = [];
  rankings.spin = null;
  rankings.peakViewers = rankings.viewers;
  rankings.diamondBank = 0;
  rankings.goalBaseline = null;
  rankings.statsBaseline = null;
  rankings.statsPeak = rankings.viewers;
  rankings.alertsEpoch = (rankings.alertsEpoch || 0) + 1;
}

function trackedLikes(rankings) {
  let sum = 0;
  for (const row of rankings.likers.values()) sum += row.likes;
  return sum;
}

function totalDiamonds(rankings) {
  return sumGifters(rankings) + (rankings.diamondBank || 0);
}

function topRows(map, scoreKey) {
  return [...map.values()]
    .sort((a, b) => b[scoreKey] - a[scoreKey] || a.nickname.localeCompare(b.nickname, "pt"))
    .slice(0, TOP_LIMIT)
    .map((row) => ({ ...row }));
}

export function snapshot(rankings) {
  return {
    status: rankings.status,
    message: rankings.message,
    uniqueId: rankings.uniqueId,
    roomId: rankings.roomId,
    viewers: rankings.viewers,
    peakViewers: rankings.peakViewers,
    startedAt: rankings.startedAt,
    durationMs: rankings.startedAt ? Math.max(0, Date.now() - rankings.startedAt) : 0,
    totalLikes: rankings.totalLikes,
    totalLikesKnown: rankings.totalLikesKnown,
    trackedLikes: trackedLikes(rankings),
    totalDiamonds: totalDiamonds(rankings),
    followCount: rankings.followCount,
    shareCount: rankings.shareCount,
    joinCount: rankings.joinCount,
    topLikers: topRows(rankings.likers, "likes"),
    topGifters: topRows(rankings.gifters, "diamonds"),
    comments: rankings.comments.map((row) => ({ ...row })),
    recentGifts: rankings.recentGifts.map((row) => ({ ...row })),
    recentGifters: rankings.recentGifters.map((row) => ({ ...row })),
    lastGift: rankings.lastGift ? { ...rankings.lastGift } : null,
    likeCombo: rankings.likeCombo ? { ...rankings.likeCombo } : null,
    giftCounts: { ...rankings.giftCounts },
    recentFollows: rankings.recentFollows.map((row) => ({ ...row })),
    recentShares: rankings.recentShares.map((row) => ({ ...row })),
    recentJoins: rankings.recentJoins.map((row) => ({ ...row })),
    spin: rankings.spin ? { ...rankings.spin } : null,
    countdownEndsAt: rankings.countdownEndsAt || 0,
    goalBaseline: rankings.goalBaseline ? { ...rankings.goalBaseline, gifts: { ...rankings.goalBaseline.gifts } } : null,
    statsBaseline: rankings.statsBaseline ? { ...rankings.statsBaseline } : null,
    statsPeak: rankings.statsPeak || 0,
    alertsEpoch: rankings.alertsEpoch || 0,
  };
}
