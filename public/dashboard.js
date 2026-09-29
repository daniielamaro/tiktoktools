const logoutBtn = document.querySelector("#logout-btn");
const accountName = document.querySelector("#account-name");
const form = document.querySelector("#connect-form");
const uniqueIdInput = document.querySelector("#unique-id");
const connectBtn = document.querySelector("#connect-btn");
const disconnectBtn = document.querySelector("#disconnect-btn");
const resetBtn = document.querySelector("#reset-btn");
const previewBtn = document.querySelector("#preview-btn");
const statusPill = document.querySelector("#status-pill");
const statusMessage = document.querySelector("#status-message");
const topCount = document.querySelector("#top-count");
const urlLikes = document.querySelector("#url-likes");
const urlGifts = document.querySelector("#url-gifts");
const previewLikes = document.querySelector("#preview-likes");
const previewGifts = document.querySelector("#preview-gifts");

const numberFormat = new Intl.NumberFormat("pt-BR");
const usdFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const DIAMOND_TO_USD = 0.005;
const STATUS_LABEL = {
  idle: "Desconectado",
  connecting: "Conectando",
  live: "Ao vivo",
  error: "Erro",
  offline: "Offline",
};

let state = null;
let overlayKey = "";

function clampTop(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(20, Math.max(1, parsed));
}

function overlayUrls() {
  const port = location.port || "8787";
  const top = clampTop(topCount.value);
  const base = `http://127.0.0.1:${port}`;
  const key = encodeURIComponent(overlayKey);
  return {
    likes: `${base}/overlay/likes?key=${key}&top=${top}`,
    gifts: `${base}/overlay/gifts?key=${key}&top=${top}`,
  };
}

function renderUrls() {
  const urls = overlayUrls();
  urlLikes.textContent = urls.likes;
  urlGifts.textContent = urls.gifts;
}

const PLACE_LABEL = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };

function selectedFile(form, place) {
  const button = form.querySelector(`[data-place="${place}"] .thumb.selected`);
  return button?.dataset.file || "";
}

function colorValue(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#ffffff";
}

function fillForm(form, catalog, style) {
  form.showTitle.checked = Boolean(style.showTitle);
  form.title.value = style.title || "";
  form.titleColor.value = colorValue(style.titleColor);
  form.nameColor.value = colorValue(style.nameColor);
  form.scoreColor.value = colorValue(style.scoreColor);
  form.dataset.generalName = form.nameColor.value;
  for (const place of ["1", "2", "3"]) {
    form[`nameColor${place}`].value = colorValue(style.placeNameColors?.[place] || style.nameColor);
    const field = form.querySelector(`[data-place="${place}"]`);
    const chosen = style.frames?.[place] || "";
    const buttons = [];
    const none = document.createElement("button");
    none.type = "button";
    none.className = `thumb none${chosen ? "" : " selected"}`;
    none.dataset.file = "";
    none.textContent = "Sem moldura";
    buttons.push(none);
    for (const item of catalog[place] || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `thumb${item.file === chosen ? " selected" : ""}`;
      button.dataset.file = item.file;
      const image = document.createElement("img");
      image.alt = `${PLACE_LABEL[place]} ${item.file}`;
      image.src = item.url;
      button.append(image);
      buttons.push(button);
    }
    const row = document.createElement("div");
    row.className = "thumbs";
    row.replaceChildren(...buttons);
    field.querySelector(".thumbs")?.remove();
    field.append(row);
    row.addEventListener("click", (event) => {
      const thumb = event.target.closest(".thumb");
      if (!thumb) return;
      row.querySelectorAll(".thumb").forEach((item) => item.classList.remove("selected"));
      thumb.classList.add("selected");
    });
  }
}

function bindStyleForms(payload) {
  document.querySelectorAll(".style-form").forEach((form) => {
    const style = payload[form.dataset.mode];
    if (style) fillForm(form, payload.catalog || {}, style);
    if (form.dataset.bound) return;
    form.dataset.bound = "1";
    form.nameColor.addEventListener("input", () => {
      const previous = (form.dataset.generalName || "").toLowerCase();
      const next = form.nameColor.value;
      for (const place of ["1", "2", "3"]) {
        const input = form[`nameColor${place}`];
        if (input.value.toLowerCase() === previous) input.value = next;
      }
      form.dataset.generalName = next;
    });
    const note = form.querySelector(".style-note");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      note.textContent = "";
      try {
        const saved = await post("/api/overlay-style", {
          mode: form.dataset.mode,
          showTitle: form.showTitle.checked,
          title: form.title.value,
          titleColor: form.titleColor.value,
          nameColor: form.nameColor.value,
          scoreColor: form.scoreColor.value,
          placeNameColors: {
            1: form.nameColor1.value,
            2: form.nameColor2.value,
            3: form.nameColor3.value,
          },
          frames: {
            1: selectedFile(form, "1"),
            2: selectedFile(form, "2"),
            3: selectedFile(form, "3"),
          },
        });
        fillForm(form, saved.catalog || {}, saved[form.dataset.mode]);
        note.className = "style-note";
        note.textContent = "Visual salvo.";
      } catch (err) {
        note.className = "style-note error";
        note.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderPreview(list, rows, scoreKey, suffix) {
  const top = clampTop(topCount.value);
  const visible = rows.slice(0, top);
  if (!visible.length) {
    list.innerHTML = '<li class="empty">Ninguém ainda</li>';
    return;
  }
  list.replaceChildren(...visible.map((row, index) => {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    rank.textContent = String(index + 1);
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = row.nickname || row.uniqueId;
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = `${numberFormat.format(row[scoreKey])} ${suffix}`;
    item.append(rank, who, score);
    return item;
  }));
}

function render(next) {
  state = next;
  statusPill.className = `pill ${next.status || "idle"}`;
  statusPill.textContent = STATUS_LABEL[next.status] || STATUS_LABEL.idle;
  statusMessage.textContent = next.message || (next.uniqueId ? `@${next.uniqueId}` : "");
  document.querySelector("#stat-viewers").textContent = numberFormat.format(next.viewers || 0);
  document.querySelector("#stat-likes").textContent = next.totalLikesKnown
    ? numberFormat.format(next.totalLikes || 0)
    : "—";
  document.querySelector("#stat-tracked").textContent = numberFormat.format(next.trackedLikes || 0);
  document.querySelector("#stat-diamonds").textContent = numberFormat.format(next.totalDiamonds || 0);
  document.querySelector("#stat-usd").textContent = usdFormat.format((next.totalDiamonds || 0) * DIAMOND_TO_USD);
  const busy = next.status === "connecting";
  connectBtn.disabled = busy;
  disconnectBtn.disabled = next.status === "idle" || busy;
  resetBtn.disabled = next.status !== "live" && next.status !== "offline";
  renderPreview(previewLikes, next.topLikers || [], "likes", "curtidas");
  renderPreview(previewGifts, next.topGifters || [], "diamonds", "diamantes");
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir.");
  return payload;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  connectBtn.disabled = true;
  try {
    render(await post("/api/connect", { uniqueId: uniqueIdInput.value }));
  } catch (err) {
    statusPill.className = "pill error";
    statusPill.textContent = STATUS_LABEL.error;
    statusMessage.textContent = err.message;
    connectBtn.disabled = false;
  }
});

disconnectBtn.addEventListener("click", async () => {
  try {
    render(await post("/api/disconnect"));
  } catch (err) {
    statusMessage.textContent = err.message;
  }
});

resetBtn.addEventListener("click", async () => {
  try {
    render(await post("/api/reset"));
  } catch (err) {
    statusMessage.textContent = err.message;
  }
});

previewBtn.addEventListener("click", async () => {
  const label = "Teste por 15 segundos";
  previewBtn.disabled = true;
  let left = 15;
  previewBtn.textContent = `Testando… ${left}s`;
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      previewBtn.disabled = false;
      previewBtn.textContent = label;
      return;
    }
    previewBtn.textContent = `Testando… ${left}s`;
  }, 1000);
  try {
    render(await post("/api/preview"));
  } catch (err) {
    clearInterval(timer);
    previewBtn.disabled = false;
    previewBtn.textContent = label;
    statusMessage.textContent = err.message;
  }
});

topCount.addEventListener("input", () => {
  renderUrls();
  if (state) render(state);
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const urls = overlayUrls();
    const value = urls[button.dataset.copy];
    try {
      await navigator.clipboard.writeText(value);
      const previous = button.textContent;
      button.textContent = "Copiado";
      setTimeout(() => { button.textContent = previous; }, 1200);
    } catch {
      statusMessage.textContent = "Não foi possível copiar. Selecione a URL manualmente.";
    }
  });
});

function connectSocket() {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.state) render(payload.state);
  });
  socket.addEventListener("close", () => {
    setTimeout(connectSocket, 1000);
  });
}

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await post("/api/logout");
    location.href = "/login";
  } catch (err) {
    statusMessage.textContent = err.message;
    logoutBtn.disabled = false;
  }
});

async function boot() {
  const meResponse = await fetch("/api/me");
  if (meResponse.status === 401) {
    location.href = "/login";
    return;
  }
  const me = await meResponse.json();
  overlayKey = me.overlayKey || "";
  accountName.textContent = me.username || "";
  if (me.tiktokUniqueId && !uniqueIdInput.value) uniqueIdInput.value = me.tiktokUniqueId;
  renderUrls();
  const styleResponse = await fetch("/api/overlay-style");
  if (styleResponse.ok) bindStyleForms(await styleResponse.json());
  const stateResponse = await fetch("/api/state");
  if (stateResponse.ok) render(await stateResponse.json());
  connectSocket();
}

boot().catch(() => {
  location.href = "/login";
});
