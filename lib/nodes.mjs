import path from "node:path";
import os from "node:os";
import { writeJson, readJson, id as newId, nowIso } from "./store.mjs";
import { nodeFetch, nodeRequest } from "./discover.mjs";
import { assessNode, storedCompatibility } from "./node-protocol.mjs";

/**
 * The node registry: every machine ATHENA has paired with, its token and the
 * last status it reported. Tokens never leave the hub.
 */

export class Registry {
  constructor(file) {
    this.file = file;
    const saved = readJson(file, { nodes: [] });
    this.nodes = Array.isArray(saved.nodes) ? saved.nodes : [];
    /* Older records have no alias and may share an index after a re-pair.
       Give every machine one stable, human name so "Node 2" never depends on
       the model guessing or on the order a status poll happened to return. */
    this.nodes.forEach((node, position) => {
      if (!Number.isInteger(node.index) || node.index < 1) node.index = position + 1;
      if (!node.alias) node.alias = `Node ${node.index}`;
    });
    this.status = new Map();
    this.activeTasks = new Map();
    this.screenCache = new Map();
    this.screenPending = new Map();
    this.savedSignature = this.signature();
  }

  /** Identity of the stored records, ignoring the continuously-updated lastSeen. */
  signature() {
    return JSON.stringify(this.nodes.map(({ lastSeen, ...rest }) => rest));
  }

  save() {
    writeJson(this.file, { nodes: this.nodes });
    this.savedSignature = this.signature();
  }

  list() {
    return this.nodes.map((node) => this.decorate(node));
  }

  decorate(node) {
    const live = this.status.get(node.id);
    const compatibility = storedCompatibility(node);
    const hostname = String(live?.status?.hostname || "").toLowerCase();
    return {
      id: node.id,
      name: node.name,
      alias: node.alias || `Node ${node.index}`,
      label: node.alias || `Node ${node.index}`,
      host: node.host,
      port: node.port,
      index: node.index,
      pairedAt: node.pairedAt,
      lastSeen: node.lastSeen || null,
      online: Boolean(live?.online),
      status: live?.status || null,
      /* The Hub PC can also be a normal Node. This flag only labels the
         machine; it never grants the Node Hub authority. */
      localToHub: Boolean(hostname && hostname === os.hostname().toLowerCase()),
      statusAt: live?.at || null,
      error: live?.error || null,
      /* Node software identity is independent of the Hub version. */
      nodeVersion: node.nodeVersion || live?.status?.nodeVersion || live?.status?.version || null,
      protocol: node.protocol ?? live?.status?.protocol ?? null,
      hubProtocol: node.hubProtocol || null,
      features: Array.isArray(node.features) ? node.features : [],
      compatibility,
    };
  }

  /** Negotiate before pairing: an incompatible Node is not half-linked. */
  async negotiate(node) {
    const hello = await nodeRequest({ host: node.host, port: node.port, token: "" }, "/api/hello", {}, 8000);
    if (!hello.ok) {
      throw new Error(hello.json?.error || `That machine did not answer /api/hello (HTTP ${hello.status}).`);
    }
    return { hello: hello.json, compatibility: assessNode(hello.json) };
  }

  /** Refuse an incompatible Node with the reason the negotiation produced. */
  assertCompatible(node) {
    const compatibility = storedCompatibility(node);
    if (!compatibility.compatible) throw new Error(compatibility.reason);
    return compatibility;
  }

  get(idOrName) {
    const key = String(idOrName || "").trim().toLowerCase();
    if (!key) return null;
    const exact =
      this.nodes.find((node) => node.id.toLowerCase() === key) ||
      this.nodes.find((node) => String(node.alias || "").toLowerCase() === key) ||
      this.nodes.find((node) => node.name.toLowerCase() === key);
    if (exact) return exact;
    /* "node 2", "node #2" and "the second node" are registry positions, not
       model inventions. Resolve them against the persisted index. */
    const numbered = key.match(/^(?:the\s+)?node\s*#?\s*(\d+)$/) || key.match(/^(\d+)(?:st|nd|rd|th)?\s+node$/);
    if (numbered) {
      const index = Number(numbered[1]);
      const byIndex = this.nodes.find((node) => Number(node.index) === index);
      if (byIndex) return byIndex;
    }
    const ordinal = key.match(/^(?:the\s+)?(first|second|third|fourth|fifth)\s+(?:node|machine|pc|computer)$/);
    if (ordinal) {
      const position = ["first", "second", "third", "fourth", "fifth"].indexOf(ordinal[1]) + 1;
      const byIndex = this.nodes.find((node) => Number(node.index) === position) || this.nodes[position - 1];
      if (byIndex) return byIndex;
    }
    return (
      this.nodes.find((node) => node.name.toLowerCase().includes(key)) ||
      this.nodes.find((node) => String(node.alias || "").toLowerCase().includes(key)) ||
      null
    );
  }

  async pair({ host, port, code, name }) {
    const cleanHost = String(host || "").trim();
    if (!cleanHost) throw new Error("No address for that machine.");
    const target = { host: cleanHost, port: Number(port) || 47_910 };
    const { compatibility } = await this.negotiate(target);
    if (!compatibility.compatible) throw new Error(compatibility.reason);
    const reply = await nodeRequest({ host: cleanHost, port: Number(port) || 47_910, token: "" }, "/api/link", {
      method: "POST",
      body: JSON.stringify({ hub: name || "athena", code: String(code || "") }),
    });
    if (!reply.ok || !reply.json.token) {
      throw new Error(reply.json.error || `The machine refused the link (HTTP ${reply.status}).`);
    }
    const existing = this.nodes.find((node) => node.id === reply.json.id);
    if (existing) {
      existing.host = cleanHost;
      existing.port = Number(port) || existing.port;
      existing.token = reply.json.token;
      existing.lastSeen = nowIso();
      existing.nodeVersion = compatibility.nodeVersion;
      existing.protocol = compatibility.protocol;
      existing.hubProtocol = compatibility.hubProtocol;
      existing.features = compatibility.features;
      this.save();
      return this.decorate(existing);
    }    const usedIndexes = new Set(this.nodes.map((node) => Number(node.index)).filter(Number.isFinite));
    let index = Number(reply.json.index);
    if (!Number.isInteger(index) || index < 1 || usedIndexes.has(index)) {
      index = 1;
      while (usedIndexes.has(index)) index += 1;
    }
    const node = {
      id: reply.json.id || newId("node"),
      name: reply.json.name || cleanHost,
      alias: `Node ${index}`,
      host: cleanHost,
      port: Number(port) || 47_910,
      token: reply.json.token,
      index,
      pairedAt: nowIso(),
      lastSeen: nowIso(),
      gpu: reply.json.gpu || null,
      nodeVersion: compatibility.nodeVersion,
      protocol: compatibility.protocol,
      hubProtocol: compatibility.hubProtocol,
      features: compatibility.features,
    };
    this.nodes.push(node);
    this.save();
    return this.decorate(node);
  }

  remove(id) {
    const node = this.get(id);
    if (!node) return false;
    this.nodes = this.nodes.filter((item) => item.id !== node.id);
    this.status.delete(node.id);
    this.save();
    nodeRequest(node, "/api/unlink", { method: "POST" }).catch(() => undefined);
    return true;
  }

  async refresh(id) {
    const node = id ? this.get(id) : null;
    const targets = node ? [node] : this.nodes;
    await Promise.all(
      targets.map(async (item) => {
        try {
          const reply = await nodeRequest(item, "/api/status", {}, 8000);
          if (reply.ok && reply.json && !reply.json.error) {
            this.status.set(item.id, { online: true, status: reply.json, at: Date.now() });
            item.lastSeen = nowIso();
            if (reply.json.name) item.name = String(reply.json.name);
            if (reply.json.gpu?.name) item.gpu = reply.json.gpu.name;
            /* Keep the negotiated contract current without touching the
               Node's own files or version. */
            if (reply.json.nodeVersion) item.nodeVersion = String(reply.json.nodeVersion);
            if (Number.isInteger(Number(reply.json.protocol))) item.protocol = Number(reply.json.protocol);
            if (reply.json.hubProtocol && typeof reply.json.hubProtocol === "object") item.hubProtocol = reply.json.hubProtocol;
            if (Array.isArray(reply.json.features)) item.features = reply.json.features;
            return;
          }
          this.status.set(item.id, {
            online: false,
            error: reply.json?.error || `HTTP ${reply.status}`,
          });
        } catch (error) {
          this.status.set(item.id, { online: false, error: error?.message || "unreachable" });
        }
      })
    );
    if (!id) {
      /* Refresh happens every 8 s; only touch the disk when a record really
         changed, so the registry is not rewritten for a tick that saw nothing. */
      const signature = this.signature();
      if (signature !== this.savedSignature) {
        this.savedSignature = signature;
        this.save();
      }
    }
    return this.list();
  }

  statusOf(id) {
    return this.status.get(id) || null;
  }

  async action(idOrName, op, args = {}, timeoutMs = 120_000) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    this.assertCompatible(node);
    const reply = await nodeRequest(node, "/api/action", { method: "POST", body: JSON.stringify({ op, args }) }, timeoutMs);
    if (!reply.ok) throw new Error(reply.json?.error || `Node error (HTTP ${reply.status}).`);
    return reply.json;
  }

  /** Start a long job on a node, then poll its task until it ends. */
  async run(idOrName, command, { timeoutSec = 900, cwd } = {}) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    const started = await this.action(node.id, "run", { command, cwd });
    const taskId = started.taskId;
    if (!taskId) throw new Error("The node did not return a task id.");
    this.activeTasks.set(node.id, taskId);
    const deadline = Date.now() + timeoutSec * 1000;
    let last = null;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        last = await this.action(node.id, "task", { taskId });
        if (last?.task?.state === "done") return last.task;
        if (last?.task?.state === "failed") return last.task;
      }
      return { ...(last?.task || {}), state: "timeout", output: (last?.task?.output || "") + "\n[athena] stopped waiting after " + timeoutSec + "s" };
    } finally {
      if (this.activeTasks.get(node.id) === taskId) this.activeTasks.delete(node.id);
    }
  }

  /** Ask a node to stop the task it is currently running for us. */
  async cancelTask(idOrName) {
    const node = this.get(idOrName);
    if (!node) return { ok: false, error: "No such node." };
    const taskId = this.activeTasks.get(node.id);
    if (!taskId) return { ok: false, error: "That node is not running a task for us." };
    return this.action(node.id, "task-cancel", { taskId });
  }

  async tasks(idOrName) {
    return this.action(idOrName, "tasks", {});
  }

  /* ---- screen ---- */

  async screenInfo(idOrName) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    this.assertCompatible(node);
    const reply = await nodeRequest(node, "/api/screen/info", {}, 10_000);
    if (!reply.ok) throw new Error(reply.json?.error || `Node error (HTTP ${reply.status}).`);
    return reply.json;
  }

  /**
   * One JPEG of the machine's screen, straight from the node.
   *
   * Two phones watching the same PC used to open two node requests per frame.
   * Requests inside the same ~80 ms window share one frame, and the node-only
   * in-flight promise means a slow capture is never queued twice.
   */
  async screen(idOrName, options = {}) {
    return (await this.screenFrame(idOrName, options)).buffer;
  }

  /** A frame plus the separate capture/node/browser measurements the UI shows. */
  async screenFrame(idOrName, { fps = 10, width = 0 } = {}) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    this.assertCompatible(node);
    const wantedFps = Math.max(1, Math.min(30, Math.round(Number(fps) || 10)));
    const cached = this.screenCache.get(node.id);
    /* Two controllers watching the same PC share the latest delivered frame.
       The Node captures continuously while watched, so a request must never
       wait for another JPEG just to hand back the same picture. */
    if (cached && Date.now() - cached.at < 20 && cached.fps >= wantedFps) return cached;
    const pending = this.screenPending.get(node.id);
    if (pending && pending.fps >= wantedFps) return pending.promise;
    const query = new URLSearchParams({ fps: String(wantedFps) });
    if (Number(width) > 0) query.set("width", String(Math.round(Number(width))));
    const entry = { fps: wantedFps };
    entry.promise = (async () => {
      const started = Date.now();
      const res = await nodeFetch(node, `/api/screen?${query}`, {}, 25_000);
      const nodeMs = Date.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = `Screen HTTP ${res.status}`;
        try {
          message = JSON.parse(text).error || message;
        } catch {
          /* not json */
        }
        throw new Error(message);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        at: Date.now(),
        fps: wantedFps,
        buffer,
        metrics: {
          nodeMs,
          captureFps: Number(res.headers.get("x-athena-capture-fps")) || 0,
          captureMs: Number(res.headers.get("x-athena-capture-ms")) || 0,
          frameAgeMs: Number(res.headers.get("x-athena-frame-age-ms")) || 0,
        },
      };
    })();
    this.screenPending.set(node.id, entry);
    try {
      const frame = await entry.promise;
      this.screenCache.set(node.id, frame);
      return frame;
    } finally {
      if (this.screenPending.get(node.id) === entry) this.screenPending.delete(node.id);
    }
  }

  /** Move the real mouse / press real keys on a machine. */
  async input(idOrName, payload = {}) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    this.assertCompatible(node);
    const reply = await nodeRequest(node, "/api/input", { method: "POST", body: JSON.stringify(payload) }, 20_000);
    if (!reply.ok) throw new Error(reply.json?.error || `Node error (HTTP ${reply.status}).`);
    return reply.json.result ?? reply.json;
  }

  /* ---- sound + apps ---- */

  async audioDevices(idOrName) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    this.assertCompatible(node);
    const reply = await nodeRequest(node, "/api/audio/devices", {}, 25_000);
    if (!reply.ok) throw new Error(reply.json?.error || `Node error (HTTP ${reply.status}).`);
    return reply.json;
  }

  /** Every installable app on a machine and whether it is there / running. */
  async apps(idOrName) {
    return this.action(idOrName, "apps", {}, 60_000);
  }
}
