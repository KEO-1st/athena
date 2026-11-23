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
import { discover, lanAddresses, DISCOVERY_PORT } from "./lib/discover.mjs";
import { Registry } from "./lib/nodes.mjs";
import { Jobs } from "./lib/jobs.mjs";
import { ask, probeBrain, warmBrain } from "./lib/brain.mjs";
import { APPS } from "./lib/apps.mjs";
import { createBrainInstaller } from "./lib/brain-install.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "data");
const PUBLIC = path.join(HERE, "public");
const CONFIG_FILE = path.join(DATA, "config.json");
const KEYS_FILE = path.join(DATA, "keys.json");
const SESSIONS_FILE = path.join(DATA, "sessions.json");
const NODES_FILE = path.join(DATA, "nodes.json");
const JOBS_FILE = path.join(DATA, "jobs.json");
const CODE_FILE = path.join(DATA, "access-code.txt");
const VERSION = "2.2.1";
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
const jobs = new Jobs(JOBS_FILE, registry);
const keys = readJson(KEYS_FILE, { keys: [] }).keys || [];
const sessions = new Map(Object.entries(readJson(SESSIONS_FILE, {})));

/** Drops sessions that have not been used in SESSION_DAYS. */
function pruneSessions() {
  const cutoff = Date.now() - SESSION_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [token, seen] of sessions) {
    const at = Date.parse(seen);
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

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

/* ------------------------------------------------------------------- auth */

let failures = new Map();

function presentedSecret(req, url) {
  const bearer = String(req.headers.authorization || "").replace(/^bearer\s+/i, "").trim();
  return (
    String(req.headers["x-athena-key"] || "") ||
    String(req.headers["x-athena-session"] || "") ||
    String(url.searchParams.get("token") || "") ||
    bearer
  );
}

function authenticate(req, url) {
  if (config.openMode) return { ok: true, via: "open" };
  const secret = presentedSecret(req, url);
  if (!secret) return { ok: false };
  const hash = sha256(secret);
  const key = keys.find((item) => safeEqual(item.hash, hash));
  if (key) {
    key.lastUsed = nowIso();
    saveKeys();
    return { ok: true, via: "key", key };
  }
  if (sessions.has(secret)) {
    const seen = Date.parse(sessions.get(secret));
    if (!Number.isFinite(seen) || Date.now() - seen > SESSION_DAYS * 24 * 60 * 60 * 1000) {
      sessions.delete(secret);
      saveSessions();
      return { ok: false };
    }
    /* cheap touch: only rewrite the file once an hour */
    if (Date.now() - seen > 60 * 60 * 1000) {
      sessions.set(secret, nowIso());
      saveSessions();
    }
    return { ok: true, via: "session" };
  }
  if (secret === config.code) return { ok: true, via: "code" };
  return { ok: false };
}

function isLoopback(req) {
  const raw = req.socket.remoteAddress || "";
  return raw === "127.0.0.1" || raw === "::1" || raw === "::ffff:127.0.0.1";
}

/* --------------------------------------------------------------- responses */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("Body too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(path.resolve(PUBLIC))) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
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
      code: isOpen() ? null : config.code,
      pid: process.pid,
      startedAt: STARTED_AT,
      dataDir: DATA,
    },
    nodes,
    jobs: jobs.list(20),
    keys: keys.map(({ id, label, prefix, createdAt, lastUsed }) => ({ id, label, prefix, createdAt, lastUsed })),
    sessions: sessions.size,
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

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type,authorization,x-athena-key,x-athena-session",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    });
    return res.end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,x-athena-key,x-athena-session");

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
      if (!authenticate(req, url).ok) return json(res, 401, { error: "Locked." });
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
        sessions.set(token, nowIso());
        saveSessions();
        failures.delete(ip);
        log(`session opened from ${ip}`);
        return json(res, 200, { ok: true, token });
      }
      failures.set(ip, { count: recent.count + 1, at: Date.now() });
      return json(res, 401, { error: "That code does not match. It is printed in the hub window." });
    }

    if (route === "/api/events") {
      if (!authenticate(req, url).ok) return json(res, 401, { error: "Locked." });
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
      if (!authenticate(req, url).ok) {
        return json(res, 401, {
          error: "ATHENA is locked. Send x-athena-key, Authorization: Bearer <api key>, or unlock with the 6-character code.",
          locked: true,
        });
      }
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
        const job = jobs.create({
          node: node.id,
          op: "run",
          args: { command: String(body.command), timeoutSec: clamp(body.timeoutSec || 900, 5, 7200), source: body.source || "api" },
          label: String(body.command).split("\n")[0].slice(0, 120),
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
          const buffer = await registry.screen(node.id);
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
        try {
          const upstream = await fetch(
            `http://${node.host}:${node.port}/api/audio${device ? `?device=${encodeURIComponent(device)}` : ""}`,
            {
              headers: { "x-athena-token": node.token || "" },
              signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
            }
          );
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
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
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
        const upstream = await fetch(`http://${node.host}:${node.port}${target}${url.search}`, {
          method,
          headers: { "x-athena-token": node.token, ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}) },
          body,
          signal: AbortSignal.timeout(600_000),
        });
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
      if (body.op && body.op !== "run" && body.op !== "exec") {
        const job = jobs.create({ node: node.id, op: String(body.op), args: body.args || {}, label: body.label });
        return json(res, 202, { ok: true, job });
      }
      if (!body.command) return json(res, 400, { error: "Give a command." });
      const job = jobs.create({
        node: node.id,
        op: "run",
        args: { command: String(body.command), timeoutSec: clamp(body.timeoutSec || 900, 5, 7200), source: body.source || "api" },
        label: body.label || String(body.command).split("\n")[0].slice(0, 120),
      });
      return json(res, 202, { ok: true, job });
    }

    const jobMatch = route.match(/^\/api\/jobs\/([^/]+)(\/cancel)?$/);
    if (jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!job) return json(res, 404, { error: "No such job." });
      if (jobMatch[2] && method === "POST") {
        const ok = jobs.cancel(job.id);
        return json(res, ok ? 200 : 409, { ok, job });
      }
      return json(res, 200, { job });
    }

    if (route === "/api/ask" && method === "POST") {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      if (!text) return json(res, 400, { error: "Ask me something." });
      const answer = await ask({
        text,
        config: { ...config, ...(body.context || {}) },
        registry,
        history: body.history || [],
        admin: brainInstaller,
      });
      broadcast("chat", { at: nowIso(), text, ...answer });
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

    if (route === "/api/sessions" && method === "DELETE") {
      const count = sessions.size;
      sessions.clear();
      saveSessions();
      log(`signed out ${count} device${count === 1 ? "" : "s"}`);
      return json(res, 200, { ok: true, count });
    }

    if (route === "/api/settings" && method === "POST") {
      const body = await readBody(req);
      if (typeof body.hubName === "string" && body.hubName.trim()) config.hubName = body.hubName.trim().slice(0, 40);
      if (typeof body.openMode === "boolean") config.openMode = body.openMode;
      if (typeof body.code === "string" && body.code.trim().length >= 4) config.code = body.code.trim().toUpperCase().slice(0, 12);
      if (body.brain && typeof body.brain === "object") {
        for (const field of ["provider", "model", "baseUrl", "apiKey"]) {
          if (field in body.brain) config.brain[field] = String(body.brain[field] ?? "").trim();
        }
      }
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

server.listen(config.port, "0.0.0.0", () => {
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
