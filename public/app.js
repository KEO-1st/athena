/* ATHENA — hub client. Works on iOS Safari as an installed PWA. */
import { rankVoices, speechChunks, voiceLabel } from "./speech.mjs";
import { screenPoint, screenProfile } from "./screen-coords.mjs";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const TOKEN_KEY = "athena.session";
const TOKEN_SESSION_KEY = "athena.session.ephemeral";
const readStoredToken = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_SESSION_KEY) || "";

function saveAuthToken(token, remember = true) {
  clearAuthToken();
  if (remember) localStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.setItem(TOKEN_SESSION_KEY, token);
}

function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
}

const store = {
  token: readStoredToken(),
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
  deviceSession: localStorage.getItem("athena.deviceSession") || "",
  lockInfo: null,
  state: null,
  admin: false,
  view: "home",
  history: [],
  chat: [],
  conversations: [],
  chatId: "",
  busy: false,
  stream: null,
};

const CHAT_KEY = "athena.chat";
const CHATS_KEY = "athena.chats.v1";
const SESSION_DEVICE_KEY = "athena.deviceSession";

/** A stable local identity for THIS browser. It organizes sessions; it is not
    a credential and is never used in place of the session token. */
function deviceIdentity() {
  let id = localStorage.getItem("athena.deviceId") || "";
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("athena.deviceId", id);
  }
  const ua = navigator.userAgent || "";
  const platform = /iPad/i.test(ua) ? "iPad" : /iPhone/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Browser";
  const browser = /Edg\//i.test(ua) ? "Edge" : /CriOS|Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : /Firefox\//i.test(ua) ? "Firefox" : "Browser";
  return { id, name: `${platform} · ${browser}`, platform: `${platform} · ${browser}` };
}

function conversationId() {
  return globalThis.crypto?.randomUUID?.() || `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function freshConversation() {
  return { id: conversationId(), title: "New conversation", createdAt: Date.now(), updatedAt: Date.now(), messages: [], history: [] };
}

/** Conversation history lives on this controller. It never leaves the device
    and it is never shared with another phone, tablet or PC. */
function readConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHATS_KEY) || "null");
    if (saved && Array.isArray(saved.conversations)) {
      const conversations = saved.conversations
        .filter((item) => item && item.id && Array.isArray(item.messages))
        .map((item) => ({
          id: String(item.id),
          title: String(item.title || "Conversation").slice(0, 70),
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now(),
          messages: item.messages.slice(-80),
          history: Array.isArray(item.history) ? item.history.slice(-16) : [],
        }));
      return { conversations, activeId: saved.activeId || conversations[0]?.id || "" };
    }
    /* One-time migration. The old single conversation is kept, not erased. */
    const legacy = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    if (Array.isArray(legacy) && legacy.length) {
      const message = {
        id: conversationId(),
        title: String(legacy.find((entry) => entry.role === "me")?.text || "Earlier conversation").slice(0, 70),
        createdAt: Number(legacy[0]?.at) || Date.now(),
        updatedAt: Number(legacy.at(-1)?.at) || Date.now(),
        messages: legacy.slice(-80),
        history: legacy
          .slice(-16)
          .map((entry) => ({ role: entry.role === "me" ? "user" : "assistant", content: String(entry.text || "") }))
          .filter((entry) => entry.content),
      };
      return { conversations: [message], activeId: message.id };
    }
  } catch {
    /* private mode / damaged storage — start clean without deleting anything */
  }
  return { conversations: [], activeId: "" };
}

function activeConversation() {
  return store.conversations.find((item) => item.id === store.chatId) || null;
}

function persistConversations() {
  try {
    const active = activeConversation();
    if (active) {
      active.messages = store.chat.slice(-80);
      active.history = store.history.slice(-16);
      active.updatedAt = Date.now();
      if (active.title === "New conversation") {
        const first = store.chat.find((entry) => entry.role === "me" && entry.text);
        if (first) active.title = String(first.text).slice(0, 70);
      }
    }
    localStorage.setItem(CHATS_KEY, JSON.stringify({ activeId: store.chatId, conversations: store.conversations.slice(-30) }));
    /* Keep the legacy key in sync for one release so an older cached shell can
       still restore the active conversation without losing it. */
    localStorage.setItem(CHAT_KEY, JSON.stringify(store.chat.slice(-40)));
  } catch {
    /* private mode / quota — the conversation just is not kept */
  }
}

function saveChat() {
  persistConversations();
}

function loadChat() {
  return activeConversation()?.messages || [];
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
    store.token = "";
    store.admin = false;
    clearAuthToken();
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
      body: JSON.stringify({ code, ...deviceIdentity() }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "No.");
    store.token = json.token;
    store.admin = Boolean(json.admin);
    store.deviceSession = json.device?.id || "";
    if (store.deviceSession) localStorage.setItem(SESSION_DEVICE_KEY, store.deviceSession);
    saveAuthToken(json.token, json.remember !== false);
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
  store.admin = Boolean(state.admin);
  document.body.dataset.admin = store.admin ? "yes" : "no";
  $$("[data-admin-only]").forEach((element) => (element.hidden = !store.admin));
  const nodes = state.nodes || [];
  const online = nodes.filter((node) => node.online);

  $("#hub-line").textContent = `ATHENA HUB · ${String(state.hub.name).toUpperCase()} · v${state.hub.version} · ${state.hub.addresses?.[0] || "LAN"}`;
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

  renderVoicePanel();
  renderOrbNodes(nodes);
  renderNodes(nodes, state);
  renderScreens();
  renderJobs(state.jobs || []);
  renderIntegrations(state.integrations || []);
  renderKeys(state.keys || []);
  renderModelCenter(state);
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
  $("#api-example").textContent = `curl -H "x-athena-key: ath_…" http://${state.hub.addresses?.[0] || "localhost"}:${state.hub.port}/v1/health\n\ncurl -H "x-athena-key: ath_…" http://${state.hub.addresses?.[0] || "localhost"}:${state.hub.port}/v1/nodes\n\n# Remote execution, installs and power actions need the Hub administrator\n# session on the Hub PC; API keys are intentionally read-only for those.`;

  if (!nodes.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">NO NODES YET</p><p class="micro dim" style="margin-top:8px">RUN THE NODE ON A PC, THEN SCAN</p></div>`;
    return;
  }

  /* State updates arrive every few seconds. Rebuilding the cards must not
     slam an open Software section shut or throw away its loaded list. */
  const openSoftware = new Set([...list.querySelectorAll("details[data-soft][open]")].map((item) => item.dataset.soft));
  const openHardware = new Set([...list.querySelectorAll("details[data-hw][open]")].map((item) => item.dataset.hw));

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
            <h3>${esc(node.name)} ${node.localToHub ? '<span class="badge ok">THIS PC</span>' : ""}</h3>
            <p class="micro dim">NODE ${String(node.index || 0).padStart(2, "0")} · ${esc(node.host)}:${node.port} · NODE SOFTWARE ${node.nodeVersion ? "v" + esc(node.nodeVersion) : "UNKNOWN"} · PROTOCOL ${node.protocol == null ? "LEGACY" : esc(node.protocol)}</p>
          </div>
          <span class="badge ${node.online ? (nodeBusy(node) ? "run" : "ok") : "bad"}">${node.online ? (nodeBusy(node) ? "WORKING" : "ONLINE") : "OFFLINE"}</span>
        </div>
        <div class="metrics">
          <div class="metric"><span>GPU</span><b title="${esc(gpu.name || "")}">${esc(gpu.name || "—")}</b></div>
          <div class="metric"><span>VRAM</span><b>${gpu.vramGb ? gpu.vramGb + " GB" + (gpu.usedGb ? " · " + gpu.usedGb + " used" : "") : "—"}</b></div>
          <div class="metric"><span>LOAD</span><b>${gpu.util != null ? gpu.util + "%" : "—"}${gpu.temp != null ? " · " + gpu.temp + "°" : ""}</b></div>
          <div class="metric"><span>CPU</span><b>${status.hardware?.cpu?.model ? esc(status.hardware.cpu.model) : status.cores ? status.cores + " cores" : "—"}</b></div>
          <div class="metric"><span>RAM FREE</span><b>${status.hardware?.memory?.freeGb != null && status.hardware?.memory?.totalGb != null ? status.hardware.memory.freeGb + " / " + status.hardware.memory.totalGb + " GB" : status.memory ? status.memory.totalGb + " GB" : "—"}</b></div>
          <div class="metric"><span>SCREEN</span><b>${caps.screen ? (caps.input ? "CONTROL" : "VIEW") : "—"}</b></div>
          <div class="metric"><span>SOUND</span><b>${caps.audio ? "LISTEN" : "—"}</b></div>
        </div>
        ${compatBad ? `<p class="micro job-error">✕ ${esc(compat.reason || "This Node is not compatible with this Hub.")}</p>` : ""}
        <details class="node-hardware" data-hw="${esc(node.id)}">
          <summary><span class="micro">HARDWARE &amp; CAPABILITIES</span><span class="micro dim">${status.hardware ? "MEASURED" : "UNAVAILABLE"}</span></summary>
          ${hardwarePanel(node, status)}
        </details>
        <details class="node-soft" data-soft="${esc(node.id)}">
          <summary><span class="micro">SOFTWARE ON THIS MACHINE</span><span class="micro dim">DETECT · INSTALL · START</span></summary>
          <div class="soft-body" data-soft-body="${esc(node.id)}"><p class="micro dim">OPEN TO READ WHAT IS INSTALLED ON ${esc(node.name.toUpperCase())}.</p></div>
        </details>
        <div class="actions">
          <button class="btn tiny solid" data-act="focus" data-id="${node.id}">⤢ FOCUS</button>
          <button class="btn tiny" data-act="refresh" data-id="${node.id}">STATUS</button>
          ${store.admin ? `<button class="btn tiny danger" data-act="unpair" data-id="${node.id}">UNLINK NODE</button>` : ""}
        </div>
      </article>`;
    })
    .join("");

  for (const id of openHardware) {
    const details = list.querySelector(`details[data-hw="${CSS.escape(id)}"]`);
    if (details) details.open = true;
  }

  for (const id of openSoftware) {
    const details = list.querySelector(`details[data-soft="${CSS.escape(id)}"]`);
    if (!details) continue;
    details.open = true;
    const body = softBody(id);
    if (!body) continue;
    if (appsState.nodes.has(id) && Date.now() - (appsState.at.get(id) || 0) < SOFT_CACHE_MS) renderNodeSoftware(id, body);
    else void loadNodeSoftware(id);
  }
}

function hwText(value, suffix = "") {
  return value === null || value === undefined || value === "" ? "unavailable" : `${value}${suffix}`;
}

/** A real detail view for one machine. Missing readings stay explicit. */
function hardwarePanel(node, status) {
  const hw = status.hardware;
  if (!hw) return `<p class="micro dim" style="padding:10px 0">This Node did not return a hardware inventory. Nothing is assumed.</p>`;
  const cpu = hw.cpu || {};
  const memory = hw.memory || {};
  const gpu = hw.gpu || status.gpu || {};
  const disks = Array.isArray(hw.disks) ? hw.disks : null;
  const displays = Array.isArray(hw.displays) ? hw.displays : null;
  const audio = hw.audio || null;
  const apps = hw.installedApps || null;
  const caps = status.capabilities || {};
  const rows = [
    ["CPU", cpu.model || "unavailable"],
    ["CPU USE", cpu.utilizationPct != null ? `${cpu.utilizationPct}% · ${cpu.cores ?? "?"} cores` : `${cpu.cores ?? "?"} cores · live use unavailable`],
    ["RAM", `installed ${hwText(memory.installedGb, " GB")} · usable ${hwText(memory.totalGb, " GB")} · available ${hwText(memory.freeGb, " GB")}`],
    ["GPU", gpu.name || "unavailable"],
    ["VRAM", `installed ${hwText(gpu.vramGb, " GB")} · available ${hwText(gpu.availableGb, " GB")}${gpu.availablePct != null ? ` (${gpu.availablePct}%)` : ""}`],
    ["GPU USE", `${hwText(gpu.util, "%")}${gpu.temp != null ? ` · ${gpu.temp}°C` : ""}`],
    ["OS", hw.os ? `${hw.os.type || ""} ${hw.os.release || ""} · ${hw.os.arch || "?"}`.trim() : "unavailable"],
  ];
  const diskText = disks ? (disks.length ? disks.map((disk) => `${disk.id} ${hwText(disk.freeGb, " GB")} free of ${hwText(disk.totalGb, " GB")}`).join(" · ") : "no fixed disks reported") : "unavailable";
  const displayText = displays ? (displays.length ? displays.map((display) => `${display.width || "?"}×${display.height || "?"}${display.refreshHz ? ` @${display.refreshHz}Hz` : ""}${display.primary ? " primary" : ""}`).join(" · ") : "no displays reported") : "unavailable";
  const audioText = audio ? `${audio.inputs?.length ?? 0} input · ${audio.outputs?.length ?? 0} output${audio.captureReady ? " · capture ready" : " · capture not ready"}` : "unavailable";
  const appText = apps ? `${apps.count ?? "?"} installed${apps.sample?.length ? ` · ${apps.sample.slice(0, 10).map((name) => esc(name)).join(" · ")}` : ""}` : "unavailable";
  return `<div class="hw-detail">
    ${rows.map(([label, value]) => `<div class="kv"><span class="micro dim">${label}</span><b>${esc(value)}</b></div>`).join("")}
    <div class="kv"><span class="micro dim">STORAGE</span><b>${esc(diskText)}</b></div>
    <div class="kv"><span class="micro dim">DISPLAYS</span><b>${esc(displayText)}</b></div>
    <div class="kv"><span class="micro dim">AUDIO</span><b>${esc(audioText)}</b></div>
    <div class="kv"><span class="micro dim">INSTALLED APPS</span><b>${esc(appText)}</b></div>
    <div class="chips" style="margin-top:8px">
      <span class="chip ${caps.shell ? "up" : ""}">SHELL ${caps.shell ? "ON" : "OFF"}</span>
      <span class="chip ${caps.input ? "up" : ""}">INPUT ${caps.input ? "ON" : "OFF"}</span>
      <span class="chip ${caps.shutdown ? "up" : ""}">SHUTDOWN ${caps.shutdown ? "ON" : "OFF"}</span>
      <span class="chip ${caps.screen ? "up" : ""}">SCREEN ${caps.screen ? "READY" : "OFF"}</span>
    </div>
  </div>`;
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
  if (isInternalJob(job)) return { badge: "SYSTEM", why: "Internal ATHENA connectivity check. It was not created by you and can be ignored." };
  const who = job.createdBy ? ` by ${job.createdBy}` : " — created before the Hub recorded which client asked";
  if (source === "api") return { badge: "API", why: `Sent to the Hub's REST API${who}.` };
  if (source === "hub" || source === "app") return { badge: "APP", why: `Queued from the ATHENA app${who}.` };
  if (source === "chat") return { badge: "CHAT", why: `Queued from a chat request${who}.` };
  return { badge: source.toUpperCase(), why: `Origin reported as “${source}”${who}.` };
}

/** The old API smoke checks are data, not user work. Keep them, but do not put
    them at the top of the queue as if they were meaningful jobs. */
function isInternalJob(job) {
  const command = String(job?.args?.command || "").trim().toLowerCase();
  return /^echo\s+(athena|keyed)-ok$/.test(command) && String(job?.source || "api") === "api";
}

function jobFailure(job) {
  if (!["failed", "timeout", "cancelled"].includes(job.state)) return "";
  const reason = job.error || String(job.output || "").trim().split(/\r?\n/).filter(Boolean).pop() || (job.state === "cancelled" ? "Cancelled before it finished." : "No reason was reported.");
  return String(reason).slice(0, 300);
}

function jobCard(job, nodeName) {
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
}

function renderJobs(jobs) {
  const list = $("#job-list");
  if (!jobs.length) {
    list.innerHTML = `<div class="empty"><p class="micro dim">QUEUE IS EMPTY</p><p class="micro dim" style="margin-top:8px">JOBS ARE TASKS QUEUED FOR ONE NODE BY THE REST API OR BY AN APP ACTION. THE AI ANSWERS IN CHAT DIRECTLY, SO ITS WORK DOES NOT APPEAR HERE.</p></div>`;
    return;
  }
  const nodeName = (id) => (store.state?.nodes || []).find((node) => node.id === id)?.name || id;
  const meaningful = jobs.filter((job) => !isInternalJob(job));
  const internal = jobs.filter(isInternalJob);
  list.innerHTML =
    meaningful.map((job) => jobCard(job, nodeName)).join("") +
    (meaningful.length ? "" : `<div class="empty"><p class="micro dim">NO USER JOBS YET</p><p class="micro dim" style="margin-top:8px">THE ONLY ENTRIES BELOW ARE INTERNAL CONNECTIVITY CHECKS.</p></div>`) +
    (internal.length
      ? `<details class="panel" style="margin-top:12px"><summary class="micro">INTERNAL SYSTEM CHECKS · ${internal.length}</summary><p class="micro dim">THESE ARE OLD HUB-TO-NODE SMOKE TESTS. THEY ARE PRESERVED AS HISTORY, NOT COUNTED AS YOUR WORK.</p><div class="cards">${internal.map((job) => jobCard(job, nodeName)).join("")}</div></details>`
      : "");
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
  if (!store.admin) return;
  if (document.activeElement?.closest(".panel")) return;
  const tts = state.tts || {};
  if ($("#cfg-tts-provider")) $("#cfg-tts-provider").value = tts.provider || "browser";
  if ($("#cfg-tts-voice")) $("#cfg-tts-voice").value = tts.voice || "";
  if ($("#cfg-tts-language")) $("#cfg-tts-language").value = tts.languageCode || "";
  if ($("#tts-state")) {
    $("#tts-state").textContent =
      tts.provider === "google"
        ? tts.configured
          ? `GOOGLE CLOUD TTS · ${tts.voice || "voice not set"} · KEY SAVED ON THIS HUB`
          : "GOOGLE CLOUD TTS SELECTED · NO API KEY SAVED — SPOKEN REPLIES WILL REPORT THE PROVIDER ERROR"
        : tts.provider === "off"
          ? "SPEECH IS OFF ON THIS HUB"
          : "BROWSER SPEECH ON EACH CONTROLLER · NO AUDIO LEAVES THE DEVICE";
  }
  return fillHubConfig(state);
}

/* ─────────────────────────────────────────────── model center */

function providerInfo(id) {
  const list = store.state?.providers?.providers || [];
  if (id === "ollama") {
    return { id: "ollama", label: "Ollama", model: store.state?.brain?.provider === "ollama" ? store.state.brain.model : "", defaultModel: "qwen2.5:7b", configured: true, keyMask: "", local: true };
  }
  return list.find((entry) => entry.id === id) || null;
}

function renderModelCenter(state) {
  const grid = $("#provider-grid");
  if (!grid) return;
  const catalog = state?.providers?.providers || [];
  const active = String(state?.brain?.provider || "auto");
  const cards = [
    { id: "ollama", label: "Ollama", configured: true, model: active === "ollama" ? state.brain?.model : "local, no key", keyMask: "LOCAL", kind: "local" },
    ...catalog,
  ];
  grid.innerHTML = cards
    .map(
      (entry) => `<button type="button" class="provider-card ${entry.id === active ? "active" : ""}" data-provider="${esc(entry.id)}">
        <span class="provider-name">${esc(entry.label)}</span>
        <span class="badge ${entry.configured ? "ok" : "bad"}">${entry.configured ? "READY" : "NO KEY"}</span>
        <span class="micro dim">${esc(entry.model || entry.defaultModel || "choose a model")}</span>
        <span class="micro provider-meta">${esc(entry.keyMask || entry.kind || "")}</span>
      </button>`
    )
    .join("");
  const badge = $("#model-active");
  if (badge) {
    const brain = state?.brain || {};
    badge.textContent = brain.ready ? `${String(brain.provider).toUpperCase()} · ${brain.model}` : String(brain.provider || "NONE").toUpperCase();
    badge.className = "badge " + (brain.ready ? "ok" : "bad");
  }
}

function applyProviderToForm(id) {
  const info = providerInfo(id);
  const provider = $("#cfg-provider");
  if (!provider) return;
  provider.value = id;
  if (!info) return;
  $("#cfg-model").value = info.model || "";
  $("#cfg-model").placeholder = info.defaultModel || "model name";
  $("#cfg-base").value = info.baseUrl && info.baseUrl !== info.defaultBase ? info.baseUrl : "";
  $("#cfg-base").placeholder = info.baseUrl || info.defaultBase || "https://…/v1";
  $("#cfg-key").value = "";
  $("#cfg-key").placeholder = info.keyMask ? `SAVED · ${info.keyMask} — leave blank to keep it` : "paste the provider key";
  $("#provider-test-state").textContent = `${String(info.label || id).toUpperCase()} SELECTED. SAVE TO MAKE IT THE ACTIVE BRAIN.`;
}

function fillHubConfig(state) {
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
  const activeProvider = String(state.providers?.active?.provider || brain.provider || "auto");
  if (!document.activeElement?.closest(".model-config")) {
    $("#cfg-provider").value = activeProvider;
    $("#cfg-model").value = brain.requested || brain.model || "";
    $("#cfg-base").value = brain.base && !brain.base.includes("11434") ? brain.base : "";
    const info = providerInfo(activeProvider === "auto" ? (brain.provider || "openai") : activeProvider);
    const keyNote = $("#cfg-key");
    if (keyNote) keyNote.placeholder = info?.keyMask ? `SAVED · ${info.keyMask} — leave blank to keep it` : "paste the provider key";
  }
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

function initializeConversations() {
  const saved = readConversations();
  store.conversations = saved.conversations;
  store.chatId = saved.activeId;
  if (!activeConversation()) {
    const conversation = freshConversation();
    store.conversations.push(conversation);
    store.chatId = conversation.id;
  }
  store.chat = [...(activeConversation()?.messages || [])];
  store.history = [...(activeConversation()?.history || [])];
}

/** Reloads the active conversation after a refresh — the phone no longer loses it. */
function restoreChat() {
  const saved = loadChat();
  store.chat = [...saved];
  store.history = [...(activeConversation()?.history || [])];
  renderConversationList();
  if (!saved.length) return;
  $$("#chat .msg").forEach((element) => element.remove());
  for (const entry of saved) {
    addMessage(entry.role === "me" ? "me" : "athena", entry.text, {
      tools: entry.tools || [],
      code: entry.code || "",
      restore: true,
    });
  }
  if (!store.history.length) {
    store.history = saved
      .map((entry) => ({ role: entry.role === "me" ? "user" : "assistant", content: String(entry.text || "") }))
      .filter((entry) => entry.content);
  }
  store.history = store.history.slice(-16);
  renderConversationList();
}

function renderConversationList() {
  const list = $("#chat-history-list");
  if (!list) return;
  const title = $("#chat-title");
  if (title) title.textContent = (activeConversation()?.title || "CONVERSATION").toUpperCase();
  const conversations = [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  list.innerHTML = conversations.length
    ? conversations
        .map(
          (item) => `<div class="chat-history-row ${item.id === store.chatId ? "active" : ""}">
            <button class="chat-open" data-chat-open="${esc(item.id)}">
              <b>${esc(item.title)}</b>
              <span>${esc(new Date(item.updatedAt).toLocaleString())} · ${item.messages.length} MESSAGE${item.messages.length === 1 ? "" : "S"}</span>
            </button>
            <button class="btn tiny danger" data-chat-delete="${esc(item.id)}" title="Delete this conversation">DELETE</button>
          </div>`
        )
        .join("")
    : `<p class="micro dim">NO CONVERSATIONS YET</p>`;
}

function showConversation(id) {
  const conversation = store.conversations.find((item) => item.id === id);
  if (!conversation) return;
  persistConversations();
  store.chatId = id;
  store.chat = [...conversation.messages];
  store.history = [...(conversation.history || [])];
  $$("#chat .msg").forEach((element) => element.remove());
  for (const entry of store.chat) {
    addMessage(entry.role === "me" ? "me" : "athena", entry.text, {
      tools: entry.tools || [],
      code: entry.code || "",
      restore: true,
    });
  }
  persistConversations();
  renderConversationList();
  $("#chat-history-panel").hidden = true;
}

function newChat() {
  persistConversations();
  const conversation = freshConversation();
  store.conversations.push(conversation);
  store.chatId = conversation.id;
  store.chat = [];
  store.history = [];
  $$("#chat .msg").forEach((element) => element.remove());
  persistConversations();
  renderConversationList();
  $("#chat-history-panel").hidden = true;
  $("#ask").focus();
}

function clearChat() {
  if (!store.chat.length && !store.history.length) return toast("This conversation is already empty.");
  if (!confirm("Clear this conversation? Its messages are removed from this controller. Other conversations and other controllers are not touched.")) return;
  store.chat = [];
  store.history = [];
  const active = activeConversation();
  if (active) {
    active.messages = [];
    active.history = [];
    active.title = "New conversation";
    active.updatedAt = Date.now();
  }
  $$("#chat .msg").forEach((element) => element.remove());
  persistConversations();
  renderConversationList();
}

function deleteConversation(id) {
  const conversation = store.conversations.find((item) => item.id === id);
  if (!conversation) return;
  if (!confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
  store.conversations = store.conversations.filter((item) => item.id !== id);
  if (store.chatId === id) {
    if (!store.conversations.length) store.conversations.push(freshConversation());
    store.chatId = store.conversations.at(-1).id;
    store.chat = [...activeConversation().messages];
    store.history = [...(activeConversation().history || [])];
    $$("#chat .msg").forEach((element) => element.remove());
    for (const entry of store.chat) {
      addMessage(entry.role === "me" ? "me" : "athena", entry.text, { tools: entry.tools || [], code: entry.code || "", restore: true });
    }
  }
  persistConversations();
  renderConversationList();
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
    pick.disabled = serverProvider() !== "browser";
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
    if (serverProvider() === "google") {
      note.textContent = `The Hub is using Google Cloud TTS voice ${store.state?.tts?.voice || "(not set)"}. This browser's voice list is not used, and a server failure is reported instead of falling back to it.`;
    } else if (serverProvider() === "off") {
      note.textContent = "Spoken replies are switched off on the Hub.";
    } else {
      note.textContent = voices.length
        ? `${voices.length} voice${voices.length === 1 ? "" : "s"} installed on this device · ${voices[0].name} sounds most natural here. Speech is generated by this browser, not by the Hub.`
        : "This browser has not reported any voices. On Windows, add voices in Settings → Time & language → Speech. On iOS, they download in Settings → Accessibility → Spoken Content.";
    }
  }
  const architecture = $("#voice-architecture");
  if (architecture) {
    architecture.textContent =
      serverProvider() === "google"
        ? "HUB-SIDE SPEECH · the Hub sends MP3 audio generated by Google Cloud TTS to this controller. No browser voice is substituted."
        : serverProvider() === "off"
          ? "SPEECH OFF · spoken replies are disabled on the Hub."
          : "DEVICE-SIDE SPEECH · this browser generates the audio locally. Google Cloud TTS is not configured, so no server voice is implied.";
  }
  const pickLabel = $("#voice-pick-label");
  if (pickLabel) pickLabel.textContent = serverProvider() === "browser" ? "BROWSER VOICE ON THIS DEVICE" : "BROWSER VOICE (NOT USED BY THE CURRENT PROVIDER)";
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

function speakBrowser(text) {
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

/* Server speech is a different path on purpose. When the Hub is configured to
   use Google Cloud TTS, a failure is reported as that provider failing; the
   browser's robotic voice is never substituted silently. */
const serverSpeech = { el: null, gen: 0, chunks: [], running: false };

function serverProvider() {
  return store.state?.tts?.provider || "browser";
}

function silentWav() {
  return "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
}

/** Called from a real tap so iOS allows the later server-audio payload. */
function primeServerVoice() {
  if (serverProvider() !== "google") return;
  if (!serverSpeech.el) {
    serverSpeech.el = document.createElement("audio");
    serverSpeech.el.playsInline = true;
    serverSpeech.el.setAttribute("playsinline", "");
  }
  try {
    if (!serverSpeech.el.src) serverSpeech.el.src = silentWav();
    serverSpeech.el.play().catch(() => undefined);
  } catch {
    /* The next explicit tap can try again. */
  }
}

function stopServerSpeech() {
  serverSpeech.gen += 1;
  serverSpeech.chunks = [];
  serverSpeech.running = false;
  if (serverSpeech.el) {
    try {
      serverSpeech.el.pause();
    } catch {
      /* already stopped */
    }
  }
}

async function speakServer(text) {
  if (!store.speak) return;
  const chunks = speechChunks(text, 1400);
  if (!chunks.length) return;
  primeServerVoice();
  const gen = ++serverSpeech.gen;
  serverSpeech.chunks = chunks;
  serverSpeech.running = true;
  const el = serverSpeech.el;
  while (gen === serverSpeech.gen && serverSpeech.chunks.length) {
    const chunk = serverSpeech.chunks.shift();
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(store.token ? { "x-athena-session": store.token } : {}),
        },
        body: JSON.stringify({ text: chunk }),
        cache: "no-store",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Speech HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (gen !== serverSpeech.gen) return;
      const url = URL.createObjectURL(blob);
      el.src = url;
      await el.play();
      await new Promise((resolve) => {
        const done = () => resolve();
        el.addEventListener("ended", done, { once: true });
        el.addEventListener("error", done, { once: true });
      });
      URL.revokeObjectURL(url);
    } catch (error) {
      if (gen === serverSpeech.gen) {
        toast(`The selected Hub voice failed: ${String(error.message || error).slice(0, 180)} Browser speech was not substituted.`, 7200);
      }
      break;
    }
  }
  if (gen === serverSpeech.gen) serverSpeech.running = false;
}

function speak(text) {
  if (!store.speak) return;
  const provider = serverProvider();
  if (provider === "off") return;
  if (provider === "google") {
    stopBrowserSpeech();
    void speakServer(text);
    return;
  }
  stopServerSpeech();
  speakBrowser(text);
}

/**
 * Feed a sentence to the browser speech queue while the model is still
 * writing. The old app waited for the complete answer, so the first word could
 * be tens of seconds late. This starts as soon as a sentence is complete and
 * appends the rest without cancelling what is already playing.
 */
function queueBrowserSpeech(text) {
  if (!store.speak || serverProvider() !== "browser" || !speechReady()) return false;
  const chunks = speechChunks(text);
  if (!chunks.length) return false;
  primeVoice();
  if (!speechSynthesis.speaking && !spokenChunks.length) {
    const gen = ++speakGen;
    spokenChunks = chunks;
    window.setTimeout(() => {
      if (gen === speakGen && spokenChunks.length) speakNext(gen);
    }, 80);
  } else {
    spokenChunks.push(...chunks);
  }
  return true;
}

function stopBrowserSpeech() {
  if (!speechReady()) return;
  spokenChunks = [];
  speakGen += 1;
  try {
    speechSynthesis.cancel();
  } catch {
    /* nothing playing */
  }
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
  primeServerVoice();
  store.busy = true;
  $("#ask").value = "";
  addMessage("me", value);
  const pending = thinking();
  const live = liveMessage();
  let streamed = "";
  let streamSpoken = 0;
  let speechStreamed = false;
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(store.token ? { "x-athena-session": store.token } : {}),
      },
      body: JSON.stringify({ text: value, history: store.history.slice(-12), stream: true }),
      cache: "no-store",
      /* A multi-step task may need several provider rounds; the Hub budgets
         them to 170s, so allow it to finish before the browser gives up. */
      signal: AbortSignal.timeout(180_000),
    });
    if (res.status === 401) {
      lock();
      throw new Error("Locked.");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `Hub said ${res.status}.`;
      try {
        message = JSON.parse(text).error || message;
      } catch {
        if (text.trim()) message = text.trim().slice(0, 300);
      }
      throw new Error(message);
    }

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
            /* Speak complete sentences before the full answer arrives. Only
               the browser provider can do this without a second request per
               sentence; server speech still starts when the text is final. */
            const boundary = Math.max(streamed.lastIndexOf(". "), streamed.lastIndexOf("! "), streamed.lastIndexOf("? "), streamed.lastIndexOf("\n"));
            if (boundary > streamSpoken && boundary - streamSpoken > 35) {
              const piece = streamed.slice(streamSpoken, boundary + 1);
              if (queueBrowserSpeech(piece)) speechStreamed = true;
              streamSpoken = boundary + 1;
            }
          } else if (event.type === "status") {
            if (!streamed) {
              live.show(event.text || (event.elapsedSec ? `Still working · ${event.elapsedSec}s` : "ATHENA is thinking…"));
            }
          } else if (event.type === "done") {
            answer = event;
          }
        }
      }
    } else {
      answer = await res.json();
    }

    pending.remove();
    if (answer.error && !answer.reply && !streamed) throw new Error(answer.error);
    const reply = String(answer.reply || streamed || "").trim();
    if (!reply) throw new Error("ATHENA returned no message. The configured brain may have failed; nothing was invented.");
    live.commit(reply, { tools: answer.actions || [], images: answer.images || [] });
    store.history.push({ role: "user", content: value }, { role: "assistant", content: reply });
    store.history = store.history.slice(-16);
    saveChat();
    renderConversationList();
    if (speechStreamed && serverProvider() === "browser") {
      const tail = reply.slice(streamSpoken);
      if (tail.trim()) queueBrowserSpeech(tail);
      streamSpoken = reply.length;
    } else {
      speak(reply);
    }
    loadState();
  } catch (error) {
    pending.remove();
    if (streamed) live.commit(streamed);
    else live.wrap.remove();
    const message = error?.name === "TimeoutError" || /aborted/i.test(String(error?.message || ""))
      ? "ATHENA did not answer within three minutes. The provider or Node did not respond; the request was stopped."
      : String(error.message || error);
    addMessage("athena", message);
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
  primeServerVoice();
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

let streamRetry = 0;
let streamRetryTimer = 0;

function scheduleStreamReconnect() {
  if (!store.token || document.visibilityState === "hidden") return;
  window.clearTimeout(streamRetryTimer);
  const delay = Math.min(30_000, 2000 * 2 ** Math.min(streamRetry, 4));
  streamRetry += 1;
  streamRetryTimer = window.setTimeout(() => void connectStream(), delay);
}

async function connectStream() {
  store.stream?.close();
  if (!store.token) return;
  if (document.visibilityState === "hidden") return;
  try {
    const ticket = await getStreamTicket();
    const stream = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
    store.stream = stream;
    stream.addEventListener("state", (event) => {
      try {
        store.state = JSON.parse(event.data);
        streamRetry = 0;
        render();
      } catch {
        /* ignore */
      }
    });
    stream.addEventListener("job", () => loadState());
    stream.onerror = () => {
      /* A ticket can expire while the phone sleeps. Reconnect with a fresh one
         and an exponential delay instead of hammering a dead Hub. */
      stream.close();
      if (store.stream !== stream) return;
      store.stream = null;
      scheduleStreamReconnect();
    };
  } catch (error) {
    if (!String(error.message).includes("Locked")) scheduleStreamReconnect();
  }
}

/* A backgrounded phone must not keep an SSE socket or poll loop alive. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    store.stream?.close();
    store.stream = null;
    window.clearTimeout(streamRetryTimer);
    return;
  }
  if (store.token) {
    void loadState();
    streamRetry = 0;
    void connectStream();
  }
});

/* ─────────────────────────────────────────────────────────── screens */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* fps is measured from frames this browser actually received and painted. */
const screens = { generation: 0, fps: new Map(), latency: new Map(), capture: new Map(), node: new Map() };

function noteScreenFrame(id, latency = 0, capture = {}, nodeMs = 0) {
  const now = performance.now();
  screens.capture.set(id, capture);
  screens.node.set(id, Math.round(nodeMs));
  const stat = screens.fps.get(id) || { frames: 0, since: now, value: 0 };
  stat.frames += 1;
  screens.latency.set(id, Math.round(latency));
  const elapsed = now - stat.since;
  if (elapsed >= 1200) {
    stat.value = Math.round((stat.frames / (elapsed / 1000)) * 10) / 10;
    stat.frames = 0;
    stat.since = now;
  }
  screens.fps.set(id, stat);
  if (elapsed >= 1200) {
    const measured = screens.capture.get(id) || {};
    const label = `B ${stat.value} · C ${Number(measured.captureFps || 0).toFixed(1)} · ${screens.latency.get(id) || 0} MS`;
    const title = `Browser ${stat.value} FPS · Node capture ${Number(measured.captureFps || 0).toFixed(1)} FPS in ${measured.captureMs || 0} ms · round trip ${screens.latency.get(id) || 0} ms · node ${screens.node.get(id) || 0} ms`;
    for (const badge of document.querySelectorAll(`[data-fps="${CSS.escape(id)}"]`)) {
      badge.textContent = label;
      badge.title = title;
    }
    if (store.focus === id) {
      const focusBadge = $("#focus-fps");
      if (focusBadge) {
        focusBadge.textContent = label;
        focusBadge.title = title;
      }
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
    </div>
    ${
      control
        ? `<div class="screen-bar">
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
           </form>`
        : `<p class="micro dim">VIEW ONLY — REMOTE CONTROL IS OFF ON THAT NODE.</p>`
    }
    <div class="screen-audio">
      <select class="audio-pick" data-audio-pick="${esc(node.id)}" aria-label="Audio source"${audio ? "" : " disabled"}>
        <option value="desktop">PC SOUND</option>
        <option value="microphone">MICROPHONE</option>
      </select>
      <button class="btn tiny" data-listen="${esc(node.id)}"${audio ? "" : " disabled"}>🔊 LISTEN</button>
      <button class="btn tiny ghost" data-listen-mute="${esc(node.id)}"${audio ? "" : " disabled"}>MUTE</button>
      <span class="micro dim" data-audio-latency="${esc(node.id)}">${audio ? "PC SOUND OR MICROPHONE" : "FFMPEG REQUIRED FOR BOTH SOURCES"}</span>
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
    : `<div class="empty"><p class="micro dim">NO NODE IS ANSWERING</p><p class="micro dim" style="margin-top:8px">START THE NODE AGENT ON A PC, THEN OPEN NODES → SCAN</p></div>`;

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
      : `<span class="micro dim">NO SIGNAL · LINK A NODE FIRST</span>`;
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
      await sleep(500);
      misses = 0;
      continue;
    }
    const focused = store.focus === id;
    const profile = screenProfile({ focused, hidden: document.hidden, coarse: matchMedia("(pointer: coarse)").matches, viewportWidth: window.innerWidth });
    if (!profile.active) {
      await sleep(500);
      continue;
    }
    const started = Date.now();
    const ok = await grabScreen(id, generation, profile);
    const latency = Date.now() - started;
    screens.latency.set(id, latency);
    misses = ok ? 0 : misses + 1;
    /* a dead or blocking node must not turn into a request storm on a phone */
    if (misses >= 3) {
      await sleep(5000);
      misses = 0;
      continue;
    }
    const spent = Date.now() - started;
    await sleep(Math.max(0, profile.intervalMs - spent));
  }
}

async function grabScreen(id, generation, profile = screenProfile({ focused: store.focus === id })) {
  const imgs = [...document.querySelectorAll(`[data-img="${CSS.escape(id)}"]`)];
  if (!imgs.length) {
    if (store.focus !== id) return true;
  }
  const note = document.querySelector(`[data-note="${CSS.escape(id)}"]`);
  const focusNote = store.focus === id ? $("#focus-note") : null;
  const started = Date.now();
  try {
    const query = new URLSearchParams({ fps: String(profile.fps), width: String(profile.width) });
    const res = await fetch(`/api/nodes/${encodeURIComponent(id)}/screen?${query}`, {
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
    noteScreenFrame(id, Date.now() - started, {
      captureFps: Number(res.headers.get("x-athena-capture-fps")) || 0,
      captureMs: Number(res.headers.get("x-athena-capture-ms")) || 0,
      frameAgeMs: Number(res.headers.get("x-athena-frame-age-ms")) || 0,
    }, Number(res.headers.get("x-athena-node-ms")) || 0);
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
  const inputTools = $("#focus-input-tools");
  if (inputTools) inputTools.hidden = !caps.input;
  const audioTools = $("#focus-audio-tools");
  if (audioTools) audioTools.hidden = !caps.audio;
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
  const activeAudio = audioState.streams.get(id);
  listen.textContent = activeAudio ? "STOP" : "LISTEN";
  listen.classList.toggle("solid", Boolean(activeAudio));
  if ($("#focus-audio-source") && activeAudio?.source) $("#focus-audio-source").value = activeAudio.source;
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

function setListenLabels(id, active, source) {
  for (const button of document.querySelectorAll(`[data-listen="${CSS.escape(id)}"]`)) {
    button.textContent = active ? "STOP" : "LISTEN";
    button.classList.toggle("solid", active);
  }
  const pick = document.querySelector(`[data-audio-pick="${CSS.escape(id)}"]`);
  if (pick && active && source) pick.value = source;
  if (store.focus === id && $("#focus-listen")) {
    $("#focus-listen").textContent = active ? "STOP" : "LISTEN";
    $("#focus-listen").classList.toggle("solid", active);
  }
  if ($("#focus-audio-source") && active && source) $("#focus-audio-source").value = source;
}

function stopAudio(id) {
  const entry = audioState.streams.get(id);
  if (!entry) return false;
  entry.el.pause();
  entry.el.removeAttribute("src");
  entry.el.load();
  entry.source = null;
  audioState.streams.delete(id);
  setListenLabels(id, false);
  syncMute();
  return true;
}

function createAudioEntry(id, source, ticket) {
  const el = document.createElement("audio");
  el.autoplay = true;
  el.playsInline = true;
  el.setAttribute("playsinline", "");
  el.preload = "none";
  el.muted = audioState.muted;
  const query = new URLSearchParams({ ticket, source });
  el.src = `/api/nodes/${encodeURIComponent(id)}/audio?${query}`;
  const entry = { el, source, startedAt: Date.now(), readyMs: null };
  el.addEventListener("playing", () => {
    entry.readyMs = Date.now() - entry.startedAt;
    const label = document.querySelector(`[data-audio-latency="${CSS.escape(id)}"]`);
    if (label) label.textContent = `${source === "desktop" ? "PC" : "MIC"} · ${entry.readyMs} MS`;
  });
  el.addEventListener("error", () => {
    stopAudio(id);
    toast(
      source === "desktop"
        ? "No desktop sound — enable Stereo Mix/VB-CABLE on that PC, or choose MICROPHONE."
        : "No microphone sound from that PC — check its input device and Windows microphone privacy setting.",
      6500
    );
  });
  audioState.streams.set(id, entry);
  return entry;
}

async function toggleListen(id, source = "desktop") {
  const entry = audioState.streams.get(id);
  if (entry?.el && entry.source === source) {
    stopAudio(id);
    return;
  }
  /* Switching source stops the old stream first: never microphone + desktop. */
  if (entry) stopAudio(id);

  /* iOS only accepts play() inside the tap's synchronous task. The ticket is
     already cached after the event stream connects, so the common path does no
     await before play(). The old code awaited a fresh ticket first, which is
     why the browser reported playback blocked on desktop and iOS. */
  if (!streamTicket.value) {
    try {
      await getStreamTicket();
    } catch (error) {
      toast(error.message, 4500);
      return;
    }
    toast("Sound is ready. Tap LISTEN once more.", 3200);
    return;
  }

  const created = createAudioEntry(id, source, streamTicket.value);
  setListenLabels(id, true, source);
  try {
    await created.el.play();
    syncMute();
    void describeAudio(id, source);
  } catch {
    stopAudio(id);
    toast("The browser blocked playback — tap LISTEN again after this screen finishes loading.", 4200);
  }
}

const audioInfo = new Map();

/** Tell the truth about what is being heard: a microphone, or the PC itself. */
async function describeAudio(id, source = "desktop") {
  const key = `${id}:${source}`;
  if (audioInfo.has(key)) return;
  try {
    const info = await api(`/api/nodes/${encodeURIComponent(id)}/audio/devices`);
    audioInfo.set(key, info);
    if (source === "desktop" && !info.systemAudio) {
      toast("That PC has no loopback capture device. Enable Stereo Mix or VB-CABLE; ATHENA will not silently use the microphone instead.", 7600);
    } else if (source === "microphone" && !info.microphoneAudio) {
      toast("That PC did not report a microphone capture device.", 5200);
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

const appsState = { catalogue: [], nodes: new Map(), at: new Map(), busy: new Set(), message: new Map() };
const SOFT_CACHE_MS = 20_000;

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
  if (appsState.nodes.has(nodeId) && !force && Date.now() - (appsState.at.get(nodeId) || 0) < SOFT_CACHE_MS) {
    renderNodeSoftware(nodeId, body);
    return;
  }
  body.innerHTML = `<p class="micro dim">READING INSTALLED SOFTWARE ON ${esc(node.name.toUpperCase())}…</p>`;
  try {
    await softwareCatalogue();
    const res = await api(`/api/nodes/${encodeURIComponent(nodeId)}/action`, { method: "POST", body: { op: "apps", args: {} } });
    appsState.nodes.set(nodeId, res.result?.apps || []);
    appsState.at.set(nodeId, Date.now());
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
      const message = appsState.message.get(`${nodeId}:${app.id}`);
      const badge = !found
        ? `<span class="badge">?</span>`
        : found.running
          ? `<span class="badge run">RUNNING</span>`
          : found.installed
            ? `<span class="badge ok">INSTALLED</span>`
            : `<span class="badge bad">MISSING</span>`;
      const buttons = [];
      if (!busy && found && !found.installed) {
        const label = app.install === "detect" || app.id === "comfyui" ? "FIND FOLDER" : "INSTALL";
        buttons.push(`<button class="btn tiny solid" data-app="install" data-node="${esc(nodeId)}" data-id="${app.id}">${label}</button>`);
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
        ${message ? `<p class="micro ${message.bad ? "job-error" : "accent"}">${esc(message.text)}</p>` : ""}
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
    const detail = result.note || (result.where ? `Found at ${result.where}` : "");
    appsState.message.set(key, { text: detail || `${appId.toUpperCase()} ${action.toUpperCase()} completed.`, bad: false });
    toast(detail || `${appId.toUpperCase()} · ${action.toUpperCase()} DONE ON THAT MACHINE`, 6500);
  } catch (error) {
    appsState.message.set(key, { text: String(error.message || error), bad: true });
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
  if (!store.admin) {
    $("#sys-addresses").textContent = "ADMINISTRATION AVAILABLE ON THE HUB PC";
    $("#sys-code").textContent = "HIDDEN";
    $("#sys-pid").textContent = "—";
    $("#sys-uptime").textContent = "—";
    $("#sys-sessions").textContent = "—";
    $("#sys-devices").innerHTML = `<p class="micro dim">CONTROLLER MANAGEMENT IS AVAILABLE ON THE HUB PC ONLY.</p>`;
    $("#sys-nodes").innerHTML = `<p class="micro dim">YOU CAN VIEW AND CONTROL NODES FROM THE NODES AND SCREEN TABS.</p>`;
    return;
  }
  $("#sys-addresses").textContent = addresses.join("  ·  ");
  $("#sys-code").textContent = hub.openMode ? "OPEN MODE" : store.lockInfo?.code || "ON THIS PC ONLY";
  $("#sys-pid").textContent = hub.pid ? `PID ${hub.pid} · v${hub.version}` : "—";
  $("#sys-uptime").textContent = hub.startedAt ? `SINCE ${new Date(hub.startedAt).toLocaleTimeString()}` : "—";
  const sessions = $("#sys-sessions");
  if (sessions) sessions.textContent = state?.sessions != null ? String(state.sessions) : "—";
  const note = $("#sessions-note");
  if (note && state?.sessionDays) {
    note.textContent = state.rememberControllers
      ? `Each controller has its own conversation. A remembered controller stays unlocked for ${state.sessionDays} days after its last use.`
      : "Remembering new controllers is off. They must unlock again after the browser closes or the Hub restarts. Existing remembered sessions stay valid until revoked or expired.";
  }
  const devices = $("#sys-devices");
  if (devices) {
    const list = Array.isArray(state?.devices) ? state.devices : [];
    devices.innerHTML = list.length
      ? list
          .map((device) => {
            const current = device.id === store.deviceSession;
            const isAdmin = device.role === "admin";
            return `<div class="app-row">
              <div class="app-row-head"><span class="micro">${esc(device.name)}${current ? " · THIS DEVICE" : ""}</span>
                <span class="badge ${isAdmin ? "ok" : ""}">${esc(isAdmin ? "HUB ADMIN" : String(device.platform || "unknown").slice(0, 28))}</span></div>
              <p class="micro dim">${esc(String(device.platform || "unknown platform").slice(0, 60))} · LAST USED ${esc(device.lastSeen ? new Date(device.lastSeen).toLocaleString() : "unknown")}${device.remember === false ? " · NOT REMEMBERED" : ""}${device.legacy ? " · EARLIER SESSION" : ""}</p>
              <div class="actions">
                ${isAdmin ? "" : `<button class="btn tiny" data-device-rename="${esc(device.id)}">RENAME</button>`}
                ${current ? `<button class="btn tiny danger" data-device-revoke="${esc(device.id)}">SIGN OUT THIS DEVICE</button>` : `<button class="btn tiny danger" data-device-revoke="${esc(device.id)}">REVOKE</button>`}
              </div>
            </div>`;
          })
          .join("")
      : `<p class="micro dim">NO CONTROLLER SESSIONS YET. UNLOCK FROM A PHONE OR OPEN THE HUB ON THIS PC.</p>`;
  }
  const remember = $("#cfg-remember");
  if (remember) remember.checked = state?.rememberControllers !== false;
  const days = $("#cfg-session-days");
  if (days) {
    days.value = String(state?.sessionDays || 30);
    days.disabled = state?.rememberControllers === false;
  }

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
    : `<p class="micro dim">NO NODES LINKED. START A NODE AGENT ON A PC, THEN NODES → SCAN.</p>`;
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
    if (!confirm("Unlink this Node? ATHENA will lose control of it until it is linked again.")) return;
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
  button.onclick = () => {
    if (button.dataset.tab) switchView(button.dataset.tab);
  };
});

$("#controllers-btn")?.addEventListener("click", () => {
  if (!store.admin) return;
  switchView("system");
  setTimeout(() => $("#controller-management")?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
});

$("#new-chat")?.addEventListener("click", newChat);
$("#clear-chat")?.addEventListener("click", clearChat);
$("#chat-history-btn")?.addEventListener("click", () => {
  renderConversationList();
  const panel = $("#chat-history-panel");
  panel.hidden = !panel.hidden;
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
});
$("#chat-history-list")?.addEventListener("click", (event) => {
  const open = event.target.closest("[data-chat-open]");
  if (open) return showConversation(open.dataset.chatOpen);
  const remove = event.target.closest("[data-chat-delete]");
  if (remove) return deleteConversation(remove.dataset.chatDelete);
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
  if (store.speak && serverProvider() === "browser") speak("This is my voice.");
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
  primeServerVoice();
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
  if (store.focus) void toggleListen(store.focus, $("#focus-audio-source")?.value || "desktop");
};

$("#focus-mute").onclick = () => {
  const id = store.focus;
  const entry = audioState.streams.get(id);
  if (!entry) return toast("Press LISTEN first.");
  entry.el.muted = !entry.el.muted;
  $("#focus-mute").textContent = entry.el.muted ? "UNMUTE" : "MUTE";
};

$("#focus-redraw")?.addEventListener("click", () => {
  screens.generation += 1;
  startScreens();
  toast("Redrawing…");
});

$("#focus-full")?.addEventListener("click", async () => {
  const panel = $("#focus");
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await panel.requestFullscreen?.();
  } catch {
    toast("Fullscreen is not available in this browser.");
  }
});

$("#focus-shot")?.addEventListener("click", async () => {
  const id = store.focus;
  if (!id) return;
  try {
    const res = await fetch(`/api/nodes/${encodeURIComponent(id)}/screen?fps=1&width=1920`, {
      headers: store.token ? { "x-athena-session": store.token } : {},
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Screenshot failed (HTTP ${res.status}).`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(focusedNode()?.name || "athena").replace(/[^a-z0-9_-]+/gi, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    toast(error.message, 5200);
  }
});

$("#focus-status")?.addEventListener("click", async () => {
  const id = store.focus;
  if (!id) return;
  try {
    await api(`/api/nodes/${encodeURIComponent(id)}/refresh`, { method: "POST" });
    await loadState();
    focusNode(id);
    toast("Status refreshed.");
  } catch (error) {
    toast(error.message, 5200);
  }
});

$("#focus-panel")?.addEventListener("click", () => {
  const node = focusedNode();
  if (!node) return;
  window.open(`http://${node.host}:${node.port}/`, "_blank", "noopener");
});

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
    primeServerVoice();
    speak("Voice on.");
  } else {
    stopBrowserSpeech();
    stopServerSpeech();
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
  if (summary) void loadNodeSoftware(summary.parentElement.dataset.soft, { force: true });
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
    const source = card.querySelector("[data-audio-pick]")?.value || "desktop";
    void toggleListen(id, source);
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
    sessionDays: Number($("#cfg-session-days")?.value) || store.state?.sessionDays || 30,
    rememberControllers: $("#cfg-remember")?.checked !== false,
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

async function saveTtsSettings() {
  const provider = $("#cfg-tts-provider").value;
  const body = {
    tts: {
      provider,
      voice: $("#cfg-tts-voice").value.trim(),
      languageCode: $("#cfg-tts-language").value.trim(),
      apiKey: $("#cfg-tts-key").value,
    },
  };
  try {
    const res = await api("/api/settings", { method: "POST", body });
    store.state = res.state;
    $("#cfg-tts-key").value = "";
    render();
    renderVoicePanel();
    toast(`Speech provider → ${provider.toUpperCase()}`, 4200);
  } catch (error) {
    toast(error.message, 5200);
  }
}

$("#cfg-save").onclick = () => saveSettings();
$("#cfg-save-2").onclick = () => saveSettings();
$("#cfg-tts-save")?.addEventListener("click", () => void saveTtsSettings());
$("#cfg-remember")?.addEventListener("change", () => {
  const days = $("#cfg-session-days");
  if (days) days.disabled = !$("#cfg-remember").checked;
  void saveSettings();
});

$("#cfg-model-pick").addEventListener("change", (event) => {
  const model = event.target.value;
  if (!model) return;
  $("#cfg-model").value = model;
  void saveSettings({ brain: { model, provider: $("#cfg-provider").value } });
  toast(`Model → ${model}`, 3200);
});

$("#cfg-provider")?.addEventListener("change", (event) => applyProviderToForm(event.target.value));

$("#provider-grid")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-provider]");
  if (!card) return;
  applyProviderToForm(card.dataset.provider);
});

$("#cfg-models-load")?.addEventListener("click", async () => {
  const provider = $("#cfg-provider").value;
  const pick = $("#cfg-model-pick");
  const note = $("#provider-test-state");
  if (provider === "ollama") {
    const brain = store.state?.brain || {};
    const models = Array.isArray(brain.models) ? brain.models : [];
    pick.innerHTML = models.length ? models.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("") : `<option value="">no local models installed</option>`;
    pick.disabled = !models.length;
    note.textContent = models.length ? `${models.length} LOCAL MODEL${models.length === 1 ? "" : "S"} FOUND.` : "OLLAMA HAS NO MODELS PULLED YET.";
    return;
  }
  pick.disabled = true;
  pick.innerHTML = `<option value="">loading…</option>`;
  try {
    const result = await api(`/api/providers?models=1&provider=${encodeURIComponent(provider)}`);
    const models = Array.isArray(result.models) ? result.models : [];
    pick.innerHTML = models.length
      ? models.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")
      : `<option value="">${esc(result.modelsError || "the provider returned no model list — type one above")}</option>`;
    pick.disabled = !models.length;
    note.textContent = models.length ? `${models.length} MODELS RETURNED BY ${provider.toUpperCase()}.` : String(result.modelsError || "NO MODEL LIST. TYPE A MODEL NAME AND TEST IT.").toUpperCase();
  } catch (error) {
    pick.innerHTML = `<option value="">could not load models</option>`;
    note.textContent = String(error.message || error).toUpperCase();
  }
});

$("#cfg-test")?.addEventListener("click", async () => {
  const button = $("#cfg-test");
  const note = $("#provider-test-state");
  const provider = $("#cfg-provider").value;
  if (provider === "ollama" || provider === "off" || provider === "auto") {
    note.textContent = "CHOOSE ONE REMOTE PROVIDER TO TEST. LOCAL OLLAMA IS PROBED AUTOMATICALLY.";
    return;
  }
  button.setAttribute("aria-busy", "true");
  note.textContent = "SENDING A REAL TEST MESSAGE…";
  try {
    const result = await api("/api/providers/test", {
      method: "POST",
      body: {
        provider,
        model: $("#cfg-model").value.trim(),
        baseUrl: $("#cfg-base").value.trim(),
        apiKey: $("#cfg-key").value.trim(),
      },
    });
    note.textContent = `READY · ${String(result.provider).toUpperCase()} · ${result.model} · ${result.latencyMs} ms${result.vision ? " · VISION" : ""}${result.tools ? " · TOOLS" : ""}`;
  } catch (error) {
    note.textContent = String(error.message || error).toUpperCase();
  } finally {
    button.removeAttribute("aria-busy");
  }
});

$("#sys-devices")?.addEventListener("click", async (event) => {
  const rename = event.target.closest("[data-device-rename]");
  if (rename) {
    const device = (store.state?.devices || []).find((item) => item.id === rename.dataset.deviceRename);
    if (!device) return;
    const name = prompt("Name this controller:", device.name);
    if (!name || !name.trim() || name.trim() === device.name) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(device.id)}`, { method: "PATCH", body: { name: name.trim() } });
      toast("Controller renamed.");
      await loadState();
    } catch (error) {
      toast(error.message, 5200);
    }
    return;
  }
  const button = event.target.closest("[data-device-revoke]");
  if (!button) return;
  const current = button.dataset.deviceRevoke === store.deviceSession;
  if (!confirm(current ? "Sign out this device? You will need the access code again." : "Revoke this device session? That device will need the access code again.")) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(button.dataset.deviceRevoke)}`, { method: "DELETE" });
    if (current) {
      store.token = "";
      store.admin = false;
      store.deviceSession = "";
      clearAuthToken();
      localStorage.removeItem(SESSION_DEVICE_KEY);
      store.stream?.close();
      store.stream = null;
      lock();
    } else {
      toast("Device revoked.");
      await loadState();
    }
  } catch (error) {
    toast(error.message, 5200);
  }
});

$("#sessions-clear").onclick = async () => {
  if (!confirm("Sign out every phone and device? Each one will need the access code again.")) return;
  try {
    const res = await api("/api/sessions", { method: "DELETE" });
    toast(`Signed out ${res.count} device${res.count === 1 ? "" : "s"}.`, 3600);
    store.token = "";
    store.admin = false;
    store.deviceSession = "";
    clearAuthToken();
    localStorage.removeItem(SESSION_DEVICE_KEY);
    /* Revoking sessions is an access change, not a history deletion. The
       conversation stays on this device until the user clears it explicitly. */
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
    /* Always mint a fresh administrator session on the Hub PC. An older
       controller token is not silently promoted to administrator. */
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ local: true, ...deviceIdentity() }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    store.token = json.token;
    store.admin = Boolean(json.admin);
    store.deviceSession = json.device?.id || "";
    if (store.deviceSession) localStorage.setItem(SESSION_DEVICE_KEY, store.deviceSession);
    saveAuthToken(json.token, true);
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
      store.admin = false;
      clearAuthToken();
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
  initializeConversations();
  saveVoiceSetting();
  renderVoicePanel();
  renderConversationList();
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
    if (!store.token) return;
    if (!document.hidden && (store.view === "screen" || store.focus)) startScreens();
    if (!document.hidden) void loadState();
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
