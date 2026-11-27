import fs from "node:fs";
import path from "node:path";

/**
 * API keys live in their own file, never in config.json.
 *
 * The Hub is a local, single-user service, so this is not a vault; it is a
 * deliberate separation so that state sent to the UI, copied logs, exports and
 * backups of settings cannot accidentally carry a working key. The file is
 * created with owner-only permissions where the platform supports it.
 */
export class Secrets {
  constructor(file) {
    this.file = file;
    this.data = this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return {
        providers: parsed && typeof parsed.providers === "object" && parsed.providers ? parsed.providers : {},
        tts: typeof parsed?.tts === "string" ? parsed.tts : "",
      };
    } catch {
      return { providers: {}, tts: "" };
    }
  }

  getProvider(id) {
    return String(this.data.providers[String(id || "").toLowerCase()] || "");
  }

  setProvider(id, key) {
    const clean = String(key || "").trim();
    const name = String(id || "").toLowerCase();
    if (!name) return;
    if (clean) this.data.providers[name] = clean;
    else delete this.data.providers[name];
    this.save();
  }

  getTts() {
    return String(this.data.tts || "");
  }

  setTts(key) {
    this.data.tts = String(key || "").trim();
    this.save();
  }

  /** Hydrate the in-memory config only; the caller strips keys before saving. */
  hydrate(brain, tts) {
    const providers = brain.providers && typeof brain.providers === "object" ? brain.providers : {};
    for (const id of Object.keys(this.data.providers)) {
      providers[id] = { ...(providers[id] || {}), apiKey: this.data.providers[id] };
    }
    brain.providers = providers;
    if (brain.provider === "auto") {
      brain.apiKey = this.getProvider("openai");
    } else {
      brain.apiKey = this.getProvider(brain.provider) || "";
    }
    if (tts) tts.apiKey = this.getTts();
  }

  save() {
    const dir = path.dirname(this.file);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* exists */
    }
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* Windows: the per-user profile ACL is the boundary */
    }
  }
}

/** A saved config must never contain a key, even if one was hydrated. */
export function withoutSecrets(config) {
  const copy = JSON.parse(JSON.stringify(config));
  if (copy.brain) {
    copy.brain.apiKey = "";
    if (copy.brain.providers) {
      for (const entry of Object.values(copy.brain.providers)) {
        if (entry && typeof entry === "object") delete entry.apiKey;
      }
    }
  }
  if (copy.tts) copy.tts.apiKey = "";
  return copy;
}
