import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function id(prefix = "id") {
  return prefix + "_" + crypto.randomBytes(5).toString("hex");
}

export function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function accessCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function nowIso() {
  return new Date().toISOString();
}

export function hostLabel() {
  return (os_hostname() || "athena").replace(/\.local$/i, "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function os_hostname() {
  try {
    return fs.existsSync("/proc/sys/kernel/hostname") ? fs.readFileSync("/proc/sys/kernel/hostname", "utf8").trim() : process.env.COMPUTERNAME || process.env.HOSTNAME || "athena";
  } catch {
    return "athena";
  }
}
