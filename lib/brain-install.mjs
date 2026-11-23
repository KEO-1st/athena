/**
 * INSTALL BRAIN — the hub installs its own intelligence.
 *
 * One click: install Ollama if it is missing, work out what this machine can
 * carry, pull the biggest free model that fits, and point the hub at it.
 * UPGRADE BRAIN does the same search again and moves up the ladder only when
 * something better fits.
 *
 * Everything is a real local install: winget (or the official installer), then
 * `ollama pull`. No API keys, no cloud.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";

const OLLAMA_HOST = "http://127.0.0.1:11434";
const IS_WIN = process.platform === "win32";

/** Ordered by weight class. `minRamGb` is what the model actually needs free. */
export const BRAIN_LADDER = [
  { model: "qwen2.5:1.5b", minRamGb: 4, note: "tiny · fast · good for commands" },
  { model: "llama3.2:3b", minRamGb: 8, note: "small · solid conversation" },
  { model: "qwen3:4b", minRamGb: 8, note: "small · reasons before it answers" },
  { model: "qwen2.5:7b", minRamGb: 12, note: "the dependable default" },
  { model: "qwen3:8b", minRamGb: 14, note: "stronger reasoning, same footprint" },
  { model: "qwen2.5:14b", minRamGb: 20, note: "much better at multi-step work" },
  { model: "gemma3:12b", minRamGb: 24, note: "Google's open model, calmer tone" },
  { model: "qwen3:14b", minRamGb: 26, note: "best all-rounder under 32 GB" },
  { model: "qwen2.5:32b", minRamGb: 36, note: "near-frontier locally" },
  { model: "qwen3:32b", minRamGb: 40, note: "the top of the local ladder" },
];

/** Models that can look at a screenshot, so SEE SCREEN becomes real. */
export const VISION_LADDER = [
  { model: "qwen2.5vl:3b", minRamGb: 8 },
  { model: "qwen2.5vl:7b", minRamGb: 12 },
];

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          out: String(stdout || "").trim(),
          err: String(stderr || "").trim(),
        });
      }
    );
  });
}

function ollamaCandidates() {
  const list = [];
  if (IS_WIN) {
    list.push(
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ollama.exe"),
      "C:\\Program Files\\Ollama\\ollama.exe"
    );
  }
  list.push("ollama");
  return list.filter(Boolean);
}

/** The Ollama binary, once it exists anywhere normal. */
function findOllama() {
  for (const candidate of ollamaCandidates()) {
    if (candidate === "ollama") continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return "ollama";
}

async function ollamaUp() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(1800) });
    if (!res.ok) return null;
    const json = await res.json();
    return { ok: true, models: (json.models || []).map((m) => String(m.name)) };
  } catch {
    return null;
  }
}

function totalRamGb() {
  return Math.round(os.totalmem() / 1024 ** 3);
}

/** Best model this machine can carry, skipping anything already installed. */
export function pickBrain(ramGb, installed = []) {
  const have = new Set(installed.map((name) => name.replace(/:latest$/, "")));
  const fits = BRAIN_LADDER.filter((entry) => entry.minRamGb <= ramGb - 2);
  const missing = fits.filter((entry) => !have.has(entry.model));
  return missing[missing.length - 1] || null;
}

export function pickVision(ramGb, installed = []) {
  const have = new Set(installed.map((name) => name.replace(/:latest$/, "")));
  const fits = VISION_LADDER.filter((entry) => entry.minRamGb <= ramGb - 2 && !have.has(entry.model));
  return fits[fits.length - 1] || null;
}

export function createBrainInstaller({ getBrain, setBrain, onDone = () => undefined }) {
  const state = {
    state: "idle", // idle · running · done · failed
    action: null,
    step: "",
    progress: "",
    model: null,
    log: [],
    error: null,
    ramGb: totalRamGb(),
    startedAt: null,
    finishedAt: null,
  };

  const push = (line) => {
    state.log.push(`${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${line}`);
    if (state.log.length > 240) state.log.shift();
    state.step = line;
  };

  function spawnDetached(command, args) {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } catch {
      /* caller polls for the server instead */
    }
  }

  async function ensureOllama() {
    const up = await ollamaUp();
    if (up) return { ok: true, already: true };

    const bin = findOllama();
    const known = bin !== "ollama";
    if (known) {
      push("Ollama is installed but not answering. Starting it…");
      spawnDetached(bin, ["serve"]);
      if (await waitFor(ollamaUp, 45_000, 1500)) return { ok: true, already: true };
    }

    push("Installing Ollama — this downloads about 1 GB and can take a few minutes.");
    let installed = false;

    const winget = await run("winget", ["--version"], 20_000);
    if (winget.ok) {
      const result = await run(
        "winget",
        [
          "install",
          "--id",
          "Ollama.Ollama",
          "-e",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
        1_800_000
      );
      installed = result.ok;
      if (!result.ok) push(`winget could not install it (${(result.err || result.out).split("\n")[0] || "no output"}).`);
    } else {
      push("winget is not available here. Using the official installer instead.");
    }

    if (!installed) {
      if (!IS_WIN) throw new Error("Automatic brain install is Windows-only. Install Ollama yourself, then press INSTALL BRAIN again.");
      push("Downloading the official Ollama installer…");
      const script = [
        "$ProgressPreference='SilentlyContinue';",
        "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile \"$env:TEMP\\OllamaSetup.exe\";",
        "Start-Process -FilePath \"$env:TEMP\\OllamaSetup.exe\" -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait",
      ].join(" ");
      const result = await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], 1_800_000);
      if (!result.ok) throw new Error("Could not download the Ollama installer: " + (result.err || result.out).slice(0, 240));
    }

    push("Ollama installed. Waiting for its server…");
    const bin2 = findOllama();
    spawnDetached(bin2, ["serve"]);
    if (await waitFor(ollamaUp, 90_000, 2000)) return { ok: true, already: false };
    throw new Error("Ollama installed but its server never answered on 11434. Open Ollama once from the Start menu, then press INSTALL BRAIN again.");
  }

  function pull(model, timeoutMs = 3_600_000) {
    return new Promise((resolve) => {
      const bin = findOllama();
      push(`Pulling ${model} — this is the big download.`);
      const child = spawn(bin, ["pull", model], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let buffer = "";
      let err = "";
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* gone */
        }
        resolve({ ok: false, err: "timed out" });
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const parts = buffer.split(/[\r\n]+/).filter(Boolean);
        buffer = parts.join("\n").slice(-4000);
        const last = parts[parts.length - 1] || "";
        if (last) state.progress = last.trim().slice(0, 120);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, err: error.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, err });
      });
    });
  }

  async function install({ vision = false } = {}) {
    const ramGb = totalRamGb();
    state.ramGb = ramGb;
    push(`This hub has ${ramGb} GB of RAM.`);

    await ensureOllama();
    const up = await ollamaUp();
    if (!up) throw new Error("Ollama is not answering on 11434.");
    push(up.models.length ? `Ollama is up with ${up.models.length} model(s).` : "Ollama is up with no models yet.");

    const target = pickBrain(ramGb, up.models);
    if (!target) throw new Error("No model on the ladder fits this machine's memory.");
    push(`Best fit for this PC: ${target.model} (${target.note}).`);

    const result = await pull(target.model);
    if (!result.ok) throw new Error(`Could not pull ${target.model}: ${(result.err || "").slice(0, 200)}`);
    state.model = target.model;
    setBrain({ provider: "ollama", model: target.model, baseUrl: OLLAMA_HOST, apiKey: "" });
    push(`Brain is live: ${target.model}.`);

    if (vision) {
      const seen = await ollamaUp();
      const visionTarget = pickVision(ramGb, seen?.models || []);
      if (visionTarget) {
        const pulled = await pull(visionTarget.model);
        if (pulled.ok) push(`${visionTarget.model} installed — SEE SCREEN can now actually read a screen.`);
        else push(`${visionTarget.model} did not finish; you can pull it later.`);
      } else {
        push("Not enough memory for a vision model on this PC.");
      }
    }
  }

  async function upgrade() {
    const ramGb = totalRamGb();
    state.ramGb = ramGb;
    await ensureOllama();
    const up = await ollamaUp();
    if (!up) throw new Error("Ollama is not answering on 11434.");

    const current = getBrain()?.model || "";
    const target = pickBrain(ramGb, up.models);
    if (!target) {
      push(
        current
          ? `Already on the heaviest model this PC can carry (${current}). Nothing better fits.`
          : "Everything on the ladder is already installed."
      );
      state.model = current || null;
      return;
    }
    push(`Searching the ladder… ${target.model} is bigger and fits (${target.note}).`);
    const result = await pull(target.model);
    if (!result.ok) throw new Error(`Could not pull ${target.model}: ${(result.err || "").slice(0, 200)}`);
    state.model = target.model;
    setBrain({ provider: "ollama", model: target.model, baseUrl: OLLAMA_HOST, apiKey: "" });
    push(`Upgraded to ${target.model}.`);
  }

  async function work(action, options) {
    state.state = "running";
    state.action = action;
    state.error = null;
    state.progress = "";
    state.model = null;
    state.log = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    try {
      if (action === "upgrade") await upgrade();
      else await install(options);
      state.state = "done";
      push("Done.");
    } catch (error) {
      state.state = "failed";
      state.error = String(error?.message || error);
      push("Failed: " + state.error);
    } finally {
      state.finishedAt = new Date().toISOString();
      state.progress = "";
      onDone(state);
    }
  }

  return {
    status: () => ({ ...state, hardware: { ramGb: totalRamGb(), platform: `${os.type()} ${os.release()}` } }),
    start(action = "install", options = {}) {
      if (state.state === "running") return { ok: false, busy: true, state: this.status() };
      void work(action === "upgrade" ? "upgrade" : "install", options);
      return { ok: true, state: this.status() };
    },
  };
}

async function waitFor(fn, timeoutMs, everyMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return null;
}
