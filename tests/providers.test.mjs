import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatRequest,
  describeProviderError,
  listProviderModels,
  maskKey,
  providerCatalog,
  readChatResponse,
  resolveProviderSettings,
} from "../lib/providers.mjs";

const config = {
  provider: "openai",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-live-1234567890",
  providers: {
    deepseek: { apiKey: "ds-secret-key", model: "deepseek-chat" },
  },
};

test("the provider catalogue filters secrets to a mask", () => {
  const catalog = providerCatalog(config);
  const text = JSON.stringify(catalog);
  assert.ok(text.includes("sk-…7890"));
  assert.ok(!text.includes("sk-live-1234567890"), "the full key never reaches the UI payload");
  assert.equal(catalog.find((entry) => entry.id === "deepseek").configured, true);
  assert.ok(catalog.some((entry) => entry.id === "anthropic"));
  assert.ok(catalog.some((entry) => entry.id === "groq"));
});

test("maskKey never reveals a short key", () => {
  assert.equal(maskKey(""), "");
  assert.equal(maskKey("12345678"), "••••");
  assert.match(maskKey("sk-abcdefghijk"), /^sk-…hijk$/);
});

test("auto with a legacy top-level key still means OpenAI", () => {
  const settings = resolveProviderSettings({ provider: "auto", apiKey: "sk-legacy", model: "gpt-4o-mini" }, "openai");
  assert.equal(settings.apiKey, "sk-legacy");
  assert.equal(settings.model, "gpt-4o-mini");
});

test("provider settings are isolated per provider and do not inherit another key", () => {
  const settings = resolveProviderSettings(config, "groq");
  assert.equal(settings.id, "groq");
  assert.equal(settings.apiKey, "");
  assert.match(settings.baseUrl, /api\.groq\.com/);
  assert.equal(settings.model, "llama-3.3-70b-versatile");
});

test("Anthropic requests use the native message and tool format", () => {
  const settings = resolveProviderSettings({ provider: "anthropic", apiKey: "ak-test" }, "anthropic");
  const tools = [
    { type: "function", function: { name: "list_nodes", description: "List nodes", parameters: { type: "object", properties: {} } } },
  ];
  const request = buildChatRequest(
    settings,
    [
      { role: "system", content: "You are ATHENA." },
      { role: "user", content: "check Rig" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "list_nodes", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "{\"ok\":true}" },
    ],
    tools,
    { maxTokens: 100 }
  );
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "ak-test");
  assert.equal(request.body.system, "You are ATHENA.");
  assert.equal(request.body.messages[0].role, "user");
  assert.equal(request.body.messages[1].content[0].type, "tool_use");
  assert.equal(request.body.messages[2].content[0].type, "tool_result");
  assert.equal(request.body.tools[0].input_schema.type, "object");
});

test("Anthropic replies become the same assistant/tool shape the loop already uses", () => {
  const settings = resolveProviderSettings({ provider: "anthropic", apiKey: "ak-test" }, "anthropic");
  const message = readChatResponse(settings, {
    content: [
      { type: "text", text: "I'll check." },
      { type: "tool_use", id: "toolu_1", name: "node_status", input: { node: "Rig" } },
    ],
  });
  assert.equal(message.content, "I'll check.");
  assert.equal(message.tool_calls[0].function.name, "node_status");
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { node: "Rig" });
});

test("provider errors are specific and never contain a key", () => {
  const settings = resolveProviderSettings(config, "openai");
  assert.match(describeProviderError(settings, 401), /rejected the API key/i);
  assert.match(describeProviderError(settings, 429), /rate limit/i);
  assert.match(describeProviderError(settings, 404), /no model/i);
  const timeout = new Error("aborted");
  timeout.name = "TimeoutError";
  assert.match(describeProviderError(settings, 0, null, timeout), /did not answer in time/i);
  assert.doesNotMatch(describeProviderError(settings, 401), /sk-live/);
});

test("model discovery reads the provider's real list", async () => {
  const settings = resolveProviderSettings(config, "openai");
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options.headers.authorization, "Bearer sk-live-1234567890");
    return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }), { status: 200 });
  };
  const result = await listProviderModels(settings, { fetchImpl });
  assert.deepEqual(result.models, ["gpt-4o", "gpt-4o-mini"]);
  assert.equal(result.error, null);
});
