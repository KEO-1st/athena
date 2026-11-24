import test from "node:test";
import assert from "node:assert/strict";
import { answerQuick, quickIntent } from "../lib/identity.mjs";
import { ask, selectToolNames } from "../lib/brain.mjs";
import { VERSION } from "../lib/version.mjs";

const NODE = {
  id: "node_1",
  name: "Rig",
  online: true,
  host: "192.168.1.20",
  port: 47910,
  status: {
    platform: "Windows 11",
    gpu: { name: "RTX 3060", vramGb: 12 },
    services: { comfy: { ok: true }, ollama: { ok: false } },
    tasks: [],
  },
};

function fakeRegistry({ online = true } = {}) {
  return {
    list: () => [{ ...NODE, online }],
    statusOf: () => ({ status: NODE.status }),
    action: async () => ({
      ok: true,
      total: 140,
      processes: [
        { name: "chrome.exe", memMb: 1200, pid: 42 },
        { name: "explorer.exe", memMb: 210, pid: 7 },
      ],
      services: { comfy: { ok: true }, ollama: { ok: false } },
    }),
  };
}

const facts = {
  software: {
    name: "ATHENA",
    version: VERSION,
    hubName: "athena",
    platform: "Windows 11",
    port: 4790,
    addresses: ["192.168.1.10"],
    startedAt: null,
  },
  brain: {
    ready: true,
    provider: "ollama",
    model: "qwen2.5:7b",
    requested: null,
    local: true,
    tools: true,
    installedModels: ["qwen2.5:7b", "llama3.2:3b"],
    detail: "",
  },
  nodes: [
    {
      name: "Rig",
      online: true,
      platform: "Windows 11",
      address: "192.168.1.20:47910",
      gpu: "RTX 3060",
      vramGb: 12,
      runningServices: ["comfy"],
      runningTasks: 0,
      error: null,
    },
  ],
};

test("identity questions map to distinct intents", () => {
  assert.equal(quickIntent("what are you?"), "identity");
  assert.equal(quickIntent("what version are you"), "version");
  assert.equal(quickIntent("what brain are you using"), "brain");
  assert.equal(quickIntent("which pc is the hub"), "hub");
  assert.equal(quickIntent("what machines are connected"), "machines");
  assert.equal(quickIntent("what is running on this pc"), "running");
  assert.equal(quickIntent("what changed?"), "changed");
  assert.equal(quickIntent("open youtube in chrome"), null);
});

test("the software version is never presented as the model version", async () => {
  const version = await answerQuick("version", { text: "what version are you", facts });
  assert.match(version, new RegExp(`v${VERSION.replace(/\./g, "\\.")}`));
  assert.match(version, /qwen2\.5:7b/);
  assert.match(version, /separate/);

  const brain = await answerQuick("brain", { text: "what brain are you using", facts });
  assert.match(brain, /ollama · qwen2\.5:7b/);
  assert.match(brain, /local/);
  assert.match(brain, new RegExp(`v${VERSION.replace(/\./g, "\\.")}`));
});

test("a switched-off or missing brain is stated, not invented", async () => {
  const reply = await answerQuick("brain", {
    text: "what model are you",
    facts: { ...facts, brain: { ...facts.brain, ready: false, provider: "none", model: null } },
  });
  assert.match(reply, /No AI model is configured/i);
  assert.doesNotMatch(reply, /qwen/);
});

test("machines and the hub are reported from real facts", async () => {
  const machines = await answerQuick("machines", { text: "what machines are connected", facts });
  assert.match(machines, /Rig/);
  assert.match(machines, /192\.168\.1\.20:47910/);

  const hub = await answerQuick("hub", { text: "which pc is the hub", facts });
  assert.match(hub, /"athena"/);
  assert.match(hub, /192\.168\.1\.10:4790/);
});

test("\"what is running\" reads processes through a tool, not a guess", async () => {
  const reply = await answerQuick("running", {
    text: "what is running on this pc",
    facts,
    listProcesses: async () => ({
      processes: [{ name: "chrome.exe", memMb: 900 }],
      total: 99,
      services: { comfy: { ok: true } },
    }),
  });
  assert.match(reply, /chrome\.exe/);
  assert.match(reply, /99 processes/);

  const failed = await answerQuick("running", {
    text: "what is running on this pc",
    facts,
    listProcesses: async () => {
      throw new Error("node offline");
    },
  });
  assert.match(failed, /Could not read processes/);
  assert.match(failed, /node offline/);
});

test("ask answers identity questions without calling a model", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("a model must not be probed for an identity question");
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const config = { hubName: "athena", port: 4790, brain: { provider: "off" } };
  const answer = await ask({ text: "what version are you", config, registry: fakeRegistry(), history: [] });
  assert.equal(answer.meta.path, "identity:version");
  assert.equal(answer.meta.rounds, 0);
  assert.match(answer.reply, new RegExp(`v${VERSION.replace(/\./g, "\\.")}`));
  assert.ok(answer.meta.ms < 1000, `identity answer took ${answer.meta.ms}ms`);
});

test("a follow-up inherits the previous turn's tools", () => {
  assert.ok(selectToolNames("open it again", "open youtube in chrome").includes("node_action"));
  assert.ok(selectToolNames("what is running", "").includes("node_processes"));
  assert.ok(selectToolNames("screenshot the screen", "").includes("see_screen"));
});
