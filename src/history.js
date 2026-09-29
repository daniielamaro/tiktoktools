import { db } from "./db.js";

export function recordLive(userId, state) {
  if (!userId || !state?.uniqueId) return;
  db.prepare(`
    INSERT INTO live_history (
      user_id, unique_id, started_at, ended_at, peak_viewers, total_likes, total_diamonds, follow_count, share_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    String(state.uniqueId || ""),
    Number(state.startedAt) || Date.now(),
    Date.now(),
    Number(state.peakViewers) || 0,
    Number(state.totalLikes) || 0,
    Number(state.totalDiamonds) || 0,
    Number(state.followCount) || 0,
    Number(state.shareCount) || 0,
  );
}

export function listHistory(userId, limit = 15) {
  return db.prepare(`
    SELECT id, unique_id AS uniqueId, started_at AS startedAt, ended_at AS endedAt,
      peak_viewers AS peakViewers, total_likes AS totalLikes, total_diamonds AS totalDiamonds,
      follow_count AS followCount, share_count AS shareCount
    FROM live_history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, limit);
}

export function allTimeTotals(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS lives,
      COALESCE(SUM(total_likes), 0) AS likes,
      COALESCE(SUM(total_diamonds), 0) AS diamonds,
      COALESCE(MAX(peak_viewers), 0) AS peakViewers,
      COALESCE(SUM(follow_count), 0) AS follows,
      COALESCE(SUM(share_count), 0) AS shares
    FROM live_history
    WHERE user_id = ?
  `).get(userId);
  return {
    lives: Number(row?.lives) || 0,
    likes: Number(row?.likes) || 0,
    diamonds: Number(row?.diamonds) || 0,
    peakViewers: Number(row?.peakViewers) || 0,
    follows: Number(row?.follows) || 0,
    shares: Number(row?.shares) || 0,
  };
}
