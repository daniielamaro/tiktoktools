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

function portrait(name, avatarUrl, framed) {
  let face;
  if (avatarUrl) {
    face = document.createElement("img");
    face.className = "avatar";
    face.alt = "";
    face.referrerPolicy = "no-referrer";
    face.src = avatarUrl;
    face.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = "fallback";
      fallback.textContent = initial(name);
      face.replaceWith(fallback);
    });
  } else {
    face = document.createElement("span");
    face.className = "fallback";
    face.textContent = initial(name);
  }
  if (!framed) return face;
  const medal = document.createElement("div");
  medal.className = "medal";
  medal.append(face);
  const frame = document.createElement("img");
  frame.className = "frame";
  frame.alt = "";
  frame.src = framed;
  medal.append(frame);
  return medal;
}

function waitingRow(text) {
  const item = document.createElement("li");
  item.className = "waiting";
  const pulse = document.createElement("span");
  pulse.className = "pulse";
  const label = document.createElement("span");
  label.textContent = text;
  item.append(pulse, label);
  return item;
}

function render(state) {
  lastState = state || lastState;
  applyTitle();
  if (missingKey) {
    const item = document.createElement("li");
    item.className = "waiting";
    const label = document.createElement("span");
    label.textContent = "Link sem a chave da conta.";
    item.append(label);
    rows.replaceChildren(item);
    return;
  }
  const limit = topLimit();
  const source = mode === "gifts" ? lastState.topGifters : lastState.topLikers;
  const list = (source || []).slice(0, limit);
  if (!list.length) {
    rows.replaceChildren(waitingRow("Aguardando alguém entrar no ranking"));
    return;
  }

  rows.replaceChildren(...list.map((row, index) => {
    const place = index + 1;
    const frame = place <= 3 ? frameUrl(String(place)) : "";
    const item = document.createElement("li");
    item.className = frame ? `medal-row place-${place}` : `plain place-${place}`;
    const name = row.nickname || row.uniqueId;
    const person = document.createElement("div");
    person.className = "person";
    const who = document.createElement("span");
    who.className = "name";
    who.style.color = nameColorFor(place);
    who.textContent = name;
    const score = document.createElement("span");
    score.className = "score";
    score.style.color = textColor(currentStyle().scoreColor, "#ffffff");
    const icon = document.createElement("img");
    icon.alt = "";
    icon.src = mode === "gifts" ? "/assets/moeda.png" : "/assets/coracao.png";
    const value = document.createElement("span");
    const amount = mode === "gifts" ? row.diamonds : row.likes;
    value.textContent = numberFormat.format(amount || 0);
    score.append(icon, value);
    person.append(who, score);
    if (frame) {
      item.append(portrait(name, row.avatar, frame), person);
      return item;
    }
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = String(place);
    item.append(rank, person);
    return item;
  }));
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
