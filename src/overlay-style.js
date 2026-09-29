import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const framesRoot = path.join(root, "public", "assets", "molduras");
const IMAGE = /\.(png|webp|gif|jpe?g)$/i;
const PLACES = [
  ["1", "1lugar"],
  ["2", "2lugar"],
  ["3", "3lugar"],
];
const DEFAULTS = {
  likes: { showTitle: true, title: "Top curtidas", titleColor: "#ff7a90" },
  gifts: { showTitle: true, title: "Top presentes", titleColor: "#7ef6ec" },
};
const TEXT_COLOR = "#ffffff";
const GOAL_METRICS = new Set(["likes", "diamonds", "viewers", "follows", "shares", "gift"]);
const GOAL_DEFAULTS = {
  showTitle: true,
  title: "Meta de curtidas",
  titleColor: "#ffd166",
  metric: "likes",
  target: 10000,
  barColor: "#ffd166",
  barTrackColor: "#2a3140",
  scoreColor: TEXT_COLOR,
  showPercent: true,
  showCounts: true,
  milestones: "",
  showSecond: false,
  secondMetric: "diamonds",
  secondTarget: 1000,
  sound: false,
  giftName: "",
};
export const TOOL_MODES = ["alerts", "ticker", "recent", "combo", "stats", "countdown", "chat", "wheel"];
const TOOL_DEFAULTS = {
  alerts: {
    showTitle: true,
    title: "Alertas",
    titleColor: "#ffd166",
    nameColor: TEXT_COLOR,
    duration: 5,
    gifts: true,
    follows: true,
    shares: true,
    joins: false,
  },
  ticker: { showTitle: true, title: "Último presente", titleColor: "#7ef6ec", nameColor: TEXT_COLOR },
  recent: { showTitle: true, title: "Últimos presentes", titleColor: "#7ef6ec", nameColor: TEXT_COLOR, scoreColor: TEXT_COLOR },
  combo: { showTitle: true, title: "Combo de curtidas", titleColor: "#ff7a90", nameColor: TEXT_COLOR, scoreColor: TEXT_COLOR },
  stats: { showTitle: true, title: "Live agora", titleColor: TEXT_COLOR, nameColor: TEXT_COLOR, scoreColor: TEXT_COLOR },
  countdown: { showTitle: true, title: "Contagem", titleColor: "#f5c16c", scoreColor: TEXT_COLOR, minutes: 20 },
  chat: { showTitle: true, title: "Chat", titleColor: TEXT_COLOR, nameColor: TEXT_COLOR },
  wheel: { showTitle: true, title: "Sorteio", titleColor: "#ffd166", nameColor: TEXT_COLOR },
};

function hexColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback;
}

function goalMetric(value) {
  return GOAL_METRICS.has(value) ? value : GOAL_DEFAULTS.metric;
}

function goalTarget(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return GOAL_DEFAULTS.target;
  return Math.min(1_000_000_000, parsed);
}

function defaultGoalStyle() {
  return { ...GOAL_DEFAULTS };
}

function intIn(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function milestonesText(value) {
  const parts = String(value || "")
    .split(/[,;]+/)
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 8);
  return parts.join(", ");
}

function flag(value, fallback) {
  return value == null ? fallback : Boolean(value);
}

function parseGoalStored(raw) {
  const fallback = defaultGoalStyle();
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw);
    return {
      showTitle: Boolean(data.showTitle),
      title: String(data.title || "").trim().slice(0, 40),
      titleColor: hexColor(data.titleColor, fallback.titleColor),
      metric: goalMetric(data.metric),
      target: goalTarget(data.target),
      barColor: hexColor(data.barColor, fallback.barColor),
      barTrackColor: hexColor(data.barTrackColor, fallback.barTrackColor),
      scoreColor: hexColor(data.scoreColor, fallback.scoreColor),
      showPercent: Boolean(data.showPercent),
      showCounts: Boolean(data.showCounts),
      milestones: milestonesText(data.milestones),
      showSecond: Boolean(data.showSecond),
      secondMetric: goalMetric(data.secondMetric || fallback.secondMetric),
      secondTarget: goalTarget(data.secondTarget || fallback.secondTarget),
      sound: Boolean(data.sound),
      giftName: String(data.giftName || "").trim().slice(0, 40),
    };
  } catch {
    return fallback;
  }
}

function buildGoalStyle(body) {
  const fallback = defaultGoalStyle();
  return {
    showTitle: Boolean(body?.showTitle),
    title: String(body?.title || "").trim().slice(0, 40),
    titleColor: hexColor(body?.titleColor, fallback.titleColor),
    metric: goalMetric(body?.metric),
    target: goalTarget(body?.target),
    barColor: hexColor(body?.barColor, fallback.barColor),
    barTrackColor: hexColor(body?.barTrackColor, fallback.barTrackColor),
    scoreColor: hexColor(body?.scoreColor, fallback.scoreColor),
    showPercent: Boolean(body?.showPercent),
    showCounts: Boolean(body?.showCounts),
    milestones: milestonesText(body?.milestones),
    showSecond: Boolean(body?.showSecond),
    secondMetric: goalMetric(body?.secondMetric || fallback.secondMetric),
    secondTarget: goalTarget(body?.secondTarget || fallback.secondTarget),
    sound: Boolean(body?.sound),
    giftName: String(body?.giftName || "").trim().slice(0, 40),
  };
}

function parseTool(mode, data) {
  const fallback = { ...TOOL_DEFAULTS[mode] };
  if (!data || typeof data !== "object") return fallback;
  const style = {
    showTitle: Boolean(data.showTitle),
    title: String(data.title || "").trim().slice(0, 40),
    titleColor: hexColor(data.titleColor, fallback.titleColor),
    nameColor: hexColor(data.nameColor, fallback.nameColor || TEXT_COLOR),
  };
  if (fallback.scoreColor) style.scoreColor = hexColor(data.scoreColor, fallback.scoreColor);
  if (mode === "alerts") {
    style.duration = intIn(data.duration, 2, 20, fallback.duration);
    style.gifts = flag(data.gifts, fallback.gifts);
    style.follows = flag(data.follows, fallback.follows);
    style.shares = flag(data.shares, fallback.shares);
    style.joins = flag(data.joins, fallback.joins);
  }
  if (mode === "countdown") style.minutes = intIn(data.minutes, 1, 180, fallback.minutes);
  return style;
}

function buildTool(mode, body) {
  return parseTool(mode, body);
}

function readTools(raw) {
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw) || {};
    } catch {
      data = {};
    }
  }
  const tools = {};
  for (const mode of TOOL_MODES) tools[mode] = parseTool(mode, data[mode]);
  return tools;
}

export function listFrames() {
  const catalog = { 1: [], 2: [], 3: [] };
  for (const [place, folder] of PLACES) {
    let names = [];
    try {
      names = readdirSync(path.join(framesRoot, folder));
    } catch {
      names = [];
    }
    catalog[place] = names
      .filter((name) => IMAGE.test(name) && path.basename(name) === name)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((file) => ({
        file,
        url: `/assets/molduras/${folder}/${encodeURIComponent(file)}`,
      }));
  }
  return catalog;
}

function defaultStyle(mode, catalog) {
  const base = DEFAULTS[mode];
  return {
    showTitle: base.showTitle,
    title: base.title,
    titleColor: base.titleColor,
    nameColor: TEXT_COLOR,
    scoreColor: TEXT_COLOR,
    placeNameColors: { 1: TEXT_COLOR, 2: TEXT_COLOR, 3: TEXT_COLOR },
    frames: {
      1: catalog[1][0]?.file || "",
      2: catalog[2][0]?.file || "",
      3: catalog[3][0]?.file || "",
    },
  };
}

function knownFile(catalog, place, file) {
  return catalog[place].some((item) => item.file === file) ? file : "";
}

function parseStored(raw, mode, catalog) {
  const fallback = defaultStyle(mode, catalog);
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw);
    const nameColor = hexColor(data.nameColor, TEXT_COLOR);
    return {
      showTitle: Boolean(data.showTitle),
      title: String(data.title || "").trim().slice(0, 40),
      titleColor: hexColor(data.titleColor, fallback.titleColor),
      nameColor,
      scoreColor: hexColor(data.scoreColor, TEXT_COLOR),
      placeNameColors: {
        1: hexColor(data.placeNameColors?.["1"], nameColor),
        2: hexColor(data.placeNameColors?.["2"], nameColor),
        3: hexColor(data.placeNameColors?.["3"], nameColor),
      },
      frames: {
        1: knownFile(catalog, "1", String(data.frames?.["1"] || "")),
        2: knownFile(catalog, "2", String(data.frames?.["2"] || "")),
        3: knownFile(catalog, "3", String(data.frames?.["3"] || "")),
      },
    };
  } catch {
    return fallback;
  }
}

export function readStyles(userId) {
  const catalog = listFrames();
  const row = db.prepare("SELECT overlay_likes, overlay_gifts, overlay_goals, overlay_tools FROM users WHERE id = ?").get(userId);
  return {
    catalog,
    likes: parseStored(row?.overlay_likes, "likes", catalog),
    gifts: parseStored(row?.overlay_gifts, "gifts", catalog),
    goals: parseGoalStored(row?.overlay_goals),
    ...readTools(row?.overlay_tools),
  };
}

export function saveStyle(userId, mode, body) {
  if (mode === "goals") {
    db.prepare("UPDATE users SET overlay_goals = ? WHERE id = ?").run(JSON.stringify(buildGoalStyle(body)), userId);
    return readStyles(userId);
  }
  if (TOOL_MODES.includes(mode)) {
    const row = db.prepare("SELECT overlay_tools FROM users WHERE id = ?").get(userId);
    const tools = readTools(row?.overlay_tools);
    tools[mode] = buildTool(mode, body);
    db.prepare("UPDATE users SET overlay_tools = ? WHERE id = ?").run(JSON.stringify(tools), userId);
    return readStyles(userId);
  }
  if (mode !== "likes" && mode !== "gifts") {
    const error = new Error("Overlay desconhecido.");
    error.statusCode = 400;
    throw error;
  }
  const catalog = listFrames();
  const fallback = defaultStyle(mode, catalog);
  const nameColor = hexColor(body?.nameColor, TEXT_COLOR);
  const style = {
    showTitle: Boolean(body?.showTitle),
    title: String(body?.title || "").trim().slice(0, 40),
    titleColor: hexColor(body?.titleColor, fallback.titleColor),
    nameColor,
    scoreColor: hexColor(body?.scoreColor, TEXT_COLOR),
    placeNameColors: {
      1: hexColor(body?.placeNameColors?.["1"], nameColor),
      2: hexColor(body?.placeNameColors?.["2"], nameColor),
      3: hexColor(body?.placeNameColors?.["3"], nameColor),
    },
    frames: {
      1: knownFile(catalog, "1", String(body?.frames?.["1"] || "")),
      2: knownFile(catalog, "2", String(body?.frames?.["2"] || "")),
      3: knownFile(catalog, "3", String(body?.frames?.["3"] || "")),
    },
  };
  const column = mode === "gifts" ? "overlay_gifts" : "overlay_likes";
  db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(JSON.stringify(style), userId);
  return readStyles(userId);
}
