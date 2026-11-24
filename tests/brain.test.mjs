import test from "node:test";
import assert from "node:assert/strict";
import { invalidateProbeCache, probeBrain } from "../lib/brain.mjs";

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
