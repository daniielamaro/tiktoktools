const card = document.querySelector("#card");
const title = document.querySelector("#title");
const rows = document.querySelector("#rows");
const mode = location.pathname.includes("/gifts") ? "gifts" : "likes";
const numberFormat = new Intl.NumberFormat("pt-BR");
const overlayKey = new URLSearchParams(location.search).get("key") || "";

card.classList.add(mode);

let stylePack = null;
let lastState = { status: "idle", topLikers: [], topGifters: [] };
let missingKey = !overlayKey;

function topLimit() {
  const params = new URLSearchParams(location.search);
  const parsed = Number.parseInt(params.get("top") || "5", 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(20, Math.max(1, parsed));
}

function currentStyle() {
  const pack = stylePack?.[mode] || {
    showTitle: true,
    title: mode === "gifts" ? "Top presentes" : "Top curtidas",
    titleColor: mode === "gifts" ? "#7ef6ec" : "#ff7a90",
    nameColor: "#ffffff",
    scoreColor: "#ffffff",
    placeNameColors: { 1: "#ffffff", 2: "#ffffff", 3: "#ffffff" },
    frames: { 1: "", 2: "", 3: "" },
  };
  return pack;
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

function render(state) {
  lastState = state || lastState;
  warmImages();
  applyTitle();
  if (missingKey) {
    paintMessage("Link sem a chave da conta.", false);
    return;
  }
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
  });
  socket.addEventListener("close", (event) => {
    if (event.code === 1008) return;
    setTimeout(connectSocket, 1000);
  });
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
