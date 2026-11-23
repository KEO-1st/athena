/* ATHENA — hub client. Works on iOS Safari as an installed PWA. */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const store = {
  token: localStorage.getItem("athena.session") || "",
  speak: localStorage.getItem("athena.speak") === "1",
  mode: localStorage.getItem("athena.mode") === "advanced" ? "advanced" : "basic",
  look: {
    accent: localStorage.getItem("athena.accent") || "gold",
    motion: localStorage.getItem("athena.motion") || "2",
    glass: localStorage.getItem("athena.glass") !== "0",
    art: localStorage.getItem("athena.art") !== "0",
  },
  focus: null,
  state: null,
  view: "home",
  history: [],
  chat: [],
  busy: false,
  stream: null,
};

const CHAT_KEY = "athena.chat";

function saveChat() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(store.chat.slice(-40)));
  } catch {
    /* private mode / quota — the conversation just is not kept */
  }
}

function loadChat() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/* ─────────────────────────────────────────────────────────── look & mode */

const MOTION_LABELS = ["CALM", "DIVINE", "ECSTATIC"];

function applyLook() {
  const body = document.body;
  body.dataset.mode = store.mode;
  body.dataset.accent = store.look.accent;
  body.dataset.motion = store.look.motion;
  body.dataset.glass = store.look.glass ? "on" : "off";
  body.dataset.art = store.look.art ? "on" : "off";
  $$("#mode button").forEach((button) => button.classList.toggle("on", button.dataset.mode === store.mode));
  $$("#swatches button").forEach((button) => button.classList.toggle("on", button.dataset.accent === store.look.accent));
  const motion = $("#cfg-motion");
  if (motion) motion.value = store.look.motion;
  const glass = $("#cfg-glass");
  if (glass) glass.checked = store.look.glass;
  const art = $("#cfg-art");
  if (art) art.checked = store.look.art;
  const note = $("#motion-note");
  if (note) note.textContent = `MOTION: ${MOTION_LABELS[Number(store.look.motion)] || "DIVINE"} · ${"▮".repeat(Number(store.look.motion) + 1)}`;
  moveTabGlide();
}

function setMode(mode) {
  store.mode = mode === "advanced" ? "advanced" : "basic";
  localStorage.setItem("athena.mode", store.mode);
  applyLook();
  requestAnimationFrame(moveTabGlide);
}

/** The gold pill that slides under the active tab, in either bar orientation. */
function moveTabGlide() {
  const tabs = $("#tabs");
  const glide = tabs?.querySelector(".tab-glide");
  const active = tabs?.querySelector("button.active");
  if (!tabs || !glide || !active || !active.offsetWidth) return;
  const box = tabs.getBoundingClientRect();
  const spot = active.getBoundingClientRect();
  glide.style.setProperty("--gx", `${spot.left - box.left + tabs.scrollLeft}px`);
  glide.style.setProperty("--gy", `${spot.top - box.top + tabs.scrollTop}px`);
  glide.style.width = `${spot.width}px`;
  glide.style.height = `${spot.height}px`;
}

function spawnSparks() {
  const box = $("#sparks");
  if (!box || box.childElementCount) return;
  for (let index = 0; index < 18; index += 1) {
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.left = `${Math.random() * 100}%`;
    spark.style.top = `${52 + Math.random() * 58}%`;
    spark.style.animationDuration = `${9 + Math.random() * 13}s`;
    spark.style.animationDelay = `${-Math.random() * 16}s`;
    spark.style.opacity = String(0.35 + Math.random() * 0.5);
    box.appendChild(spark);
  }
}

function toast(text, ms = 2800) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), ms);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(store.token ? { "x-athena-session": store.token } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (res.status === 401) {
    lock();
    throw new Error(json.error || "Locked.");
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* ─────────────────────────────────────────────────────────── lock */

function lock() {
  $("#lock").hidden = false;
  $("#app").hidden = true;
  store.stream?.close();
  store.stream = null;
  setTimeout(() => $("#code").focus(), 120);
}

async function unlock() {
  const code = $("#code").value.trim().toUpperCase();
  if (!code) return;
  $("#unlock").disabled = true;
  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "No.");
    store.token = json.token;
    localStorage.setItem("athena.session", json.token);
    $("#lock").hidden = true;
    $("#app").hidden = false;
    await loadState();
    connectStream();
  } catch (error) {
    $("#lock-msg").textContent = error.message;
    $("#lock-msg").classList.add("accent");
  } finally {
    $("#unlock").disabled = false;
  }
}

/* ─────────────────────────────────────────────────────────── state */

async function loadState() {
  try {
    store.state = await api("/api/state");
    render();
  } catch (error) {
    if (!String(error.message).includes("Locked")) toast(error.message);
  }
}

function nodeBusy(node) {
  return Boolean(node.status?.tasks?.some((task) => task.state === "running"));
}

function render() {
  const state = store.state;
  if (!state) return;
  const nodes = state.nodes || [];
  const online = nodes.filter((node) => node.online);

  $("#hub-line").textContent = `HUB · ${String(state.hub.name).toUpperCase()} · ${state.hub.addresses?.[0] || "LAN"}`;
  const vram = online.reduce((sum, node) => sum + (node.status?.gpu?.vramGb || 0), 0);
  $("#orb-count").textContent = String(nodes.length).padStart(2, "0");
  $("#orb-online").textContent = String(online.length).padStart(2, "0");
  $("#orb-vram").textContent = String(vram);
  $("#orb-kicker").textContent = online.length ? "NETWORK LIVE" : nodes.length ? "NO ANSWER" : "NETWORK";
  $("#orb-label").textContent = nodes.length === 1 ? "MACHINE" : "MACHINES";
  $("#net-dot").className = "dot " + (online.length ? "live" : "");
  $("#net-caption").textContent = online.length
    ? `${online.length} MACHINE${online.length === 1 ? "" : "S"} UNDER THE CROWN`
    : nodes.length
      ? "THE PANTHEON IS ASLEEP"
      : "THE PANTHEON IS QUIET";
  $("#net-line").textContent = online.length
    ? `${online.length} OF ${nodes.length} ANSWERING · ${vram} GB VRAM`
    : nodes.length
      ? "NODES OFFLINE · CHECK THE AGENTS"
      : "NO MACHINES LINKED YET";

  const brain = state.brain;
  $("#brain-line").textContent = brain?.ready
    ? `BRAIN · ${String(brain.provider).toUpperCase()} · ${brain.model}`
    : "BRAIN · BUILT-IN COMMANDS ONLY";
  $("#brain-detail").textContent = brain?.detail || "—";
  $("#speak-toggle").innerHTML = `VOICE <b>${store.speak ? "ON" : "OFF"}</b>`;
  $("#speak-toggle").classList.toggle("on", store.speak);

  renderOrbNodes(nodes);
  renderNodes(nodes, state);
  renderScreens();
  renderJobs(state.jobs || []);
  renderKeys(state.keys || []);
  renderConfig(state);
  renderSystem(state);
}

function renderOrbNodes(nodes) {
  const wrap = $("#orb-nodes");
  wrap.innerHTML = "";
  nodes.forEach((node, index) => {
    const angle = (-90 + (360 / Math.max(nodes.length, 1)) * index) * (Math.PI / 180);
    const dot = document.createElement("div");
    dot.className = "orb-node " + (nodeBusy(node) ? "busy" : node.online ? "on" : "");
    dot.style.left = `${50 + Math.cos(angle) * 45}%`;
    dot.style.top = `${50 + Math.sin(angle) * 45}%`;
    dot.innerHTML = `<span>${esc(node.name.slice(0, 14))}</span>`;
    dot.title = `${node.name}${node.status?.gpu?.name ? " · " + node.status.gpu.name : ""}`;
    wrap.appendChild(dot);
  });
}

function renderNodes(nodes, state) {
  const list = $("#node-list");
  $("#net-detail").textContent = `${state.hub.name} · ${state.hub.addresses?.join(" · ") || "no LAN address"} · port ${state.hub.port} · ${state.platform}`;
  $("#api-example").textContent = `curl -H "x-athena-key: ath_…" http://${state.hub.addresses?.[0] || "localhost"}:${state.hub.port}/v1/health\n\ncurl -X POST -H "x-athena-key: ath_…" -H "content-type: application/json" \\\n  -d '{"command":"nvidia-smi"}' \\\n  http://${state.hub.addresses?.[0] || "localhost"}:${state.hub.port}/v1/nodes/${nodes[0]?.id || "NODE"}/exec`;

  if (!nodes.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">NO MACHINES YET</p><p class="micro dim" style="margin-top:8px">RUN THE NODE ON A PC, THEN SCAN</p></div>`;
    return;
  }

  list.innerHTML = nodes
    .map((node) => {
      const status = node.status || {};
      const gpu = status.gpu || {};
      const caps = status.capabilities || {};
      return `<article class="card ${node.online ? "on" : "off"} bracket">
        <div class="card-top">
          <div>
            <h3>${esc(node.name)}</h3>
            <p class="micro dim">NODE ${String(node.index || 0).padStart(2, "0")} · ${esc(node.host)}:${node.port}</p>
          </div>
          <span class="badge ${node.online ? (nodeBusy(node) ? "run" : "ok") : "bad"}">${node.online ? (nodeBusy(node) ? "WORKING" : "ONLINE") : "OFFLINE"}</span>
        </div>
        <div class="metrics">
          <div class="metric"><span>GPU</span><b title="${esc(gpu.name || "")}">${esc(gpu.name || "—")}</b></div>
          <div class="metric"><span>VRAM</span><b>${gpu.vramGb ? gpu.vramGb + " GB" + (gpu.usedGb ? " · " + gpu.usedGb + " used" : "") : "—"}</b></div>
          <div class="metric"><span>LOAD</span><b>${gpu.util != null ? gpu.util + "%" : "—"}${gpu.temp != null ? " · " + gpu.temp + "°" : ""}</b></div>
          <div class="metric"><span>CPU</span><b>${status.cores ? status.cores + " cores" : "—"}</b></div>
          <div class="metric"><span>RAM</span><b>${status.memory ? status.memory.totalGb + " GB" : "—"}</b></div>
          <div class="metric"><span>SCREEN</span><b>${caps.screen ? (caps.input ? "CONTROL" : "VIEW") : "—"}</b></div>
          <div class="metric"><span>SOUND</span><b>${caps.audio ? "LISTEN" : "—"}</b></div>
        </div>
        <div class="actions">
          <button class="btn tiny solid" data-act="focus" data-id="${node.id}">⤢ FOCUS</button>
          <button class="btn tiny" data-act="refresh" data-id="${node.id}">STATUS</button>
          <button class="btn tiny" data-act="screen" data-id="${node.id}">SCREEN</button>
          <button class="btn tiny" data-act="apps" data-id="${node.id}">APPS</button>
          <button class="btn tiny danger" data-act="unpair" data-id="${node.id}">UNLINK</button>
        </div>
      </article>`;
    })
    .join("");
}

function renderJobs(jobs) {
  const list = $("#job-list");
  if (!jobs.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">QUEUE IS EMPTY</p><p class="micro dim" style="margin-top:8px">JOBS ARRIVE FROM THE AI OR THE API</p></div>`;
    return;
  }
  list.innerHTML = jobs
    .map((job) => {
      const badge = { queued: "", running: "run", done: "ok", failed: "bad", cancelled: "bad", timeout: "bad" }[job.state] || "";
      return `<article class="card bracket job">
        <div class="card-top">
          <div>
            <h3 style="font-size:13px">${esc(job.label || job.op)}</h3>
            <p class="micro dim">${esc(job.node)} · ${esc(job.op)} · ${new Date(job.createdAt).toLocaleTimeString()}</p>
          </div>
          <span class="badge ${badge}">${esc(job.state)}</span>
        </div>
        ${job.output ? `<p>${esc(job.output.slice(-1200))}</p>` : ""}
        <div class="actions">
          <button class="btn tiny ghost" data-job="${job.id}">DETAIL</button>
          ${["queued", "running"].includes(job.state) ? `<button class="btn tiny danger" data-cancel="${job.id}">CANCEL</button>` : ""}
        </div>
      </article>`;
    })
    .join("");
}

function renderKeys(keys) {
  const list = $("#key-list");
  if (!keys.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">NO KEYS YET</p></div>`;
    return;
  }
  list.innerHTML = keys
    .map(
      (key) => `<article class="card bracket">
      <div class="card-top">
        <div><h3 style="font-size:13px">${esc(key.label)}</h3><p class="micro dim">${esc(key.prefix)}… · created ${new Date(key.createdAt).toLocaleDateString()}</p></div>
        <button class="btn tiny danger" data-key="${key.id}">REVOKE</button>
      </div>
      <p class="micro dim">${key.lastUsed ? "LAST USED " + new Date(key.lastUsed).toLocaleString() : "NEVER USED"}</p>
    </article>`
    )
    .join("");
}

function renderConfig(state) {
  if (document.activeElement?.closest(".panel")) return;
  $("#cfg-name").value = state.hub.name || "";
  $("#cfg-code").value = state.hub.code || "";
  $("#cfg-open").checked = Boolean(state.hub.openMode);
  const brain = state.brain || {};
  $("#cfg-provider").value = brain.provider || "auto";
  $("#cfg-model").value = brain.requested || "";
  $("#cfg-base").value = brain.base && !brain.base.includes("11434") ? brain.base : "";
  renderModelPicker(brain);
}

/** The list of models actually installed — so switching the brain is a tap. */
function renderModelPicker(brain) {
  const pick = $("#cfg-model-pick");
  if (!pick) return;
  const models = Array.isArray(brain?.models) ? brain.models.filter(Boolean) : [];
  if (!models.length) {
    pick.innerHTML = `<option value="">${brain?.provider === "ollama" ? "no models pulled yet" : "local model not available"}</option>`;
    pick.disabled = true;
    return;
  }
  pick.disabled = false;
  pick.innerHTML = models
    .map((name) => `<option value="${esc(name)}"${name === brain.model ? " selected" : ""}>${esc(name)}${name === brain.model ? " · in use" : ""}</option>`)
    .join("");
}

/* ─────────────────────────────────────────────────────────── chat */

function addMessage(role, text, extra = {}) {
  if (!extra.restore) {
    store.chat.push({
      role,
      text: String(text ?? ""),
      tools: extra.tools?.map((tool) => ({ name: tool.name, ok: tool.ok })),
      code: extra.code || "",
      at: Date.now(),
    });
    store.chat = store.chat.slice(-40);
    saveChat();
  }
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "me" ? "me" : "athena");
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  wrap.innerHTML = `<span class="micro dim">${role === "me" ? "YOU · " + stamp : "ATHENA · " + stamp}</span>`;
  const p = document.createElement("p");
  p.textContent = text;
  wrap.appendChild(p);
  if (extra.tools?.length) {
    const line = document.createElement("span");
    line.className = "tool";
    line.textContent = extra.tools.map((tool) => `${tool.ok ? "✓" : "✕"} ${tool.name}`).join("  ");
    wrap.appendChild(line);
  }
  if (extra.code) {
    const pre = document.createElement("pre");
    pre.className = "code";
    pre.textContent = extra.code;
    wrap.appendChild(pre);
  }
  $("#chat").appendChild(wrap);
  /* a long conversation is kept in storage, but the page only holds so much */
  const messages = $$("#chat .msg");
  if (messages.length > 60) messages.slice(0, messages.length - 60).forEach((old) => old.remove());
  wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return wrap;
}

/** Reloads the conversation after a refresh — the phone no longer loses it. */
function restoreChat() {
  const saved = loadChat();
  if (!saved.length) return;
  store.chat = saved;
  $$("#chat .msg").forEach((element) => element.remove());
  for (const entry of saved) {
    addMessage(entry.role === "me" ? "me" : "athena", entry.text, {
      tools: entry.tools || [],
      code: entry.code || "",
      restore: true,
    });
    store.history.push({ role: entry.role === "me" ? "user" : "assistant", content: entry.text });
  }
  store.history = store.history.slice(-16);
}

function thinking() {
  const wrap = document.createElement("div");
  wrap.className = "msg athena thinking-wrap";
  wrap.innerHTML = `<span class="micro dim">ATHENA</span><span class="thinking"><i></i><i></i><i></i></span>`;
  $("#chat").appendChild(wrap);
  wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return wrap;
}

let voicePrimed = false;

/**
 * iOS only allows speech that starts inside a tap. The reply arrives long
 * after the tap, so the engine is woken once on the first touch and again
 * before each sentence — otherwise Safari accepts speak() and stays silent.
 */
function primeVoice() {
  if (voicePrimed || !("speechSynthesis" in window)) return;
  voicePrimed = true;
  try {
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    speechSynthesis.speak(silent);
    speechSynthesis.cancel();
  } catch {
    /* no voices yet */
  }
}

function speak(text) {
  if (!store.speak || !("speechSynthesis" in window)) return;
  const clean = String(text).replace(/```[\s\S]*?```/g, " code block ").replace(/[*_#`>]/g, "").slice(0, 600);
  if (!clean.trim()) return;
  primeVoice();
  const say = () => {
    try {
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.02;
      utterance.pitch = 0.92;
      const voices = speechSynthesis.getVoices();
      const preferred = voices.find((voice) => /en[-_]/i.test(voice.lang) && /female|samantha|serena|zira|aria/i.test(voice.name));
      if (preferred) utterance.voice = preferred;
      speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    } catch {
      /* the browser refused — nothing to do but stay quiet */
    }
  };
  try {
    speechSynthesis.cancel();
  } catch {
    /* nothing queued */
  }
  setTimeout(say, 80);
}

async function submitAsk(text) {
  const value = String(text || "").trim();
  if (!value || store.busy) return;
  store.busy = true;
  $("#ask").value = "";
  addMessage("me", value);
  const pending = thinking();
  try {
    const answer = await api("/api/ask", {
      method: "POST",
      body: { text: value, history: store.history.slice(-8) },
    });
    pending.remove();
    addMessage("athena", answer.reply || "…", { tools: answer.actions || [] });
    store.history.push({ role: "user", content: value }, { role: "assistant", content: answer.reply || "" });
    store.history = store.history.slice(-16);
    speak(answer.reply || "");
    loadState();
  } catch (error) {
    pending.remove();
    addMessage("athena", String(error.message || error));
  } finally {
    store.busy = false;
  }
}

/* ─────────────────────────────────────────────────────────── speech in */

let recognition = null;
let listening = false;

function startListening() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("Voice input is not available in this browser. Type instead.");
    return;
  }
  if (!recognition) {
    recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript) void submitAsk(transcript);
    };
    recognition.onerror = (event) => {
      listening = false;
      $("#mic").classList.remove("live");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast("Microphone blocked. iOS needs the app served over HTTPS to use the mic.");
      } else if (event.error !== "aborted") {
        toast("Voice error: " + event.error);
      }
    };
    recognition.onend = () => {
      listening = false;
      $("#mic").classList.remove("live");
    };
  }
  try {
    recognition.start();
    listening = true;
    $("#mic").classList.add("live");
    toast("Listening…");
  } catch {
    recognition.stop();
    listening = false;
  }
}

/* ─────────────────────────────────────────────────────────── stream */

function connectStream() {
  store.stream?.close();
  if (!store.token) return;
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(store.token)}`);
  store.stream = stream;
  stream.addEventListener("state", (event) => {
    try {
      store.state = JSON.parse(event.data);
      render();
    } catch {
      /* ignore */
    }
  });
  stream.addEventListener("job", () => loadState());
  stream.onerror = () => {
    /* the browser retries on its own */
  };
}

/* ─────────────────────────────────────────────────────────── screens */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const screens = { generation: 0 };

function screenNodes() {
  return (store.state?.nodes || []).filter((node) => node.online);
}

function screenCard(node) {
  const control = node.status?.capabilities?.input;
  const audio = node.status?.capabilities?.audio;
  return `<article class="screen-card" data-node="${esc(node.id)}">
    <div class="screen-head">
      <div class="screen-id">
        <span class="micro">${esc(node.name)}</span>
        <span class="micro dim">${esc(node.host)}:${node.port}</span>
      </div>
      <div class="head-actions">
        <span class="badge ${control ? "ok" : ""}">${control ? "CONTROL" : "VIEW ONLY"}</span>
        <button class="btn tiny" data-focus="${esc(node.id)}">⤢ FOCUS</button>
      </div>
    </div>
    <div class="screen-stage">
      <img alt="Screen of ${esc(node.name)}" data-img="${esc(node.id)}" draggable="false" />
      <div class="screen-note" data-note="${esc(node.id)}">CONNECTING…</div>
      <button class="focus-hint" data-focus="${esc(node.id)}">⤢ FOCUS</button>
    </div>
    <div class="screen-bar">
      <button class="btn tiny" data-k="enter" title="Enter">⏎</button>
      <button class="btn tiny" data-k="tab">TAB</button>
      <button class="btn tiny" data-k="esc">ESC</button>
      <button class="btn tiny" data-k="backspace">⌫</button>
      <button class="btn tiny" data-scroll="3" title="Scroll up">▲</button>
      <button class="btn tiny" data-scroll="-3" title="Scroll down">▼</button>
    </div>
    <form class="screen-type" data-form="${esc(node.id)}">
      <input data-text="${esc(node.id)}" placeholder="Type on that PC…" autocomplete="off" spellcheck="false" />
      <button class="btn tiny solid" type="submit">SEND</button>
    </form>
    <div class="screen-audio">
      ${
        audio
          ? `<button class="btn tiny" data-listen="${esc(node.id)}">🔊 LISTEN</button>
             <button class="btn tiny ghost" data-listen-mute="${esc(node.id)}">MUTE</button>`
          : `<span class="micro dim">SOUND OFF · INSTALL FFMPEG IN APPS</span>`
      }
    </div>
  </article>`;
}

function renderScreens() {
  const grid = $("#screen-grid");
  if (!grid) return;
  const nodes = screenNodes();
  const all = store.state?.nodes || [];
  const signature = all
    .map((node) => `${node.id}:${node.name}:${node.online}:${Boolean(node.status?.capabilities?.input)}:${Boolean(node.status?.capabilities?.audio)}`)
    .join("|") || "none";
  if (grid.dataset.signature === signature) return;
  grid.dataset.signature = signature;
  grid.innerHTML = nodes.length
    ? nodes.map(screenCard).join("")
    : `<div class="empty"><p class="micro dim">NO MACHINE IS ANSWERING</p><p class="micro dim" style="margin-top:8px">START THE NODE AGENT ON A PC, THEN OPEN NODES → SCAN</p></div>`;

  const deck = $("#screen-deck");
  if (deck) {
    deck.innerHTML = all.length
      ? all
          .map(
            (node) => `<div class="deck-item">
              <span class="dot ${node.online ? "live" : "off"}"></span>${esc(node.name)}
              <button data-focus="${esc(node.id)}">FOCUS</button>
            </div>`
          )
          .join("")
      : `<span class="micro dim">NO SIGNAL · LINK A MACHINE FIRST</span>`;
  }

  if (nodes.length && (store.view === "screen" || store.focus)) startScreens();
}

function stopScreens() {
  screens.generation += 1;
}

function startScreens() {
  const generation = (screens.generation += 1);
  for (const node of screenNodes()) void screenLoop(node.id, generation);
}

async function screenLoop(id, generation) {
  let misses = 0;
  while (generation === screens.generation) {
    if ((store.view !== "screen" && store.focus !== id) || document.hidden) {
      await sleep(800);
      misses = 0;
      continue;
    }
    const ok = await grabScreen(id, generation);
    misses = ok ? 0 : misses + 1;
    /* a dead or blocking node must not turn into a request storm on a phone */
    if (misses >= 3) {
      await sleep(6000);
      misses = 0;
      continue;
    }
    const focused = store.focus === id;
    /* one full-rate stream on a phone; the wall of previews can be slower */
    const tight = window.innerWidth < 760 && !focused;
    await sleep(focused ? 420 : tight ? 1400 : 650);
  }
}

async function grabScreen(id, generation) {
  const imgs = [...document.querySelectorAll(`[data-img="${CSS.escape(id)}"]`)];
  if (!imgs.length) {
    if (store.focus !== id) return true;
  }
  const note = document.querySelector(`[data-note="${CSS.escape(id)}"]`);
  const focusNote = store.focus === id ? $("#focus-note") : null;
  try {
    const res = await fetch(`/api/nodes/${encodeURIComponent(id)}/screen`, {
      headers: store.token ? { "x-athena-session": store.token } : {},
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `no picture (HTTP ${res.status})`;
      try {
        message = JSON.parse(text).error || message;
      } catch {
        /* not json */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    if (generation !== screens.generation) return true;
    const url = URL.createObjectURL(blob);
    const previous = imgs.map((element) => element.dataset.url).filter(Boolean);
    for (const img of imgs) {
      img.src = url;
      img.dataset.url = url;
      img.classList.add("live");
    }
    previous.forEach((old) => { if (old !== url) URL.revokeObjectURL(old); });
    if (note) note.hidden = true;
    if (focusNote) focusNote.hidden = true;
    return true;
  } catch (error) {
    const message = String(error.message || error).slice(0, 140).toUpperCase();
    if (note) {
      note.hidden = false;
      note.textContent = message;
    }
    if (focusNote) {
      focusNote.hidden = false;
      focusNote.textContent = message;
    }
    for (const img of imgs) img.classList.remove("live");
    return false;
  }
}

/* ─────────────────────────────────────────────────────────── focus */

function focusNode(id) {
  const node = (store.state?.nodes || []).find((item) => item.id === id);
  if (!node) return toast("That machine is not linked any more.");
  const caps = node.status?.capabilities || {};
  const gpu = node.status?.gpu || {};
  store.focus = id;
  $("#focus-name").textContent = node.name;
  $("#focus-meta").textContent = `NODE ${String(node.index || 0).padStart(2, "0")} · ${node.host}:${node.port}`;
  $("#focus-badge").textContent = node.online ? (caps.input ? "CONTROL" : "VIEW ONLY") : "OFFLINE";
  $("#focus-badge").className = "badge " + (node.online ? (caps.input ? "ok" : "") : "bad");
  const img = $("#focus-img");
  img.dataset.img = id;
  img.alt = `Screen of ${node.name}`;
  img.classList.remove("live");
  img.removeAttribute("src");
  $("#focus-note").hidden = false;
  $("#focus-note").textContent = "CONNECTING…";
  $("#focus-stats").innerHTML = [
    ["GPU", gpu.name || "—"],
    ["VRAM", gpu.vramGb ? `${gpu.vramGb} GB${gpu.usedGb ? ` · ${gpu.usedGb} used` : ""}` : "—"],
    ["LOAD", gpu.util != null ? `${gpu.util}%${gpu.temp != null ? ` · ${gpu.temp}°` : ""}` : "—"],
    ["CPU", node.status?.cores ? `${node.status.cores} cores` : "—"],
    ["RAM", node.status?.memory?.totalGb ? `${node.status.memory.totalGb} GB` : "—"],
    ["SOUND", caps.audio ? "LISTEN READY" : "NO FFMPEG"],
  ]
    .map(([label, value]) => `<div class="kv"><span class="micro dim">${label}</span><b>${esc(value)}</b></div>`)
    .join("");
  const listen = $("#focus-listen");
  $("#focus-mute").textContent = audioState.streams.get(id)?.el?.muted ? "UNMUTE" : "MUTE";
  listen.textContent = audioState.streams.has(id) ? "STOP" : "LISTEN";
  listen.classList.toggle("solid", audioState.streams.has(id));
  $("#focus").hidden = false;
  document.body.classList.add("focusing");
  startScreens();
}

function closeFocus() {
  const panel = $("#focus");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove("focusing");
  store.focus = null;
  const img = $("#focus-img");
  img.removeAttribute("data-img");
  img.removeAttribute("src");
  stopScreens();
  if (store.view === "screen") startScreens();
}

function screenPoint(img, event) {
  const rect = img.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1))),
  };
}

async function screenAct(id, payload) {
  try {
    await api(`/api/nodes/${encodeURIComponent(id)}/input`, { method: "POST", body: payload });
  } catch (error) {
    toast(error.message, 4500);
  }
}

/* ─────────────────────────────────────────────────────────── sound */

/** One <audio> per machine, fed by the hub's MP3 relay from that node. */
const audioState = { streams: new Map(), muted: false };

function audioElement(id) {
  const found = audioState.streams.get(id);
  if (found?.el) return found.el;
  const el = document.createElement("audio");
  el.autoplay = true;
  el.preload = "none";
  el.muted = audioState.muted;
  el.src = `/api/nodes/${encodeURIComponent(id)}/audio${store.token ? `?token=${encodeURIComponent(store.token)}` : ""}`;
  el.addEventListener("error", () => toast("No sound from that PC — FFmpeg installed? Stereo Mix enabled in Windows sound settings?", 5600));
  audioState.streams.set(id, { el });
  return el;
}

async function toggleListen(id, button) {
  const entry = audioState.streams.get(id);
  if (entry?.el) {
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
    audioState.streams.delete(id);
    button.textContent = "LISTEN";
    button.classList.remove("solid");
    syncMute();
    if ($("#focus-listen") && store.focus === id) $("#focus-listen").textContent = "LISTEN";
    return;
  }
  try {
    const el = audioElement(id);
    await el.play();
    button.textContent = "STOP";
    button.classList.add("solid");
    syncMute();
    void describeAudio(id);
  } catch {
    toast("The browser blocked playback — tap LISTEN again.", 4200);
  }
}

const audioInfo = new Map();

/** Tell the truth about what is being heard: a microphone, or the PC itself. */
async function describeAudio(id) {
  if (audioInfo.has(id)) return;
  try {
    const info = await api(`/api/nodes/${encodeURIComponent(id)}/audio/devices`);
    audioInfo.set(id, info);
    if (!info.systemAudio) {
      toast(
        `Hearing "${info.default}" on that PC — turn on Stereo Mix in Windows sound settings (Recording devices → show disabled) to hear its own sound.`,
        7200
      );
    }
  } catch (error) {
    toast(error.message, 6500);
  }
}

function syncMute() {
  const button = $("#screen-mute");
  if (button) button.textContent = audioState.muted ? "UNMUTE ALL" : "MUTE ALL";
  for (const { el } of audioState.streams.values()) el.muted = audioState.muted;
}

/* ─────────────────────────────────────────────────────────── apps */

const appsState = { catalogue: [], nodes: new Map(), busy: new Set() };

async function loadApps() {
  const grid = $("#app-list");
  if (!grid) return;
  const nodes = (store.state?.nodes || []);
  if (!nodes.length) {
    grid.innerHTML = `<div class="empty"><p class="micro dim">NO MACHINES LINKED</p><p class="micro dim" style="margin-top:8px">APPS INSTALL ON A NODE — START ONE, THEN NODES → SCAN</p></div>`;
    return;
  }
  grid.innerHTML = `<p class="micro dim">READING APPS ON ${nodes.length} MACHINE${nodes.length === 1 ? "" : "S"}…</p>`;
  try {
    if (!appsState.catalogue.length) appsState.catalogue = (await api("/api/apps")).apps || [];
  } catch (error) {
    grid.innerHTML = `<div class="empty"><p class="micro dim">${esc(error.message)}</p></div>`;
    return;
  }
  appsState.nodes.clear();
  await Promise.all(
    nodes.map(async (node) => {
      if (!node.online) {
        appsState.nodes.set(node.id, null);
        return;
      }
      try {
        const res = await api(`/api/nodes/${encodeURIComponent(node.id)}/action`, { method: "POST", body: { op: "apps", args: {} } });
        appsState.nodes.set(node.id, res.result?.apps || []);
      } catch (error) {
        appsState.nodes.set(node.id, { error: error.message });
      }
    })
  );
  renderApps();
}

function renderApps() {
  const grid = $("#app-list");
  if (!grid) return;
  const nodes = store.state?.nodes || [];
  if (!nodes.length) return;
  grid.innerHTML = appsState.catalogue
    .map((app) => {
      const rows = nodes
        .map((node) => {
          const list = appsState.nodes.get(node.id);
          const found = Array.isArray(list) ? list.find((item) => item.id === app.id) : null;
          const busy = appsState.busy.has(`${node.id}:${app.id}`);
          const badge = !node.online
            ? `<span class="badge bad">OFFLINE</span>`
            : !found
              ? `<span class="badge">?</span>`
              : found.running
                ? `<span class="badge run">RUNNING</span>`
                : found.installed
                  ? `<span class="badge ok">INSTALLED</span>`
                  : `<span class="badge bad">MISSING</span>`;
          const buttons = [];
          if (!busy && found && !found.installed) {
            buttons.push(`<button class="btn tiny solid" data-app="install" data-node="${esc(node.id)}" data-id="${app.id}">INSTALL</button>`);
          }
          if (!busy && app.service && found?.installed) {
            buttons.push(
              found.running
                ? `<button class="btn tiny" data-app="stop" data-node="${esc(node.id)}" data-id="${app.id}">STOP</button>`
                : `<button class="btn tiny" data-app="start" data-node="${esc(node.id)}" data-id="${app.id}">START</button>`
            );
          }
          return `<div class="app-row">
            <div class="app-row-head"><span class="micro">${esc(node.name)}</span>${badge}</div>
            <p class="micro dim">${esc(busy ? "WORKING…" : found?.note || "")}</p>
            <div class="actions">${buttons.join("")}</div>
          </div>`;
        })
        .join("");
      return `<article class="card bracket app-card" id="app-${app.id}">
        <div class="app-head">
          <div><h3>${esc(app.name)}</h3><p class="micro dim">${esc(app.tag)} · ${esc(app.size)}</p></div>
          <span class="badge">${app.service ? "SERVICE" : "TOOL"}</span>
        </div>
        <p class="micro dim">${esc(app.blurb)}</p>
        ${app.detail ? `<p class="micro dim">${esc(app.detail)}</p>` : ""}
        <div class="app-rows">${rows}</div>
      </article>`;
    })
    .join("");
}

async function appAction(nodeId, appId, action) {
  const key = `${nodeId}:${appId}`;
  appsState.busy.add(key);
  renderApps();
  try {
    await api(`/api/nodes/${encodeURIComponent(nodeId)}/action`, {
      method: "POST",
      body: { op: `app-${action}`, args: { app: appId }, timeout: action === "install" ? 900_000 : 240_000 },
    });
    toast(`${appId.toUpperCase()} · ${action.toUpperCase()} DONE`, 3600);
  } catch (error) {
    toast(error.message, 6500);
  }
  appsState.busy.delete(key);
  await loadApps();
}

/* ─────────────────────────────────────────────────────────── system */

let brainPoll = null;

function renderSystem(state) {
  const hub = state?.hub || {};
  const addresses = [`http://127.0.0.1:${hub.port}`, ...(hub.addresses || []).map((address) => `http://${address}:${hub.port}`)];
  $("#sys-addresses").textContent = addresses.join("  ·  ");
  $("#sys-code").textContent = hub.code || "OPEN MODE";
  $("#sys-pid").textContent = hub.pid ? `PID ${hub.pid} · v${hub.version}` : "—";
  $("#sys-uptime").textContent = hub.startedAt ? `SINCE ${new Date(hub.startedAt).toLocaleTimeString()}` : "—";
  const sessions = $("#sys-sessions");
  if (sessions) sessions.textContent = state?.sessions != null ? String(state.sessions) : "—";
  const note = $("#sessions-note");
  if (note && state?.sessionDays) note.textContent = `A device stays unlocked for ${state.sessionDays} days after its last use. Sign out here if a phone is lost.`;

  const nodes = state?.nodes || [];
  $("#sys-nodes").innerHTML = nodes.length
    ? nodes
        .map(
          (node) => `<div class="app-row">
            <div class="app-row-head"><span class="micro">${esc(node.name)} · ${esc(node.host)}:${node.port}</span>
              <span class="badge ${node.online ? "ok" : "bad"}">${node.online ? "AGENT UP" : "OFFLINE"}</span></div>
            <div class="actions">
              <button class="btn tiny" data-agent="panel" data-id="${esc(node.id)}">PANEL</button>
              <button class="btn tiny" data-agent="screen" data-id="${esc(node.id)}">SCREEN</button>
              <button class="btn tiny danger" data-agent="stop" data-id="${esc(node.id)}">STOP AGENT</button>
            </div>
          </div>`
        )
        .join("")
    : `<p class="micro dim">NO MACHINES LINKED. START A NODE AGENT ON A PC, THEN NODES → SCAN.</p>`;
}

async function brainStatus() {
  try {
    const status = await api("/api/brain/install");
    const log = $("#brain-log");
    $("#brain-state").textContent = `${String(status.state || "idle").toUpperCase()}${status.step ? " · " + status.step : ""}`;
    if (status.log?.length) {
      log.hidden = false;
      log.textContent = status.log.slice(-60).join("\n");
      log.scrollTop = log.scrollHeight;
    }
    if (status.state === "running" && !brainPoll) {
      brainPoll = setInterval(() => {
        if (store.view !== "system") {
          clearInterval(brainPoll);
          brainPoll = null;
          return;
        }
        void brainStatus();
      }, 2500);
    }
    if (status.state !== "running" && brainPoll) {
      clearInterval(brainPoll);
      brainPoll = null;
      if (status.state === "done") void loadState();
    }
  } catch {
    /* locked or hub restarting */
  }
}

async function brainStart(kind) {
  const path = kind === "upgrade" ? "/api/brain/upgrade" : "/api/brain/install";
  try {
    const res = await api(path, { method: "POST", body: { vision: Boolean($("#brain-vision")?.checked) } });
    if (res.busy) {
      toast("Already working on the brain.", 3600);
    } else {
      toast(kind === "upgrade" ? "Searching for a bigger brain…" : "Installing the brain — this takes a few minutes.", 4600);
    }
    $("#brain-log").hidden = false;
    void brainStatus();
  } catch (error) {
    toast(error.message, 5200);
  }
}

/* ─────────────────────────────────────────────────────────── wiring */

function switchView(view) {
  if (store.focus) closeFocus();
  store.view = view;
  $$(".view").forEach((section) => (section.hidden = section.dataset.view !== view));
  $$(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === view));
  requestAnimationFrame(moveTabGlide);
  if (view === "jobs") void loadJobs();
  if (view === "apps") void loadApps();
  if (view === "system") {
    renderSystem(store.state);
    void brainStatus();
  }
  if (view === "screen") {
    renderScreens();
    startScreens();
  } else {
    stopScreens();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadJobs() {
  try {
    const jobs = await api("/api/jobs");
    store.state = { ...(store.state || {}), jobs: jobs.jobs };
    renderJobs(jobs.jobs);
  } catch {
    /* handled by api() */
  }
}

async function scan() {
  $("#scan").disabled = true;
  toast("Shouting on the network…");
  try {
    const res = await api("/api/scan", { method: "POST" });
    const box = $("#found");
    if (!res.found.length) {
      box.innerHTML = `<div class="empty"><p class="micro dim">NO NODES ANSWERED</p><p class="micro dim" style="margin-top:8px">START THE AGENT ON THE PC, ALLOW ITS FIREWALL PROMPT, THEN SCAN AGAIN</p></div>`;
      return;
    }
    box.innerHTML = res.found
      .map(
        (device, index) => `<article class="card bracket">
        <div class="card-top">
          <div>
            <h3 style="font-size:14px">${esc(device.name)}</h3>
            <p class="micro dim">${esc(device.address)} · ${esc(device.gpu || "no gpu reporting")}${device.vramGb ? " · " + device.vramGb + "GB" : ""}</p>
          </div>
          <span class="badge ${device.paired ? "ok" : ""}">${device.paired ? "LINKED" : "FOUND"}</span>
        </div>
        ${
          device.paired
            ? ""
            : `<div class="found-row">
                <input data-code="${index}" placeholder="CODE" maxlength="10" inputmode="text" />
                <button class="btn tiny solid" data-link="${index}">LINK</button>
              </div>`
        }
      </article>`
      )
      .join("");
    box._devices = res.found;
    box.querySelectorAll("[data-link]").forEach((button) => {
      button.onclick = async () => {
        const device = box._devices[Number(button.dataset.link)];
        const input = box.querySelector(`[data-code="${button.dataset.link}"]`);
        const code = String(input?.value || "").trim().toUpperCase();
        if (!code) return toast("Enter the code shown on that PC.");
        button.disabled = true;
        try {
          await api("/api/nodes/pair", { method: "POST", body: { host: device.host, port: device.port, code } });
          toast("Linked " + device.name);
          box.innerHTML = "";
          await loadState();
        } catch (error) {
          toast(error.message, 4200);
          button.disabled = false;
        }
      };
    });
  } catch (error) {
    toast(error.message);
  } finally {
    $("#scan").disabled = false;
  }
}

async function act(nodeId, op) {
  if (op === "focus") return focusNode(nodeId);
  if (op === "screen") return switchView("screen");
  if (op === "apps") return switchView("apps");
  if (op === "unpair") {
    if (!confirm("Unlink this machine? ATHENA will lose control of it.")) return;
    await api(`/api/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" }).catch((error) => toast(error.message));
    return loadState();
  }
  toast(op.replace("-", " ").toUpperCase() + "…");
  try {
    if (op === "refresh") await api(`/api/nodes/${encodeURIComponent(nodeId)}/refresh`, { method: "POST" });
    else await api(`/api/nodes/${encodeURIComponent(nodeId)}/action`, { method: "POST", body: { op, args: {} } });
    toast("Done.");
    await loadState();
  } catch (error) {
    toast(error.message, 5000);
  }
}

$("#unlock").onclick = unlock;
$("#code").addEventListener("keydown", (event) => {
  if (event.key === "Enter") unlock();
});
$("#lock").addEventListener("submit", (event) => event.preventDefault());

$$(".tabs button").forEach((button) => {
  button.onclick = () => switchView(button.dataset.tab);
});

/* ─────────────────────────────────────────────────────────── mode & look */

$("#mode").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button && button.dataset.mode !== store.mode) setMode(button.dataset.mode);
});

$("#swatches").addEventListener("click", (event) => {
  const button = event.target.closest("[data-accent]");
  if (!button) return;
  store.look.accent = button.dataset.accent;
  localStorage.setItem("athena.accent", store.look.accent);
  applyLook();
});

$("#cfg-motion").addEventListener("input", (event) => {
  store.look.motion = event.target.value;
  localStorage.setItem("athena.motion", store.look.motion);
  applyLook();
  toast(`Motion · ${MOTION_LABELS[Number(store.look.motion)] || "DIVINE"}`, 1600);
});

$("#cfg-glass").addEventListener("change", (event) => {
  store.look.glass = event.target.checked;
  localStorage.setItem("athena.glass", store.look.glass ? "1" : "0");
  applyLook();
});

$("#cfg-art").addEventListener("change", (event) => {
  store.look.art = event.target.checked;
  localStorage.setItem("athena.art", store.look.art ? "1" : "0");
  applyLook();
});

/* ─────────────────────────────────────────────────────────── focus panel */

function focusedNode() {
  return (store.state?.nodes || []).find((node) => node.id === store.focus) || null;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-focus]");
  if (button) focusNode(button.dataset.focus);
});

$("#focus").addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) return closeFocus();
  const id = store.focus;
  if (!id) return;
  const quick = event.target.closest("[data-quick-focus]");
  if (quick) {
    const node = focusedNode();
    const label = node ? node.name : "that machine";
    closeFocus();
    switchView("home");
    void submitAsk(`on ${label}: ${quick.dataset.quickFocus}`);
    return;
  }
  const key = event.target.closest("[data-k]");
  if (key) return void screenAct(id, { op: "key", key: key.dataset.k });
  const scroll = event.target.closest("[data-scroll]");
  if (scroll) return void screenAct(id, { op: "scroll", amount: Number(scroll.dataset.scroll) });
  if (event.target.id === "focus-img") void screenAct(id, { op: "click", ...screenPoint(event.target, event) });
});

$("#focus").addEventListener("contextmenu", (event) => {
  if (event.target.id !== "focus-img" || !store.focus) return;
  event.preventDefault();
  void screenAct(store.focus, { op: "right", ...screenPoint(event.target, event) });
});

$("#focus-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#focus-text");
  const text = String(input.value || "");
  if (!text.trim() || !store.focus) return;
  input.value = "";
  void screenAct(store.focus, { op: "type", text });
});

$("#focus-listen").onclick = () => {
  if (store.focus) void toggleListen(store.focus, $("#focus-listen"));
};

$("#focus-mute").onclick = () => {
  const id = store.focus;
  const entry = audioState.streams.get(id);
  if (!entry) return toast("Press LISTEN first.");
  entry.el.muted = !entry.el.muted;
  $("#focus-mute").textContent = entry.el.muted ? "UNMUTE" : "MUTE";
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && store.focus) closeFocus();
});

window.addEventListener("resize", () => requestAnimationFrame(moveTabGlide));

$("#ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitAsk($("#ask").value);
});

$("#quick").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick]");
  if (button) void submitAsk(button.dataset.quick);
});

$("#mic").addEventListener("click", () => {
  if (listening) {
    recognition?.stop();
    return;
  }
  startListening();
});

$("#speak-toggle").onclick = () => {
  store.speak = !store.speak;
  localStorage.setItem("athena.speak", store.speak ? "1" : "0");
  if (!store.speak) speechSynthesis?.cancel();
  render();
};

$("#refresh").onclick = async () => {
  toast("Syncing…");
  await loadState();
};

$("#scan").onclick = scan;
$("#jobs-refresh").onclick = loadJobs;

$("#pair").onclick = async () => {
  const host = $("#pair-host").value.trim();
  const port = Number($("#pair-port").value) || 47910;
  const code = $("#pair-code").value.trim().toUpperCase();
  if (!host) return toast("Enter the machine's address.");
  try {
    await api("/api/nodes/pair", { method: "POST", body: { host, port, code } });
    toast("Linked.");
    $("#pair-host").value = "";
    $("#pair-code").value = "";
    await loadState();
  } catch (error) {
    toast(error.message, 5000);
  }
};

$("#node-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (button) void act(button.dataset.id, button.dataset.act);
});

$("#screen-redraw").onclick = () => {
  screens.generation += 1;
  startScreens();
  toast("Redrawing…");
};

$("#screen-mute").onclick = () => {
  audioState.muted = !audioState.muted;
  syncMute();
  toast(audioState.muted ? "Sound muted." : "Sound back on.");
};

$("#apps-refresh").onclick = () => {
  void loadApps();
};

$("#app-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-app]");
  if (!button) return;
  void appAction(button.dataset.node, button.dataset.id, button.dataset.app);
});

$("#sys-nodes").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-agent]");
  if (!button) return;
  const node = (store.state?.nodes || []).find((item) => item.id === button.dataset.id);
  if (!node) return;
  if (button.dataset.agent === "panel") {
    window.open(`http://${node.host}:${node.port}/`, "_blank");
    return;
  }
  if (button.dataset.agent === "screen") return switchView("screen");
  if (!confirm(`Stop the ATHENA agent on ${node.name}? That machine goes offline until it is started again.`)) return;
  try {
    await api(`/api/nodes/${encodeURIComponent(node.id)}/action`, { method: "POST", body: { op: "shutdown", args: {} } });
    toast("Agent stopped on " + node.name);
  } catch (error) {
    toast(error.message, 5200);
  }
});

$("#brain-install").onclick = () => void brainStart("install");
$("#brain-upgrade").onclick = () => void brainStart("upgrade");

$("#hub-stop").onclick = async () => {
  if (!confirm("Shut down the hub? Phones and API tools lose ATHENA until Start Athena.cmd runs again.")) return;
  try {
    await api("/api/hub/shutdown", { method: "POST" });
  } catch {
    /* the connection may drop as it exits */
  }
  store.stream?.close();
  document.querySelector("#lock").hidden = true;
  document.querySelector("#app").innerHTML = `<div class="empty" style="padding:60px 20px">
    <p class="micro accent">ATHENA IS STOPPED</p>
    <p class="micro dim" style="margin-top:10px">RUN Start Athena.cmd ON THE HUB PC TO BRING IT BACK.</p>
  </div>`;
};

$("#hub-restart").onclick = async () => {
  if (!confirm("Restart the hub? Everything reconnects in a few seconds.")) return;
  try {
    await api("/api/hub/restart", { method: "POST" });
  } catch {
    /* connection drops */
  }
  store.stream?.close();
  toast("Restarting the hub…", 4000);
  setTimeout(() => location.reload(), 2800);
};

$("#screen-grid").addEventListener("click", (event) => {
  const card = event.target.closest(".screen-card");
  if (!card) return;
  const id = card.dataset.node;
  const listen = event.target.closest("[data-listen]");
  if (listen) {
    void toggleListen(id, listen);
    return;
  }
  const mute = event.target.closest("[data-listen-mute]");
  if (mute) {
    const entry = audioState.streams.get(id);
    if (!entry) {
      toast("Press LISTEN first.");
      return;
    }
    entry.el.muted = !entry.el.muted;
    mute.textContent = entry.el.muted ? "UNMUTE" : "MUTE";
    return;
  }
  const key = event.target.closest("[data-k]");
  if (key) {
    void screenAct(id, { op: "key", key: key.dataset.k });
    return;
  }
  const scroll = event.target.closest("[data-scroll]");
  if (scroll) {
    void screenAct(id, { op: "scroll", amount: Number(scroll.dataset.scroll) });
    return;
  }
  if (event.target.matches("[data-img]")) {
    /* on a phone a 16:9 thumbnail is too small to aim at — open it instead */
    if (store.mode === "basic") {
      focusNode(id);
      return;
    }
    void screenAct(id, { op: "click", ...screenPoint(event.target, event) });
  }
});

$("#screen-grid").addEventListener("contextmenu", (event) => {
  const img = event.target.closest("[data-img]");
  if (!img) return;
  event.preventDefault();
  const card = img.closest(".screen-card");
  if (card) void screenAct(card.dataset.node, { op: "right", ...screenPoint(img, event) });
});

$("#screen-grid").addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector("[data-text]");
  const text = String(input?.value || "");
  if (!text.trim()) return;
  input.value = "";
  void screenAct(form.dataset.form, { op: "type", text });
});

$("#job-list").addEventListener("click", (event) => {
  const detail = event.target.closest("[data-job]");
  if (detail) {
    const job = (store.state?.jobs || []).find((item) => item.id === detail.dataset.job);
    if (job) addMessage("athena", `Job ${job.id} · ${job.state}\n$ ${job.args?.command || job.op}`, { code: job.output || "(no output)" });
    switchView("home");
  }
  const cancel = event.target.closest("[data-cancel]");
  if (cancel) {
    api(`/api/jobs/${encodeURIComponent(cancel.dataset.cancel)}/cancel`, { method: "POST" })
      .then(() => {
        toast("Cancelled.");
        return loadJobs();
      })
      .catch((error) => toast(error.message));
  }
});

$("#key-create").onclick = async () => {
  const label = $("#key-label").value.trim() || "tool";
  try {
    const res = await api("/api/keys", { method: "POST", body: { label } });
    $("#new-key").innerHTML = `<div class="panel bracket" style="margin-top:12px">
      <p class="micro accent">COPY IT NOW — IT IS NOT SHOWN AGAIN</p>
      <pre class="code">${esc(res.key)}</pre>
      <button class="btn tiny" id="copy-key">COPY</button>
    </div>`;
    $("#copy-key").onclick = async () => {
      try {
        await navigator.clipboard.writeText(res.key);
        toast("Key copied.");
      } catch {
        toast("Select the key and copy it by hand.");
      }
    };
    $("#key-label").value = "";
    await loadState();
  } catch (error) {
    toast(error.message);
  }
};

$("#key-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-key]");
  if (!button) return;
  if (!confirm("Revoke this key? Tools using it stop working.")) return;
  try {
    await api(`/api/keys/${encodeURIComponent(button.dataset.key)}`, { method: "DELETE" });
    toast("Revoked.");
    await loadState();
  } catch (error) {
    toast(error.message);
  }
});

async function saveSettings(overrides = {}) {
  const body = {
    hubName: $("#cfg-name").value,
    code: $("#cfg-code").value,
    openMode: $("#cfg-open").checked,
    brain: {
      provider: $("#cfg-provider").value,
      model: $("#cfg-model").value,
      baseUrl: $("#cfg-base").value,
      apiKey: $("#cfg-key").value,
      ...(overrides.brain || {}),
    },
  };
  try {
    const res = await api("/api/settings", { method: "POST", body });
    store.state = res.state;
    $("#cfg-key").value = "";
    render();
    toast("Saved.");
  } catch (error) {
    toast(error.message);
  }
}

$("#cfg-save").onclick = () => saveSettings();
$("#cfg-save-2").onclick = () => saveSettings();

$("#cfg-model-pick").addEventListener("change", (event) => {
  const model = event.target.value;
  if (!model) return;
  $("#cfg-model").value = model;
  void saveSettings({ brain: { model, provider: "ollama" } });
  toast(`Brain → ${model}`, 3200);
});

$("#sessions-clear").onclick = async () => {
  if (!confirm("Sign out every phone and device? Each one will need the access code again.")) return;
  try {
    const res = await api("/api/sessions", { method: "DELETE" });
    toast(`Signed out ${res.count} device${res.count === 1 ? "" : "s"}.`, 3600);
    store.token = "";
    localStorage.removeItem("athena.session");
    /* signing out is also forgetting what was said on this device */
    localStorage.removeItem(CHAT_KEY);
    store.chat = [];
    store.history = [];
    $$("#chat .msg").forEach((element) => element.remove());
    lock();
  } catch (error) {
    toast(error.message, 5000);
  }
};

/* first touch anywhere wakes the speech engine, which iOS insists on */
document.addEventListener("pointerdown", primeVoice, { once: true });

$("#lock-hint").textContent = "ENTER ACCESS CODE";

/** On the machine that runs the hub there is nothing to type: it opens itself. */
async function localUnlock() {
  try {
    const info = await (await fetch("/api/lock", { cache: "no-store" })).json();
    if (!info.local) return false;
    if (info.code) {
      const line = $("#lock-local");
      line.hidden = false;
      line.innerHTML = `THIS PC · CODE <b class="accent">${esc(info.code)}</b>`;
      $("#code").value = info.code;
    }
    if (store.token) return true;
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ local: true }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    store.token = json.token;
    localStorage.setItem("athena.session", json.token);
    return true;
  } catch {
    return false;
  }
}

/** A stored token is only worth the session behind it — ask the hub first. */
async function sessionStillValid() {
  if (!store.token) return false;
  try {
    const res = await fetch("/api/state", {
      headers: { "x-athena-session": store.token },
      cache: "no-store",
    });
    if (res.status === 401) {
      store.token = "";
      localStorage.removeItem("athena.session");
      return false;
    }
    return true;
  } catch {
    /* hub asleep or Wi-Fi dropped: keep the token, the lock is not the answer */
    return true;
  }
}

async function boot() {
  applyLook();
  spawnSparks();
  /* On the hub PC, auto-unlock. A phone needs a session the hub still knows. */
  const unlocked = (await localUnlock()) || (await sessionStillValid());
  if (unlocked) {
    $("#lock").hidden = true;
    $("#app").hidden = false;
    restoreChat();
    await loadState();
    connectStream();
    requestAnimationFrame(moveTabGlide);
  } else {
    $("#lock").hidden = false;
    $("#app").hidden = true;
    $("#code").focus();
  }
  /* waking the phone from the background is when a phone is most stale */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !store.token) return;
    void loadState();
  });
}

/* the emblem follows the pointer on hover-capable screens */
function bindEmblemTilt() {
  const stage = document.querySelector(".core-stage");
  const core = stage?.querySelector(".oculus");
  if (!stage || !core || !matchMedia("(hover: hover)").matches) return;
  let raf = 0;
  stage.addEventListener("pointermove", (event) => {
    const box = stage.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      core.style.setProperty("--ty", (x * 18).toFixed(2) + "deg");
      core.style.setProperty("--tx", (-y * 15).toFixed(2) + "deg");
    });
  });
  stage.addEventListener("pointerleave", () => {
    core.style.setProperty("--tx", "0deg");
    core.style.setProperty("--ty", "0deg");
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

bindEmblemTilt();

void boot();
