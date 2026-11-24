import os from "node:os";
import crypto from "node:crypto";

/**
 * Small, dependency-free security primitives shared by the hub and the node.
 *
 * The rules here are deliberately fail-closed:
 *   - a request whose Host header is not this machine is refused
 *   - a browser request from any other origin is refused
 *   - CORS is never a wildcard
 *   - request bodies are bounded and must be valid JSON
 *   - long-lived session tokens are not accepted in URLs
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function isLoopback(req) {
  const raw = req.socket?.remoteAddress || "";
  return raw === "127.0.0.1" || raw === "::1" || raw === "::ffff:127.0.0.1";
}

function hostnameOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(":")[0];
}

/** Every name this process should answer to. Nothing else is a valid Host. */
export function allowedHostnames() {
  const names = new Set(["localhost", "127.0.0.1", "::1"]);
  const host = os.hostname().toLowerCase().replace(/\.local$/, "");
  names.add(host);
  names.add(`${host}.local`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) names.add(item.address);
    }
  }
  for (const extra of String(process.env.ATHENA_ALLOWED_HOSTS || "").split(",")) {
    const clean = extra.trim().toLowerCase();
    if (clean) names.add(clean);
  }
  return names;
}

export function hostAllowed(req) {
  const host = hostnameOf(req.headers.host);
  return Boolean(host) && allowedHostnames().has(host);
}

export function originAllowed(req, origin) {
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return allowedHostnames().has(hostnameOf(parsed.host));
}

/**
 * Same-origin CORS. No wildcard, ever: a foreign page cannot read a response,
 * and cannot preflight a custom header through us.
 */
export function corsHeadersFor(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return {};
  if (!originAllowed(req, origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type,authorization,x-athena-key,x-athena-session,x-athena-local,x-athena-panel",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

export function applyCors(req, res) {
  for (const [name, value] of Object.entries(corsHeadersFor(req))) res.setHeader(name, value);
}

/** Reads a bounded JSON body; malformed input is a 400, not an empty object. */
export async function readJsonBody(req, { limit = 512 * 1024 } = {}) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "Request body is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new HttpError(400, "Body must be a JSON object.");
  }
}

/**
 * Single-purpose, expiring tickets for transports that cannot send a header
 * (EventSource, <audio src>). They are scoped to streaming routes and are not
 * session tokens: revoking the session does not revoke a running stream, but a
 * ticket cannot be used for anything else.
 */
export class StreamTickets {
  constructor({ ttlMs = 6 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.tickets = new Map();
  }

  issue(scope = "stream") {
    const ticket = "st_" + crypto.randomBytes(18).toString("hex");
    this.tickets.set(ticket, { scope, expires: Date.now() + this.ttlMs });
    return { ticket, expiresInSec: Math.round(this.ttlMs / 1000) };
  }

  valid(ticket, scope = "stream") {
    const found = this.tickets.get(String(ticket || ""));
    if (!found) return false;
    if (found.expires < Date.now()) {
      this.tickets.delete(String(ticket));
      return false;
    }
    return found.scope === scope;
  }

  prune() {
    const now = Date.now();
    for (const [ticket, found] of this.tickets) if (found.expires < now) this.tickets.delete(ticket);
  }
}

/** Remove known secrets from text before it is logged, returned or broadcast. */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    const value = String(secret || "").trim();
    if (value.length < 4) continue;
    out = out.split(value).join("[redacted]");
    if (value.toUpperCase() !== value) out = out.split(value.toUpperCase()).join("[redacted]");
  }
  return out;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
