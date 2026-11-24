import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "version.json");

/** The one place ATHENA's version is written. Hub, node and service worker read it. */
export function readVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const version = String(parsed?.version || "").trim();
    return /^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(version) ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
