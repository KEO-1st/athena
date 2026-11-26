import test from "node:test";
import assert from "node:assert/strict";
import { ask, selectToolNames } from "../lib/brain.mjs";

function stubProvider(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify(handler(body, calls.length - 1)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

const message = (payload) => ({ choices: [{ message: { role: "assistant", content: "", ...payload } }] });
const text = (content) => message({ content });
let id = 0;
function toolCall(name, args) {
  id += 1;
  return message({ tools: undefined, tool_calls: [{ id: `call_${id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
}

const config = {
  hubName: "athena",
  port: 4790,
  brain: { provider: "openai", model: "gpt-4o-mini", apiKey: "test-key", baseUrl: "http://127.0.0.1:9/v1" },
};

const node = { id: "node_2", name: "Node 2", online: true, status: { platform: "Windows 11" } };

function registry({ action, screen } = {}) {
  const calls = [];
  return {
    calls,
    list: () => [node],
    get: () => node,
    refresh: async () => undefined,
    statusOf: () => ({ status: node.status }),
    action: async (nodeId, op, args, timeout) => {
      calls.push({ nodeId, op, args, timeout });
      return action ? action(op, args) : { ok: true };
    },
    screen: async (nodeRef) => {
      calls.push({ nodeId: nodeRef, op: "screen" });
      return screen ? screen() : Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    },
    run: async () => ({ state: "done", code: 0, output: "" }),
  };
}

test("ordinary browser verbs reach browser_control, not only the word open", () => {
  const names = selectToolNames("play the latest video uploaded by CaseOh on Node 2");
  assert.ok(names.includes("browser_control"), `browser tool missing: ${names.join(",")}`);
  assert.ok(selectToolNames("look up the weather and read the result").includes("browser_control"));
  assert.ok(selectToolNames("bring the Chrome window to the foreground").includes("window_control"));
});

test("a multi-step browser task keeps tools available and attaches evidence captured after the action", async () => {
  const seen = [];
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("browser_control", { node: "Node 2", op: "open", url: "https://youtube.com" });
    assert.ok(body.tools?.length, "browser tasks must keep tools for the next step");
    if (index === 1) {
      assert.match(JSON.stringify(body.messages), /YouTube/, "the model receives the real page result");
      assert.match(JSON.stringify(body.messages), /Fresh screenshot attached/, "the model is told evidence was captured");
      seen.push("second-round");
      return toolCall("browser_control", { node: "Node 2", op: "type", text: "CaseOh", submit: true });
    }
    assert.match(JSON.stringify(body.messages), /page/, "the second action result is visible");
    return text("YouTube is open on Node 2. The page title and a fresh screenshot are in the result.");
  });
  const reg = registry({
    action: (op, args) => {
      seen.push(`${op}:${args.op}`);
      if (args.op === "open") return { ok: true, page: { title: "YouTube", url: "https://www.youtube.com/" }, foreground: { focused: true } };
      return {
        ok: true,
        action: { typed: "CaseOh", field: "Search" },
        page: { title: "YouTube", url: "https://www.youtube.com/results?search_query=CaseOh" },
        foreground: { focused: true },
      };
    },
  });
  try {
    const answer = await ask({
      text: "Open YouTube on Node 2 and play the latest video uploaded by CaseOh.",
      config,
      registry: reg,
      history: [],
    });
    assert.deepEqual(seen.filter((entry) => entry.includes(":")), ["browser:open", "browser:type"]);
    assert.ok(reg.calls.some((call) => call.op === "screen"), "a screenshot was captured after the browser action");
    assert.equal(answer.images.length, 2, "each browser step returns a fresh screenshot");
    assert.match(answer.images[0].url, /^data:image\/jpeg;base64,/);
    assert.equal(answer.actions.every((action) => action.ok), true);
    assert.equal(answer.meta.path, "model");
  } finally {
    stub.restore();
  }
});

test("a browser failure is a failed action, never a fabricated success", async () => {
  const stub = stubProvider((body, index) =>
    index === 0 ? toolCall("browser_control", { node: "Node 2", op: "open", url: "https://youtube.com" }) : text("I could not open it because no browser was available on Node 2.")
  );
  const reg = registry({ action: () => ({ ok: false, error: "No Chrome, Edge or Brave installation was found." }) });
  try {
    const answer = await ask({ text: "Open YouTube on Node 2.", config, registry: reg, history: [] });
    assert.equal(answer.actions[0].ok, false);
    assert.equal(answer.images.length, 0);
    assert.match(answer.reply, /could not|No Chrome|failed/i);
    assert.doesNotMatch(answer.reply, /opened YouTube/i);
  } finally {
    stub.restore();
  }
});

test("window focus uses the handle the Node actually returned", async () => {
  const stub = stubProvider((body, index) =>
    index === 0 ? toolCall("window_control", { node: "Node 2", op: "focus", handle: "123456" }) : text("Chrome is in the foreground on Node 2.")
  );
  const reg = registry({
    action: (op, args) => {
      assert.equal(op, "window-focus");
      assert.equal(args.handle, "123456");
      return { ok: true, focused: true, title: "YouTube — Google Chrome", verifiedForeground: true };
    },
  });
  try {
    const answer = await ask({ text: "Bring the Chrome window to the foreground on Node 2.", config, registry: reg, history: [] });
    assert.equal(answer.actions[0].name, "window_control");
    assert.equal(answer.actions[0].ok, true);
    assert.equal(reg.calls[0].op, "window-focus");
    assert.match(answer.reply, /foreground|Chrome/i);
  } finally {
    stub.restore();
  }
});
