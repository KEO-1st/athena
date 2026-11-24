/* ATHENA — hub client. Works on iOS Safari as an installed PWA. */
import { rankVoices, speechChunks, voiceLabel } from "./speech.mjs";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const store = {
  token: localStorage.getItem("athena.session") || "",
  /* Athena answers out loud by default — it is a voice-first app. */
  speak: localStorage.getItem("athena.speak") === null ? true : localStorage.getItem("athena.speak") === "1",
  voice: {
    name: localStorage.getItem("athena.voice") || "",
    rate: Number(localStorage.getItem("athena.voiceRate")) || 1,
    pitch: Number(localStorage.getItem("athena.voicePitch")) || 1,
  },
  look: {
    accent: localStorage.getItem("athena.accent") || "gold",
    motion: localStorage.getItem("athena.motion") || "2",
    glass: localStorage.getItem("athena.glass") !== "0",
    art: localStorage.getItem("athena.art") !== "0",
  },
  focus: null,
  lockInfo: null,
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
  body.dataset.accent = store.look.accent;
  body.dataset.motion = store.look.motion;
  body.dataset.glass = store.look.glass ? "on" : "off";
  body.dataset.art = store.look.art ? "on" : "off";
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

  $("#hub-line").textContent = `HUB · ${String(state.hub.name).toUpperCase()} · v${state.hub.version} · ${state.hub.addresses?.[0] || "LAN"}`;
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
  renderIntegrations(state.integrations || []);
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

  /* State updates arrive every few seconds. Rebuilding the cards must not
     slam an open Software section shut or throw away its loaded list. */
  const openSoftware = new Set([...list.querySelectorAll("details[data-soft][open]")].map((item) => item.dataset.soft));

  list.innerHTML = nodes
    .map((node) => {
      const status = node.status || {};
      const gpu = status.gpu || {};
      const caps = status.capabilities || {};
      const compat = node.compatibility || {};
      const compatBad = compat.status && !["ok", "legacy"].includes(compat.status);
      return `<article class="card ${node.online ? "on" : "off"} bracket">
        <div class="card-top">
          <div>
            <h3>${esc(node.name)}</h3>
            <p class="micro dim">NODE ${String(node.index || 0).padStart(2, "0")} · ${esc(node.host)}:${node.port} · NODE SOFTWARE ${node.nodeVersion ? "v" + esc(node.nodeVersion) : "UNKNOWN"} · PROTOCOL ${node.protocol == null ? "LEGACY" : esc(node.protocol)}</p>
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
        ${compatBad ? `<p class="micro job-error">✕ ${esc(compat.reason || "This Node is not compatible with this Hub.")}</p>` : ""}
        <details class="node-soft" data-soft="${esc(node.id)}">
          <summary><span class="micro">SOFTWARE ON THIS MACHINE</span><span class="micro dim">DETECT · INSTALL · START</span></summary>
          <div class="soft-body" data-soft-body="${esc(node.id)}"><p class="micro dim">OPEN TO READ WHAT IS INSTALLED ON ${esc(node.name.toUpperCase())}.</p></div>
        </details>
        <div class="actions">
          <button class="btn tiny solid" data-act="focus" data-id="${node.id}">⤢ FOCUS</button>
          <button class="btn tiny" data-act="refresh" data-id="${node.id}">STATUS</button>
          <button class="btn tiny" data-act="screen" data-id="${node.id}">SCREEN</button>
          <button class="btn tiny danger" data-act="unpair" data-id="${node.id}">UNLINK</button>
        </div>
      </article>`;
    })
    .join("");

  for (const id of openSoftware) {
    const details = list.querySelector(`details[data-soft="${CSS.escape(id)}"]`);
    if (!details) continue;
    details.open = true;
    const body = softBody(id);
    if (!body) continue;
    if (appsState.nodes.has(id)) renderNodeSoftware(id, body);
    else void loadNodeSoftware(id);
  }
}

const JOB_BADGE = { queued: "", running: "run", done: "ok", failed: "bad", cancelled: "bad", timeout: "bad" };

function formatWhen(value) {
  if (!value) return "—";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(job) {
  if (!job.startedAt) return job.state === "queued" ? "waiting" : "—";
  const end = job.endedAt ? Date.parse(job.endedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function jobDescription(job) {
  const command = job.args?.command ? String(job.args.command).split("\n")[0] : "";
  if (command) return command;
  if (job.op === "app-install") return `install ${job.args?.app || "software"}`;
  if (job.op === "app-start") return `start ${job.args?.app || "a service"}`;
  if (job.op === "app-stop") return `stop ${job.args?.app || "a service"}`;
  return job.label || job.op;
}

function jobOrigin(job) {
  const source = String(job.source || "api").toLowerCase();
  const who = job.createdBy ? ` by ${job.createdBy}` : " — created before the Hub recorded which client asked";
  if (source === "api") return { badge: "API", why: `Sent to the Hub's REST API${who}.` };
  if (source === "hub" || source === "app") return { badge: "APP", why: `Queued from the ATHENA app${who}.` };
  if (source === "chat") return { badge: "CHAT", why: `Queued from a chat request${who}.` };
  return { badge: source.toUpperCase(), why: `Origin reported as “${source}”${who}.` };
}

function jobFailure(job) {
  if (!["failed", "timeout", "cancelled"].includes(job.state)) return "";
  const reason = job.error || String(job.output || "").trim().split(/\r?\n/).filter(Boolean).pop() || (job.state === "cancelled" ? "Cancelled before it finished." : "No reason was reported.");
  return String(reason).slice(0, 300);
}

function renderJobs(jobs) {
  const list = $("#job-list");
  if (!jobs.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">QUEUE IS EMPTY</p><p class="micro dim" style="margin-top:8px">JOBS ARE TASKS ATHENA RUNS OR QUEUES ON A MACHINE. THEY ARRIVE FROM THE AI OR THE API.</p></div>`;
    return;
  }
  const nodeName = (id) => (store.state?.nodes || []).find((node) => node.id === id)?.name || id;
  list.innerHTML = jobs
    .map((job) => {
      const badge = JOB_BADGE[job.state] || "";
      const failure = jobFailure(job);
      const output = String(job.output || "").trim();
      const origin = jobOrigin(job);
      return `<article class="card bracket job" data-state="${esc(job.state)}">
        <div class="card-top">
          <div>
            <h3 style="font-size:13px">${esc(jobDescription(job))}</h3>
            <p class="micro dim">${esc(nodeName(job.node))} · ${esc(job.op.toUpperCase())} · ${esc(origin.badge)}</p>
          </div>
          <span class="badge ${badge}">${esc(job.state)}</span>
        </div>
        <p class="micro dim">WHY · ${esc(origin.why)}</p>
        <div class="job-times">
          <span class="micro dim">QUEUED ${esc(formatWhen(job.createdAt))}</span>
          <span class="micro dim">STARTED ${esc(formatWhen(job.startedAt))}</span>
          <span class="micro dim">ENDED ${esc(formatWhen(job.endedAt))}</span>
          <span class="micro dim">TOOK ${esc(formatDuration(job))}</span>
          ${job.code != null ? `<span class="micro dim">EXIT ${esc(job.code)}</span>` : ""}
        </div>
        ${failure ? `<p class="micro job-error">✕ ${esc(failure)}</p>` : ""}
        ${output ? `<details class="job-output"><summary class="micro dim">OUTPUT (${output.length} CHARS)</summary><pre class="code">${esc(output.slice(-4000))}</pre></details>` : `<p class="micro dim">No output.</p>`}
        <div class="actions">
          <button class="btn tiny ghost" data-job="${job.id}">SEND TO CHAT</button>
          ${output ? `<button class="btn tiny" data-copy-job="${job.id}">COPY OUTPUT</button>` : ""}
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
  const local = Boolean(store.lockInfo?.local);
  $("#cfg-code").value = store.lockInfo?.code || "";
  $("#cfg-code").disabled = !local;
  $("#cfg-open").checked = Boolean(state.hub.openMode);
  $("#cfg-open").disabled = !local;
  const localNote = $("#cfg-local-note");
  if (localNote) {
    localNote.textContent = local
      ? "SECURITY CHANGES ARE CONFIRMED WITH THE CURRENT CODE."
      : "OPEN MODE AND CODE CHANGES CAN ONLY BE MADE ON THE HUB PC.";
  }
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

/** Screenshots come back as real images, not base64 text or JSON. */
function addShots(wrap, images) {
  if (!Array.isArray(images) || !images.length) return;
  const box = document.createElement("div");
  box.className = "msg-shots";
  for (const shot of images.slice(0, 2)) {
    if (!shot?.url) continue;
    const img = document.createElement("img");
    img.src = shot.url;
    img.alt = shot.node ? `Screenshot of ${shot.node}` : "Screenshot";
    img.loading = "lazy";
    box.appendChild(img);
  }
  if (box.childElementCount) wrap.appendChild(box);
}

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
  addShots(wrap, extra.images);
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
const speechReady = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/**
 * iOS only allows speech whose engine was woken by a real tap. One silent
 * utterance during the first touch unlocks it for the rest of the session.
 * It is deliberately not cancelled — cancelling revokes the unlock in Safari.
 */
function primeVoice() {
  if (voicePrimed || !speechReady()) return;
  voicePrimed = true;
  try {
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    silent.rate = 1;
    speechSynthesis.resume();
    speechSynthesis.speak(silent);
  } catch {
    voicePrimed = false;
  }
}

let spokenChunks = [];
let speakTimer = 0;
let speakGen = 0;

/** The installed voices, best first. Quality is a ranking, not a hard rule. */
function availableVoices() {
  if (!speechReady()) return [];
  try {
    return rankVoices(speechSynthesis.getVoices());
  } catch {
    return [];
  }
}

function selectedVoice(voices = availableVoices()) {
  return voices.find((voice) => voice.name === store.voice.name) || voices[0] || null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function renderVoicePanel() {
  const pick = $("#voice-pick");
  if (!pick) return;
  const voices = availableVoices();
  if (!voices.length) {
    pick.innerHTML = `<option value="">No speech voices reported yet</option>`;
    pick.disabled = true;
  } else {
    pick.disabled = false;
    const chosen = selectedVoice(voices);
    pick.innerHTML = voices
      .map((voice) => `<option value="${esc(voice.name)}"${voice.name === chosen?.name ? " selected" : ""}>${esc(voiceLabel(voice))}</option>`)
      .join("");
  }
  const rate = $("#voice-rate");
  const pitch = $("#voice-pitch");
  if (rate) rate.value = String(store.voice.rate);
  if (pitch) pitch.value = String(store.voice.pitch);
  const note = $("#voice-note");
  if (note) {
    note.textContent = voices.length
      ? `${voices.length} voice${voices.length === 1 ? "" : "s"} installed on this device · ${voices[0].name} sounds most natural here. Speech is generated by this browser, not by the hub.`
      : "This browser has not reported any voices. On Windows, add voices in Settings → Time & language → Speech. On iOS, they download in Settings → Accessibility → Spoken Content.";
  }
}

function speakNext(gen) {
  if (gen !== speakGen) return;
  window.clearInterval(speakTimer);
  speakTimer = 0;
  if (!spokenChunks.length) return;
  const utterance = new SpeechSynthesisUtterance(spokenChunks.shift());
  /* 1.0 instead of 1.02/0.92: the old lowered pitch and slightly fast rate
     were most of the "robot" impression. The user can tune both. */
  utterance.rate = clampNumber(store.voice.rate, 0.7, 1.5, 1);
  utterance.pitch = clampNumber(store.voice.pitch, 0.7, 1.4, 1);
  utterance.volume = 1;
  const preferred = selectedVoice();
  if (preferred) utterance.voice = preferred;
  utterance.onend = () => speakNext(gen);
  utterance.onerror = () => speakNext(gen);
  try {
    speechSynthesis.resume();
    speechSynthesis.speak(utterance);
  } catch {
    /* the browser refused — stay quiet */
  }
}

function speak(text) {
  if (!store.speak || !speechReady()) return;
  const chunks = speechChunks(text);
  if (!chunks.length) return;
  primeVoice();
  /* Cancelling fires onerror on whatever was playing — the generation stamp
     makes sure that stale callback cannot restart the old reply. */
  const gen = ++speakGen;
  try {
    speechSynthesis.cancel();
  } catch {
    /* nothing queued */
  }
  spokenChunks = chunks;
  /* Chrome and iOS both need the queue drained from a task, not mid-gesture. */
  window.setTimeout(() => {
    if (gen !== speakGen || !spokenChunks.length) return;
    speakNext(gen);
    /* A speech engine that falls asleep mid-reply needs a nudge. */
    window.clearInterval(speakTimer);
    speakTimer = window.setInterval(() => {
      if (gen !== speakGen) {
        window.clearInterval(speakTimer);
        speakTimer = 0;
      } else if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.resume();
      } else if (!spokenChunks.length) {
        window.clearInterval(speakTimer);
        speakTimer = 0;
      }
    }, 5000);
  }, 90);
}

/**
 * A bubble that fills in while the model is still writing. It only reaches the
 * saved chat once the answer is final, so a reload never shows half a sentence
 * as if it were the reply.
 */
function liveMessage() {
  const wrap = document.createElement("div");
  wrap.className = "msg athena";
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  wrap.innerHTML = `<span class="micro dim">ATHENA · ${stamp}</span>`;
  const p = document.createElement("p");
  p.textContent = "";
  wrap.appendChild(p);
  $("#chat").appendChild(wrap);
  return {
    wrap,
    p,
    show(text) {
      p.textContent = text;
      wrap.scrollIntoView({ block: "nearest" });
    },
    commit(text, extra = {}) {
      const body = String(text || "…");
      p.textContent = body;
      if (extra.tools?.length) {
        const line = document.createElement("span");
        line.className = "tool";
        line.textContent = extra.tools.map((tool) => `${tool.ok ? "✓" : "✕"} ${tool.name}`).join("  ");
        wrap.appendChild(line);
      }
      addShots(wrap, extra.images);
      store.chat.push({
        role: "athena",
        text: body,
        tools: extra.tools?.map((tool) => ({ name: tool.name, ok: tool.ok })),
        code: "",
        at: Date.now(),
      });
      store.chat = store.chat.slice(-40);
      saveChat();
      wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
  };
}

async function submitAsk(text) {
  const value = String(text || "").trim();
  if (!value || store.busy) return;
  store.busy = true;
  $("#ask").value = "";
  addMessage("me", value);
  const pending = thinking();
  const live = liveMessage();
  let streamed = "";
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(store.token ? { "x-athena-session": store.token } : {}),
      },
      body: JSON.stringify({ text: value, history: store.history.slice(-8), stream: true }),
      cache: "no-store",
    });
    if (res.status === 401) {
      lock();
      throw new Error("Locked.");
    }
    if (!res.ok) throw new Error(`Hub said ${res.status}.`);

    const type = res.headers.get("content-type") || "";
    let answer = {};
    if (res.body && type.includes("ndjson")) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "token") {
            if (!streamed) pending.remove();
            streamed += event.text;
            live.show(streamed);
          } else if (event.type === "done") {
            answer = event;
          }
        }
      }
    } else {
      answer = await res.json();
    }

    pending.remove();
    const reply = answer.reply || streamed || "…";
    live.commit(reply, { tools: answer.actions || [], images: answer.images || [] });
    store.history.push({ role: "user", content: value }, { role: "assistant", content: reply });
    store.history = store.history.slice(-16);
    speak(reply);
    loadState();
  } catch (error) {
    pending.remove();
    if (streamed) live.commit(streamed);
    else live.wrap.remove();
    addMessage("athena", String(error.message || error));
  } finally {
    store.busy = false;
  }
}

/* ─────────────────────────────────────────────────────────── speech in */

let recognition = null;
let listening = false;

function startListening() {
  /* Speaking to Athena means you expect her to answer out loud. */
  if (!store.speak) {
    store.speak = true;
    localStorage.setItem("athena.speak", "1");
    render();
  }
  primeVoice();
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

/* EventSource cannot send a header, so the hub issues a scoped, expiring
   ticket. It is not the session token and cannot be used on other routes. */
let streamTicket = { value: "", at: 0 };

async function getStreamTicket() {
  if (streamTicket.value && Date.now() - streamTicket.at < 60 * 60 * 1000) return streamTicket.value;
  const issued = await api("/api/stream-ticket", { method: "POST" });
  streamTicket = { value: issued.ticket, at: Date.now() };
  return streamTicket.value;
}

async function connectStream() {
  store.stream?.close();
  if (!store.token) return;
  try {
    const ticket = await getStreamTicket();
    const stream = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
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
      /* A ticket can expire while the phone sleeps. Reconnect with a fresh one
         instead of letting the browser retry a dead URL forever. */
      stream.close();
      if (store.stream !== stream) return;
      store.stream = null;
      setTimeout(() => void connectStream(), 2500);
    };
  } catch (error) {
    if (!String(error.message).includes("Locked")) setTimeout(() => void connectStream(), 4000);
  }
}

/* ─────────────────────────────────────────────────────────── screens */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* fps is measured from frames this browser actually received and painted. */
const screens = { generation: 0, fps: new Map() };

function noteScreenFrame(id) {
  const now = performance.now();
  const stat = screens.fps.get(id) || { frames: 0, since: now, value: 0 };
  stat.frames += 1;
  const elapsed = now - stat.since;
  if (elapsed >= 1200) {
    stat.value = Math.round((stat.frames / (elapsed / 1000)) * 10) / 10;
    stat.frames = 0;
    stat.since = now;
  }
  screens.fps.set(id, stat);
  if (elapsed >= 1200) {
    const label = `${stat.value} FPS`;
    for (const badge of document.querySelectorAll(`[data-fps="${CSS.escape(id)}"]`)) badge.textContent = label;
    if (store.focus === id) {
      const focusBadge = $("#focus-fps");
      if (focusBadge) focusBadge.textContent = label;
    }
  }
}

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
        <span class="badge" data-fps="${esc(node.id)}" title="Frames per second measured in this browser">—</span>
        <button class="btn tiny" data-focus="${esc(node.id)}">⤢ FOCUS</button>
      </div>
    </div>
    <div class="screen-stage">
      <img alt="Screen of ${esc(node.name)}" data-img="${esc(node.id)}" draggable="false" />
      <div class="screen-note" data-note="${esc(node.id)}">CONNECTING…</div>
      <button class="focus-hint" data-focus="${esc(node.id)}">⤢ FOCUS</button>
    </div>
    <div class="screen-bar">
      <button class="btn tiny" data-k="enter" title="Enter" aria-label="Press Enter">⏎</button>
      <button class="btn tiny" data-k="tab" aria-label="Press Tab">TAB</button>
      <button class="btn tiny" data-k="esc" aria-label="Press Escape">ESC</button>
      <button class="btn tiny" data-k="backspace" aria-label="Press Backspace">⌫</button>
      <button class="btn tiny" data-scroll="3" title="Scroll up" aria-label="Scroll up">▲</button>
      <button class="btn tiny" data-scroll="-3" title="Scroll down" aria-label="Scroll down">▼</button>
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
          : `<span class="micro dim">SOUND OFF · INSTALL FFMPEG IN SOFTWARE</span>`
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
      await sleep(700);
      misses = 0;
      continue;
    }
    const started = Date.now();
    const ok = await grabScreen(id, generation);
    misses = ok ? 0 : misses + 1;
    /* a dead or blocking node must not turn into a request storm on a phone */
    if (misses >= 3) {
      await sleep(5000);
      misses = 0;
      continue;
    }
    const focused = store.focus === id;
    /* A focused screen asks for the next frame as soon as the last one was
       painted; previews get a slower budget so a wall of PCs does not saturate
       the hub. The sleep only fills whatever is left of the budget. */
    const tight = window.innerWidth < 760 && !focused;
    const budget = focused ? 60 : tight ? 900 : 400;
    const spent = Date.now() - started;
    await sleep(Math.max(0, budget - spent));
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
    noteScreenFrame(id);
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
  if ($("#focus-fps")) $("#focus-fps").textContent = "—";
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

async function audioElement(id) {
  const found = audioState.streams.get(id);
  if (found?.el) return found.el;
  const ticket = await getStreamTicket();
  const el = document.createElement("audio");
  el.autoplay = true;
  el.preload = "none";
  el.muted = audioState.muted;
  el.src = `/api/nodes/${encodeURIComponent(id)}/audio?ticket=${encodeURIComponent(ticket)}`;
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
    const el = await audioElement(id);
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

/* ────────────────────────────────────────────── software (per node) */

const appsState = { catalogue: [], nodes: new Map(), busy: new Set() };

/** Software is a property of a machine, so it is read and shown per node. */
function softBody(nodeId) {
  return document.querySelector(`[data-soft-body="${CSS.escape(nodeId)}"]`);
}

async function softwareCatalogue() {
  if (!appsState.catalogue.length) {
    const res = await api("/api/apps");
    appsState.catalogue = res.apps || [];
  }
  return appsState.catalogue;
}

async function loadNodeSoftware(nodeId, { force = false } = {}) {
  const body = softBody(nodeId);
  if (!body) return;
  const node = (store.state?.nodes || []).find((item) => item.id === nodeId);
  if (!node) return;
  if (!node.online) {
    body.innerHTML = `<p class="micro dim">OFFLINE — SOFTWARE IS READ ON THE MACHINE ITSELF. START THAT NODE, THEN STATUS.</p>`;
    return;
  }
  if (appsState.nodes.has(nodeId) && !force) {
    renderNodeSoftware(nodeId, body);
    return;
  }
  body.innerHTML = `<p class="micro dim">READING INSTALLED SOFTWARE ON ${esc(node.name.toUpperCase())}…</p>`;
  try {
    await softwareCatalogue();
    const res = await api(`/api/nodes/${encodeURIComponent(nodeId)}/action`, { method: "POST", body: { op: "apps", args: {} } });
    appsState.nodes.set(nodeId, res.result?.apps || []);
    renderNodeSoftware(nodeId, body);
  } catch (error) {
    body.innerHTML = `<p class="micro job-error">${esc(error.message)}</p>`;
  }
}

function renderNodeSoftware(nodeId, body) {
  const list = appsState.nodes.get(nodeId);
  if (!Array.isArray(list)) {
    body.innerHTML = `<p class="micro job-error">That machine did not return a software list.</p>`;
    return;
  }
  body.innerHTML = `<div class="app-rows">${appsState.catalogue
    .map((app) => {
      const found = list.find((item) => item.id === app.id);
      const busy = appsState.busy.has(`${nodeId}:${app.id}`);
      const badge = !found
        ? `<span class="badge">?</span>`
        : found.running
          ? `<span class="badge run">RUNNING</span>`
          : found.installed
            ? `<span class="badge ok">INSTALLED</span>`
            : `<span class="badge bad">MISSING</span>`;
      const buttons = [];
      if (!busy && found && !found.installed) {
        buttons.push(`<button class="btn tiny solid" data-app="install" data-node="${esc(nodeId)}" data-id="${app.id}">INSTALL</button>`);
      }
      if (!busy && app.service && found?.installed) {
        buttons.push(
          found.running
            ? `<button class="btn tiny" data-app="stop" data-node="${esc(nodeId)}" data-id="${app.id}">STOP</button>`
            : `<button class="btn tiny" data-app="start" data-node="${esc(nodeId)}" data-id="${app.id}">START</button>`
        );
      }
      return `<div class="app-row">
        <div class="app-row-head"><span class="micro">${esc(app.name)}</span>${badge}</div>
        <p class="micro dim">${esc(busy ? "WORKING…" : found?.note || `${app.tag} · ${app.size}`)}</p>
        <div class="actions">${buttons.join("")}</div>
      </div>`;
    })
    .join("")}</div>
    <p class="micro dim">INSTALL AND START RUN ON THIS MACHINE ONLY.</p>`;
}

async function appAction(nodeId, appId, action, button) {
  const key = `${nodeId}:${appId}`;
  appsState.busy.add(key);
  if (button) {
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
  }
  const body = softBody(nodeId);
  if (body) renderNodeSoftware(nodeId, body);
  try {
    const res = await api(`/api/nodes/${encodeURIComponent(nodeId)}/action`, {
      method: "POST",
      body: { op: `app-${action}`, args: { app: appId }, timeout: action === "install" ? 900_000 : 240_000 },
    });
    const result = res.result || {};
    if (result.ok === false) throw new Error(result.error || result.note || "The machine refused that.");
    toast(`${appId.toUpperCase()} · ${action.toUpperCase()} DONE ON THAT MACHINE`, 3600);
  } catch (error) {
    toast(error.message, 6500);
  }
  appsState.busy.delete(key);
  await loadNodeSoftware(nodeId, { force: true });
}

/* ─────────────────────────────────────────────────────── integrations */

function renderIntegrations(items) {
  const list = $("#integration-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">NO INTEGRATIONS REGISTERED</p><p class="micro dim" style="margin-top:8px">REGISTER AN APP'S API ABOVE TO SEE ITS STATUS AND CAPABILITIES HERE</p></div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const probe = item.lastProbe;
      const badge = !item.url
        ? `<span class="badge">NO ADDRESS</span>`
        : !probe
          ? `<span class="badge">NOT CHECKED</span>`
          : probe.ok
            ? `<span class="badge ok">CONNECTED · ${esc(probe.ms)}MS</span>`
            : `<span class="badge bad">${esc(probe.error || "NO ANSWER")}</span>`;
      return `<article class="card bracket job">
        <div class="card-top">
          <div>
            <h3 style="font-size:13px">${esc(item.name)}</h3>
            <p class="micro dim">${esc(String(item.kind).toUpperCase())}${item.url ? " · " + esc(item.url) : ""}${item.hasToken ? " · TOKEN STORED" : ""}</p>
          </div>
          ${badge}
        </div>
        ${item.description ? `<p class="micro dim">${esc(item.description)}</p>` : ""}
        ${item.capabilities?.length ? `<p class="micro dim">CAPABILITIES · ${item.capabilities.map((cap) => esc(cap)).join(" · ")}</p>` : ""}
        ${probe?.at ? `<p class="micro dim">CHECKED ${esc(new Date(probe.at).toLocaleTimeString())}</p>` : ""}
        <div class="actions">
          <button class="btn tiny solid" data-int-probe="${esc(item.id)}">CHECK</button>
          <button class="btn tiny danger" data-int-remove="${esc(item.id)}">REMOVE</button>
        </div>
      </article>`;
    })
    .join("");
}

/* ─────────────────────────────────────────────────────────── system */

let brainPoll = null;

function renderSystem(state) {
  const hub = state?.hub || {};
  const addresses = [`http://127.0.0.1:${hub.port}`, ...(hub.addresses || []).map((address) => `http://${address}:${hub.port}`)];
  $("#sys-addresses").textContent = addresses.join("  ·  ");
  $("#sys-code").textContent = hub.openMode ? "OPEN MODE" : store.lockInfo?.code || "ON THIS PC ONLY";
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

/* ─────────────────────────────────────────────────────────── look */

$("#swatches").addEventListener("click", (event) => {
  const button = event.target.closest("[data-accent]");
  if (!button) return;
  store.look.accent = button.dataset.accent;
  localStorage.setItem("athena.accent", store.look.accent);
  applyLook();
});

/* Voice settings are per device: a phone and a desktop have different voices. */
function saveVoiceSetting() {
  store.voice.rate = clampNumber(store.voice.rate, 0.75, 1.35, 1);
  store.voice.pitch = clampNumber(store.voice.pitch, 0.85, 1.25, 1);
  localStorage.setItem("athena.voice", store.voice.name || "");
  localStorage.setItem("athena.voiceRate", String(store.voice.rate));
  localStorage.setItem("athena.voicePitch", String(store.voice.pitch));
  const rate = $("#voice-rate-label");
  const pitch = $("#voice-pitch-label");
  if (rate) rate.textContent = `${store.voice.rate.toFixed(2)}×`;
  if (pitch) pitch.textContent = store.voice.pitch.toFixed(2);
}

$("#voice-pick")?.addEventListener("change", (event) => {
  store.voice.name = event.target.value;
  saveVoiceSetting();
  if (store.speak) speak("This is my voice.");
});

for (const id of ["#voice-rate", "#voice-pitch"]) {
  $(id)?.addEventListener("input", (event) => {
    if (id === "#voice-rate") store.voice.rate = clampNumber(event.target.value, 0.75, 1.35, 1);
    else store.voice.pitch = clampNumber(event.target.value, 0.85, 1.25, 1);
    saveVoiceSetting();
  });
}

$("#voice-test")?.addEventListener("click", () => {
  const wasOff = !store.speak;
  if (wasOff) {
    store.speak = true;
    localStorage.setItem("athena.speak", "1");
    $("#speak-toggle").innerHTML = "VOICE <b>ON</b>";
  }
  primeVoice();
  speak("Athena online. This is how I sound on this device. I can read version 3 point 0 point 0 and GPU temperatures out loud.");
});

$("#voice-reset")?.addEventListener("click", () => {
  store.voice = { name: "", rate: 1, pitch: 1 };
  saveVoiceSetting();
  renderVoicePanel();
  toast("Voice reset to the most natural installed option.", 3200);
});

if (speechReady()) speechSynthesis.addEventListener("voiceschanged", renderVoicePanel);

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
  if (store.speak) {
    primeVoice();
    speak("Voice on.");
  } else if (speechReady()) {
    spokenChunks = [];
    speechSynthesis.cancel();
  }
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
  if (button) return void act(button.dataset.id, button.dataset.act);
  const software = event.target.closest("[data-app]");
  if (software) return void appAction(software.dataset.node, software.dataset.id, software.dataset.app, software);
  const summary = event.target.closest("details[data-soft] > summary");
  if (summary) void loadNodeSoftware(summary.parentElement.dataset.soft);
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

$("#int-add").onclick = async (event) => {
  const button = event.currentTarget;
  const name = $("#int-name").value.trim();
  if (!name) return toast("Give the integration a name.");
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    await api("/api/integrations", {
      method: "POST",
      body: {
        name,
        kind: $("#int-kind").value,
        description: $("#int-desc").value.trim(),
        url: $("#int-url").value.trim(),
        token: $("#int-token").value,
        capabilities: $("#int-caps").value,
      },
    });
    for (const id of ["#int-name", "#int-desc", "#int-url", "#int-token", "#int-caps"]) $(id).value = "";
    toast("Integration registered. Press CHECK to verify it answers.", 4200);
    await loadState();
  } catch (error) {
    toast(error.message, 5200);
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
  }
};

$("#integration-list").addEventListener("click", async (event) => {
  const probe = event.target.closest("[data-int-probe]");
  const remove = event.target.closest("[data-int-remove]");
  if (probe) {
    probe.setAttribute("aria-busy", "true");
    probe.disabled = true;
    try {
      const res = await api(`/api/integrations/${encodeURIComponent(probe.dataset.intProbe)}/probe`, { method: "POST" });
      const result = res.integration?.lastProbe;
      if (result?.ok) toast(`Answered in ${result.ms} ms.`, 3600);
      else toast(result?.error || "No answer.", 5200);
      await loadState();
    } catch (error) {
      toast(error.message, 5200);
    } finally {
      probe.removeAttribute("aria-busy");
    }
    return;
  }
  if (remove) {
    if (!confirm("Remove this integration? ATHENA forgets its address and token.")) return;
    try {
      await api(`/api/integrations/${encodeURIComponent(remove.dataset.intRemove)}`, { method: "DELETE" });
      toast("Removed.");
      await loadState();
    } catch (error) {
      toast(error.message, 5200);
    }
  }
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
    /* A preview is navigation, always. Remote clicks happen on the focused
       screen, where the full-size image makes the target predictable. The old
       BASIC/ADV toggle silently changed this and caused misclicks. */
    focusNode(id);
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

$("#job-list").addEventListener("click", async (event) => {
  const detail = event.target.closest("[data-job]");
  if (detail) {
    const job = (store.state?.jobs || []).find((item) => item.id === detail.dataset.job);
    if (job) addMessage("athena", `Job ${job.id} · ${job.state}\n$ ${job.args?.command || job.op}`, { code: job.output || "(no output)" });
    switchView("home");
  }
  const copy = event.target.closest("[data-copy-job]");
  if (copy) {
    const job = (store.state?.jobs || []).find((item) => item.id === copy.dataset.copyJob);
    if (!job) return;
    try {
      await navigator.clipboard.writeText(String(job.output || ""));
      toast("Output copied.");
    } catch {
      toast("Select the output and copy it by hand.");
    }
    return;
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
    confirmCode: store.lockInfo?.code || "",
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
    const info = await (await fetch("/api/lock", { headers: { "x-athena-local": "1" }, cache: "no-store" })).json();
    store.lockInfo = info;
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
  saveVoiceSetting();
  renderVoicePanel();
  /* Chrome populates the voice list asynchronously after the first call. */
  setTimeout(renderVoicePanel, 400);
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
