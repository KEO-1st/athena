import test from "node:test";
import assert from "node:assert/strict";
import { ask } from "../lib/brain.mjs";

/*
 * OpenAI-compatible stub. These tests exercise the real request/response and
 * tool loop; they do not claim to test a real model. `tests/brain-live.test.mjs`
 * is the separate, opt-in real-provider check.
 */
function stubProvider(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    const reply = handler(body, calls.length - 1);
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

const message = (payload) => ({ choices: [{ message: { role: "assistant", content: "", ...payload } }] });
const text = (content) => message({ content });
let callId = 0;
function toolCall(name, args) {
  callId += 1;
  return message({
    tool_calls: [{ id: `call_${callId}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
}

const config = {
  hubName: "athena",
  port: 4790,
  brain: { provider: "openai", model: "gpt-4o-mini", apiKey: "test-key", baseUrl: "http://127.0.0.1:9/v1" },
};

/* Only the Hub PC's administrator may run shell commands in a chat turn. */
const admin = { status: () => ({ ok: true }), start: () => ({ ok: true }) };

const nodes = [
  {
    id: "node_1",
    name: "Rig",
    online: true,
    status: {
      platform: "Windows 11",
      load: 0.2,
      memory: { totalGb: 32, freeGb: 18 },
      gpu: { name: "RTX 3060", vramGb: 12, util: 31, temp: 42 },
      services: {},
      tasks: [],
    },
  },
  {
    id: "node_2",
    name: "Laptop",
    online: true,
    status: {
      platform: "Windows 11",
      load: 0.4,
      memory: { totalGb: 16, freeGb: 7 },
      gpu: { name: "RTX 4050", vramGb: 6, util: 5, temp: 38 },
      services: {},
      tasks: [],
    },
  },
];

function registry({ run, action } = {}) {
  const byId = () => ({ status: nodes[0].status });
  return {
    list: () => nodes,
    get: (ref) =>
      nodes.find((node) => node.id === ref || node.name.toLowerCase() === String(ref || "").toLowerCase()) || null,
    refresh: async () => undefined,
    statusOf: () => byId(),
    run:
      run ||
      (async () => ({ state: "done", code: 0, output: "ok" })),
    action:
      action ||
      (async (id, op) => {
        if (op === "processes") return { processes: [{ name: "chrome", memMb: 900 }], total: 1, services: {} };
        return { ok: true };
      }),
  };
}

test("a multi-step request keeps tools available and observes each result", async () => {
  const statuses = [];
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("node_status", { node: "Rig" });
    assert.ok(body.tools?.length, "the second round must still offer tools for a multi-step task");
    if (index === 1) return toolCall("run_command", { node: "Rig", command: "nvidia-smi" });
    assert.match(JSON.stringify(body.messages), /GPU 42C/, "the second tool sees the first result");
    return text("Rig is at 42°C, and nvidia-smi finished cleanly.");
  });
  try {
    const answer = await ask({
      text: "Check the GPU on Rig, then run nvidia-smi on Rig.",
      config,
      registry: registry({ run: async () => ({ state: "done", code: 0, output: "GPU 42C" }) }),
      history: [],
      admin,
      onStatus: (line) => statuses.push(line),
    });
    assert.equal(stub.calls.length, 3, "three model rounds: plan, observe, answer");
    assert.deepEqual(
      answer.actions.map((action) => action.name),
      ["node_status", "run_command"]
    );
    assert.equal(answer.actions.every((action) => action.ok), true);
    assert.match(answer.reply, /42/);
    assert.ok(statuses.includes("Checking Rig…"), "the controller sees the first step");
    assert.ok(statuses.includes("Running a command on Rig…"), "the controller sees the next step");
  } finally {
    stub.restore();
  }
});

test("a failed command is reported as failed and the model can recover", async () => {
  let runCalls = 0;
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("run_command", { node: "Rig", command: "npm test" });
    if (index === 1) return toolCall("run_command", { node: "Rig", command: "npm install" });
    return text("The tests failed on a missing dependency; I installed it, so the next run can proceed.");
  });
  try {
    const answer = await ask({
      text: "Run npm test on Rig and then fix the failure.",
      config,
      registry: registry({
        run: async () => {
          runCalls += 1;
          return runCalls === 1
            ? { state: "failed", code: 1, output: "Error: Cannot find module 'left-pad'" }
            : { state: "done", code: 0, output: "added 1 package" };
        },
      }),
      history: [],
      admin,
    });
    assert.ok(stub.calls[1].body.tools?.length, "a failed step keeps tools available for a safe retry");
    assert.match(JSON.stringify(stub.calls[1].body.messages), /exited with code 1/);
    assert.equal(answer.actions[0].ok, false, "a nonzero exit is not success");
    assert.equal(answer.actions[1].ok, true);
    assert.match(answer.reply, /missing dependency/i);
  } finally {
    stub.restore();
  }
});

test("a single failed command is retried before the answer is composed", async () => {
  let runCalls = 0;
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("run_command", { node: "Rig", command: "npm test" });
    assert.ok(body.tools?.length, "recovery offers tools");
    assert.match(JSON.stringify(body.messages), /Cannot find module/);
    return text("It failed because a module is missing. Install it and I can run the tests again.");
  });
  try {
    const answer = await ask({
      text: "run npm test on Rig",
      config,
      registry: registry({
        run: async () => {
          runCalls += 1;
          return { state: "failed", code: 1, output: "Error: Cannot find module 'left-pad'" };
        },
      }),
      history: [],
      admin,
    });
    assert.equal(runCalls, 1, "the test does not retry a command on its own");
    assert.equal(answer.actions[0].ok, false);
    assert.match(answer.reply, /missing/i);
    assert.doesNotMatch(answer.reply, /^Done/i);
  } finally {
    stub.restore();
  }
});

test("a read tool gets a model round so the answer is phrased, not dumped", async () => {
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("node_status", { node: "Rig" });
    assert.equal(body.tools, undefined, "a finished read needs no further schema");
    return text("Rig has 32 GB of RAM, with about 18 GB free right now.");
  });
  try {
    const answer = await ask({
      text: "What is the memory on Rig?",
      config,
      registry: registry(),
      history: [],
    });
    assert.equal(stub.calls.length, 2);
    assert.match(answer.reply, /32 GB/);
  } finally {
    stub.restore();
  }
});

test("a general question is not turned into a machine command", async () => {
  const stub = stubProvider(() => text("RAM is fast working memory; VRAM is memory on the graphics card."));
  try {
    const answer = await ask({
      text: "Explain the difference between RAM and VRAM.",
      config,
      registry: registry(),
      history: [],
    });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].body.tools, undefined, "general knowledge must not offer machine tools");
    assert.match(answer.reply, /VRAM/);
  } finally {
    stub.restore();
  }
});

test("a greeting with a follow-up question is answered naturally without a model", async () => {
  const real = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("a greeting must not call a provider");
  };
  try {
    const answer = await ask({
      text: "Hello, how are you?",
      config: { provider: "off", brain: { provider: "off" } },
      registry: registry(),
      history: [],
    });
    assert.equal(called, false);
    assert.equal(answer.meta.path, "identity:greeting");
    assert.match(answer.reply, /running well/i);
  } finally {
    globalThis.fetch = real;
  }
});

test("a bare follow-up with no history asks for clarification instead of guessing", async () => {
  const real = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("clarification must not call a provider");
  };
  try {
    const answer = await ask({
      text: "open it",
      config: { provider: "off" },
      registry: registry(),
      history: [],
    });
    assert.equal(called, false);
    assert.equal(answer.meta.path, "clarify");
    assert.match(answer.reply, /earlier request/i);
    assert.match(answer.reply, /which machine/i);
    assert.equal(answer.actions.length, 0);
  } finally {
    globalThis.fetch = real;
  }
});

test("malformed tool arguments are reported back instead of silently doing nothing", async () => {
  const stub = stubProvider((body, index) => {
    if (index === 0) {
      return message({
        tool_calls: [{ id: "bad", type: "function", function: { name: "node_status", arguments: "{not json" } }],
      });
    }
    assert.ok(body.tools?.length);
    assert.match(JSON.stringify(body.messages), /not valid JSON/);
    return text("I could not read that request; please say which machine you meant.");
  });
  try {
    const answer = await ask({
      text: "check the gpu on Rig",
      config,
      registry: registry(),
      history: [],
    });
    assert.equal(answer.actions[0].ok, false);
    assert.match(answer.reply, /which machine/i);
  } finally {
    stub.restore();
  }
});

test("conversation context from previous turns reaches the model", async () => {
  const stub = stubProvider(() => text("You asked about the render node."));
  try {
    await ask({
      text: "What did I ask about?",
      config,
      registry: registry(),
      history: [
        { role: "user", content: "Which node should render this?" },
        { role: "assistant", content: "Rig is the better choice." },
      ],
    });
    const messages = stub.calls[0].body.messages;
    assert.ok(messages.some((entry) => entry.role === "user" && /Which node should render/.test(entry.content)));
    assert.ok(messages.some((entry) => entry.role === "assistant" && /better choice/.test(entry.content)));
  } finally {
    stub.restore();
  }
});

test("a controller cannot run shell commands through the model", async () => {
  let ran = 0;
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("run_command", { node: "Rig", command: "whoami" });
    return text("Shell commands are limited to the Hub administrator.");
  });
  try {
    const answer = await ask({
      text: "run whoami on Rig",
      config,
      registry: registry({
        run: async () => {
          ran += 1;
          return { state: "done", code: 0, output: "controller" };
        },
      }),
      history: [],
      admin: null,
    });
    assert.equal(ran, 0, "the controller never reached the node's shell");
    assert.equal(answer.actions[0].ok, false);
    assert.match(JSON.stringify(stub.calls[1].body.messages), /Hub administrator/);
  } finally {
    stub.restore();
  }
});

test("a controller cannot run shell commands through the no-model fallback", async () => {
  let ran = 0;
  const answer = await ask({
    text: "run whoami on Rig",
    config: { provider: "off" },
    registry: registry({
      run: async () => {
        ran += 1;
        return { state: "done", code: 0, output: "controller" };
      },
    }),
    history: [],
    admin: null,
  });
  assert.equal(ran, 0);
  assert.match(answer.reply, /Hub administrator/);
  assert.equal(answer.actions.length, 0);
});

test("a repeated successful action runs once, not twice", async () => {
  let ran = 0;
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("run_command", { node: "Rig", command: "whoami" });
    if (index === 1) return toolCall("run_command", { node: "Rig", command: "whoami" });
    return text("Checked it once; the account is the same.");
  });
  try {
    const answer = await ask({
      text: "Run whoami on Rig, then check the result.",
      config,
      registry: registry({
        run: async () => {
          ran += 1;
          return { state: "done", code: 0, output: "controller" };
        },
      }),
      history: [],
      admin,
    });
    assert.equal(ran, 1, "the duplicate call is answered from the first result");
    assert.equal(answer.actions.length, 1);
    assert.match(JSON.stringify(stub.calls[2].body.messages), /already succeeded/);
  } finally {
    stub.restore();
  }
});

test("a timed-out command can be retried, and its first failure is reported honestly", async () => {
  let runs = 0;
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("run_command", { node: "Rig", command: "ping 10.0.0.1" });
    if (index === 1) return toolCall("run_command", { node: "Rig", command: "ping 10.0.0.1" });
    return text("The first attempt timed out; the retry completed.");
  });
  try {
    const answer = await ask({
      text: "Run ping 10.0.0.1 on Rig, then report what happened.",
      config,
      registry: registry({
        run: async () => {
          runs += 1;
          return runs === 1 ? { state: "timeout", output: "" } : { state: "done", code: 0, output: "1 received" };
        },
      }),
      history: [],
      admin,
    });
    assert.equal(runs, 2, "a timeout gets one deliberate retry");
    assert.equal(answer.actions[0].ok, false);
    assert.match(JSON.stringify(stub.calls[1].body.messages), /still running when the time limit expired/);
    assert.equal(answer.actions[1].ok, true);
  } finally {
    stub.restore();
  }
});

test("a provider failure after a real action never re-runs the fallback", async () => {
  let opened = 0;
  let index = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    index += 1;
    if (index === 1) {
      return new Response(
        JSON.stringify(toolCall("node_action", { node: "Rig", op: "open", args: { app: "notepad" } })),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error("provider disconnected");
  };
  try {
    const answer = await ask({
      text: "Open Notepad on Rig, then check the result.",
      config,
      registry: registry({
        action: async () => {
          opened += 1;
          return { ok: true, opened: "notepad.exe" };
        },
      }),
      history: [],
      admin,
    });
    assert.equal(opened, 1, "the built-in parser does not repeat the open");
    assert.equal(answer.actions.length, 1);
    assert.match(answer.reply, /stopped before finishing/i);
  } finally {
    globalThis.fetch = real;
  }
});

test("an unknown node is reported instead of invented", async () => {
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("node_status", { node: "Ghost" });
    return text("There is no machine called Ghost on this network.");
  });
  try {
    const answer = await ask({
      text: "check the gpu on Ghost",
      config,
      registry: registry(),
      history: [],
    });
    assert.equal(answer.actions[0].ok, false);
    assert.match(JSON.stringify(stub.calls[1].body.messages), /Unknown node/);
    assert.match(answer.reply, /no machine called Ghost/i);
  } finally {
    stub.restore();
  }
});

test("node discovery returns only linked machines", async () => {
  const stub = stubProvider((body, index) => {
    if (index === 0) return toolCall("list_nodes", {});
    return text("Rig is the stronger renderer.");
  });
  try {
    await ask({
      text: "Compare the available nodes and tell me which is better for rendering.",
      config,
      registry: registry(),
      history: [],
    });
    const toolPayload = stub.calls[1].body.messages.find((entry) => entry.role === "tool")?.content || "";
    assert.match(toolPayload, /Rig/);
    assert.match(toolPayload, /Laptop/);
    assert.doesNotMatch(toolPayload, /Ghost|Unknown/);
  } finally {
    stub.restore();
  }
});
