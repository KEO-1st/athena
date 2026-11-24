import { lanAddresses } from "./discover.mjs";

/**
 * ATHENA's brain. Talks to any OpenAI-compatible chat endpoint (Ollama, LM
 * Studio, OpenAI, Gemini's compatibility endpoint, the Freebuff API, …) and
 * gives the model tools that reach the real nodes. With no model configured it
 * falls back to a small built-in intent parser so the hub is never dead.
 */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_nodes",
      description: "List every connected machine with GPU, VRAM, temperature, services and online state.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "node_status",
      description: "Live status of one machine: CPU load, memory, GPU, uptime, which apps are running and which tasks are active.",
      parameters: {
        type: "object",
        properties: { node: { type: "string", description: "Node id or name" } },
        required: ["node"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command on a machine and return its output. Use for anything executable: ffmpeg, python, git, ls, a training script.",
      parameters: {
        type: "object",
        properties: {
          node: { type: "string", description: "Node id or name" },
          command: { type: "string", description: "The full command line" },
          timeoutSec: { type: "number", description: "Maximum seconds to wait, default 120" },
        },
        required: ["node", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "see_screen",
      description:
        "Take a screenshot of a machine's screen and look at it. Use this whenever the user refers to something visible (\"that video\", \"the window that is open\", \"the error on screen\", \"what am I looking at\"). Ask a focused question so you know what to look for.",
      parameters: {
        type: "object",
        properties: {
          node: { type: "string", description: "Node id or name" },
          question: { type: "string", description: "What to find or answer on that screen" },
        },
        required: ["node"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control_mouse_keyboard",
      description:
        "Drive the real mouse and keyboard of a machine: move, click, double-click, right-click, scroll, type text, press a key or shortcut (enter, tab, esc, backspace, ctrl+t, alt+tab, win …). x and y are fractions of the whole screen, 0 to 1, origin top-left: (0.5, 0.5) is the middle. Call see_screen first to see where to click, then click, then see_screen again to check it worked.",
      parameters: {
        type: "object",
        properties: {
          node: { type: "string" },
          op: { type: "string", enum: ["move", "click", "double", "right", "scroll", "type", "key"] },
          x: { type: "number", description: "0…1 across the screen" },
          y: { type: "number", description: "0…1 down the screen" },
          text: { type: "string", description: "For op=type" },
          key: { type: "string", description: "For op=key, e.g. enter, tab, ctrl+t" },
          amount: { type: "number", description: "For op=scroll: steps, positive up, negative down" },
        },
        required: ["node", "op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_brain",
      description:
        "Install or upgrade this hub's own AI. install: installs Ollama if missing and pulls the biggest free local model that fits this PC's memory. upgrade: searches the model ladder again and moves to a bigger model when one fits. Use this when the user asks to install, set up, fix or upgrade the brain / model / AI.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["install", "upgrade", "status"] },
          vision: { type: "boolean", description: "Also install a vision model so you can read screenshots." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "node_action",
      description:
        "Act on a machine. open (args {app} or {path} — runs any program by name: chrome, edge, notepad, taskmgr, or a full .exe path), app-start / app-stop (args {app} — a catalogue id like \"ollama\"), apps, detect, pip (args {packages}), pull-model (args {model}), speak (args {text}), open-panel, shutdown, tasks, status.",
      parameters: {
        type: "object",
        properties: {
          node: { type: "string" },
          op: { type: "string" },
          args: { type: "object", description: "Operation arguments, e.g. {app} or {url} or {packages} or {model} or {text}" },
        },
        required: ["node", "op"],
      },
    },
  },
];

const SYSTEM = `You are ATHENA, the resident intelligence of a private machine network.
You control real computers over a local link. Be brief, calm and precise — one or two sentences plus what you did.

Rules:
- Always use a tool before claiming you did something on a machine. Never invent node ids or results.
- When the user points at something on a screen, do not guess: call see_screen, look, then act.
- To operate a desktop, alternate: see_screen → control_mouse_keyboard → see_screen to verify. One click per step, never a blind click sequence.
- Pick the machine whose GPU/state fits the job. If the user says "the PC" or "the 3060", match it to the node list.
- Destructive or expensive actions (shutdown, installs, model pulls, long renders) only when the user clearly asked for them.
- If a tool fails, say what failed in one line and offer the next step.
- Prefer run_command for tasks; prefer node_action for services.
- Report only what a tool actually returns. Never bring up an app the user did not ask about, and never treat a stopped or uninstalled app as a problem or a thing to offer starting. A machine with nothing extra running is simply idle.
- Stay under 40 words unless the user asks for detail. No headings, no lists, no restating the question.`;

/** Models that can actually look at a picture. */
const VISION_MODEL = /(gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o|o3|o4|gemini|claude|llava|moondream|minicpm|qwen.*vl|pixtral|internvl|florence|idefics)/i;

function normaliseBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/**
 * Ollama stores models with a tag ("qwen2:7b"), so a config holding just
 * "qwen2" used to be sent verbatim and came back as a 404 model-not-found.
 * Match what is installed instead of trusting the string.
 */
function pickModel(requested, models) {
  const installed = (models || []).filter(Boolean);
  const want = String(requested || "").trim();
  if (!installed.length) return { model: want || null, note: null };
  if (!want) return { model: installed[0], note: null };
  const lower = want.toLowerCase();
  const exact = installed.find((name) => name.toLowerCase() === lower);
  if (exact) return { model: exact, note: null };
  const tagged = installed.find((name) => name.toLowerCase().startsWith(`${lower}:`));
  if (tagged) return { model: tagged, note: null };
  const bare = lower.split(":")[0];
  const sameFamily = installed.find((name) => name.toLowerCase().split(":")[0] === bare);
  if (sameFamily) return { model: sameFamily, note: `"${want}" → using the installed ${sameFamily}.` };
  return { model: installed[0], note: `"${want}" is not installed here — using ${installed[0]}.` };
}

async function probeBrainUncached(config = {}) {
  const provider = String(config.provider || "auto").toLowerCase();
  if (provider === "off") return { ready: false, provider: "off", model: null, detail: "Brain is switched off." };

  if (provider === "ollama" || (provider === "auto" && !config.apiKey)) {
    const base = normaliseBase(config.baseUrl) || "http://127.0.0.1:11434";
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const json = await res.json();
      const entries = json.models || [];
      const models = entries.map((m) => m.name);
      const picked = pickModel(config.model, models);
      /* Newer Ollama reports capabilities; a model without "tools" cannot call
         run_command/see_screen, and sending tools to it is a hard 400. */
      const caps = entries.find((m) => m.name === picked.model)?.capabilities || null;
      const tools = caps ? caps.includes("tools") : true;
      return {
        ready: Boolean(picked.model),
        provider: "ollama",
        model: picked.model,
        requested: config.model || null,
        models,
        tools,
        base: `${base}/v1`,
        native: base,
        detail: picked.model
          ? `${picked.note ? picked.note + " " : ""}Local model ${picked.model}${models.length > 1 ? ` · ${models.length} installed` : ""}${tools ? "" : " · chat only (this model cannot run tools — use qwen2.5 for that)"}`
          : "Ollama is up but has no models. Pull one, e.g. qwen2.5:7b.",
      };
    } catch {
      if (provider === "ollama") {
        return { ready: false, provider: "ollama", model: null, models: [], detail: "Ollama is not answering on " + base };
      }
    }
  }

  if (config.apiKey) {
    const gemini = provider === "gemini";
    const base =
      normaliseBase(config.baseUrl) || (gemini ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://api.openai.com/v1");
    const model = config.model || (gemini || base.includes("generativelanguage") ? "gemini-2.0-flash" : "gpt-4o-mini");
    return { ready: true, provider: gemini ? "gemini" : "openai", model, models: [model], base, detail: `Remote brain ${model}` };
  }

  return { ready: false, provider: "none", model: null, detail: "No brain configured. Add an API key or run Ollama, or use built-in commands." };
}

/*
 * State is read on every render and on every tick, and each read used to probe
 * the provider. A short cache keeps that off the hot path while still noticing
 * a model pulled a few seconds ago. Settings changes invalidate it explicitly.
 */
const PROBE_TTL_MS = 45_000;
const probeCache = new Map();
const probePending = new Map();

export function invalidateProbeCache() {
  probeCache.clear();
  probePending.clear();
}

export async function probeBrain(config = {}) {
  const key = JSON.stringify([
    String(config.provider || "auto").toLowerCase(),
    String(config.model || ""),
    String(config.baseUrl || ""),
    config.apiKey ? "key" : "no-key",
  ]);
  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;
  const running = probePending.get(key);
  if (running) return running;
  const pending = probeBrainUncached(config)
    .then((value) => {
      probeCache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => probePending.delete(key));
  probePending.set(key, pending);
  return pending;
}

async function resolveBrain(config) {
  const probe = await probeBrain(config);
  if (probe.ready) {
    const base =
      probe.provider === "ollama"
        ? normaliseBase(config.baseUrl) || "http://127.0.0.1:11434/v1"
        : probe.base;
    return {
      ...probe,
      base,
      native: probe.provider === "ollama" ? base.replace(/\/v1$/, "") : base,
      apiKey: config.apiKey || (probe.provider === "ollama" ? "ollama" : ""),
    };
  }
  return probe;
}

/**
 * Ollama's own endpoint is used when it is the brain: it accepts keep_alive
 * (so the model is not unloaded after five idle minutes and then re-read from
 * disk on the next sentence) and options (so a small model stops rambling
 * until the timeout). Anything else still goes through /v1.
 */
/** Models Ollama has told us cannot call tools; they chat without them. */
const NO_TOOLS = new Set();

/**
 * Ollama reloads a model whenever the options differ from the loaded run, and
 * a reload here costs ~15s. So every call — warm-up included — uses exactly
 * these values.
 */
const BRAIN_OPTIONS = { temperature: 0.35, num_predict: 450, top_p: 0.9 };

async function chat(brain, messages, tools, onToken = null) {
  if (tools && (brain.tools === false || NO_TOOLS.has(brain.model))) tools = null;
  /* A stream is only useful when the answer is plain text; tool calls need the
     whole message, so those turns stay unstreamed. */
  const streaming = Boolean(onToken) && brain.provider === "ollama" && brain.native && !tools;
  const ollama = brain.provider === "ollama" && brain.native;
  const url = ollama ? `${brain.native}/api/chat` : `${brain.base}/chat/completions`;
  const payload = ollama
    ? {
        model: brain.model,
        messages,
        stream: false,
        keep_alive: "30m",
        options: BRAIN_OPTIONS,
        ...(tools ? { tools } : {}),
      }
    : {
        model: brain.model,
        messages,
        temperature: 0.35,
        max_tokens: 450,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      };
  if (streaming) payload.stream = true;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${brain.apiKey || "none"}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /does not support tools/i.test(text) && tools) {
      NO_TOOLS.add(brain.model);
      return chat(brain, messages, null, onToken);
    }
    if (res.status === 404) {
      throw new Error(
        `Brain has no model "${brain.model}". Installed: ${(brain.models || []).join(", ") || "none"} — pick one in SYSTEM → THE MIND.`
      );
    }
    throw new Error(`Brain HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  /* Ollama streams one JSON object per line: token by token, so the phone can
     show the sentence forming instead of a spinner for forty seconds. */
  if (streaming) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk;
        try {
          chunk = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(String(chunk.error));
        const piece = chunk?.message?.content || "";
        if (!piece) continue;
        content += piece;
        onToken(piece);
      }
    }
    return { role: "assistant", content: content.trim() };
  }

  const text = await res.text();
  const json = JSON.parse(text);
  const message = ollama ? json.message : json.choices?.[0]?.message;
  if (!message) throw new Error("The brain returned no message.");
  return message;
}

/** Loads the model into memory so the first question is not the slow one. */
export async function warmBrain(config = {}) {
  const brain = await resolveBrain(config);
  if (!brain.ready || brain.provider !== "ollama" || !brain.native) return { warmed: false, reason: "not a local model" };
  try {
    const res = await fetch(`${brain.native}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: brain.model, prompt: "ok", stream: false, options: BRAIN_OPTIONS, keep_alive: "30m" }),
      signal: AbortSignal.timeout(300_000),
    });
    return { warmed: res.ok, model: brain.model };
  } catch (error) {
    return { warmed: false, reason: String(error?.message || error) };
  }
}

/**
 * What the model is allowed to see about a machine. Only apps that are actually
 * up appear here: a stopped app is not news, and naming one — ComfyUI, Ollama,
 * anything — made the model report it as a problem and offer to start it.
 */
function shapeStatus(node, status) {
  if (!status || status.error) return { node: node?.name || null, online: false };
  return {
    node: node?.name || status.name || null,
    online: true,
    platform: status.platform || null,
    cpu: status.cpu || null,
    cores: status.cores ?? null,
    load: status.load ?? null,
    memory: status.memory || null,
    uptimeMin: status.uptimeSec != null ? Math.round(status.uptimeSec / 60) : null,
    gpu: status.gpu
      ? { name: status.gpu.name || null, vramGb: status.gpu.vramGb ?? null, util: status.gpu.util ?? null, temp: status.gpu.temp ?? null }
      : null,
    runningApps: Object.entries(status.services || {})
      .filter(([, service]) => service && service.ok)
      .map(([id]) => id),
    runningTasks: (status.tasks || [])
      .filter((task) => task.state === "running")
      .map((task) => task.label || task.command || task.id)
      .slice(0, 5),
  };
}

function nodeDigest(registry) {
  return registry.list().map((node) => {
    const status = registry.statusOf(node.id)?.status;
    return {
      id: node.id,
      name: node.name,
      online: node.online,
      gpu: status?.gpu?.name || null,
      vramGb: status?.gpu?.vramGb ?? null,
      util: status?.gpu?.util ?? null,
      temp: status?.gpu?.temp ?? null,
      services: Object.entries(status?.services || {})
        .filter(([, service]) => service && (service.ok || service.running))
        .map(([id]) => id),
      platform: status?.platform || null,
      running: status?.tasks?.filter((task) => task.state === "running").length || 0,
    };
  });
}

/**
 * The model may only see apps that are actually running — unless the user
 * explicitly asked about that app. Anything else is noise it turns into
 * "ComfyUI is not running, shall I start it?" on every single report.
 */
function scrubApps(result, asked = "") {
  if (!result || typeof result !== "object") return result;
  const lower = String(asked || "").toLowerCase();
  const copy = { ...result };
  if (Array.isArray(copy.apps)) {
    copy.apps = copy.apps
      .filter((app) => app && (app.running === true || lower.includes(String(app.id || "").toLowerCase())))
      .map(({ installed, note, ...rest }) => rest);
  }
  if (copy.services && typeof copy.services === "object") {
    copy.services = Object.fromEntries(Object.entries(copy.services).filter(([, service]) => service && service.ok));
  }
  return copy;
}

function toolResult(registry, admin, asked = "") {
  return async (name, args) => {
    switch (name) {
      case "list_nodes":
        return nodeDigest(registry);
      case "node_status": {
        const node = registry.get(args.node);
        if (!node) throw new Error(`Unknown node "${args.node}".`);
        await registry.refresh(node.id);
        return shapeStatus(node, registry.statusOf(node.id)?.status);
      }
      case "run_command": {
        const task = await registry.run(args.node, String(args.command || ""), {
          timeoutSec: Math.min(Number(args.timeoutSec) || 120, 1800),
        });
        return { state: task.state, code: task.code, output: String(task.output || "").slice(-4000) };
      }
      case "node_action": {
        const op = String(args.op || "status");
        const result = await registry.action(args.node, op, args.args || {}, op === "open" || op === "launch" ? 20_000 : 120_000);
        return JSON.stringify(scrubApps(result, asked)).slice(0, 4000);
      }
      case "manage_brain": {
        if (!admin) throw new Error("The brain installer is not wired up on this hub.");
        if (String(args.action) === "status") return admin.status();
        const started = admin.start(String(args.action) === "upgrade" ? "upgrade" : "install", { vision: Boolean(args.vision) });
        return {
          ...started,
          note: "Running in the background. Progress is on SYSTEM → BRAIN, and the hub switches to the new model by itself.",
        };
      }
      case "see_screen": {
        const buffer = await registry.screen(args.node);
        const info = await registry.screenInfo(args.node).catch(() => null);
        const size = info?.frame ? `${info.frame.width}×${info.frame.height}` : "screenshot";
        return {
          __image: buffer.toString("base64"),
          note: `Took a ${size} screenshot from ${args.node}.${args.question ? ` Look for: ${args.question}` : ""}`,
        };
      }
      case "control_mouse_keyboard": {
        await registry.input(args.node, {
          op: String(args.op || "click"),
          x: args.x,
          y: args.y,
          text: args.text,
          key: args.key,
          amount: Number(args.amount) || 3,
        });
        return { ok: true, did: `${args.op}${args.key ? " " + args.key : ""}${args.x != null ? ` at ${args.x},${args.y}` : ""}` };
      }
      default:
        throw new Error(`Unknown tool ${name}.`);
    }
  };
}

/**
 * Local models pay a heavy price for a tool schema: on this hardware a plain
 * "hi" took 25s with tools attached and 2s without. Tools are only offered
 * when the sentence actually asks for something to happen.
 */
const ACTION_HINT =
  /\b(run|exec|execute|command|open|close|start|stop|restart|launch|click|double|type|press|scroll|move|screenshot|screen|see|look|watch|install|uninstall|upgrade|pull|download|fetch|status|check|report|list|node|machine|pc|computer|laptop|gpu|vram|cpu|ram|job|task|shell|terminal|file|folder|dir|listen|mute|unmute|volume|shutdown|reboot|brain|model|ollama|comfy|ffmpeg|python|git|yt-dlp|app)\b/i;

const STATUS_QUERY =
  /^(status|report|overview|everything|system)\b|^how('s| is| are)\b[^.?!]{0,40}\b(doing|going|running|online|up|ok|okay|alive)\b|^(what('s| is) the )?(status|state|running|up)\b|^(what|which|anything)\b[^.?!]{0,30}\b(running|active)\b|\b(what('s| is)|anything)\b\s+running\b/;

/**
 * Only the tools the sentence could plausibly need. Handing a 7B model seven
 * schemas made one tool call take fifty seconds; four take a fraction of that,
 * and one good call is enough — the follow-up turn never re-offers them.
 */
function pickTools(text) {
  const lower = String(text || "").toLowerCase();
  const names = new Set(["list_nodes"]);
  if (/\b(app|apps|start|stop|restart|launch|open|service|services|kill)\b/.test(lower)) names.add("node_action");
  if (/\b(screen|see|look|watch|click|double|right|scroll|type|press|key|mouse|window|desktop|button)\b/.test(lower)) {
    names.add("see_screen");
    names.add("control_mouse_keyboard");
  }
  if (/\b(run|exec|execute|command|shell|terminal|cmd|powershell|script|file|folder|dir|job|task|git|python|ffmpeg|pip)\b/.test(lower)) {
    names.add("run_command");
  }
  if (/\b(brain|model|ollama|llm|upgrade|smarter|faster)\b/.test(lower)) names.add("manage_brain");
  if (/\b(status|state|report|gpu|vram|cpu|ram|temp|temperature|memory|uptime|health|machine|machines|node|nodes|pc)\b/.test(lower)) {
    names.add("node_status");
  }
  /* A bare action with no target still needs the catalogue and the status. */
  if (names.size === 1) {
    names.add("node_status");
    names.add("run_command");
    names.add("node_action");
  }
  return TOOLS.filter((tool) => names.has(tool.function.name));
}

/** A model that says "Done." after a tool call has said nothing at all. */
function isUseful(text) {
  const clean = String(text || "").trim();
  if (clean.length < 3) return false;
  return !/^(done|done\.|ok|okay|okay\.|finished|completed|complete|success|sure|no problem)[.!]?$/i.test(clean);
}

/**
 * When the model goes quiet after using a tool, say what actually happened
 * instead of echoing "Done.". The tool already returned the truth.
 */
function composeReply(results, nodes) {
  if (!results?.length) return "";
  const lines = [];
  for (const { name, args, ok, result } of results.slice(-4)) {
    if (!ok || result?.error) {
      lines.push(`That failed: ${String(result?.error || "unknown error").split("\n")[0]}`);
      continue;
    }
    if (name === "run_command") {
      const output = String(result?.output || "").trim();
      const state = result?.state === "done" ? "" : ` (${result?.state})`;
      lines.push(output ? output.split(/\r?\n/).slice(-12).join("\n") : `Ran it — no output${state}.`);
      continue;
    }
    if (name === "node_status") {
      const bits = [result?.node, result?.online ? "online" : "offline"];
      if (result?.cpu) bits.push(String(result.cpu).replace(/\s+/g, " "));
      if (result?.gpu?.name) bits.push(`${result.gpu.name}${result.gpu.vramGb ? ` ${result.gpu.vramGb}GB` : ""}`);
      lines.push(bits.filter(Boolean).join(" · "));
      continue;
    }
    if (name === "list_nodes") {
      const online = nodes.filter((node) => node.online).length;
      lines.push(`${nodes.length} machine${nodes.length === 1 ? "" : "s"} linked, ${online} online: ${nodes.map((node) => node.name).join(", ") || "none"}.`);
      continue;
    }
    if (name === "see_screen") {
      lines.push(String(result?.note || "Took a screenshot — it is on the SCREEN tab."));
      continue;
    }
    if (name === "node_action") {
      const op = String(args?.op || "");
      const target = String(args?.args?.app || args?.args?.path || "");
      if (op === "open" || op === "launch") {
        lines.push(`Opened ${result?.opened || target}.`);
      } else if (op === "apps") {
        const running = (result?.apps || []).filter((app) => app.running);
        lines.push(running.length ? `Running: ${running.map((app) => app.id).join(", ")}.` : "Nothing extra is running.");
      } else if (op === "app-start" || op === "start-comfy") {
        lines.push(`${target || "It"} is running.`);
      } else if (op === "app-stop" || op === "stop-comfy") {
        lines.push(`${target || "It"} stopped.`);
      } else {
        const text = typeof result === "string" ? result : JSON.stringify(result);
        lines.push(text.slice(0, 400));
      }
      continue;
    }
    const text = typeof result === "string" ? result : JSON.stringify(result);
    lines.push(text.slice(0, 400));
  }
  return lines.filter(Boolean).join("\n").slice(0, 1200);
}

export async function ask({ text, config, registry, history = [], admin = null, onToken = null }) {
  const brainConfig = config.brain || config;
  const brain = await resolveBrain(brainConfig);
  const nodes = nodeDigest(registry);

  /* "status" does not need a model: the built-in report is instant, accurate
     and free of any app the user did not ask about. Asking a 7B model to
     paraphrase it took fifty seconds. */
  const plain = String(text || "").trim();
  const NO_ACTION = !/\b(start|stop|restart|run|execute|exec|install|open|launch|click|press|type|screenshot|shutdown|pull|download|scan|pair)\b/i.test(plain);
  if (NO_ACTION && plain.length < 60 && STATUS_QUERY.test(plain)) {
    return { ...(await heuristic({ text: plain, registry, nodes, admin })), provider: "builtin", model: null };
  }

  const baseMessages = [
    {
      role: "system",
      content:
        SYSTEM +
        `\n\nHub: ${config.hubName || "athena"} · LAN ${lanAddresses().map((n) => n.address).join(", ") || "unknown"}` +
        `\nConnected machines:\n${JSON.stringify(nodes, null, 2)}` +
        `\nCurrent time: ${new Date().toISOString()}`,
    },
    ...history.slice(-8),
    { role: "user", content: String(text || "") },
  ];

  if (!brain.ready) {
    return { ...(await heuristic({ text, registry, nodes, admin })), provider: "builtin", model: null };
  }

  /* A model without tools can still talk, just not act. Say so instead of
     pretending the tool set exists. */
  if (brain.provider === "ollama" && brain.tools === false) {
    baseMessages[0].content +=
      "\n\nTools are unavailable on the current local model, so you cannot run commands this turn. Answer helpfully and, when an action is needed, say which action you would take.";
  }

  const messages = [...baseMessages];
  const actions = [];
  const results = [];
  const toolSet = brain.tools !== false && ACTION_HINT.test(String(text || "")) ? pickTools(text) : null;
  try {
    for (let round = 0; round < 5; round += 1) {
      /* First turn may call a tool; after that the model only has to phrase
         the result, so the schema is dropped. */
      const message = await chat(brain, messages, round === 0 ? toolSet : null, onToken);
      const calls = message.tool_calls || [];
      if (!calls.length) {
        const said = String(message.content || "").trim();
        return {
          reply: isUseful(said) ? said : composeReply(results, nodes),
          actions,
          provider: brain.provider,
          model: brain.model,
        };
      }
      messages.push({ role: "assistant", content: message.content || "", tool_calls: calls });
      for (const call of calls) {
        let parsed = {};
        try {
          const raw = call.function?.arguments;
          parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
        } catch {
          parsed = {};
        }
        const name = call.function?.name || "unknown";
        let result;
        let ok = true;
        try {
          result = await toolResult(registry, admin, text)(name, parsed);
        } catch (error) {
          ok = false;
          result = { error: String(error?.message || error) };
        }
        actions.push({ name, args: parsed, ok, at: new Date().toISOString() });
        results.push({ name, args: parsed, ok, result });

        /* A screenshot goes back as a real image, when the model can see. */
        if (result && typeof result === "object" && result.__image) {
          messages.push({ role: "tool", tool_call_id: call.id, content: String(result.note || "Screenshot taken.") });
          if (VISION_MODEL.test(String(brain.model || ""))) {
            messages.push({
              role: "user",
              content: [
                { type: "text", text: "Here is the screenshot you just took. Use it to answer my request." },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${result.__image}` } },
              ],
            });
          } else {
            messages.push({
              role: "user",
              content:
                "Your model has no vision, so the screenshot could not be attached. Tell the user in one line that you took it (it is on the SCREEN tab) and that a vision model would let you read it: Ollama qwen2.5vl:7b or llava, or an OpenAI/Gemini key.",
            });
          }
          continue;
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: typeof result === "string" ? result : JSON.stringify(result).slice(0, 6000),
        });
      }
    }
    return {
      reply: composeReply(results, nodes) || "I ran out of steps on that one — ask me to continue and I'll pick it up.",
      actions,
      provider: brain.provider,
      model: brain.model,
    };
  } catch (error) {
    const fallback = await heuristic({ text, registry, nodes, admin });
    return {
      reply: `${fallback.reply}\n\n(brain unavailable: ${String(error?.message || error).slice(0, 160)})`,
      actions: fallback.actions,
      provider: "builtin",
      model: null,
    };
  }
}

/** Works with no AI at all: a small, honest command language. */
async function heuristic({ text, registry, nodes, admin }) {
  const input = String(text || "").trim();
  const lower = input.toLowerCase();
  const actions = [];
  const first = nodes.find((node) => node.online) || nodes[0];

  const target = () => {
    const match = nodes.find((node) => lower.includes(node.name.toLowerCase()));
    return match ? match.id : first?.id;
  };

  /* Installing the brain has to work before a brain exists — that is the point. */
  if (admin && /\b(install|set ?up|add|get|download|fix)\b[^.\n]{0,24}\bbrain\b|\bbrain\b[^.\n]{0,24}\b(install|setup|set up)\b/.test(lower)) {
    const started = admin.start("install", { vision: /vision|see|screen/.test(lower) });
    return {
      reply: started.busy
        ? "A brain install is already running — watch SYSTEM → BRAIN for the progress."
        : "Installing a brain: Ollama, then the biggest free model this PC can carry. Progress is on SYSTEM → BRAIN, and I switch over by myself when it lands.",
      actions: [{ name: "manage_brain", args: { action: "install" }, ok: Boolean(started.ok || started.busy) }],
    };
  }

  if (admin && /\b(upgrade|better|bigger|smarter|improve)\b[^.\n]{0,24}\bbrain\b|\bbrain\b[^.\n]{0,24}\b(upgrade|better|smarter)\b/.test(lower)) {
    const started = admin.start("upgrade", { vision: /vision|see|screen/.test(lower) });
    return {
      reply: started.busy
        ? "Already working on it — SYSTEM → BRAIN shows the progress."
        : "Searching the local model ladder for something bigger than what I am running, and installing it if it fits.",
      actions: [{ name: "manage_brain", args: { action: "upgrade" }, ok: Boolean(started.ok || started.busy) }],
    };
  }

  if (!nodes.length) {
    return {
      reply: "No machines are linked yet. Open NODES → SCAN, then pair a node with the code shown on that PC.",
      actions,
    };
  }

  if (/^(hi|hey|hello|yo|athena)\b/.test(lower) && lower.length < 24) {
    return {
      reply: `Online. ${nodes.length} machine${nodes.length === 1 ? "" : "s"} linked, ${nodes.filter((n) => n.online).length} answering. What do you need?`,
      actions,
    };
  }

  /* "open chrome", "launch task manager" — the machine runs any program. */
  const openMatch = lower.match(/\b(open|launch|fire up)\s+(?:the\s+)?([a-z0-9 _.+#-]{2,40}?)(?:\s+(?:on|in)\s+(?:this pc|the pc|pc \d+|my pc))?[.?!]*$/);
  if (openMatch && !/\b(file|folder|app page|panel)\b/.test(openMatch[2])) {
    const wanted = openMatch[2].replace(/\s+(app|application|browser|program)$/, "").trim();
    const id = target();
    try {
      const result = await registry.action(id, "open", { app: wanted }, 20_000);
      actions.push({ name: "open", args: { app: wanted }, ok: true });
      return { reply: `Opening ${result?.opened || wanted} on ${nodes.find((node) => node.id === id)?.name}.`, actions };
    } catch (error) {
      actions.push({ name: "open", args: { app: wanted }, ok: false });
      return { reply: `Could not open ${wanted} on that machine: ${error?.message || error}`, actions };
    }
  }

  if (/(\bstatus\b|\breport\b|how are|how is|everything|\bsystem\b|doing|going on|\bwhat('s| is) running\b)/.test(lower) && !/\b(run|execute|start|stop)\b/.test(lower)) {
    const lines = nodes.map((node) => {
      if (!node.online) return `· ${node.name}: offline`;
      const parts = [`· ${node.name}: online`];
      if (node.gpu) parts.push(`${node.gpu} ${node.vramGb ? node.vramGb + "GB" : ""}`.trim());
      if (node.temp !== null) parts.push(`${node.temp}°C`);
      if (node.util !== null) parts.push(`${node.util}% load`);
      if (node.services?.length) parts.push(node.services.join(", "));
      if (node.running) parts.push(`${node.running} task running`);
      return parts.join(" · ");
    });
    return { reply: lines.join("\n"), actions };
  }

  if (/^scan\b/.test(lower)) {
    return { reply: "Scanning the network — open NODES to see anything new that answers.", actions: [{ name: "scan", args: {}, ok: true }] };
  }

  const service = lower.match(/\b(start|stop|restart)\b\s+(?:the\s+)?([a-z0-9.+#-]+)/);
  if (service && !/^(it|that|this|everything|all|them|me)$/.test(service[2])) {
    const verb = service[1];
    const app = service[2].replace(/[.+#-]+$/, "");
    const id = target();
    const op = verb === "stop" ? "app-stop" : "app-start";
    try {
      const result = await registry.action(id, op, { app }, 150_000);
      actions.push({ name: op, args: { node: id, app }, ok: true });
      return { reply: `${app} ${verb === "stop" ? "stopped" : "started"} on ${nodes.find((n) => n.id === id)?.name}. ${result?.error ? "(" + result.error + ")" : ""}`.trim(), actions };
    } catch (error) {
      actions.push({ name: op, args: { node: id, app }, ok: false });
      return { reply: `Could not ${verb} ${app}: ${error?.message || error}`, actions };
    }
  }

  const command = input.replace(/^(run|execute|exec|do)\s+/i, "");
  if (/^(run|execute|exec|do)\s+/i.test(input) || /^[>!]/.test(input)) {
    const line = input.replace(/^[>!]\s*/, "");
    const id = target();
    try {
      const task = await registry.run(id, line, { timeoutSec: 240 });
      actions.push({ name: "run_command", args: { node: id, command: line }, ok: task.state === "done" });
      return { reply: `$ ${line}\n${String(task.output || "(no output)").slice(-2500)}`, actions };
    } catch (error) {
      actions.push({ name: "run_command", args: { node: id, command: line }, ok: false });
      return { reply: `Command failed: ${error?.message || error}`, actions };
    }
  }

  if (command !== input && command) {
    return { reply: `Say \`run ${command}\` and I'll execute it on ${first.name}.` };
  }

  return {
    reply:
      "I can drive these machines. With an AI key or a local model I understand anything; right now I know: \n" +
      "· status\n· run <command>\n· start / stop <app>\n· scan\n· install brain / upgrade brain\n" +
      "Press INSTALL BRAIN on SYSTEM for a real conversation.",
    actions,
  };
}
