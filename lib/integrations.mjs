import { readJson, writeJson, id as newId, nowIso } from "./store.mjs";

/**
 * Integrations are applications that talk to ATHENA through their own API —
 * AI Clip Studio, a story maker, anything with an endpoint. They are not
 * software installed on a node and not jobs. Nothing about a particular app
 * is hardcoded here: an integration is a descriptor plus a live probe.
 */

const KINDS = new Set(["app", "api", "service"]);

function cleanUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("The address must be a full http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The address must be a full http(s) URL.");
  }
  return parsed.href;
}

export class Integrations {
  constructor(file) {
    this.file = file;
    const saved = readJson(file, { integrations: [] });
    this.items = Array.isArray(saved.integrations) ? saved.integrations : [];
  }

  save() {
    writeJson(this.file, { integrations: this.items });
  }

  /** Tokens never leave the hub; callers learn only whether one is stored. */
  view(item) {
    const { token, ...rest } = item;
    return { ...rest, hasToken: Boolean(token) };
  }

  list() {
    return this.items.map((item) => this.view(item));
  }

  get(idOrName) {
    const key = String(idOrName || "").toLowerCase();
    if (!key) return null;
    return (
      this.items.find((item) => item.id.toLowerCase() === key) ||
      this.items.find((item) => item.name.toLowerCase() === key) ||
      null
    );
  }

  add({ name, description = "", url = "", kind = "app", token = "", capabilities = [] } = {}) {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("Give the integration a name.");
    const type = String(kind || "app").toLowerCase();
    if (!KINDS.has(type)) throw new Error(`Unknown integration kind "${kind}".`);
    const entry = {
      id: newId("int"),
      name: clean.slice(0, 60),
      description: String(description || "").slice(0, 300),
      kind: type,
      url: cleanUrl(url),
      token: String(token || ""),
      capabilities: (Array.isArray(capabilities) ? capabilities : String(capabilities || "").split(","))
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 20),
      createdAt: nowIso(),
      lastProbe: null,
    };
    this.items.unshift(entry);
    this.save();
    return this.view(entry);
  }

  update(idOrName, patch = {}) {
    const item = this.get(idOrName);
    if (!item) return null;
    if (patch.name !== undefined) {
      const name = String(patch.name || "").trim();
      if (!name) throw new Error("Give the integration a name.");
      item.name = name.slice(0, 60);
    }
    if (patch.description !== undefined) item.description = String(patch.description || "").slice(0, 300);
    if (patch.kind !== undefined) {
      const kind = String(patch.kind || "").toLowerCase();
      if (!KINDS.has(kind)) throw new Error(`Unknown integration kind "${patch.kind}".`);
      item.kind = kind;
    }
    if (patch.url !== undefined) item.url = cleanUrl(patch.url);
    if (patch.token !== undefined) item.token = String(patch.token || "");
    if (patch.capabilities !== undefined) {
      const list = Array.isArray(patch.capabilities) ? patch.capabilities : String(patch.capabilities || "").split(",");
      item.capabilities = list.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 20);
    }
    this.save();
    return this.view(item);
  }

  remove(idOrName) {
    const item = this.get(idOrName);
    if (!item) return false;
    this.items = this.items.filter((entry) => entry.id !== item.id);
    this.save();
    return true;
  }

  /**
   * A real request, not a simulated status. When there is no URL the
   * integration is reported as unverified instead of "connected".
   */
  async probe(idOrName, { timeoutMs = 5000 } = {}) {
    const item = this.get(idOrName);
    if (!item) throw new Error("No such integration.");
    if (!item.url) {
      item.lastProbe = { ok: false, status: null, ms: 0, error: "No URL registered.", at: nowIso() };
      this.save();
      return this.view(item);
    }
    const started = Date.now();
    try {
      const res = await fetch(item.url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json, text/plain, */*",
          ...(item.token ? { authorization: `Bearer ${item.token}` } : {}),
        },
      });
      item.lastProbe = {
        ok: res.ok,
        status: res.status,
        ms: Date.now() - started,
        error: res.ok ? null : `HTTP ${res.status}`,
        at: nowIso(),
      };
    } catch (error) {
      item.lastProbe = {
        ok: false,
        status: null,
        ms: Date.now() - started,
        error: error?.name === "TimeoutError" ? "No answer before the timeout." : String(error?.message || error),
        at: nowIso(),
      };
    }
    this.save();
    return this.view(item);
  }
}
