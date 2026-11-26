import test from "node:test";
import assert from "node:assert/strict";
import { ask } from "../lib/brain.mjs";

const config = { hubName: "athena", port: 4790, brain: { provider: "off" } };

function registryWith(nodes) {
  const statuses = new Map(nodes.map((node) => [node.id, { status: node.status, online: node.online, at: Date.now() }]));
  return {
    nodes,
    list: () => nodes,
    statusOf: (id) => statuses.get(id) || null,
    refresh: async () => nodes,
  };
}

const local = {
  id: "node_local",
  name: "HubRig",
  online: true,
  localToHub: true,
  host: "127.0.0.1",
  port: 47910,
  status: {
    hardware: {
      cpu: { model: "AMD Ryzen 9 7950X", cores: 16, utilizationPct: 21 },
      memory: { installedGb: 64, totalGb: 63.1, freeGb: 41.2, availablePct: 65 },
      gpu: { name: "NVIDIA RTX 4080", vramGb: 16, availableGb: 12.4, availablePct: 77, util: 18, temp: 51 },
      disks: [{ id: "C:", totalGb: 953.9, freeGb: 401.2 }],
      displays: [{ width: 2560, height: 1440, refreshHz: 165, primary: true }],
      audio: { inputs: ["Microphone (USB)"], outputs: ["Speakers (Realtek)"], captureReady: true },
      installedApps: { count: 87, sample: ["Google Chrome", "7-Zip"] },
      os: { type: "Windows_NT", release: "10.0.26100", arch: "x64" },
    },
  },
};

const second = {
  id: "node_second",
  name: "RenderBox",
  online: true,
  localToHub: false,
  host: "192.168.1.20",
  port: 47910,
  status: {
    hardware: {
      memory: { installedGb: 32, totalGb: 31.8, freeGb: 6.1, availablePct: 19 },
      gpu: { name: "NVIDIA RTX 3060", vramGb: 12, availableGb: 2.2, availablePct: 18 },
    },
  },
};

test("a specifications request reports installed, usable and available separately", async () => {
  const answer = await ask({ text: "Show me the specifications of this PC", config, registry: registryWith([local]), history: [] });
  assert.equal(answer.meta.path, "hardware");
  assert.match(answer.reply, /AMD Ryzen 9 7950X/);
  assert.match(answer.reply, /installed 64 GB/);
  assert.match(answer.reply, /usable 63\.1 GB/);
  assert.match(answer.reply, /available 41\.2 GB/);
  assert.match(answer.reply, /16 GB VRAM/);
  assert.match(answer.reply, /12\.4 GB available/);
  assert.equal(answer.actions[0].name, "node_status");
});

test("a missing measurement is reported as unavailable, never zero", async () => {
  const sparse = {
    ...local,
    status: { hardware: { memory: { installedGb: null, totalGb: null, freeGb: null }, gpu: null } },
  };
  const answer = await ask({ text: "what are my PC specs", config, registry: registryWith([sparse]), history: [] });
  assert.match(answer.reply, /unavailable/);
  assert.doesNotMatch(answer.reply, /0 GB/);
});

test("the most-available-RAM question compares measured online Nodes", async () => {
  const answer = await ask({ text: "Which Node has the most available RAM?", config, registry: registryWith([local, second]), history: [] });
  assert.match(answer.reply, /HubRig/);
  assert.match(answer.reply, /41\.2 GB free/);
  assert.doesNotMatch(answer.reply, /RenderBox has the most/);
});

test("a controller can read hardware but this path executes no privileged action", async () => {
  const answer = await ask({ text: "show the gpu status", config, registry: registryWith([local]), history: [], admin: null });
  assert.equal(answer.actions[0].ok, true);
  assert.equal(answer.actions[0].name, "node_status");
  assert.doesNotMatch(answer.actions[0].name, /run_command|exec|shutdown/);
});

test("the no-model path opens an app on the Node the sentence names", async () => {
  const calls = [];
  const registry = registryWith([local, second]);
  registry.action = async (id, op, args) => {
    calls.push({ id, op, args });
    return { ok: true, opened: "notepad.exe" };
  };
  const answer = await ask({ text: "open notepad on RenderBox", config, registry, history: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "node_second", "the named machine is the target, not the Hub PC");
  assert.equal(calls[0].op, "open");
  assert.equal(calls[0].args.app, "notepad");
  assert.match(answer.reply, /RenderBox/);
  assert.equal(answer.actions[0].ok, true);
});
