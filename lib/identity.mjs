import os from "node:os";
import { VERSION } from "./version.mjs";
import { lanAddresses } from "./discover.mjs";

/**
 * ATHENA's self-knowledge.
 *
 * The model used to guess at this: it has no way to know the hub's build
 * number, which provider is wired up, or that it is not the software. These
 * facts are collected once per request from real state and handed to the model,
 * and the common questions are answered here directly — fast, accurate, and
 * without inventing anything when a value is genuinely unavailable.
 */

const NAME = "ATHENA";

function platformLabel() {
  const name = { win32: "Windows", darwin: "macOS", linux: "Linux" }[os.platform()] || os.platform();
  return `${name} ${os.release()}`;
}

export function softwareFacts({ config = {}, startedAt = null } = {}) {
  return {
    name: NAME,
    version: VERSION,
    hubName: String(config.hubName || os.hostname() || "athena"),
    platform: platformLabel(),
    port: config.port ?? null,
    addresses: lanAddresses().map((item) => item.address),
    startedAt,
  };
}

export function brainFacts(brain = {}) {
  const provider = String(brain.provider || "none").toLowerCase();
  return {
    ready: Boolean(brain.ready),
    provider,
    model: brain.model || null,
    requested: brain.requested || null,
    local: provider === "ollama",
    tools: brain.tools !== false,
    installedModels: Array.isArray(brain.models) ? brain.models : [],
    detail: String(brain.detail || ""),
  };
}

export function nodeFacts(nodes = []) {
  return nodes.map((node) => {
    const status = node.status || {};
    const hw = status.hardware || {};
    const memory = hw.memory || status.memory || {};
    const gpu = hw.gpu || status.gpu || {};
    return {
      name: node.name,
      online: Boolean(node.online),
      localToHub: Boolean(node.localToHub),
      platform: hw.os ? `${hw.os.type || "Windows"} ${hw.os.release || ""}`.trim() : status.platform || null,
      address: node.host ? `${node.host}:${node.port}` : null,
      cpu: hw.cpu?.model || status.cpu || null,
      cpuUtilizationPct: hw.cpu?.utilizationPct ?? null,
      installedRamGb: memory.installedGb ?? null,
      usableRamGb: memory.totalGb ?? null,
      availableRamGb: memory.freeGb ?? null,
      gpu: gpu.name || null,
      vramGb: gpu.vramGb ?? null,
      vramAvailableGb: gpu.availableGb ?? null,
      installedApps: hw.installedApps?.count ?? null,
      disks: Array.isArray(hw.disks)
        ? hw.disks.map((disk) => ({ id: disk.id, totalGb: disk.totalGb ?? null, freeGb: disk.freeGb ?? null }))
        : null,
      displays: Array.isArray(hw.displays)
        ? hw.displays.map((display) => ({ width: display.width ?? null, height: display.height ?? null, refreshHz: display.refreshHz ?? null }))
        : null,
      audio: hw.audio
        ? { inputs: hw.audio.inputs?.length ?? 0, outputs: hw.audio.outputs?.length ?? 0 }
        : null,
      runningServices: Object.entries(status.services || {})
        .filter(([, service]) => service && (service.ok || service.running))
        .map(([id]) => id),
      runningTasks: (status.tasks || []).filter((task) => task.state === "running").length,
      error: node.error || null,
    };
  });
}

export function identityFacts({ config = {}, brain = {}, nodes = [], startedAt = null } = {}) {
  return {
    software: softwareFacts({ config, startedAt }),
    brain: brainFacts(brain),
    nodes: nodeFacts(nodes),
  };
}

/** "ollama · qwen2.5:7b (local model on this hub)" or an honest not-available line. */
export function describeBrain(brain) {
  if (!brain) return "no brain information available";
  if (brain.provider === "off") return "switched off";
  if (!brain.ready) return "no AI model is configured — built-in commands only";
  if (!brain.model) return `${brain.provider} (the provider did not report a model name)`;
  return `${brain.provider} · ${brain.model}${brain.local ? " (local model)" : " (remote provider)"}`;
}

function machineLine(node) {
  if (!node.online) return `· ${node.name} — offline${node.error ? ` (${node.error})` : ""}`;
  const bits = [`· ${node.name}${node.localToHub ? " (this Hub PC)" : ""} — online`];
  if (node.cpu) bits.push(node.cpu);
  if (node.availableRamGb != null && node.usableRamGb != null) bits.push(`RAM ${node.availableRamGb}/${node.usableRamGb}GB free`);
  else if (node.usableRamGb != null) bits.push(`RAM ${node.usableRamGb}GB usable`);
  if (node.gpu) bits.push(`${node.gpu}${node.vramGb ? ` ${node.vramGb}GB VRAM` : ""}${node.vramAvailableGb != null ? `, ${node.vramAvailableGb}GB free` : ""}`);
  if (node.installedApps != null) bits.push(`${node.installedApps} apps`);
  if (node.platform) bits.push(node.platform);
  if (node.address) bits.push(node.address);
  if (node.runningServices.length) bits.push(`services: ${node.runningServices.join(", ")}`);
  if (node.runningTasks) bits.push(`${node.runningTasks} task running`);
  return bits.join(" · ");
}

/** The block the model sees. Facts only — no guesses about the model itself. */
export function identityBlock(facts) {
  const { software, brain, nodes } = facts;
  const online = nodes.filter((node) => node.online).length;
  const models = brain.installedModels.length ? ` Installed models: ${brain.installedModels.join(", ")}.` : "";
  return [
    "IDENTITY (these are facts from the hub's own state; never contradict them):",
    `- You are ${software.name}, software version ${software.version}, running on the hub machine "${software.hubName}" (${software.platform}).`,
    `- Your brain is: ${describeBrain(brain)}.${models}`,
    ...(brain.ready && brain.requested && brain.model && brain.requested !== brain.model
      ? [`- The configured model "${brain.requested}" is not installed; you are running "${brain.model}". Say so plainly if asked which model is active.`]
      : []),
    `- The software version (${software.version}) and the model name are different things. The model has no ATHENA version number.`,
    `- Hub address: http://${software.addresses[0] || "127.0.0.1"}:${software.port ?? "?"}`,
    `- Machines linked: ${nodes.length}, online: ${online}.${nodes.length ? "\n" + nodes.map(machineLine).join("\n") : ""}`,
    "- Installed software and running services are per machine; use a tool to read them. Do not assume a program exists because it is in the catalogue.",
    "- A screenshot shows pixels, not a process list. To answer what is running, use the processes tool.",
    "- If something is not in these facts and no tool returns it, say it is unknown. Never invent a version, model, path, or result.",
  ].join("\n");
}

/* ---------------------------------------------------------------- intents */

const RE = {
  version: /\bwhat\s+(software\s+)?version\s+(are|is)\s+(you|athena)\b|\bwhich\s+(software\s+)?version\s+(are|is)\s+(you|athena)\b|\bathena('s)?\s+version\b|\byour\s+(software\s+)?version\b|\bwhich\s+build\s+(are|is)\s+(you|athena)\b|\bwhat\s+build\s+(are|is)\s+(you|athena)\b/i,
  identity: /^(who|what) are you\b(?!\s+(?:doing|working|running|up to|on|using|waiting|good|ok)\b)|\bwho is athena\b|^what is athena\b|^explain (yourself|athena)\b|^tell me about (yourself|athena)\b/i,
  brain: /\b(what|which)\s+(brain|model|ai|llm)\b|\bwhat (brain|model) (are|is) (you|it) using\b|\bwhat (are|is) (you|it) using\b|\bwhich provider\b|\bare you (chatgpt|gpt|claude|gemini|openai|llama)\b|\bwhat ai are you\b/i,
  hub: /\b(which|what) (pc|machine|computer) (is|runs) the hub\b|\bwhere (is|does) the hub (run|live)\b|\bhub (machine|pc|computer)\b|\bwhat is the hub\b/i,
  machines: /\b(which|what) (machines|nodes|pcs|computers) (are|is) (connected|linked|online)\b|\blist (the )?(machines|nodes|network)\b|\bhow many (machines|nodes)\b|\bwhat machines (do you|can you) (control|see)\b/i,
  running: /\bwhat('s| is| are)\s+(running|open)\s+(on|in)\s+(this|the|my|that)\s+(pc|machine|computer|node)\b|\bwhat\s+(processes|programs)\s+(are|is)\s+running\b|\bwhat('s| is) open on\b/i,
  changed: /^(what|what's|whats)\s+(changed|happened|did you (just )?do|was that)\b|^what (just )?happened\b|^and (now|then)\?*$/i,
};

/** Only these questions are answered without a model. Anything else falls through. */
export function quickIntent(text) {
  const clean = String(text || "").trim();
  if (clean.length > 160) return null;
  for (const [intent, pattern] of Object.entries(RE)) {
    if (pattern.test(clean)) return intent;
  }
  return null;
}

function oneLine(text, limit = 400) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? clean.slice(0, limit - 1) + "…" : clean;
}

export function brainLine(facts) {
  const { brain, software } = facts;
  if (brain.provider === "off") return `The brain is switched off. ${software.name} itself is v${software.version}.`;
  if (!brain.ready) {
    return `No AI model is configured, so I am running on built-in commands. ${software.name} itself is v${software.version}.`;
  }
  const model = brain.model || "a model the provider did not name";
  const where = brain.local ? "local, on this hub" : "through a remote provider";
  const extra = brain.installedModels.length > 1 ? ` ${brain.installedModels.length} models are installed on this hub.` : "";
  return `Brain: ${brain.provider} · ${model}, ${where}.${extra} That model is not ${software.name} — the software is v${software.version}.`;
}

/**
 * Answers the identity/status questions from facts. Returns null when the
 * question needs something only a tool or the model can provide.
 */
export async function answerQuick(intent, { text = "", facts, history = [], listProcesses = null } = {}) {
  if (!intent || !facts) return null;
  const { software, brain, nodes } = facts;
  const online = nodes.filter((node) => node.online);

  if (intent === "version") {
    const modelPart = brain.ready
      ? `The AI model behind it is separate: ${describeBrain(brain)}.`
      : brain.provider === "off"
        ? "The brain is switched off, so no model is running."
        : "No AI model is configured — I am on built-in commands.";
    return `ATHENA software v${software.version}, running on the hub "${software.hubName}" (${software.platform}). ${modelPart}`;
  }

  if (intent === "identity") {
    const machineText = nodes.length
      ? `I am linked to ${nodes.length} machine${nodes.length === 1 ? "" : "s"} (${online.length} online): ${nodes.map((node) => node.name).join(", ")}.`
      : "No machines are linked yet.";
    return [
      `I am ATHENA v${software.version} — software running on the hub machine "${software.hubName}" (${software.platform}).`,
      `My brain is ${describeBrain(brain)}.`,
      machineText,
      `ATHENA and the model are separate: v${software.version} is my software build, not the model's version.`,
    ].join(" ");
  }

  if (intent === "brain") return brainLine(facts);

  if (intent === "hub") {
    const address = software.addresses.length ? `http://${software.addresses[0]}:${software.port}` : `http://127.0.0.1:${software.port}`;
    return `The hub is "${software.hubName}" — this machine, running ${software.platform}, reachable at ${address}. It holds ATHENA v${software.version} and its brain (${describeBrain(brain)}).`;
  }

  if (intent === "machines") {
    if (!nodes.length) return "No machines are linked yet. Start a node agent on a PC, then scan for it.";
    return `${nodes.length} machine${nodes.length === 1 ? "" : "s"} linked, ${online.length} online:\n${nodes.map(machineLine).join("\n")}`;
  }

  if (intent === "changed") {
    const said = [...history].reverse().find((item) => item?.role === "assistant" && String(item.content || "").trim());
    if (!said) return "Nothing has happened yet in this conversation. Ask me to do something and I can tell you what changed.";
    return `Last thing I reported: ${oneLine(said.content)}`;
  }

  if (intent === "running") {
    const lower = String(text || "").toLowerCase();
    const target = nodes.find((node) => lower.includes(node.name.toLowerCase())) || online[0] || null;
    if (!nodes.length) return "No machines are linked yet.";
    if (!target) return "None of the linked machines is answering, so I cannot read its processes.";
    if (!listProcesses) return `I can read processes on ${target.name} only through a tool, which is not available right now.`;
    try {
      const result = await listProcesses(target.name);
      const processes = Array.isArray(result?.processes) ? result.processes : [];
      const services = result?.services && typeof result.services === "object" ? result.services : {};
      const runningServices = Object.entries(services)
        .filter(([, value]) => value && value.ok)
        .map(([id]) => id);
      if (!processes.length) {
        return `I could read no processes on ${target.name} — the machine answered but reported an empty list.`;
      }
      const lines = processes
        .slice(0, 8)
        .map((process) => `· ${process.name} · ${Math.round((process.memMb || 0))} MB${process.pid ? ` · pid ${process.pid}` : ""}`);
      return [
        `${target.name} — ${result.total ?? processes.length} processes readable, top by memory:`,
        ...lines,
        runningServices.length ? `Services ATHENA manages, running: ${runningServices.join(", ")}.` : "No service ATHENA manages is running.",
      ].join("\n");
    } catch (error) {
      return `Could not read processes on ${target.name}: ${String(error?.message || error)}`;
    }
  }

  return null;
}
