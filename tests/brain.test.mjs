import test from "node:test";
import assert from "node:assert/strict";
import { ask, invalidateProbeCache, probeBrain } from "../lib/brain.mjs";

test("probeBrain caches a provider probe and invalidates on demand", async (t) => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b", capabilities: ["tools"] }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    invalidateProbeCache();
  });

  invalidateProbeCache();
  const config = { provider: "ollama", baseUrl: "http://127.0.0.1:9", model: "" };
  const first = await probeBrain(config);
  const second = await probeBrain(config);
  assert.equal(first.ready, true);
  assert.equal(first.model, "qwen2.5:7b");
  assert.equal(second.model, "qwen2.5:7b");
  assert.equal(calls.length, 1, "a repeated state read must not re-probe");

  invalidateProbeCache();
  await probeBrain(config);
  assert.equal(calls.length, 2, "invalidation forces a fresh probe");
});

test("a controller cannot install the Hub brain through chat", async () => {
  invalidateProbeCache();
  const registry = { list: () => [], statusOf: () => null, action: async () => ({}) };
  const answer = await ask({
    text: "install a brain",
    config: { provider: "off", model: "", baseUrl: "", apiKey: "" },
    registry,
    history: [],
    admin: null,
  });
  assert.match(answer.reply, /Only the Hub administrator/);
  assert.equal(answer.actions.length, 0);
});

test("a greeting is answered locally instead of loading a reasoning model", async () => {
  invalidateProbeCache();
  const registry = { list: () => [], statusOf: () => null, action: async () => ({}) };
  const started = Date.now();
  const answer = await ask({
    text: "hello",
    config: { provider: "ollama", model: "qwen3:4b", baseUrl: "http://127.0.0.1:9", apiKey: "" },
    registry,
    history: [],
  });
  assert.equal(answer.meta.path, "identity:greeting");
  assert.match(answer.reply, /Hello/);
  assert.ok(Date.now() - started < 1000);
});

test("Ollama chat disables hidden thinking and caps a local turn so it cannot spend minutes in reasoning", async (t) => {
  const realFetch = globalThis.fetch;
  let chatPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3:4b", capabilities: ["completion", "tools"] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    chatPayload = JSON.parse(String(options.body || "{}"));
    return new Response(JSON.stringify({ message: { role: "assistant", content: "A short answer." } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    invalidateProbeCache();
  });
  invalidateProbeCache();
  const registry = { list: () => [], statusOf: () => null, action: async () => ({}) };
  const answer = await ask({
    text: "tell me a short story about a lighthouse",
    config: { provider: "ollama", model: "qwen3:4b", baseUrl: "http://127.0.0.1:9", apiKey: "" },
    registry,
    history: [],
  });
  assert.equal(answer.reply, "A short answer.");
  assert.equal(chatPayload.think, false, "Qwen3's hidden thinking channel must be off for normal conversation");
  assert.equal(chatPayload.model, "qwen3:4b");
  assert.ok(chatPayload.options.num_predict <= 360, "a local turn must be bounded to a responsive token budget");
  assert.match(chatPayload.messages[0].content, /Never narrate your reasoning/);
});

test("the model timeout aborts the provider request and leaves no active fetch", async (t) => {
  const realFetch = globalThis.fetch;
  let chatCalls = 0;
  let active = 0;
  let aborted = false;
  let sawSignal = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "timeout-test:1b", capabilities: ["completion", "tools"] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    chatCalls += 1;
    active += 1;
    sawSignal = options.signal instanceof AbortSignal;
    return new Promise((resolve, reject) => {
      const finish = () => {
        active -= 1;
        aborted = true;
        reject(options.signal?.reason || new Error("aborted"));
      };
      if (options.signal?.aborted) finish();
      else options.signal?.addEventListener("abort", finish, { once: true });
    });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    invalidateProbeCache();
  });
  invalidateProbeCache();
  const registry = { list: () => [], statusOf: () => null, action: async () => ({}) };
  const started = Date.now();
  const answer = await ask({
    text: "tell me a short fact",
    config: { provider: "ollama", model: "timeout-test:1b", baseUrl: "http://127.0.0.1:9", apiKey: "" },
    registry,
    history: [],
    modelTimeoutMs: 150,
  });
  assert.equal(chatCalls, 1);
  assert.equal(sawSignal, true, "the provider fetch receives an abort signal");
  assert.equal(aborted, true, "the timeout reaches the underlying request");
  assert.equal(active, 0, "the aborted request is cleaned up");
  assert.ok(Date.now() - started < 3000, "the timeout does not wait for the production one-minute bound");
  assert.match(answer.reply, /brain unavailable/i);
});

test("tool-capability retry is sequential and cannot overlap provider requests", async (t) => {
  const realFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "tool-retry-test:1b", capabilities: ["completion", "tools"] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    const payload = JSON.parse(String(options.body || "{}"));
    if (calls === 1) {
      assert.ok(payload.tools?.length, "the first attempt offers tools");
      active -= 1;
      return new Response("this model does not support tools", { status: 400 });
    }
    assert.equal(payload.tools, undefined, "the retry drops tools instead of overlapping the first call");
    active -= 1;
    return new Response(JSON.stringify({ message: { role: "assistant", content: "Tools are unavailable, so I did not run it." } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    invalidateProbeCache();
  });
  invalidateProbeCache();
  const registry = { list: () => [], statusOf: () => null, action: async () => ({}) };
  const answer = await ask({
    text: "run echo hello",
    config: { provider: "ollama", model: "tool-retry-test:1b", baseUrl: "http://127.0.0.1:9", apiKey: "" },
    registry,
    history: [],
  });
  assert.equal(calls, 2);
  assert.equal(maxActive, 1, "the retry never overlaps the failed provider request");
  assert.match(answer.reply, /Tools are unavailable/);
});
