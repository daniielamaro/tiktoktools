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
const GOAL_METRICS = new Set(["likes", "diamonds", "viewers"]);
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
  };
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
  const row = db.prepare("SELECT overlay_likes, overlay_gifts, overlay_goals FROM users WHERE id = ?").get(userId);
  return {
    catalog,
    likes: parseStored(row?.overlay_likes, "likes", catalog),
    gifts: parseStored(row?.overlay_gifts, "gifts", catalog),
    goals: parseGoalStored(row?.overlay_goals),
  };
}

export function saveStyle(userId, mode, body) {
  if (mode === "goals") {
    db.prepare("UPDATE users SET overlay_goals = ? WHERE id = ?").run(JSON.stringify(buildGoalStyle(body)), userId);
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
