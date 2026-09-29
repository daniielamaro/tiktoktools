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
const urlGoals = document.querySelector("#url-goals");
const previewLikes = document.querySelector("#preview-likes");
const previewGifts = document.querySelector("#preview-gifts");
const previewGoals = document.querySelector("#preview-goals");
const goalForm = document.querySelector(".style-form[data-mode='goals']");
const GOAL_TITLES = {
  likes: "Meta de curtidas",
  diamonds: "Meta de diamantes",
  viewers: "Meta de espectadores",
  follows: "Meta de follows",
  shares: "Meta de shares",
  gift: "Meta do presente",
};
const TOOL_MODES = ["alerts", "ticker", "recent", "combo", "stats", "countdown", "chat", "wheel"];

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
  const top = clampTop(topCount.value);
  const key = encodeURIComponent(overlayKey);
  return {
    likes: `${location.origin}/overlay/likes?key=${key}&top=${top}`,
    gifts: `${location.origin}/overlay/gifts?key=${key}&top=${top}`,
    goals: `${location.origin}/overlay/goals?key=${key}`,
    alerts: `${location.origin}/overlay/alerts?key=${key}`,
    ticker: `${location.origin}/overlay/ticker?key=${key}`,
    recent: `${location.origin}/overlay/recent?key=${key}`,
    combo: `${location.origin}/overlay/combo?key=${key}`,
    stats: `${location.origin}/overlay/stats?key=${key}`,
    countdown: `${location.origin}/overlay/countdown?key=${key}`,
    chat: `${location.origin}/overlay/chat?key=${key}`,
    wheel: `${location.origin}/overlay/wheel?key=${key}`,
  };
}

function renderUrls() {
  const urls = overlayUrls();
  urlLikes.textContent = urls.likes;
  urlGifts.textContent = urls.gifts;
  urlGoals.textContent = urls.goals;
  for (const mode of TOOL_MODES) {
    const node = document.querySelector(`#url-${mode}`);
    if (node) node.textContent = urls[mode];
  }
}

const PLACE_LABEL = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };

function selectedFile(form, place) {
  const button = form.querySelector(`[data-place="${place}"] .thumb.selected`);
  return button?.dataset.file || "";
}

function colorValue(value, fallback = "#ffffff") {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : fallback;
}

function goalValue(next, metric, giftName) {
  if (metric === "diamonds") return Number(next?.totalDiamonds) || 0;
  if (metric === "viewers") return Number(next?.viewers) || 0;
  if (metric === "follows") return Number(next?.followCount) || 0;
  if (metric === "shares") return Number(next?.shareCount) || 0;
  if (metric === "gift") {
    const key = String(giftName || "").trim().toLowerCase();
    return Number(next?.giftCounts?.[key]) || 0;
  }
  return Number(next?.totalLikes) || 0;
}

function goalStyleFromForm(form) {
  return {
    showTitle: form.showTitle.checked,
    title: form.title.value,
    titleColor: form.titleColor.value,
    metric: form.metric.value,
    target: Number.parseInt(form.target.value, 10) || 10000,
    barColor: form.barColor.value,
    barTrackColor: form.barTrackColor.value,
    scoreColor: form.scoreColor.value,
    showCounts: form.showCounts.checked,
    showPercent: form.showPercent.checked,
    milestones: form.milestones?.value || "",
    showSecond: Boolean(form.showSecond?.checked),
    secondMetric: form.secondMetric?.value || "diamonds",
    secondTarget: Number.parseInt(form.secondTarget?.value, 10) || 1000,
    sound: Boolean(form.sound?.checked),
    giftName: form.giftName?.value || "",
  };
}

function fillGoalForm(form, style) {
  form.showTitle.checked = Boolean(style.showTitle);
  form.title.value = style.title || "";
  form.titleColor.value = colorValue(style.titleColor, "#ffd166");
  form.metric.value = GOAL_TITLES[style.metric] ? style.metric : "likes";
  form.target.value = String(style.target || 10000);
  form.barColor.value = colorValue(style.barColor, "#ffd166");
  form.barTrackColor.value = colorValue(style.barTrackColor, "#2a3140");
  form.scoreColor.value = colorValue(style.scoreColor);
  form.showCounts.checked = Boolean(style.showCounts);
  form.showPercent.checked = Boolean(style.showPercent);
  if (form.giftName) form.giftName.value = style.giftName || "";
  if (form.milestones) form.milestones.value = style.milestones || "";
  if (form.showSecond) form.showSecond.checked = Boolean(style.showSecond);
  if (form.secondMetric) form.secondMetric.value = style.secondMetric || "diamonds";
  if (form.secondTarget) form.secondTarget.value = String(style.secondTarget || 1000);
  if (form.sound) form.sound.checked = Boolean(style.sound);
}

function renderGoalPreview(next, style) {
  if (!previewGoals) return;
  const fill = previewGoals.querySelector(".goal-fill");
  const track = previewGoals.querySelector(".goal-track");
  const counts = previewGoals.querySelector(".goal-counts");
  const percentLabel = previewGoals.querySelector(".goal-percent");
  const target = Math.max(1, Number(style.target) || 10000);
  const current = goalValue(next, style.metric, style.giftName);
  const ratio = Math.min(1, current / target);
  const percent = Math.round(ratio * 100);
  previewGoals.classList.toggle("reached", ratio >= 1);
  track.style.background = colorValue(style.barTrackColor, "#2a3140");
  fill.style.background = colorValue(style.barColor, "#ffd166");
  fill.style.width = `${ratio * 100}%`;
  counts.textContent = style.showCounts
    ? `${numberFormat.format(current)} / ${numberFormat.format(target)}`
    : "";
  counts.style.color = colorValue(style.scoreColor);
  percentLabel.textContent = style.showPercent ? `${percent}%` : "";
  percentLabel.style.color = colorValue(style.scoreColor);
}

function fillToolForm(form, style) {
  if (!style) return;
  for (const field of form.elements) {
    if (!field.name) continue;
    const value = style[field.name];
    if (field.type === "checkbox") field.checked = Boolean(value);
    else if (value != null) field.value = String(value);
  }
}

function toolStyleFromForm(form) {
  const body = { mode: form.dataset.mode };
  for (const field of form.elements) {
    if (!field.name || field.type === "submit") continue;
    if (field.type === "checkbox") body[field.name] = field.checked;
    else if (field.type === "number") body[field.name] = Number.parseInt(field.value, 10);
    else body[field.name] = field.value;
  }
  return body;
}

function renderToolPreviews(next) {
  const gift = next?.lastGift;
  const combo = next?.likeCombo;
  const texts = {
    alerts: gift ? `${gift.nickname} · ${gift.giftName}` : "Nenhum alerta ainda",
    ticker: gift ? `${gift.nickname} enviou ${gift.giftName}` : "Nenhum presente ainda",
    recent: (next?.recentGifters || []).map((row) => row.nickname).join(", ") || "Ninguém ainda",
    combo: combo ? `${combo.nickname} x${combo.count}` : "Sem combo agora",
    stats: `${numberFormat.format(next?.viewers || 0)} assistindo · pico ${numberFormat.format(next?.peakViewers || 0)}`,
    countdown: next?.countdownEndsAt ? "Contagem em andamento" : "Contagem parada",
    chat: (next?.comments || [])[0]?.comment || "Nenhum comentário ainda",
    wheel: next?.spin?.nickname ? `Último: ${next.spin.nickname}` : "Ainda não sorteou",
  };
  for (const [mode, text] of Object.entries(texts)) {
    const node = document.querySelector(`[data-preview="${mode}"]`);
    if (node) node.textContent = text;
  }
}

function renderHistory(rows) {
  const list = document.querySelector("#history-list");
  if (!list) return;
  if (!rows?.length) {
    list.innerHTML = '<li class="empty">Nenhuma live gravada ainda</li>';
    return;
  }
  list.replaceChildren(...rows.map((row) => {
    const item = document.createElement("li");
    const when = new Date(Number(row.endedAt) || Date.now());
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = `@${row.uniqueId} · ${when.toLocaleString("pt-BR")}`;
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = `${numberFormat.format(row.totalLikes || 0)} likes · ${numberFormat.format(row.totalDiamonds || 0)} ♦ · pico ${numberFormat.format(row.peakViewers || 0)}`;
    const rank = document.createElement("span");
    rank.textContent = "";
    item.append(rank, who, score);
    return item;
  }));
}

async function loadHistory() {
  try {
    const response = await fetch("/api/history");
    if (response.ok) renderHistory(await response.json());
  } catch {
    // O histórico é extra; o painel segue sem ele.
  }
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
    if (form.classList.contains("tool-form")) {
      fillToolForm(form, payload[form.dataset.mode] || {});
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      const note = form.querySelector(".style-note");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button[type='submit']");
        button.disabled = true;
        note.textContent = "";
        try {
          const saved = await post("/api/overlay-style", toolStyleFromForm(form));
          fillToolForm(form, saved[form.dataset.mode] || {});
          note.className = "style-note";
          note.textContent = "Visual salvo.";
        } catch (err) {
          note.className = "style-note error";
          note.textContent = err.message;
        } finally {
          button.disabled = false;
        }
      });
      return;
    }
    if (form.dataset.mode === "goals") {
      fillGoalForm(form, payload.goals || {});
      renderGoalPreview(state || { totalLikes: 0, totalDiamonds: 0, viewers: 0 }, goalStyleFromForm(form));
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      form.metric.addEventListener("change", () => {
        const current = form.title.value.trim();
        if (Object.values(GOAL_TITLES).includes(current)) {
          form.title.value = GOAL_TITLES[form.metric.value] || GOAL_TITLES.likes;
        }
        renderGoalPreview(state || { totalLikes: 0, totalDiamonds: 0, viewers: 0 }, goalStyleFromForm(form));
      });
      form.addEventListener("input", () => {
        if (state) renderGoalPreview(state, goalStyleFromForm(form));
        else renderGoalPreview({ totalLikes: 0, totalDiamonds: 0, viewers: 0 }, goalStyleFromForm(form));
      });
      const note = form.querySelector(".style-note");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button[type='submit']");
        button.disabled = true;
        note.textContent = "";
        try {
          const saved = await post("/api/overlay-style", {
            mode: "goals",
            ...goalStyleFromForm(form),
          });
          fillGoalForm(form, saved.goals || {});
          renderGoalPreview(state || {}, goalStyleFromForm(form));
          note.className = "style-note";
          note.textContent = "Visual salvo.";
        } catch (err) {
          note.className = "style-note error";
          note.textContent = err.message;
        } finally {
          button.disabled = false;
        }
      });
      return;
    }
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
  document.querySelector("#stat-peak").textContent = numberFormat.format(next.peakViewers || 0);
  document.querySelector("#stat-likes").textContent = next.totalLikesKnown
    ? numberFormat.format(next.totalLikes || 0)
    : "—";
  document.querySelector("#stat-tracked").textContent = numberFormat.format(next.trackedLikes || 0);
  document.querySelector("#stat-diamonds").textContent = numberFormat.format(next.totalDiamonds || 0);
  document.querySelector("#stat-follows").textContent = numberFormat.format(next.followCount || 0);
  document.querySelector("#stat-usd").textContent = usdFormat.format((next.totalDiamonds || 0) * DIAMOND_TO_USD);
  const busy = next.status === "connecting";
  connectBtn.disabled = busy;
  disconnectBtn.disabled = next.status === "idle" || busy;
  resetBtn.disabled = next.status !== "live" && next.status !== "offline";
  renderPreview(previewLikes, next.topLikers || [], "likes", "curtidas");
  renderPreview(previewGifts, next.topGifters || [], "diamonds", "diamantes");
  if (goalForm) renderGoalPreview(next, goalStyleFromForm(goalForm));
  renderToolPreviews(next);
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
    await loadHistory();
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

document.querySelector("#countdown-btn")?.addEventListener("click", async () => {
  const minutes = document.querySelector(".tool-form[data-mode='countdown'] [name='minutes']")?.value;
  try {
    render(await post("/api/countdown", { minutes }));
  } catch (err) {
    statusMessage.textContent = err.message;
  }
});

document.querySelector("#countdown-stop")?.addEventListener("click", async () => {
  try {
    render(await post("/api/countdown", { stop: true }));
  } catch (err) {
    statusMessage.textContent = err.message;
  }
});

document.querySelector("#spin-btn")?.addEventListener("click", async () => {
  try {
    render(await post("/api/spin"));
  } catch (err) {
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
  await loadHistory();
  connectSocket();
}

boot().catch(() => {
  location.href = "/login";
});
