import test from "node:test";
import assert from "node:assert/strict";
import { ask } from "../lib/brain.mjs";
import { VERSION } from "../lib/version.mjs";

/* An OpenAI-compatible stub: it proves the tool loop without a real model. */
function stubBrain(responses) {
  const real = globalThis.fetch;
  let index = 0;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const message = (payload) => ({ choices: [{ message: { role: "assistant", content: "", ...payload } }] });

function toolCall(name, args) {
  return message({
    tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
}

const config = {
  hubName: "athena",
  port: 4790,
  brain: { provider: "openai", model: "gpt-4o-mini", apiKey: "test-key", baseUrl: "http://127.0.0.1:9/v1" },
};

const node = { id: "node_1", name: "Rig", online: true, status: { platform: "Windows 11" } };

function registryReturning(result) {
  return {
    list: () => [node],
    statusOf: () => ({ status: node.status }),
    action: async () => result,
    run: async () => ({ state: "done", output: "" }),
  };
}

test("a verified launch is reported as success without a second model round", async () => {
  const stub = stubBrain([toolCall("node_action", { node: "Rig", op: "open", args: { app: "task manager" } })]);
  try {
    const answer = await ask({
      text: "open task manager",
      config,
      registry: registryReturning({ ok: true, opened: "Taskmgr.exe", verified: "process" }),
      history: [],
    });
    assert.equal(stub.calls.length, 1, "the verified action is conclusive");
    assert.equal(answer.meta.path, "model:action");
    assert.match(answer.reply, /Opened Taskmgr\.exe on Rig/);
    assert.equal(answer.actions[0].ok, true);
  } finally {
    stub.restore();
  }
});

test("a failed launch is never reported as success", async () => {
  const stub = stubBrain([
    toolCall("node_action", { node: "Rig", op: "open", args: { app: "task manager" } }),
    message({ content: "Done." }),
  ]);
  try {
    const answer = await ask({
      text: "open task manager",
      config,
      registry: registryReturning({ ok: false, error: 'Windows did not open anything called "task manager".' }),
      history: [],
    });
    assert.equal(answer.actions[0].ok, false);
    assert.match(answer.reply, /failed/i);
    assert.match(answer.reply, /did not open anything/);
    assert.doesNotMatch(answer.reply, /^Done/i);
  } finally {
    stub.restore();
  }
});

test("a model that pastes JSON is turned into words", async () => {
  const stub = stubBrain([message({ content: '{"ok":true,"opened":"Taskmgr.exe"}' })]);
  try {
    const answer = await ask({ text: "tell me a short fact", config, registry: registryReturning({}), history: [] });
    assert.ok(!answer.reply.trim().startsWith("{"), `raw JSON leaked: ${answer.reply}`);
    assert.match(answer.reply, /raw data/i);
  } finally {
    stub.restore();
  }
});

test("the model sees the software version and the model name as separate facts", async () => {
  const stub = stubBrain([message({ content: "I am ATHENA." })]);
  try {
    await ask({ text: "tell me a short fact", config, registry: registryReturning({}), history: [] });
    const system = stub.calls[0].body.messages[0].content;
    assert.match(system, new RegExp(`software version ${VERSION.replace(/\./g, "\\.")}`));
    assert.match(system, /gpt-4o-mini/);
    assert.match(system, /different things/);
    assert.match(system, /never invent/i);
  } finally {
    stub.restore();
  }
});
