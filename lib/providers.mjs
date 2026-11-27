/**
 * Provider adapters for ATHENA's brain.
 *
 * A provider is a small, explicit contract: where its API lives, how it
 * authenticates, whether it can call tools or see images, and how to convert
 * ATHENA's OpenAI-shaped conversation into its own request format. Adding a
 * provider must not mean touching the tool loop again.
 *
 * No key is ever returned by these helpers in full, put in a URL, or sent to a
 * Node. `maskKey` is the only representation intended for a client.
 */

export const PROVIDER_SPECS = {
  ollama: {
    id: "ollama",
    label: "Ollama",
    kind: "local",
    style: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    defaultModel: "qwen2.5:7b",
    keyRequired: false,
    docs: "https://ollama.com",
    note: "Local models, no API key, nothing leaves this PC.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "remote",
    style: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyRequired: true,
    docs: "https://platform.openai.com/api-keys",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    kind: "remote",
    style: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    keyRequired: true,
    docs: "https://aistudio.google.com/apikey",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    kind: "remote",
    style: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    keyRequired: true,
    docs: "https://platform.deepseek.com/api_keys",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    kind: "remote",
    style: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    keyRequired: true,
    docs: "https://console.anthropic.com/settings/keys",
  },
  groq: {
    id: "groq",
    label: "Groq",
    kind: "remote",
    style: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    keyRequired: true,
    docs: "https://console.groq.com/keys",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "remote",
    style: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    keyRequired: true,
    docs: "https://openrouter.ai/keys",
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    kind: "remote",
    style: "openai",
    baseUrl: "",
    defaultModel: "",
    keyRequired: false,
    docs: "",
    note: "Any endpoint that implements /chat/completions.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDER_SPECS);

const VISION_MODEL =
  /(gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o|o3|o4|gemini|claude|llava|moondream|minicpm|qwen.*vl|pixtral|internvl|florence|idefics)/i;

export function providerSpec(id) {
  return PROVIDER_SPECS[String(id || "").toLowerCase()] || null;
}

export function normaliseBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/** Merge the selected provider's saved entry without ever inventing a key. */
export function resolveProviderSettings(config = {}, provider = config.provider) {
  const id = String(provider || "auto").toLowerCase();
  const spec = providerSpec(id) || PROVIDER_SPECS.openai;
  const saved = config.providers && typeof config.providers === "object" ? config.providers[id] || {} : {};
  /* `auto` with a top-level key has always meant OpenAI. Preserve that for
     older configs and for hosts that pass the brain config directly, while a
     real per-provider entry always wins. */
  const configuredId = String(config.provider || "").toLowerCase();
  const selected =
    id === configuredId ||
    (configuredId === "auto" && id === "openai" && !saved.apiKey && !saved.model && !saved.baseUrl);
  return {
    id: spec.id === id ? id : spec.id,
    spec,
    model: String((selected && config.model) || saved.model || spec.defaultModel || ""),
    baseUrl: normaliseBase((selected && config.baseUrl) || saved.baseUrl || spec.baseUrl),
    apiKey: String((selected && config.apiKey) || saved.apiKey || ""),
    keyRequired: Boolean(spec.keyRequired),
  };
}

/** The only form of a key a browser, log or controller may ever see. */
export function maskKey(key) {
  const clean = String(key || "");
  if (!clean) return "";
  if (clean.length <= 8) return "••••";
  return `${clean.slice(0, 3)}…${clean.slice(-4)}`;
}

export function providerCatalog(config = {}) {
  return PROVIDER_IDS.filter((id) => id !== "ollama").map((id) => {
    const settings = resolveProviderSettings(config, id);
    return {
      id,
      label: settings.spec.label,
      kind: settings.spec.kind,
      defaultModel: settings.spec.defaultModel,
      baseUrl: settings.baseUrl,
      model: settings.model,
      keyRequired: settings.keyRequired,
      configured: Boolean(settings.apiKey) || !settings.keyRequired,
      keyMask: maskKey(settings.apiKey),
      docs: settings.spec.docs,
      note: settings.spec.note || "",
    };
  });
}

/**
 * Whether a model can actually see a screenshot. Providers do not report this
 * consistently, so the model name is the reliable signal we do have; a wrong
 * guess is corrected by the caller when the provider rejects an image.
 */
export function supportsVision(provider, model) {
  const id = String(provider || "").toLowerCase();
  if (id === "ollama") return VISION_MODEL.test(String(model || ""));
  return VISION_MODEL.test(String(model || ""));
}

export function supportsTools(provider, model) {
  const id = String(provider || "").toLowerCase();
  /* Anthropic, OpenAI, Gemini, DeepSeek, Groq and OpenRouter all support tool
     calling on their current chat models. Ollama reports per-model capability
     in probeBrain and overrides this there. */
  if (id === "ollama") return true;
  if (!PROVIDER_SPECS[id]) return false;
  return true;
}

/* --------------------------------------------------------------- requests */

function apiKeyFor(settings) {
  return String(settings.apiKey || "");
}

export function buildChatRequest(settings, messages, tools = null, { stream = false, maxTokens = 450 } = {}) {
  const style = settings.spec?.style || "openai";
  if (style === "anthropic") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => String(message.content || ""))
      .filter(Boolean)
      .join("\n\n");
    return {
      url: `${settings.baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKeyFor(settings),
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: settings.model,
        max_tokens: maxTokens,
        temperature: 0.35,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(messages),
        ...(tools ? { tools: toAnthropicTools(tools) } : {}),
        ...(stream ? { stream: true } : {}),
      },
    };
  }
  const headers = { "content-type": "application/json" };
  if (apiKeyFor(settings)) headers.authorization = `Bearer ${apiKeyFor(settings)}`;
  if (settings.id === "openrouter") {
    headers["http-referer"] = "http://athena.local";
    headers["x-title"] = "ATHENA Hub";
  }
  return {
    url: `${settings.baseUrl}/chat/completions`,
    headers,
    body: {
      model: settings.model,
      messages: messages.map(({ role, content, tool_calls, tool_call_id, name }) => ({
        role,
        ...(content !== undefined ? { content } : {}),
        ...(tool_calls ? { tool_calls } : {}),
        ...(tool_call_id ? { tool_call_id } : {}),
        ...(name ? { name } : {}),
      })),
      temperature: 0.35,
      max_tokens: maxTokens,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
      ...(stream ? { stream: true } : {}),
    },
  };
}

export function toAnthropicTools(tools) {
  return (tools || []).map((tool) => ({
    name: tool.function?.name,
    description: tool.function?.description || "",
    input_schema: tool.function?.parameters || { type: "object", properties: {} },
  }));
}

/**
 * Anthropic takes the system prompt separately and represents tool calls and
 * tool results as content blocks. Consecutive tool results must share one user
 * message, otherwise the API rejects the turn.
 */
export function toAnthropicMessages(messages) {
  const output = [];
  const append = (role, blocks) => {
    const previous = output[output.length - 1];
    if (previous && previous.role === role) previous.content.push(...blocks);
    else output.push({ role, content: [...blocks] });
  };
  for (const message of messages) {
    if (!message || message.role === "system") continue;
    if (message.role === "tool") {
      append("user", [
        {
          type: "tool_result",
          tool_use_id: String(message.tool_call_id || "tool"),
          content: String(message.content ?? ""),
        },
      ]);
      continue;
    }
    if (message.role === "assistant") {
      const blocks = [];
      if (typeof message.content === "string" && message.content.trim()) blocks.push({ type: "text", text: message.content });
      for (const call of message.tool_calls || []) {
        let input = {};
        try {
          input = JSON.parse(call.function?.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: String(call.id || "tool"), name: String(call.function?.name || ""), input });
      }
      if (blocks.length) append("assistant", blocks);
      continue;
    }
    const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
    if (content) append("user", [{ type: "text", text: content }]);
  }
  return output;
}

/** Normalise the provider's reply into the same assistant message shape. */
export function readChatResponse(settings, json) {
  const style = settings.spec?.style || "openai";
  if (style === "anthropic") {
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const toolCalls = blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      }));
    return { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  }
  const message = json?.choices?.[0]?.message;
  if (!message) throw new Error("The provider returned no message.");
  return message;
}

/** One token of a streamed response, or null for an event that has no text. */
export function readStreamToken(settings, payload) {
  const style = settings.spec?.style || "openai";
  if (style === "anthropic") {
    if (payload?.type === "content_block_delta" && payload.delta?.type === "text_delta") return payload.delta.text || null;
    return null;
  }
  return payload?.choices?.[0]?.delta?.content || null;
}

export function readStreamError(settings, payload) {
  if (!payload) return null;
  if (payload.error) return payload.error.message || payload.error;
  if (payload.type === "error") return payload.error?.message || "The provider sent an error event.";
  return null;
}

/* --------------------------------------------------------------- discovery */

export async function listProviderModels(settings, { fetchImpl = fetch, timeoutMs = 12_000 } = {}) {
  if (!settings.baseUrl) return { models: [], error: "No base URL is configured." };
  const style = settings.spec?.style || "openai";
  const url = style === "anthropic" ? `${settings.baseUrl}/v1/models` : `${settings.baseUrl}/models`;
  const headers = style === "anthropic"
    ? { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" }
    : settings.apiKey
      ? { authorization: `Bearer ${settings.apiKey}` }
      : {};
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { models: [], error: describeProviderError(settings, res.status, json) };
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    const models = list
      .map((item) => (typeof item === "string" ? item : item.id || item.name))
      .filter(Boolean)
      .sort();
    return { models, error: null };
  } catch (error) {
    return { models: [], error: describeProviderError(settings, 0, null, error) };
  }
}

/** A real request, not a saved-key check. Used by "TEST CONNECTION". */
export async function testProvider(settings, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  const messages = [
    { role: "system", content: "You are a connection test. Reply with exactly: ATHENA READY" },
    { role: "user", content: "Reply with exactly: ATHENA READY" },
  ];
  const request = buildChatRequest(settings, messages, null, { maxTokens: 12 });
  try {
    const res = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML error page */
    }
    if (!res.ok) {
      return {
        ok: false,
        provider: settings.id,
        model: settings.model,
        latencyMs: Date.now() - started,
        error: describeProviderError(settings, res.status, json, null, text),
      };
    }
    const message = readChatResponse(settings, json);
    return {
      ok: true,
      provider: settings.id,
      model: settings.model,
      latencyMs: Date.now() - started,
      reply: String(message.content || "").slice(0, 120),
      tools: supportsTools(settings.id, settings.model),
      vision: supportsVision(settings.id, settings.model),
    };
  } catch (error) {
    return {
      ok: false,
      provider: settings.id,
      model: settings.model,
      latencyMs: Date.now() - started,
      error: describeProviderError(settings, 0, null, error),
    };
  }
}

/** Provider-specific, human-readable errors. Never includes the key or a URL query. */
export function describeProviderError(settings, status, json = null, error = null, raw = "") {
  const label = settings.spec?.label || settings.id || "The provider";
  const message = String(json?.error?.message || json?.message || raw || "").trim();
  if (error) {
    if (error.name === "TimeoutError" || /abort|timed? ?out/i.test(String(error.message || ""))) {
      return `${label} did not answer in time. The request was cancelled; nothing was executed on a Node.`;
    }
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(String(error.message || error))) {
      return `${label} could not be reached at ${settings.baseUrl || "its configured address"}. Check the Hub's network and the base URL.`;
    }
    return `${label} request failed: ${String(error.message || error).slice(0, 240)}`;
  }
  if (status === 401 || status === 403) return `${label} rejected the API key. Save a new key in SYSTEM → MODEL CENTER.`;
  if (status === 404) return `${label} has no model "${settings.model}". Choose an installed/available model.${message ? ` ${message.slice(0, 160)}` : ""}`;
  if (status === 429) return `${label} rate limit reached. Wait a moment or choose another provider.${message ? ` ${message.slice(0, 160)}` : ""}`;
  if (status === 400 && /tool/i.test(message)) return `${label} says this model cannot call tools. Pick a tool-capable model.`;
  if (status === 400 && /image|vision/i.test(message)) return `${label} says this model cannot read images. Pick a vision model or ask without a screenshot.`;
  if (status >= 500) return `${label} is having a server problem (HTTP ${status}).${message ? ` ${message.slice(0, 160)}` : ""}`;
  return `${label} returned HTTP ${status || "?"}.${message ? ` ${message.slice(0, 200)}` : ""}`;
}

/**
 * A provider is usable when it has a base URL and, if it is remote, a key.
 * `auto` prefers a configured cloud key, then local Ollama.
 */
export function configuredProvider(config = {}) {
  const selected = String(config.provider || "auto").toLowerCase();
  if (selected === "off") return null;
  if (selected !== "auto") {
    const settings = resolveProviderSettings(config, selected);
    if (settings.keyRequired && !settings.apiKey) return { ...settings, missingKey: true };
    if (!settings.baseUrl) return { ...settings, missingBase: true };
    return settings;
  }
  for (const id of ["openai", "gemini", "deepseek", "anthropic", "groq", "openrouter", "custom"]) {
    const settings = resolveProviderSettings(config, id);
    if (settings.apiKey && settings.baseUrl) return settings;
  }
  return null;
}
