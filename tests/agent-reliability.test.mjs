import test from "node:test";
import assert from "node:assert/strict";
import { ask } from "../lib/brain.mjs";

/*
 * These are the exact field failures reported before v0.1. They run without a
 * model on purpose: obvious computer requests must not depend on one.
 */

const config = { hubName: "athena", port: 4790, brain: { provider: "off" } };

const nodes = [
  { id: "node_1", name: "Hub PC", alias: "Node 1", index: 1, online: true, localToHub: true, status: { platform: "Windows 11", memory: { totalGb: 32, freeGb: 20 }, services: {}, tasks: [] } },
  { id: "node_2", name: "Rig", alias: "Node 2", index: 2, online: true, localToHub: false, status: { platform: "Windows 11", cpu: "Ryzen 7", memory: { totalGb: 64, freeGb: 48 }, gpu: { name: "RTX 4070", vramGb: 12 }, services: {}, tasks: [] } },
];

function registry(overrides = {}) {
  const calls = [];
  return {
    calls,
    list: () => nodes,
    get: (ref) => {
      const key = String(ref || "").toLowerCase();
      const numbered = key.match(/^node\s*(\d+)$/);
      if (numbered) return nodes.find((node) => node.index === Number(numbered[1])) || null;
      return nodes.find((node) => node.id === ref || node.name.toLowerCase() === key || node.alias.toLowerCase() === key) || null;
    },
    refresh: async () => undefined,
    statusOf: (id) => ({ status: nodes.find((node) => node.id === id)?.status }),
    screen: async (ref) => {
      calls.push({ op: "screen", ref });
      return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    },
    screenInfo: async () => ({ frame: { width: 1920, height: 1080 } }),
    action: async (id, op, args) => {
      calls.push({ id, op, args });
      return overrides.action ? overrides.action(id, op, args) : { ok: true };
    },
    run: async () => ({ state: "done", code: 0, output: "" }),
  };
}

test("'How many nodes are connected?' is answered from the registry", async () => {
  const answer = await ask({ text: "How many nodes are connected?", config, registry: registry(), history: [] });
  assert.match(answer.reply, /2 machines linked, 2 online/i);
  assert.match(answer.reply, /Node 2/);
  assert.equal(answer.actions.length, 0);
});

test("'Take a screenshot of Node 2' really captures Node 2 and returns an image", async () => {
  const reg = registry();
  const answer = await ask({ text: "Take a screenshot of Node 2.", config, registry: reg, history: [] });
  assert.equal(reg.calls[0].op, "screen");
  assert.equal(reg.calls[0].ref, "node_2", "the registry alias resolves to the real node id");
  assert.equal(answer.images.length, 1);
  assert.match(answer.images[0].url, /^data:image\/jpeg;base64,/);
  assert.match(answer.reply, /Screenshot captured from Node 2/i);
  assert.equal(answer.actions[0].ok, true);
});

test("'List open windows on Node 2' reads real windows and names them", async () => {
  const answer = await ask({
    text: "List open windows on Node 2.",
    config,
    registry: registry({
      action: (id, op) => {
        assert.equal(id, "node_2");
        assert.equal(op, "windows");
        return {
          ok: true,
          windows: [
            { process: "chrome", title: "YouTube — Google Chrome", foreground: true },
            { process: "notepad", title: "notes.txt", foreground: false },
          ],
        };
      },
    }),
    history: [],
  });
  assert.match(answer.reply, /2 visible windows/i);
  assert.match(answer.reply, /YouTube/);
  assert.equal(answer.actions[0].ok, true);
});

test("'Open Calculator on Node 2' only reports success after process and window verification", async () => {
  const answer = await ask({
    text: "Open Calculator on Node 2.",
    config,
    registry: registry({
      action: (id, op, args) => {
        assert.equal(id, "node_2");
        assert.equal(op, "open");
        assert.equal(args.app, "Calculator");
        return {
          ok: true,
          opened: "calc.exe",
          verified: "process+window",
          window: { available: true, created: true, visible: true, title: "Calculator" },
        };
      },
    }),
    history: [],
  });
  assert.match(answer.reply, /Calculator is open on Node 2/i);
  assert.match(answer.reply, /window visible/i);
  assert.equal(answer.actions[0].ok, true);
});

test("a launch without a visible window is partial, not a success claim", async () => {
  const answer = await ask({
    text: "Open Calculator on Node 2.",
    config,
    registry: registry({
      action: () => ({ ok: true, opened: "calc.exe", verified: "process", window: { available: true, created: true, visible: false } }),
    }),
    history: [],
  });
  assert.match(answer.reply, /did not show a visible window/i);
  assert.doesNotMatch(answer.reply, /Calculator is open/i);
  assert.equal(answer.actions[0].ok, false);
});

test("opening on an offline node is refused, not described as done", async () => {
  const offline = { ...nodes[1], online: false };
  const answer = await ask({
    text: "Open Calculator on Node 2.",
    config,
    registry: {
      ...registry(),
      list: () => [nodes[0], offline],
      get: () => offline,
      statusOf: () => null,
    },
    history: [],
  });
  assert.match(answer.reply, /Node 2 is offline/i);
  assert.match(answer.reply, /was not opened/i);
  assert.equal(answer.actions[0].ok, false);
});

test("a node permission refusal becomes an honest screenshot failure", async () => {
  const answer = await ask({
    text: "Take a screenshot of Node 2.",
    config,
    registry: {
      ...registry(),
      screen: async () => {
        throw new Error("Screen and window inspection is switched off on this node (PERMISSIONS → Allow screen inspection).");
      },
    },
    history: [],
  });
  assert.match(answer.reply, /could not take a screenshot/i);
  assert.match(answer.reply, /switched off/i);
  assert.equal(answer.images.length, 0);
  assert.equal(answer.actions[0].ok, false);
});

test("a provider timeout during ordinary conversation is honest and executes nothing", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("This operation was aborted");
    error.name = "TimeoutError";
    throw error;
  };
  try {
    const answer = await ask({
      text: "Explain why the sky is blue.",
      config: { hubName: "athena", port: 4790, brain: { provider: "openai", model: "gpt-4o-mini", apiKey: "test-key", baseUrl: "http://127.0.0.1:9/v1" } },
      registry: registry(),
      history: [],
    });
    assert.equal(answer.actions.length, 0);
    assert.match(answer.reply, /could not reach the brain/i);
    assert.match(answer.reply, /did not answer in time/i);
    assert.doesNotMatch(answer.reply, /done|opened|completed successfully/i);
  } finally {
    globalThis.fetch = real;
  }
});
