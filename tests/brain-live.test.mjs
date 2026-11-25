import test from "node:test";
import assert from "node:assert/strict";
import { ask } from "../lib/brain.mjs";

/*
 * REAL MODEL TESTS. These are opt-in because they need a running local
 * provider and take seconds to minutes. They are not part of the default
 * `npm test` pass; with no ATHENA_LIVE_MODEL set every test skips.
 *
 *   ATHENA_LIVE_MODEL=qwen2.5:7b npm run test:live
 *
 * The fake node registry is deliberate: this proves model behaviour and the
 * Hub tool loop against real inference, without requiring a second PC.
 */
const LIVE_MODEL = process.env.ATHENA_LIVE_MODEL || "";
const OLLAMA = process.env.ATHENA_LIVE_BASE || "http://127.0.0.1:11434";
const options = { skip: LIVE_MODEL ? false : "set ATHENA_LIVE_MODEL to a local model to run", timeout: 180_000 };

const config = {
  hubName: "athena-test",
  port: 4790,
  brain: { provider: "ollama", model: LIVE_MODEL, baseUrl: OLLAMA, apiKey: "" },
};

const node = {
  id: "live_node",
  name: "Rig",
  online: true,
  status: {
    platform: "Windows 11",
    cpu: "Test CPU",
    cores: 8,
    load: 0.15,
    memory: { totalGb: 32, freeGb: 18 },
    gpu: { name: "RTX 3060", vramGb: 12, util: 12, temp: 41 },
    services: {},
    tasks: [],
    uptimeSec: 3600,
  },
};

function registry() {
  return {
    list: () => [node],
    get: (ref) => (String(ref).toLowerCase() === "rig" || ref === node.id ? node : null),
    refresh: async () => undefined,
    statusOf: () => ({ status: node.status }),
    action: async () => ({ ok: true }),
    run: async () => ({ state: "done", code: 0, output: "ok" }),
  };
}

test("a real local model answers a capability question without tools", options, async () => {
  const answer = await ask({
    text: "What can you do? Answer in two short sentences.",
    config,
    registry: registry(),
    history: [],
  });
  assert.equal(answer.provider, "ollama");
  assert.equal(answer.model, LIVE_MODEL);
  assert.ok(answer.reply.length > 20, `reply was too short: ${answer.reply}`);
  assert.equal(answer.actions.length, 0, "a capability question must not act on a machine");
  assert.match(answer.reply, /computer|machine|command|screen|app|help|chat/i);
});

test("a real local model reads a machine value and does not invent it", options, async () => {
  const answer = await ask({
    text: "How much RAM does Rig have?",
    config,
    registry: registry(),
    history: [],
  });
  assert.equal(answer.provider, "ollama");
  assert.ok(answer.actions.length > 0, "the model must inspect the machine before answering");
  assert.match(answer.actions[0].name, /^(list_nodes|node_status)$/);
  assert.match(answer.reply, /32\s*GB|32GB/i, `answer did not contain the real value: ${answer.reply}`);
});
