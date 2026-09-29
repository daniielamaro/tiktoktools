const card = document.querySelector("#card");
const title = document.querySelector("#title");
const rows = document.querySelector("#rows");
const mode = location.pathname.includes("/gifts") ? "gifts" : "likes";
const numberFormat = new Intl.NumberFormat("pt-BR");

card.classList.add(mode);
title.textContent = mode === "gifts" ? "Top presentes" : "Top curtidas";

function topLimit() {
  const params = new URLSearchParams(location.search);
  const parsed = Number.parseInt(params.get("top") || "5", 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(20, Math.max(1, parsed));
}

function initial(name) {
  const letter = String(name || "?").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function render(state) {
  const limit = topLimit();
  const source = mode === "gifts" ? state.topGifters : state.topLikers;
  const list = (source || []).slice(0, limit);
  if (!list.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = state.status === "live" ? "Ninguém ainda" : "Aguardando a live…";
    rows.replaceChildren(item);
    return;
  }

  rows.replaceChildren(...list.map((row, index) => {
    const item = document.createElement("li");
    item.className = `place-${index + 1}`;
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = String(index + 1);

    const name = row.nickname || row.uniqueId;
    let avatar;
    if (row.avatar) {
      avatar = document.createElement("img");
      avatar.className = "avatar";
      avatar.alt = "";
      avatar.referrerPolicy = "no-referrer";
      avatar.src = row.avatar;
      avatar.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "fallback";
        fallback.textContent = initial(name);
        avatar.replaceWith(fallback);
      });
    } else {
      avatar = document.createElement("span");
      avatar.className = "fallback";
      avatar.textContent = initial(name);
    }

    const who = document.createElement("span");
    who.className = "name";
    who.textContent = name;
    const score = document.createElement("span");
    score.className = "score";
    const value = mode === "gifts" ? row.diamonds : row.likes;
    score.textContent = numberFormat.format(value || 0);
    item.append(rank, avatar, who, score);
    return item;
  }));
}

const overlayKey = new URLSearchParams(location.search).get("key") || "";

function connectSocket() {
  if (!overlayKey) {
    render({ status: "idle", topLikers: [], topGifters: [] });
    rows.querySelector(".empty").textContent = "Link sem a chave da conta.";
    return;
  }
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?key=${encodeURIComponent(overlayKey)}`);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.state) render(payload.state);
  });
  socket.addEventListener("close", (event) => {
    if (event.code === 1008) return;
    setTimeout(connectSocket, 1000);
  });
}

if (overlayKey) {
  fetch(`/api/state?key=${encodeURIComponent(overlayKey)}`).then((response) => response.json()).then(render).catch(() => {
    render({ status: "idle", topLikers: [], topGifters: [] });
  });
}
connectSocket();
