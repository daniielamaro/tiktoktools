const TOP_LIMIT = 20;

export function createRankings() {
  return {
    status: "idle",
    message: "",
    uniqueId: "",
    roomId: "",
    viewers: 0,
    totalLikes: 0,
    totalLikesKnown: false,
    baselineOpen: true,
    holdEvents: false,
    likers: new Map(),
    gifters: new Map(),
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
  if (rankings.holdEvents) return false;
  if (isStreakGift(data) && !streakFinished(data)) return false;

  const identity = identityFrom(data);
  if (!identity.uniqueId) return false;

  const repeatCount = Math.max(1, Number(data?.repeatCount) || 1);
  const diamonds = diamondUnit(data) * repeatCount;
  const row = touch(rankings.gifters, identity, { diamonds: 0, giftCount: 0 });
  row.diamonds += diamonds;
  row.giftCount += repeatCount;
  return true;
}

export function resetScores(rankings) {
  rankings.likers = new Map();
  rankings.gifters = new Map();
  rankings.totalLikes = 0;
  rankings.totalLikesKnown = false;
  rankings.baselineOpen = false;
  rankings.holdEvents = false;
}

function trackedLikes(rankings) {
  let sum = 0;
  for (const row of rankings.likers.values()) sum += row.likes;
  return sum;
}

function totalDiamonds(rankings) {
  let sum = 0;
  for (const row of rankings.gifters.values()) sum += row.diamonds;
  return sum;
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
    totalLikes: rankings.totalLikes,
    totalLikesKnown: rankings.totalLikesKnown,
    trackedLikes: trackedLikes(rankings),
    totalDiamonds: totalDiamonds(rankings),
    topLikers: topRows(rankings.likers, "likes"),
    topGifters: topRows(rankings.gifters, "diamonds"),
  };
}
