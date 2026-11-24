import path from "node:path";
import { writeJson, readJson, id as newId, nowIso } from "./store.mjs";
import { nodeRequest } from "./discover.mjs";

/**
 * The node registry: every machine ATHENA has paired with, its token and the
 * last status it reported. Tokens never leave the hub.
 */

export class Registry {
  constructor(file) {
    this.file = file;
    const saved = readJson(file, { nodes: [] });
    this.nodes = Array.isArray(saved.nodes) ? saved.nodes : [];
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
    return {
      id: node.id,
      name: node.name,
      host: node.host,
      port: node.port,
      index: node.index,
      pairedAt: node.pairedAt,
      lastSeen: node.lastSeen || null,
      online: Boolean(live?.online),
      status: live?.status || null,
      error: live?.error || null,
    };
  }

  get(idOrName) {
    const key = String(idOrName || "").toLowerCase();
    if (!key) return null;
    return (
      this.nodes.find((node) => node.id.toLowerCase() === key) ||
      this.nodes.find((node) => node.name.toLowerCase() === key) ||
      this.nodes.find((node) => node.name.toLowerCase().includes(key)) ||
      null
    );
  }

  async pair({ host, port, code, name }) {
    const cleanHost = String(host || "").trim();
    if (!cleanHost) throw new Error("No address for that machine.");
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
      this.save();
      return this.decorate(existing);
    }
    const node = {
      id: reply.json.id || newId("node"),
      name: reply.json.name || cleanHost,
      host: cleanHost,
      port: Number(port) || 47_910,
      token: reply.json.token,
      index: reply.json.index || this.nodes.length + 1,
      pairedAt: nowIso(),
      lastSeen: nowIso(),
      gpu: reply.json.gpu || null,
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
  async screen(idOrName) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    const cached = this.screenCache.get(node.id);
    if (cached && Date.now() - cached.at < 50) return cached.buffer;
    const pending = this.screenPending.get(node.id);
    if (pending) return pending;
    const request = (async () => {
      const res = await fetch(`http://${node.host}:${node.port}/api/screen`, {
        headers: { "x-athena-token": node.token || "" },
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
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
      return Buffer.from(await res.arrayBuffer());
    })();
    this.screenPending.set(node.id, request);
    try {
      const buffer = await request;
      this.screenCache.set(node.id, { at: Date.now(), buffer });
      return buffer;
    } finally {
      this.screenPending.delete(node.id);
    }
  }

  /** Move the real mouse / press real keys on a machine. */
  async input(idOrName, payload = {}) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    const reply = await nodeRequest(node, "/api/input", { method: "POST", body: JSON.stringify(payload) }, 20_000);
    if (!reply.ok) throw new Error(reply.json?.error || `Node error (HTTP ${reply.status}).`);
    return reply.json.result ?? reply.json;
  }

  /* ---- sound + apps ---- */

  async audioDevices(idOrName) {
    const node = this.get(idOrName);
    if (!node) throw new Error(`No node called "${idOrName}".`);
    const reply = await nodeRequest(node, "/api/audio/devices", {}, 25_000);
    if (!reply.ok) throw new Error(reply.json?.error || `Node error (HTTP ${reply.status}).`);
    return reply.json;
  }

  /** Every installable app on a machine and whether it is there / running. */
  async apps(idOrName) {
    return this.action(idOrName, "apps", {}, 60_000);
  }
}
