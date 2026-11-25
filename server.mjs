#!/usr/bin/env node
/**
 * ATHENA — the hub.
 *
 * One small server that owns the network: it finds nodes, keeps their tokens,
 * runs their jobs, exposes a keyed REST API to any other tool, serves the
 * phone/desktop app, and answers questions with an AI that can use the nodes.
 *
 *   node server.mjs
 *   Start Athena.cmd   (Windows)
 *
 * Zero dependencies. Node 20+.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, writeJson, accessCode, sha256, randomToken, safeEqual, id as newId, nowIso, clamp } from "./lib/store.mjs";
import { discover, lanAddresses, nodeFetch, DISCOVERY_PORT } from "./lib/discover.mjs";
import { Registry } from "./lib/nodes.mjs";
import { Jobs } from "./lib/jobs.mjs";
import { ask, probeBrain, warmBrain, invalidateProbeCache } from "./lib/brain.mjs";
import { APPS } from "./lib/apps.mjs";
import { Integrations } from "./lib/integrations.mjs";
import { createBrainInstaller } from "./lib/brain-install.mjs";
import { VERSION } from "./lib/version.mjs";
import {
  HttpError,
  StreamTickets,
  applyCors,
  hostAllowed,
  isLoopback,
  originAllowed,
  readJsonBody,
} from "./lib/security.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Tests and portable installs can point the hub at another state directory. */
const DATA = process.env.ATHENA_DATA_DIR ? path.resolve(process.env.ATHENA_DATA_DIR) : path.join(HERE, "data");
const PUBLIC = path.join(HERE, "public");
const CONFIG_FILE = path.join(DATA, "config.json");
const KEYS_FILE = path.join(DATA, "keys.json");
const SESSIONS_FILE = path.join(DATA, "sessions.json");
const NODES_FILE = path.join(DATA, "nodes.json");
const JOBS_FILE = path.join(DATA, "jobs.json");
const INTEGRATIONS_FILE = path.join(DATA, "integrations.json");
const CODE_FILE = path.join(DATA, "access-code.txt");
const STARTED_AT = nowIso();
/* A phone stays unlocked for a month, then asks for the code again. */
const SESSION_DAYS = 30;

const DEFAULTS = {
  hubName: os.hostname().replace(/\.local$/i, "").toLowerCase() || "athena",
  port: 4790,
  code: "",
  openMode: false,
  brain: {
    provider: "auto",
    model: "",
    baseUrl: "",
    apiKey: "",
  },
};

const savedConfig = readJson(CONFIG_FILE, {});
const config = {
  ...DEFAULTS,
  ...savedConfig,
  brain: { ...DEFAULTS.brain, ...(savedConfig.brain || {}) },
};
if (!config.code) config.code = accessCode(6);
if (process.env.PORT) config.port = Number(process.env.PORT) || config.port;
if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, config);
writeCodeFile();

function saveConfig() {
  writeJson(CONFIG_FILE, config);
  writeCodeFile();
}

/**
 * The access code is also a plain text file next to the config, so it can be
 * read without opening anything: ATHENA writes it on every start and the
 * launcher prints it before opening the browser.
 */
function writeCodeFile() {
  try {
    fs.writeFileSync(CODE_FILE, `${config.code}\n`, "utf8");
  } catch {
    /* read-only folder is fine, the console still shows it */
  }
}

/** INSTALL BRAIN / UPGRADE BRAIN, straight from the app. */
const brainInstaller = createBrainInstaller({
  getBrain: () => config.brain,
  setBrain: (patch) => {
    Object.assign(config.brain, patch);
    invalidateProbeCache();
    saveConfig();
    void hubState().then((state) => broadcast("state", state));
  },
  onDone: () => {
    void hubState().then((state) => broadcast("state", state));
  },
});

/** Put the model in memory in the background, so the first answer is quick. */
function prewarm() {
  if (!config.brain?.model) return;
  void warmBrain(config.brain)
    .then((result) => result?.warmed && log(`brain warm: ${result.model}`))
    .catch(() => undefined);
}

const registry = new Registry(NODES_FILE);
const integrations = new Integrations(INTEGRATIONS_FILE);
const jobs = new Jobs(JOBS_FILE, registry);
/* A job that was running when the hub died is not running now. Queued work is
   picked back up, so a restart never silently drops the queue. */
jobs.recover();
const tickets = new StreamTickets();
setInterval(() => tickets.prune(), 10 * 60 * 1000).unref?.();
const keys = readJson(KEYS_FILE, { keys: [] }).keys || [];
/* Sessions historically stored only a timestamp string per token. Keep those
   tokens valid but give them a visible identity instead of silently merging
   every old phone into one bucket. No token is ever sent to a client list. */
function normalizeSession(token, value) {
  if (value && typeof value === "object") {
    return {
      id: value.id || `device_${sha256(token).slice(0, 8)}`,
      name: String(value.name || "Earlier device").slice(0, 48),
      platform: String(value.platform || "unknown").slice(0, 48),
      clientId: value.clientId ? String(value.clientId).slice(0, 80) : null,
      createdAt: value.createdAt || value.lastSeen || null,
      lastSeen: value.lastSeen || value.createdAt || null,
      legacy: Boolean(value.legacy),
    };
  }
  return {
    id: `device_${sha256(token).slice(0, 8)}`,
    name: "Earlier device",
    platform: "before device names were recorded",
    clientId: null,
    createdAt: value || null,
    lastSeen: value || null,
    legacy: true,
  };
}

const sessions = new Map(
  Object.entries(readJson(SESSIONS_FILE, {})).map(([token, value]) => [token, normalizeSession(token, value)])
);

/** Drops sessions that have not been used in SESSION_DAYS. */
function pruneSessions() {
  const cutoff = Date.now() - SESSION_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [token, session] of sessions) {
    const at = Date.parse(session.lastSeen || session.createdAt);
    if (!Number.isFinite(at) || at < cutoff) {
      sessions.delete(token);
      changed = true;
    }
  }
  if (changed) saveSessions();
  return changed;
}
pruneSessions();

function saveKeys() {
  writeJson(KEYS_FILE, { keys });
}
function saveSessions() {
  writeJson(SESSIONS_FILE, Object.fromEntries(sessions));
}

/** Public device list: metadata only. Never a token or a code. */
function deviceList() {
  return [...sessions.values()]
    .map(({ id, name, platform, createdAt, lastSeen, legacy }) => ({ id, name, platform, createdAt, lastSeen, legacy: Boolean(legacy) }))
    .sort((a, b) => String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")));
}

function deviceLabel(req) {
  const ua = String(req.headers["user-agent"] || "");
  const platform = /iPad/i.test(ua)
    ? "iPad"
    : /iPhone/i.test(ua)
      ? "iPhone"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Unknown platform";
  const browser = /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : /Firefox\//i.test(ua) ? "Firefox" : "Browser";
  return `${platform} · ${browser}`;
}

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

/* ------------------------------------------------------------------- auth */

let failures = new Map();

/*
 * Only headers carry long-lived credentials. Query strings end up in history,
 * proxy logs and screenshots, so streaming transports use a scoped ticket
 * instead — see /api/stream-ticket.
 */
function presentedSecret(req) {
  const bearer = String(req.headers.authorization || "").replace(/^bearer\s+/i, "").trim();
  return String(req.headers["x-athena-key"] || "") || String(req.headers["x-athena-session"] || "") || bearer;
}

function authenticate(req) {
  if (config.openMode) return { ok: true, via: "open" };
  const secret = presentedSecret(req);
  if (!secret) return { ok: false };
  const hash = sha256(secret);
  const key = keys.find((item) => safeEqual(item.hash, hash));
  if (key) {
    key.lastUsed = nowIso();
    saveKeys();
    return { ok: true, via: "key", key };
  }
  const session = sessions.get(secret);
  if (session) {
    const seen = Date.parse(session.lastSeen || session.createdAt);
    if (!Number.isFinite(seen) || Date.now() - seen > SESSION_DAYS * 24 * 60 * 60 * 1000) {
      sessions.delete(secret);
      saveSessions();
      return { ok: false };
    }
    /* cheap touch: only rewrite the file once an hour */
    if (Date.now() - seen > 60 * 60 * 1000) {
      session.lastSeen = nowIso();
      saveSessions();
    }
    return { ok: true, via: "session", session };
  }
  return { ok: false };
}

/* --------------------------------------------------------------- responses */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

const readBody = (req) => readJsonBody(req, { limit: 512 * 1024 });

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = path.resolve(PUBLIC);
  const file = path.resolve(root, rel);
  const inside = path.relative(root, file);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();

    /* The service worker is a template: its cache key and shell list are
       derived from the one version source, so it can never disagree with the
       assets index.html asks for. */
    if (rel === "sw.js") {
      const body = fs.readFileSync(file, "utf8").replaceAll("__ATHENA_VERSION__", VERSION);
      res.writeHead(200, {
        "Content-Type": MIME[".js"],
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "Service-Worker-Allowed": "/",
      });
      return res.end(body);
    }

    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      /* html is never cached: a phone must get the new shell after an update */
      "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ events */

const listeners = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) {
    try {
      res.write(payload);
    } catch {
      listeners.delete(res);
    }
  }
}

jobs.onChange((job) => broadcast("job", job));

let lastStateJson = "";

async function hubState() {
  const nodes = registry.list();
  const brain = await probeBrain(config.brain);
  return {
    hub: {
      name: config.hubName,
      version: VERSION,
      port: config.port,
      addresses: lanAddresses().map((item) => item.address),
      openMode: config.openMode,
      pid: process.pid,
      startedAt: STARTED_AT,
    },
    nodes,
    jobs: jobs.list(20),
    integrations: integrations.list(),
    keys: keys.map(({ id, label, prefix, createdAt, lastUsed }) => ({ id, label, prefix, createdAt, lastUsed })),
    sessions: sessions.size,
    devices: deviceList(),
    sessionDays: SESSION_DAYS,
    brain,
    platform: `${os.type()} ${os.release()}`,
    uptimeSec: Math.round(process.uptime()),
    time: nowIso(),
  };
}

function isOpen() {
  return config.openMode;
}

async function tick() {
  if (registry.nodes.length) {
    await registry.refresh().catch(() => undefined);
    const state = await hubState();
    const serialised = JSON.stringify({ nodes: state.nodes, jobs: state.jobs.slice(0, 5) });
    if (serialised !== lastStateJson) {
      lastStateJson = serialised;
      broadcast("state", state);
    }
  }
}

/* ------------------------------------------------------------------ routes */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const route = url.pathname;
  const method = req.method || "GET";

  /* Fail closed before anything else: a request addressed to another host or
     sent by a foreign page never reaches auth or a route. */
  if (!hostAllowed(req)) return json(res, 403, { error: "This hub only answers to its own address." });
  if (req.headers.origin && !originAllowed(req, req.headers.origin)) {
    return json(res, 403, { error: "That origin is not allowed." });
  }
  applyCors(req, res);

  if (method === "OPTIONS") {
    res.writeHead(204, {});
    return res.end();
  }

  try {
    /* ---- open endpoints ---- */

    if (route === "/api/health") {
      return json(res, 200, { ok: true, name: config.hubName, version: VERSION, nodes: registry.nodes.length, locked: !config.openMode });
    }

    /* Only the machine running the hub may ask for the code — a phone on the
       LAN still has to read it off that screen. */
    /* Stopping and restarting from the app, so a black window is not the only
       way to control the thing. Only reachable with a session or the code. */
    if ((route === "/api/hub/shutdown" || route === "/api/hub/restart") && method === "POST") {
      if (!authenticate(req).ok) return json(res, 401, { error: "Locked." });
      const restart = route.endsWith("restart");
      json(res, 200, { ok: true, restarting: restart, stopping: !restart });
      log(restart ? "restart requested from the app" : "stop requested from the app");
      setTimeout(() => {
        if (restart) {
          try {
            spawn(process.execPath, ["server.mjs"], { cwd: HERE, detached: true, stdio: "ignore", windowsHide: true }).unref();
          } catch (error) {
            log("restart failed:", error?.message || error);
          }
        }
        process.exit(0);
      }, 600);
      return;
    }

    if (route === "/api/lock" && method === "GET") {
      const local = isLoopback(req);
      /* Loopback alone is not proof: a local web page could reach this port.
         The app sends the explicit intent header, which a cross-origin page
         cannot add without a preflight we refuse. */
      if (String(req.headers["x-athena-local"] || "") !== "1") {
        return json(res, local ? 403 : 200, local ? { error: "This endpoint is for the ATHENA app on this PC." } : { local: false, openMode: config.openMode, code: null, hubName: config.hubName, port: config.port });
      }

      return json(res, 200, {
        local,
        openMode: config.openMode,
        code: local && !config.openMode ? config.code : null,
        hubName: config.hubName,
        port: config.port,
      });
    }

    if (route === "/api/session" && method === "POST") {
      const body = await readBody(req);
      const ip = req.socket.remoteAddress || "?";
      const recent = failures.get(ip) || { count: 0, at: 0 };
      if (Date.now() - recent.at > 60_000) recent.count = 0;
      if (recent.count >= 8) return json(res, 429, { error: "Too many attempts. Wait a minute." });
      const given = String(body.code || "").trim().toUpperCase();
      const fromThisPc = body.local === true && isLoopback(req);
      if (config.openMode || fromThisPc || given === String(config.code).toUpperCase()) {
        const token = randomToken(20);
        const clientId = String(body.deviceId || "").trim().slice(0, 80) || null;
        const name = String(body.deviceName || "").trim().slice(0, 48) || deviceLabel(req);
        const platform = String(body.platform || req.headers["user-agent"] || "").slice(0, 160);
        /* Signing in again on the same browser replaces that device's old
           session; other phones, tablets and PCs keep theirs untouched. */
        if (clientId) {
          for (const [oldToken, oldSession] of sessions) {
            if (oldSession.clientId && oldSession.clientId === clientId) sessions.delete(oldToken);
          }
        }
        const session = {
          id: newId("device"),
          name,
          platform: clientId ? platform : deviceLabel(req),
          clientId,
          createdAt: nowIso(),
          lastSeen: nowIso(),
          legacy: false,
        };
        sessions.set(token, session);
        saveSessions();
        failures.delete(ip);
        log(`session opened from ${ip} (${name})`);
        return json(res, 200, { ok: true, token, device: { ...session, platform: session.platform } });
      }
      failures.set(ip, { count: recent.count + 1, at: Date.now() });
      return json(res, 401, { error: "That code does not match. It is printed in the hub window." });
    }

    if (route === "/api/events") {
      if (!authenticate(req).ok && !tickets.valid(url.searchParams.get("ticket"))) return json(res, 401, { error: "Locked." });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 4000\n\n");
      res.write(`event: state\ndata: ${JSON.stringify(await hubState())}\n\n`);
      listeners.add(res);
      const beat = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(beat);
        }
      }, 20_000);
      req.on("close", () => {
        clearInterval(beat);
        listeners.delete(res);
      });
      return;
    }

    /* ---- the app itself ---- */

    if (route.startsWith("/api/") || route.startsWith("/v1/")) {
      /* Audio and SSE cannot send a header from the browser, so they may use a
         scoped stream ticket instead of a session token. Nothing else can. */
      const streamRoute = route === "/api/events" || /\/audio$/.test(route);
      const ticketOk = streamRoute && tickets.valid(url.searchParams.get("ticket"));
      if (!authenticate(req).ok && !ticketOk) {
        return json(res, 401, {
          error: "ATHENA is locked. Send x-athena-key, Authorization: Bearer <api key>, or unlock with the 6-character code.",
          locked: true,
        });
      }
    }

    /* ---- integrations: apps connected through their own API ---- */

    if (route === "/api/integrations" && method === "GET") {
      return json(res, 200, { integrations: integrations.list() });
    }

    if (route === "/api/integrations" && method === "POST") {
      const body = await readBody(req);
      try {
        const integration = integrations.add(body);
        broadcast("state", await hubState());
        return json(res, 200, { ok: true, integration });
      } catch (error) {
        return json(res, 400, { error: String(error?.message || error) });
      }
    }

    const integrationMatch = route.match(/^\/api\/integrations\/([^/]+)(\/probe)?$/);
    if (integrationMatch) {
      const id = decodeURIComponent(integrationMatch[1]);
      if (integrationMatch[2] && method === "POST") {
        try {
          const integration = await integrations.probe(id);
          broadcast("state", await hubState());
          return json(res, 200, { ok: true, integration });
        } catch (error) {
          return json(res, 400, { error: String(error?.message || error) });
        }
      }
      if (method === "POST") {
        const body = await readBody(req);
        try {
          const integration = integrations.update(id, body);
          if (!integration) return json(res, 404, { error: "No such integration." });
          broadcast("state", await hubState());
          return json(res, 200, { ok: true, integration });
        } catch (error) {
          return json(res, 400, { error: String(error?.message || error) });
        }
      }
      if (method === "DELETE") {
        if (!integrations.remove(id)) return json(res, 404, { error: "No such integration." });
        broadcast("state", await hubState());
        return json(res, 200, { ok: true });
      }
      const found = integrations.get(id);
      if (!found) return json(res, 404, { error: "No such integration." });
      return json(res, 200, { integration: integrations.view(found) });
    }

    if (route === "/api/stream-ticket" && method === "POST") {
      return json(res, 200, { ok: true, ...tickets.issue("stream") });
    }

    if (route === "/api/state") return json(res, 200, await hubState());

    if (route === "/api/scan" && method === "POST") {
      const found = await discover();
      const linked = new Set(registry.nodes.map((node) => node.id));
      return json(res, 200, {
        found: found.map((device) => ({
          ...device,
          paired: linked.has(device.id),
          address: `${device.host}:${device.port}`,
        })),
      });
    }

    if (route === "/api/nodes" && method === "GET") {
      await registry.refresh();
      return json(res, 200, { nodes: registry.list() });
    }

    if (route === "/api/nodes/pair" && method === "POST") {
      const body = await readBody(req);
      try {
        const node = await registry.pair({ ...body, name: config.hubName });
        await registry.refresh(node.id);
        broadcast("state", await hubState());
        return json(res, 200, { ok: true, node });
      } catch (error) {
        return json(res, 400, { error: String(error?.message || error) });
      }
    }

    const nodeMatch = route.match(/^\/(api|v1)\/nodes\/([^/]+)(\/.*)?$/);
    if (nodeMatch) {
      const [, , rawId, rest = ""] = nodeMatch;
      const node = registry.get(decodeURIComponent(rawId));
      if (!node) return json(res, 404, { error: "No such node." });

      if (rest === "" && method === "GET") {
        await registry.refresh(node.id);
        return json(res, 200, { node: registry.decorate(node), status: registry.statusOf(node.id)?.status || null });
      }

      if (rest === "" && method === "DELETE") {
        registry.remove(node.id);
        broadcast("state", await hubState());
        return json(res, 200, { ok: true });
      }

      if (rest === "/refresh" && method === "POST") {
        await registry.refresh(node.id);
        return json(res, 200, { ok: true, status: registry.statusOf(node.id)?.status || null });
      }

      if (rest === "/action" && method === "POST") {
        const body = await readBody(req);
        try {
          const result = await registry.action(node.id, String(body.op || "status"), body.args || {}, Number(body.timeout) || 120_000);
          return json(res, 200, { ok: true, result });
        } catch (error) {
          return json(res, 400, { error: String(error?.message || error) });
        }
      }

      if (rest === "/exec" && method === "POST") {
        const body = await readBody(req);
        if (!body.command) return json(res, 400, { error: "Give a command." });
        const auth = authenticate(req);
        const job = jobs.create({
          node: node.id,
          op: "run",
          args: { command: String(body.command), timeoutSec: clamp(body.timeoutSec || 900, 5, 7200) },
          label: String(body.command).split("\n")[0].slice(0, 120),
          source: String(body.source || (route.startsWith("/v1/") ? "api" : "hub")),
          createdBy: auth.key ? `API key “${auth.key.label}”` : auth.via === "session" ? "signed-in app session" : auth.via === "open" ? "open mode (no key)" : null,
        });
        if (body.wait === false) return json(res, 202, { ok: true, job });
        return json(res, 200, { ok: true, job: await waitFor(job.id, Number(body.waitSec) || 120) });
      }

      if (rest === "/tasks" && method === "GET") {
        const result = await registry.tasks(node.id);
        return json(res, 200, result);
      }

      /* ---- live screen + remote control ---- */

      if (rest === "/screen/info" && method === "GET") {
        try {
          return json(res, 200, { ok: true, ...(await registry.screenInfo(node.id)) });
        } catch (error) {
          return json(res, 400, { error: String(error?.message || error) });
        }
      }

      if (rest === "/screen" && method === "GET") {
        try {
          const buffer = await registry.screen(node.id, {
            fps: url.searchParams.get("fps"),
            width: url.searchParams.get("width"),
          });
          res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Content-Length": buffer.length,
            "Cache-Control": "no-store",
          });
          return res.end(buffer);
        } catch (error) {
          return json(res, 502, { error: String(error?.message || error) });
        }
      }

      if (rest === "/input" && method === "POST") {
        const body = await readBody(req);
        try {
          const result = await registry.input(node.id, body);
          return json(res, 200, { ok: true, result });
        } catch (error) {
          return json(res, 400, { error: String(error?.message || error) });
        }
      }

      /* ---- hearing the machine ---- */

      if (rest === "/audio/devices" && method === "GET") {
        try {
          return json(res, 200, { ok: true, ...(await registry.audioDevices(node.id)) });
        } catch (error) {
          return json(res, 400, { error: String(error?.message || error) });
        }
      }

      if (rest === "/audio" && method === "GET") {
        const device = url.searchParams.get("device") || "";
        const source = url.searchParams.get("source") || "desktop";
        if (!["microphone", "desktop"].includes(source)) return json(res, 400, { error: "Audio source must be microphone or desktop." });
        try {
          registry.assertCompatible(node);
          const query = new URLSearchParams({ source });
          if (device) query.set("device", device);
          const upstream = await nodeFetch(node, `/api/audio?${query}`, {}, 6 * 60 * 60 * 1000);
          if (!upstream.ok || !upstream.body) {
            const text = await upstream.text().catch(() => "");
            let message = `Audio HTTP ${upstream.status}`;
            try {
              message = JSON.parse(text).error || message;
            } catch {
              /* not json */
            }
            return json(res, 502, { error: message });
          }
          res.writeHead(200, {
            "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
          });
          const stream = Readable.fromWeb(upstream.body);
          req.on("close", () => {
            try {
              stream.destroy();
            } catch {
              /* closed */
            }
          });
          stream.on("error", () => {
            try {
              res.end();
            } catch {
              /* closed */
            }
          });
          stream.pipe(res);
          return;
        } catch (error) {
          return json(res, 502, { error: String(error?.message || error) });
        }
      }

      if (rest.startsWith("/comfy") && ["GET", "POST"].includes(method)) {
        const target = route.replace(/^\/(?:api|v1)\/nodes\/[^/]+/, "");
        const body = ["POST", "PUT", "PATCH"].includes(method) ? Buffer.from(await collect(req)) : undefined;
        registry.assertCompatible(node);
        const upstream = await nodeFetch(
          node,
          `${target}${url.search}`,
          {
            method,
            headers: req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {},
            body,
          },
          600_000
        );
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
          "Content-Length": buffer.length,
          "Cache-Control": "no-store",
        });
        return res.end(buffer);
      }

      return json(res, 404, { error: "Unknown node route." });
    }

    if (route === "/api/jobs" && method === "GET") return json(res, 200, { jobs: jobs.list(50) });

    if (route === "/api/jobs" && method === "POST") {
      const body = await readBody(req);
      const node = registry.get(body.node);
      if (!node) return json(res, 400, { error: `No node called "${body.node}".` });
      const auth = authenticate(req);
      if (body.op && body.op !== "run" && body.op !== "exec") {
        const job = jobs.create({
          node: node.id,
          op: String(body.op),
          args: body.args || {},
          label: body.label,
          source: "hub",
          createdBy: auth.key ? `API key “${auth.key.label}”` : "this Hub's app",
        });
        return json(res, 202, { ok: true, job });
      }
      if (!body.command) return json(res, 400, { error: "Give a command." });
      const job = jobs.create({
        node: node.id,
        op: "run",
        args: { command: String(body.command), timeoutSec: clamp(body.timeoutSec || 900, 5, 7200) },
        label: body.label || String(body.command).split("\n")[0].slice(0, 120),
        source: "hub",
        createdBy: auth.key ? `API key “${auth.key.label}”` : "this Hub's app",
      });
      return json(res, 202, { ok: true, job });
    }

    const jobMatch = route.match(/^\/api\/jobs\/([^/]+)(\/cancel)?$/);
    if (jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!job) return json(res, 404, { error: "No such job." });
      if (jobMatch[2] && method === "POST") {
        const ok = await jobs.cancel(job.id);
        return json(res, ok ? 200 : 409, { ok, job });
      }
      return json(res, 200, { job });
    }

    if (route === "/api/ask" && method === "POST") {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      if (!text) return json(res, 400, { error: "Ask me something." });
      const wantsStream = Boolean(body.stream);
      let sentAny = false;
      const onToken = wantsStream
        ? (piece) => {
            if (res.writableEnded || res.destroyed) return;
            if (!sentAny) {
              /* Headers go out with the first token, so the phone can paint the
                 bubble before the sentence is finished. */
              sentAny = true;
              res.writeHead(200, {
                "content-type": "application/x-ndjson; charset=utf-8",
                "cache-control": "no-store",
                "x-accel-buffering": "no",
              });
            }
            res.write(JSON.stringify({ type: "token", text: piece }) + "\n");
          }
        : null;

      const answer = await ask({
        text,
        /* Provider configuration is owned by the hub. A caller may ask a
           question; it may not point the brain at another host. */
        config,
        registry,
        history: body.history || [],
        admin: brainInstaller,
        onToken,
      });
      /* Screenshots are for the client that asked; a base64 JPEG does not
         belong in a broadcast every device receives. */
      const { images: _images, ...broadcastable } = answer;
      broadcast("chat", { at: nowIso(), text, ...broadcastable });
      if (answer.meta) log(`ask ${answer.meta.ms}ms · ${answer.meta.path}${answer.meta.tools?.length ? " · " + answer.meta.tools.join(",") : ""}`);
      if (wantsStream) {
        if (!sentAny) {
          res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
        }
        res.end(JSON.stringify({ type: "done", ...answer }) + "\n");
        return;
      }
      return json(res, 200, answer);
    }

    if (route === "/api/keys" && method === "POST") {
      const body = await readBody(req);
      const label = String(body.label || "tool").slice(0, 40);
      const secret = "ath_" + randomToken(18);
      const entry = {
        id: newId("key"),
        label,
        prefix: secret.slice(0, 12),
        hash: sha256(secret),
        createdAt: nowIso(),
        lastUsed: null,
      };
      keys.push(entry);
      saveKeys();
      return json(res, 200, { ok: true, key: secret, entry: { ...entry, hash: undefined } });
    }

    if (route.startsWith("/api/keys/") && method === "DELETE") {
      const id = decodeURIComponent(route.replace("/api/keys/", ""));
      const before = keys.length;
      const filtered = keys.filter((item) => item.id !== id);
      if (filtered.length === before) return json(res, 404, { error: "No such key." });
      keys.length = 0;
      keys.push(...filtered);
      saveKeys();
      return json(res, 200, { ok: true });
    }

    if (route === "/api/sessions" && method === "GET") {
      return json(res, 200, { ok: true, devices: deviceList(), sessionDays: SESSION_DAYS });
    }

    if (route.startsWith("/api/sessions/") && method === "DELETE") {
      const id = decodeURIComponent(route.slice("/api/sessions/".length));
      const found = [...sessions.entries()].find(([, session]) => session.id === id);
      if (!found) return json(res, 404, { error: "No such device session." });
      sessions.delete(found[0]);
      saveSessions();
      log(`device session revoked: ${found[1].name}`);
      return json(res, 200, { ok: true, id });
    }

    if (route === "/api/sessions" && method === "DELETE") {
      const count = sessions.size;
      sessions.clear();
      saveSessions();
      log(`signed out ${count} device${count === 1 ? "" : "s"}`);
      return json(res, 200, { ok: true, count });
    }

    if (route === "/api/settings" && method === "POST") {
      const body = await readBody(req);
      const nextCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const wantsOpen = typeof body.openMode === "boolean" && body.openMode !== config.openMode;
      const wantsCode = Boolean(nextCode) && nextCode !== String(config.code).toUpperCase();

      /* Turning auth off, or rotating the code, is not something a borrowed
         phone session may do. It needs the machine itself and the current
         code as a fresh proof of ownership. */
      if (wantsOpen || wantsCode) {
        const confirmed = isLoopback(req) && String(body.confirmCode || "").trim().toUpperCase() === String(config.code).toUpperCase();
        if (!confirmed) {
          return json(res, 403, { error: "Open mode and code changes require this PC and the current access code." });
        }
      }

      if (wantsCode) {
        if (nextCode.length < 4 || nextCode.length > 12) return json(res, 400, { error: "The code must be 4–12 characters." });
        config.code = nextCode;
      }
      if (typeof body.hubName === "string" && body.hubName.trim()) config.hubName = body.hubName.trim().slice(0, 40);
      if (typeof body.openMode === "boolean") config.openMode = body.openMode;

      if (body.brain !== undefined) {
        if (!body.brain || typeof body.brain !== "object" || Array.isArray(body.brain)) {
          return json(res, 400, { error: "brain must be an object." });
        }
        const provider = String(body.brain.provider ?? config.brain.provider).trim().toLowerCase();
        if (!["auto", "ollama", "openai", "gemini", "off"].includes(provider)) {
          return json(res, 400, { error: `Unknown provider "${provider}".` });
        }
        config.brain.provider = provider;
        for (const field of ["model", "apiKey"]) {
          if (field in body.brain) config.brain[field] = String(body.brain[field] ?? "").trim();
        }
        if ("baseUrl" in body.brain) {
          const baseUrl = String(body.brain.baseUrl ?? "").trim();
          if (baseUrl) {
            let parsed;
            try {
              parsed = new URL(baseUrl);
            } catch {
              return json(res, 400, { error: "Base URL must be a full http(s) URL." });
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              return json(res, 400, { error: "Base URL must be a full http(s) URL." });
            }
          }
          config.brain.baseUrl = baseUrl;
        }
      }

      invalidateProbeCache();
      saveConfig();
      broadcast("state", await hubState());
      prewarm();
      return json(res, 200, { ok: true, state: await hubState() });
    }

    if (route === "/api/brain") {
      return json(res, 200, await probeBrain(config.brain));
    }

    if (route === "/api/brain/install" && method === "GET") {
      return json(res, 200, brainInstaller.status());
    }

    if (route === "/api/brain/install" && method === "POST") {
      const body = await readBody(req);
      return json(res, 200, brainInstaller.start("install", { vision: Boolean(body.vision) }));
    }

    if (route === "/api/brain/upgrade" && method === "POST") {
      const body = await readBody(req);
      return json(res, 200, brainInstaller.start("upgrade", { vision: Boolean(body.vision) }));
    }

    if (route === "/api/apps" && method === "GET") {
      return json(res, 200, { apps: APPS });
    }

    /* ---- v1: the same resources, meant for other tools ---- */

    if (route === "/v1/nodes" && method === "GET") {
      await registry.refresh();
      return json(res, 200, { nodes: registry.list() });
    }

    if (route === "/v1/jobs" && method === "GET") return json(res, 200, { jobs: jobs.list(50) });

    if (route === "/v1/health") {
      return json(res, 200, { ok: true, name: config.hubName, version: VERSION, nodes: registry.list(), brain: await probeBrain(config.brain) });
    }

    if (route === "/v1/ask" && method === "POST") {
      const body = await readBody(req);
      const answer = await ask({ text: String(body.text || ""), config, registry, history: body.history || [] });
      return json(res, 200, answer);
    }

    if (serveStatic(req, res, route)) return;

    if (route === "/" || !route.includes(".")) {
      if (serveStatic(req, res, "/index.html")) return;
    }

    return json(res, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) return json(res, error.status, { error: error.message });
      return res.end();
    }
    log("error", error?.stack || error?.message || error);
    if (!res.headersSent) return json(res, 500, { error: String(error?.message || error) });
    res.end();
  }
});

async function collect(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function waitFor(jobId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const job = jobs.get(jobId);
    if (job && ["done", "failed", "cancelled", "timeout"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return jobs.get(jobId);
}

/* -------------------------------------------------------------------- boot */

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("");
    console.error("   ATHENA is already running — that port message is not an error.");
    console.error("   Just open  http://127.0.0.1:" + config.port + "/  in your browser.");
    console.error("   (The black window from the first launch owns the hub. Closing it stops ATHENA.)");
    console.error("   Using a different port instead? Edit data/config.json -> port.");
    console.error("");
    setTimeout(() => process.exit(0), 4000);
    return;
  }
  console.error("Server error:", error);
});

const LISTEN_PORT = Number(process.env.PORT) || config.port;

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  const addresses = lanAddresses().map((item) => item.address);
  const shown = addresses.length ? addresses : ["127.0.0.1"];
  console.log("");
  console.log("   ▄▀█ ▀█▀ █░█ █▀▀ █▄░█ ▄▀█");
  console.log("   █▀█ ░█░ █▀█ ██▄ █░▀█ █▀█   v" + VERSION);
  console.log("");
  console.log("   hub        " + config.hubName);
  console.log("   this PC    http://127.0.0.1:" + config.port + "/");
  console.log("   phones     " + shown.map((ip) => `http://${ip}:${config.port}/`).join("  ·  "));
  console.log("");
  console.log("   ╔══════════════════════════════════════════════╗");
  console.log("   ║   ACCESS CODE   " + String(config.code).padEnd(28) + "║");
  console.log("   ╚══════════════════════════════════════════════╝");
  console.log("   " + (config.openMode ? "open mode: no code needed on this network" : "type that code on your phone · this PC opens by itself"));
  console.log("   saved in         data\\access-code.txt");
  console.log("   discovery  UDP " + DISCOVERY_PORT + "  ·  nodes " + registry.nodes.length);
  console.log("");
  log("athena up");
  setInterval(() => void tick(), 8000);
  setInterval(() => pruneSessions(), 6 * 60 * 60 * 1000);
  void tick();
  setTimeout(prewarm, 2500);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("shutting down");
    process.exit(0);
  });
}
