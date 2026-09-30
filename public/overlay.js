const card = document.querySelector("#card");
const title = document.querySelector("#title");
const rows = document.querySelector("#rows");
const goal = document.querySelector("#goal");
const goalTrack = document.querySelector("#goal-track");
const goalFill = document.querySelector("#goal-fill");
const goalCounts = document.querySelector("#goal-counts");
const goalPercent = document.querySelector("#goal-percent");
const goalStep = document.querySelector("#goal-step");
const goalSecond = document.querySelector("#goal-second");
const goalSecondLabel = document.querySelector("#goal-second-label");
const goalTrack2 = document.querySelector("#goal-track-2");
const goalFill2 = document.querySelector("#goal-fill-2");
const goalCounts2 = document.querySelector("#goal-counts-2");
const goalPercent2 = document.querySelector("#goal-percent-2");
const stage = document.querySelector("#stage");
const MODES = new Set(["likes", "gifts", "goals", "alerts", "ticker", "recent", "combo", "stats", "countdown", "chat", "wheel"]);
const pathMode = location.pathname.replace(/\/$/, "").split("/").pop();
const mode = MODES.has(pathMode) ? pathMode : "likes";
const numberFormat = new Intl.NumberFormat("pt-BR");
const overlayKey = new URLSearchParams(location.search).get("key") || "";
const RANK_MODES = new Set(["likes", "gifts"]);
const TOOL_MODES = new Set(["alerts", "ticker", "recent", "combo", "stats", "countdown", "chat", "wheel"]);
const GOAL_STYLE = {
  showTitle: true,
  title: "Meta de curtidas",
  titleColor: "#ffd166",
  metric: "likes",
  target: 10000,
  barColor: "#ffd166",
  barTrackColor: "#2a3140",
  scoreColor: "#ffffff",
  showPercent: true,
  showCounts: true,
  milestones: "",
  showSecond: false,
  secondMetric: "diamonds",
  secondTarget: 1000,
  sound: false,
  giftName: "",
};
const KIND_LABEL = {
  gift: "presente",
  follow: "seguiu",
  share: "compartilhou",
  join: "entrou",
};

card.classList.add(mode);
if (mode === "goals" || TOOL_MODES.has(mode)) rows.hidden = true;

let stylePack = null;
let lastState = { status: "idle", topLikers: [], topGifters: [] };
let missingKey = !overlayKey;
let goalWasReached = false;
let alertQueue = [];
let alertBusy = false;
let clockTimer = 0;

function topLimit() {
  const params = new URLSearchParams(location.search);
  const parsed = Number.parseInt(params.get("top") || "5", 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(20, Math.max(1, parsed));
}

function currentStyle() {
  if (mode === "goals") return stylePack?.goals || GOAL_STYLE;
  if (TOOL_MODES.has(mode)) {
    return stylePack?.[mode] || { showTitle: true, title: "", titleColor: "#ffffff", nameColor: "#ffffff", scoreColor: "#ffffff" };
  }
  return stylePack?.[mode] || {
    showTitle: true,
    title: mode === "gifts" ? "Top presentes" : "Top curtidas",
    titleColor: mode === "gifts" ? "#7ef6ec" : "#ff7a90",
    nameColor: "#ffffff",
    scoreColor: "#ffffff",
    placeNameColors: { 1: "#ffffff", 2: "#ffffff", 3: "#ffffff" },
    frames: { 1: "", 2: "", 3: "" },
  };
}

function frameUrl(place) {
  const file = currentStyle().frames?.[place] || "";
  if (!file || !stylePack?.catalog) return "";
  const item = stylePack.catalog[place]?.find((entry) => entry.file === file);
  return item?.url || "";
}

function textColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : fallback;
}

function nameColorFor(place) {
  const style = currentStyle();
  const general = textColor(style.nameColor, "#ffffff");
  if (place <= 3) return textColor(style.placeNameColors?.[place], general);
  return general;
}

function initial(name) {
  const letter = String(name || "?").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

const warmed = new Set();

function preload(url) {
  if (!url || warmed.has(url)) return;
  warmed.add(url);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

function warmImages() {
  if (!RANK_MODES.has(mode)) return;
  preload(mode === "gifts" ? "/assets/moeda.png" : "/assets/coracao.png");
  for (const place of ["1", "2", "3"]) preload(frameUrl(place));
}

function applyTitle() {
  const style = currentStyle();
  const text = String(style.title || "").trim();
  if (style.showTitle && text) {
    title.hidden = false;
    title.textContent = text;
    title.style.color = style.titleColor || "";
    return;
  }
  title.hidden = true;
  title.textContent = "";
}

function rowSpec(row, place) {
  const frame = place <= 3 ? frameUrl(String(place)) : "";
  const name = row.nickname || row.uniqueId;
  const amount = mode === "gifts" ? row.diamonds : row.likes;
  return {
    key: `${row.uniqueId || name}|${frame ? "medal" : "plain"}|${frame}`,
    place,
    frame,
    name,
    avatar: row.avatar || "",
    amount: numberFormat.format(amount || 0),
    nameColor: nameColorFor(place),
    scoreColor: textColor(currentStyle().scoreColor, "#ffffff"),
    icon: mode === "gifts" ? "/assets/moeda.png" : "/assets/coracao.png",
  };
}

function fillPerson(person, spec) {
  const who = person.querySelector(".name");
  who.textContent = spec.name;
  who.style.color = spec.nameColor;
  const score = person.querySelector(".score");
  score.style.color = spec.scoreColor;
  person.querySelector(".score-value").textContent = spec.amount;
}

function samePicture(current, next) {
  if (!current || current === next) return current === next;
  try {
    const left = new URL(current, location.origin);
    const right = new URL(next, location.origin);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return false;
  }
}

function setFace(medal, spec) {
  const current = medal.querySelector(".avatar, .fallback");
  if (spec.avatar) {
    if (current?.classList.contains("avatar") && samePicture(current.getAttribute("src"), spec.avatar)) return;
    const face = document.createElement("img");
    face.className = "avatar";
    face.alt = "";
    face.decoding = "async";
    face.referrerPolicy = "no-referrer";
    face.src = spec.avatar;
    face.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = "fallback";
      fallback.textContent = initial(spec.name);
      face.replaceWith(fallback);
    });
    current?.replaceWith(face);
    return;
  }
  if (current?.classList.contains("fallback") && current.textContent === initial(spec.name)) return;
  const fallback = document.createElement("span");
  fallback.className = "fallback";
  fallback.textContent = initial(spec.name);
  current?.replaceWith(fallback);
}

function createRow(spec) {
  const item = document.createElement("li");
  item.dataset.key = spec.key;
  item.className = spec.frame ? `medal-row place-${spec.place}` : `plain place-${spec.place}`;
  const person = document.createElement("div");
  person.className = "person";
  const who = document.createElement("span");
  who.className = "name";
  const score = document.createElement("span");
  score.className = "score";
  const icon = document.createElement("img");
  icon.alt = "";
  icon.decoding = "async";
  icon.src = spec.icon;
  const value = document.createElement("span");
  value.className = "score-value";
  score.append(icon, value);
  person.append(who, score);
  fillPerson(person, spec);
  if (!spec.frame) {
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = String(spec.place);
    item.append(rank, person);
    return item;
  }
  const medal = document.createElement("div");
  medal.className = "medal";
  const frame = document.createElement("img");
  frame.className = "frame";
  frame.alt = "";
  frame.decoding = "async";
  frame.src = spec.frame;
  const face = document.createElement("span");
  face.className = "fallback";
  medal.append(face, frame);
  setFace(medal, spec);
  item.append(medal, person);
  return item;
}

function paintMessage(text, pulse) {
  const current = rows.firstElementChild;
  if (rows.childElementCount === 1 && current?.dataset.message === text) return;
  const item = document.createElement("li");
  item.className = "waiting";
  item.dataset.message = text;
  if (pulse) {
    const mark = document.createElement("span");
    mark.className = "pulse";
    item.append(mark);
  }
  const label = document.createElement("span");
  label.textContent = text;
  item.append(label);
  rows.replaceChildren(item);
}

function paintRows(list) {
  const specs = list.map((row, index) => rowSpec(row, index + 1));
  const current = [...rows.children];
  const nodes = specs.map((spec) => {
    const found = current.find((node) => node.dataset.key === spec.key);
    if (!found) return createRow(spec);
    found.className = spec.frame ? `medal-row place-${spec.place}` : `plain place-${spec.place}`;
    const rank = found.querySelector(".rank");
    if (rank) rank.textContent = String(spec.place);
    fillPerson(found.querySelector(".person"), spec);
    const medal = found.querySelector(".medal");
    if (medal) setFace(medal, spec);
    return found;
  });
  const same = nodes.length === current.length && nodes.every((node, index) => current[index] === node);
  if (!same) rows.replaceChildren(...nodes);
}

function metricValue(state, metric, giftName) {
  if (metric === "diamonds") return Number(state?.totalDiamonds) || 0;
  if (metric === "viewers") return Number(state?.viewers) || 0;
  if (metric === "follows") return Number(state?.followCount) || 0;
  if (metric === "shares") return Number(state?.shareCount) || 0;
  if (metric === "gift") {
    const key = String(giftName || "").trim().toLowerCase();
    return Number(state?.giftCounts?.[key]) || 0;
  }
  return Number(state?.totalLikes) || 0;
}

function goalProgress(state, metric, giftName) {
  const raw = metricValue(state, metric, giftName);
  const base = state?.goalBaseline;
  if (!base) return raw;
  if (metric === "gift") {
    const key = String(giftName || "").trim().toLowerCase();
    return Math.max(0, raw - (Number(base.gifts?.[key]) || 0));
  }
  const field = metric === "diamonds" || metric === "viewers" || metric === "follows" || metric === "shares"
    ? metric
    : "likes";
  return Math.max(0, raw - (Number(base[field]) || 0));
}

function activeGoal(style, current) {
  const marks = String(style.milestones || "")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const unique = [...new Set(marks)].sort((a, b) => a - b);
  if (!unique.length) return { target: Math.max(1, Number(style.target) || 10000), step: 0, total: 0 };
  const next = unique.find((n) => current < n) || unique[unique.length - 1];
  return { target: next, step: unique.indexOf(next) + 1, total: unique.length };
}

function fillBar(track, fill, countsEl, percentEl, style, current, target, label) {
  const ratio = Math.min(1, current / Math.max(1, target));
  const percent = Math.round(ratio * 100);
  const scoreColor = textColor(style.scoreColor, "#ffffff");
  track.style.background = textColor(style.barTrackColor, "#2a3140");
  fill.style.background = textColor(style.barColor, "#ffd166");
  fill.style.width = `${ratio * 100}%`;
  if (style.showCounts) {
    countsEl.hidden = false;
    countsEl.style.color = scoreColor;
    countsEl.textContent = `${label ? `${label} ` : ""}${numberFormat.format(current)} / ${numberFormat.format(target)}`;
  } else {
    countsEl.hidden = true;
    countsEl.textContent = "";
  }
  if (style.showPercent) {
    percentEl.hidden = false;
    percentEl.style.color = scoreColor;
    percentEl.textContent = `${percent}%`;
  } else {
    percentEl.hidden = true;
    percentEl.textContent = "";
  }
  return ratio >= 1;
}

function playGoalSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  [523, 659, 784].forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02 + index * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28 + index * 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + index * 0.08);
    osc.stop(now + 0.32 + index * 0.08);
  });
  setTimeout(() => ctx.close().catch(() => {}), 1200);
}

function paintGoal() {
  const style = currentStyle();
  const current = goalProgress(lastState, style.metric, style.giftName);
  const active = activeGoal(style, current);
  goal.hidden = false;
  rows.hidden = true;
  stage.hidden = true;
  if (active.total) {
    goalStep.hidden = false;
    goalStep.textContent = `Marco ${active.step} de ${active.total}`;
  } else {
    goalStep.hidden = true;
    goalStep.textContent = "";
  }
  const reached = fillBar(goalTrack, goalFill, goalCounts, goalPercent, style, current, active.target);
  goal.classList.toggle("reached", reached);
  if (reached && !goalWasReached && style.sound) playGoalSound();
  goalWasReached = reached;
  if (style.showSecond) {
    goalSecond.hidden = false;
    const secondCurrent = goalProgress(lastState, style.secondMetric, style.giftName);
    const secondTarget = Math.max(1, Number(style.secondTarget) || 1000);
    goalSecondLabel.textContent = style.secondMetric === "diamonds" ? "Diamantes" : style.secondMetric === "likes" ? "Curtidas" : style.secondMetric;
    fillBar(goalTrack2, goalFill2, goalCounts2, goalPercent2, style, secondCurrent, secondTarget);
  } else {
    goalSecond.hidden = true;
  }
}

function faceNode(avatar, name) {
  if (avatar) {
    const image = document.createElement("img");
    image.className = "face";
    image.alt = "";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = avatar;
    image.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = "face fallback";
      fallback.textContent = initial(name);
      image.replaceWith(fallback);
    });
    return image;
  }
  const fallback = document.createElement("span");
  fallback.className = "face fallback";
  fallback.textContent = initial(name);
  return fallback;
}

function showStage(htmlNode) {
  goal.hidden = true;
  rows.hidden = true;
  stage.hidden = false;
  stage.replaceChildren(htmlNode);
}

function waitingStage(text) {
  const wrap = document.createElement("div");
  wrap.className = "waiting-stage";
  const mark = document.createElement("span");
  mark.className = "pulse";
  const label = document.createElement("span");
  label.textContent = text;
  wrap.append(mark, label);
  showStage(wrap);
}

function paintTicker() {
  const gift = lastState.lastGift;
  if (!gift) {
    waitingStage("Aguardando um presente");
    return;
  }
  const style = currentStyle();
  const line = document.createElement("div");
  line.className = "last-gift";
  line.append(faceNode(gift.avatar, gift.nickname));
  const copy = document.createElement("div");
  copy.className = "alert-copy";
  const name = document.createElement("span");
  name.className = "name";
  name.style.color = textColor(style.nameColor, "#ffffff");
  name.textContent = gift.nickname;
  const detail = document.createElement("span");
  detail.className = "alert-detail";
  const times = gift.count > 1 ? ` x${numberFormat.format(gift.count)}` : "";
  detail.textContent = `enviou ${gift.giftName}${times} · ${numberFormat.format(gift.diamonds || 0)} diamantes`;
  copy.append(name, detail);
  line.append(copy);
  if (gift.giftPicture) {
    const pic = document.createElement("img");
    pic.className = "gift-pic";
    pic.alt = "";
    pic.src = gift.giftPicture;
    line.append(pic);
  }
  showStage(line);
}

function paintRecent() {
  const list = lastState.recentGifters || [];
  if (!list.length) {
    waitingStage("Aguardando presentes");
    return;
  }
  const style = currentStyle();
  const ol = document.createElement("ol");
  ol.className = "feed";
  for (const row of list) {
    const item = document.createElement("li");
    item.append(faceNode(row.avatar, row.nickname));
    const name = document.createElement("span");
    name.className = "name";
    name.style.color = textColor(style.nameColor, "#ffffff");
    name.textContent = row.nickname;
    item.append(name);
    ol.append(item);
  }
  showStage(ol);
}

function paintCombo() {
  const combo = lastState.likeCombo;
  if (!combo || Date.now() - Number(combo.at || 0) > 4000) {
    waitingStage("Aguardando combo de curtidas");
    return;
  }
  const style = currentStyle();
  const wrap = document.createElement("div");
  wrap.className = "combo";
  wrap.append(faceNode(combo.avatar, combo.nickname));
  const name = document.createElement("span");
  name.className = "name";
  name.style.color = textColor(style.nameColor, "#ffffff");
  name.textContent = combo.nickname;
  const score = document.createElement("span");
  score.className = "combo-count";
  score.style.color = textColor(style.scoreColor, "#ff7a90");
  score.textContent = `x${numberFormat.format(combo.count)}`;
  wrap.append(name, score);
  showStage(wrap);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function paintStats() {
  const style = currentStyle();
  const color = textColor(style.scoreColor, "#ffffff");
  const muted = textColor(style.nameColor, "#ffffff");
  const base = lastState.statsBaseline;
  const likes = Math.max(0, (Number(lastState.totalLikes) || 0) - (Number(base?.likes) || 0));
  const diamonds = Math.max(0, (Number(lastState.totalDiamonds) || 0) - (Number(base?.diamonds) || 0));
  const follows = Math.max(0, (Number(lastState.followCount) || 0) - (Number(base?.follows) || 0));
  const peak = base ? (lastState.statsPeak || 0) : (lastState.peakViewers || 0);
  const elapsed = base?.startedAt ? Date.now() - base.startedAt : lastState.durationMs;
  const items = [
    ["Espectadores", numberFormat.format(lastState.viewers || 0)],
    ["Pico", numberFormat.format(peak)],
    ["Curtidas", lastState.totalLikesKnown || base ? numberFormat.format(likes) : "—"],
    ["Diamantes", numberFormat.format(diamonds)],
    ["Follows", numberFormat.format(follows)],
    ["Tempo", formatDuration(elapsed)],
  ];
  const allTime = lastState.allTime;
  if (allTime?.lives) {
    items.push(["Lives", numberFormat.format(allTime.lives)]);
    items.push(["Histórico ♦", numberFormat.format(allTime.diamonds || 0)]);
  }
  const grid = document.createElement("dl");
  grid.className = "stats-grid";
  for (const [label, value] of items) {
    const block = document.createElement("div");
    const dt = document.createElement("dt");
    dt.style.color = muted;
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.style.color = color;
    dd.textContent = value;
    block.append(dt, dd);
    grid.append(block);
  }
  showStage(grid);
}

function remainingClock() {
  const ends = Number(lastState.countdownEndsAt) || 0;
  if (!ends) return null;
  return Math.max(0, ends - Date.now());
}

function paintCountdown() {
  const left = remainingClock();
  const style = currentStyle();
  const wrap = document.createElement("div");
  wrap.className = "clock";
  wrap.style.color = textColor(style.scoreColor, "#ffffff");
  wrap.textContent = left == null ? "—" : formatDuration(left);
  if (left === 0) wrap.classList.add("done");
  showStage(wrap);
}

function paintChat() {
  const list = lastState.comments || [];
  if (!list.length) {
    waitingStage("Aguardando comentários");
    return;
  }
  const style = currentStyle();
  const ol = document.createElement("ol");
  ol.className = "chat";
  for (const row of [...list].reverse()) {
    const item = document.createElement("li");
    const who = document.createElement("span");
    who.className = "name";
    who.style.color = textColor(style.nameColor, "#7ef6ec");
    who.textContent = row.nickname;
    const text = document.createElement("span");
    text.textContent = ` ${row.comment}`;
    item.append(who, text);
    ol.append(item);
  }
  showStage(ol);
}

function paintWheel() {
  const winner = lastState.spin;
  const style = currentStyle();
  const wrap = document.createElement("div");
  wrap.className = "wheel";
  if (!winner) {
    waitingStage("Aguardando sorteio");
    return;
  }
  wrap.append(faceNode(winner.avatar, winner.nickname));
  const name = document.createElement("span");
  name.className = "wheel-name winner";
  name.style.color = textColor(style.nameColor, "#ffd166");
  name.textContent = winner.nickname;
  const tag = document.createElement("span");
  tag.className = "wheel-tag";
  tag.textContent = "Ganhou o sorteio";
  wrap.append(name, tag);
  showStage(wrap);
}

function paintAlert(event) {
  const style = currentStyle();
  const wrap = document.createElement("div");
  wrap.className = `alert kind-${event.kind}`;
  wrap.append(faceNode(event.avatar, event.nickname));
  const copy = document.createElement("div");
  copy.className = "alert-copy";
  const name = document.createElement("span");
  name.className = "name";
  name.style.color = textColor(style.nameColor, "#ffffff");
  name.textContent = event.nickname;
  const detail = document.createElement("span");
  detail.className = "alert-detail";
  if (event.kind === "gift") {
    detail.textContent = `enviou ${event.giftName}${event.count > 1 ? ` x${event.count}` : ""} · ${numberFormat.format(event.diamonds || 0)} ♦`;
  } else {
    detail.textContent = KIND_LABEL[event.kind] || event.kind;
  }
  copy.append(name, detail);
  if (event.giftPicture) {
    const gift = document.createElement("img");
    gift.className = "gift-pic";
    gift.alt = "";
    gift.src = event.giftPicture;
    wrap.append(copy, gift);
  } else {
    wrap.append(copy);
  }
  showStage(wrap);
}

function clearAlertStage() {
  title.hidden = true;
  title.textContent = "";
  goal.hidden = true;
  rows.hidden = true;
  stage.hidden = true;
  stage.replaceChildren();
}

function pumpAlerts() {
  if (alertBusy || mode !== "alerts") return;
  const event = alertQueue.shift();
  if (!event) {
    clearAlertStage();
    return;
  }
  alertBusy = true;
  applyTitle();
  paintAlert(event);
  const ms = Math.max(2000, (Number(currentStyle().duration) || 5) * 1000);
  setTimeout(() => {
    alertBusy = false;
    pumpAlerts();
  }, ms);
}

function acceptAlert(event) {
  const style = currentStyle();
  if (event.kind === "gift") return style.gifts !== false;
  if (event.kind === "follow") return style.follows !== false;
  if (event.kind === "share") return style.shares !== false;
  if (event.kind === "join") return Boolean(style.joins);
  return false;
}

function handleEvent(event) {
  if (!event || missingKey) return;
  if (mode === "alerts" && acceptAlert(event)) {
    alertQueue.push(event);
    pumpAlerts();
    return;
  }
  if (mode === "wheel" && event.kind === "spin") {
    lastState = { ...lastState, spin: event };
    paintWheel();
  }
}

function paintTool() {
  if (mode === "alerts") {
    if (!alertBusy && !alertQueue.length) clearAlertStage();
    return;
  }
  if (mode === "ticker") return paintTicker();
  if (mode === "recent") return paintRecent();
  if (mode === "combo") return paintCombo();
  if (mode === "stats") return paintStats();
  if (mode === "countdown") return paintCountdown();
  if (mode === "chat") return paintChat();
  if (mode === "wheel") return paintWheel();
}

let seenAlerts = 0;

function render(state) {
  lastState = state || lastState;
  const epoch = Number(lastState.alertsEpoch) || 0;
  if (epoch !== seenAlerts) {
    seenAlerts = epoch;
    alertQueue = [];
    alertBusy = false;
  }
  if (lastState.startedAt && !lastState.durationMs) {
    lastState = { ...lastState, durationMs: Date.now() - lastState.startedAt };
  }
  warmImages();
  if (mode === "alerts") {
    if (!alertBusy && !alertQueue.length) clearAlertStage();
    return;
  }
  applyTitle();
  if (missingKey) {
    goal.hidden = true;
    stage.hidden = true;
    rows.hidden = false;
    paintMessage("Link sem a chave da conta.", false);
    return;
  }
  if (mode === "goals") {
    paintGoal();
    return;
  }
  if (TOOL_MODES.has(mode)) {
    paintTool();
    return;
  }
  goal.hidden = true;
  stage.hidden = true;
  rows.hidden = false;
  const limit = topLimit();
  const source = mode === "gifts" ? lastState.topGifters : lastState.topLikers;
  const list = (source || []).slice(0, limit);
  if (!list.length) {
    paintMessage("Aguardando alguém entrar no ranking", true);
    return;
  }
  paintRows(list);
}

function connectSocket() {
  if (!overlayKey) return;
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?key=${encodeURIComponent(overlayKey)}`);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.style) {
      stylePack = payload.style;
      render(lastState);
    }
    if (payload.state) render(payload.state);
    if (payload.event) handleEvent(payload.event);
  });
  socket.addEventListener("close", (event) => {
    if (event.code === 1008) return;
    setTimeout(connectSocket, 1000);
  });
}

if (mode === "countdown" || mode === "combo" || mode === "stats") {
  clockTimer = setInterval(() => {
    if (mode === "stats" && lastState.startedAt) {
      lastState = { ...lastState, durationMs: Date.now() - lastState.startedAt };
    }
    if (mode === "countdown" || mode === "combo" || mode === "stats") render(lastState);
  }, 500);
}

if (overlayKey) {
  Promise.all([
    fetch(`/api/state?key=${encodeURIComponent(overlayKey)}`).then((response) => response.json()),
    fetch(`/api/overlay-style?key=${encodeURIComponent(overlayKey)}`).then((response) => response.json()),
  ]).then(([state, style]) => {
    stylePack = style;
    render(state);
  }).catch(() => {
    render({ status: "idle", topLikers: [], topGifters: [] });
  });
} else {
  render(lastState);
}
connectSocket();
void clockTimer;
