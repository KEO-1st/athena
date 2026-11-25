import { answerQuick, identityBlock, identityFacts, quickIntent } from "./identity.mjs";

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
      name: "node_processes",
      description:
        "List what is actually running on a machine: the top processes by memory, plus which managed services (ComfyUI, Ollama) are up. Use this for \"what is running on this PC\", \"what is open\", or before deciding whether a program is already up.",
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
      name: "node_action",
      description:
        "Act on a machine. open: args {app} or {path} runs a program by name (chrome, task manager, notepad, taskmgr) or a full .exe path; to open a website use {url} and optionally {browser}, e.g. {url:\"https://youtube.com\", browser:\"chrome\"}. app-start / app-stop (args {app} — a catalogue id like \"ollama\"), apps, detect, pip (args {packages}), pull-model (args {model}), speak (args {text}), open-panel, shutdown, tasks, status.",
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
You can hold a normal conversation and you can act on real computers over a local link.

How to answer:
- Match the request. Greetings, questions, explanations and advice are conversation: answer them naturally and give enough detail to be genuinely useful. A confirmation of a completed action can be one line.
- Do not treat every message as a command. If the user is planning, asking for advice or thinking aloud, talk it through and do not run anything until they ask you to act.
- Answer directly. Never narrate your reasoning, planning or internal debate. Do not begin with "Okay, the user...".
- Never mention tools, function names, schemas, prompts, model routing or internal steps. Talk about outcomes in plain words.
- If a request is genuinely ambiguous about what to act on, ask one short clarification instead of guessing. If the conversation makes it clear, act.
- In plain words, you can: chat; check machines and their CPU, memory and GPU; list running processes; run commands; open apps and websites; look at and control Windows screens; install or start catalogue software; and (on the Hub) install or upgrade the local brain. Say what you can do without listing internal tool names.

When acting:
- Always use a tool before claiming you did something on a machine. Never invent node ids, metrics or results.
- For a task with several steps, call one tool at a time, read its result, then decide the next step. Do not stop after the first successful step when the user asked for more.
- A tool only means the request was sent. Say it worked only when the tool returned successfully. If it returned an error, say it failed and quote the useful part.
- If a tool fails, read the error. Retry only with a changed command or approach; otherwise report the failure honestly and offer the next step. Never call a failed action a success.
- When the user points at something on a screen, do not guess: call see_screen, look, then act.
- A screenshot is not a way to find out what is running. Use node_processes for processes, services and open programs.
- To operate a desktop, alternate: see_screen → control_mouse_keyboard → see_screen to verify. One click per step, never a blind click sequence.
- To open a website, call node_action open with a url and optionally a browser. Do not take a screenshot instead of opening it.
- Pick the machine whose GPU/state fits the job. If the user says "the PC" or "the 3060", match it to the node list.
- Short follow-ups ("it", "that", "again", "do it") refer to the previous turn. Read the conversation before answering; never pretend to have forgotten.
- Destructive or expensive actions (shutdown, installs, model pulls, long renders) only when the user clearly asked for them.
- Prefer run_command for tasks; prefer node_action for services.
- Report only what a tool actually returns. Never bring up an app the user did not ask about, and never treat a stopped or uninstalled app as a problem or a thing to offer starting. A machine with nothing extra running is simply idle.
- Never print raw JSON, tool payloads or field names. Say it in words.
- Keep action confirmations under 40 words. Give explanations room — usually two to five sentences — when the user asks what, why or how. No headings, no lists, no restating the question.`;

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
/* A local 4B model on CPU produces roughly 10 tokens/second here. A 360-token
   cap keeps a normal answer complete while bounding the old multi-minute turn. */
const BRAIN_OPTIONS = { temperature: 0.35, num_predict: 360, top_p: 0.9 };

/* A provider that has not produced a complete turn in a minute is not going to
   make a short greeting feel responsive. The UI now shows live status, and the
   brain falls back to its honest built-in answer instead of hanging for the old
   three-minute provider timeout. */
const MODEL_TIMEOUT_MS = 60_000;

async function chat(brain, messages, tools, onToken = null, timeoutMs = MODEL_TIMEOUT_MS) {
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
        /* Qwen3 and other reasoning models otherwise spend the whole turn in
           the hidden thinking channel, which is what made a greeting take
           minutes and show no text. Normal chat should answer, not deliberate. */
        think: false,
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
    signal: AbortSignal.timeout(Math.max(50, Number(timeoutMs) || MODEL_TIMEOUT_MS)),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /does not support tools/i.test(text) && tools) {
      NO_TOOLS.add(brain.model);
      return chat(brain, messages, null, onToken, timeoutMs);
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
    let completed = false;
    try {
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
      completed = true;
      return { role: "assistant", content: content.trim() };
    } finally {
      /* A timeout aborts the fetch/body; a closed client or a bad chunk can
         also leave the stream half-read. Cancel and release it either way so
         an abandoned model response cannot keep a connection or reader alive. */
      if (!completed) {
        try {
          await reader.cancel();
        } catch {
          /* already aborted */
        }
      }
      try {
        reader.releaseLock();
      } catch {
        /* released */
      }
    }
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
      memory: status?.memory || null,
      load: status?.load ?? null,
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
        const code = Number(task.code);
        const failed = task.state === "failed" || task.state === "timeout" || (Number.isFinite(code) && code !== 0);
        return {
          state: task.state,
          code: task.code,
          output: String(task.output || "").slice(-4000),
          ...(failed
            ? {
                error:
                  task.state === "timeout"
                    ? "The command was still running when the time limit expired."
                    : Number.isFinite(code) && code !== 0
                      ? `The command exited with code ${task.code}.`
                      : "The command failed on the machine.",
              }
            : {}),
        };
      }
      case "node_processes": {
        const result = await registry.action(args.node, "processes", {}, 20_000);
        return result;
      }
      case "node_action": {
        const op = String(args.op || "status");
        const result = await registry.action(args.node, op, args.args || {}, op === "open" || op === "launch" ? 25_000 : 120_000);
        const cleaned = scrubApps(result, asked);
        /* The node answers 200 with ok:false when a launch did not actually
           happen. A tool that reports the truth must reach the model as an
           error, not as a success payload. */
        if (cleaned && cleaned.ok === false) {
          throw new Error(String(cleaned.error || cleaned.note || "The machine could not do that."));
        }
        /* An object, not a JSON string: the reply composer and the model both
           need the fields, and a string used to reach the user as raw JSON. */
        return cleaned;
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
function pickTools(text, context = "") {
  const lower = String(text || "").toLowerCase();
  const names = new Set(["list_nodes"]);
  if (/\b(app|apps|start|stop|restart|launch|open|service|services|kill)\b/.test(lower)) names.add("node_action");
  if (/\b(process|processes|running|using|consuming|hogging|open windows|what's open|task manager|tasks)\b/.test(lower)) names.add("node_processes");
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
  /* "open it" / "do that again" inherits the subject from the previous turn. */
  if (context) {
    const carried = String(context).toLowerCase();
    if (/\b(app|apps|open|launch|start|stop|restart|browser|website|url)\b/.test(carried)) names.add("node_action");
    if (/\b(process|processes|running|task manager)\b/.test(carried)) names.add("node_processes");
  }
  /* A bare action with no target still needs the catalogue and the status. */
  if (names.size === 1) {
    names.add("node_status");
    names.add("run_command");
    names.add("node_action");
  }
  return TOOLS.filter((tool) => names.has(tool.function.name));
}

/**
 * Questions about the world are conversation, not commands. Without this, a
 * sentence such as "what is the difference between RAM and VRAM?" offered
 * machine tools purely because it contained the word RAM.
 */
function isGeneralConversation(text, nodes = []) {
  const clean = String(text || "").trim();
  if (!/^(what|why|how|which|who|when|where|is|are|do|does|can|could|should|would|explain|describe|teach me)\b/i.test(clean)) return false;
  /* "Can you open Chrome?" is a request, not a request for an explanation. */
  if (/^(can|could|would|will)\s+you\b/i.test(clean) && !/^(can|could|would)\s+you\s+(explain|describe|teach)\b/i.test(clean)) return false;
  /* "How do I…" is advice; "how much RAM does my PC have" is a real reading. */
  if (/^how\s+(do|can|should|would)\s+(i|we)\b/i.test(clean)) return true;
  const lower = clean.toLowerCase();
  if (/\b(my|our)\s+(pc|computer|machine|node|laptop|server|hub|ram|cpu|gpu|vram|memory|disk|screen|browser|apps?|processes?)\b/i.test(clean)) return false;
  if (/\b(the|this|that)\s+(pc|computer|machine|node|laptop|server|hub)\b/i.test(clean)) return false;
  if (/\b(which|what)\s+(node|machine|pc|computer)\b/i.test(clean)) return false;
  if (/\b(available|linked|connected)\s+(nodes|machines)\b/i.test(clean)) return false;
  if (nodes.some((node) => node?.name && lower.includes(String(node.name).toLowerCase()))) return false;
  return true;
}

/** A request that names two targets or two distinct actions is not a one-shot. */
const STEP_VERBS =
  /\b(open|launch|run|execute|check|find|compare|click|type|press|search|install|start|stop|restart|show|take|look|see|tell|report|list|read|write|play|navigate|visit|go|move|copy|create|make|fix|upgrade|download|inspect|verify)\b/gi;

function looksMultiStep(text, nodes = []) {
  const clean = String(text || "");
  const verbs = new Set([...clean.matchAll(STEP_VERBS)].map((match) => match[1].toLowerCase()));
  const connector = /\b(and|then|after|before|also|next|finally|followed by)\b/i.test(clean);
  const named = nodes.filter((node) => node?.name && clean.toLowerCase().includes(String(node.name).toLowerCase())).length;
  return (verbs.size >= 2 && connector) || named >= 2;
}

/** Exposed for tests: which tools a sentence (plus its follow-up context) gets. */
export function selectToolNames(text, context = "") {
  return pickTools(text, context).map((tool) => tool.function.name);
}

/** Short follow-ups inherit the previous turn's subject for tool selection. */
const FOLLOW_UP = /^(it|that|this|them|those|again|yes|no|ok|okay|do it|now|and|then|the same|go on|continue|sure|please do)\b/i;
const BARE_ACTION_FOLLOW_UP = /^(open|launch|run|start|stop|check|find|show|do|turn)\s+(it|that|this|them|those)\b/i;

const isFollowUp = (text) => {
  const clean = String(text || "").trim();
  return FOLLOW_UP.test(clean) || BARE_ACTION_FOLLOW_UP.test(clean);
};

function contextualText(text, history) {
  const clean = String(text || "").trim();
  if (!isFollowUp(clean)) return "";
  const previous = [...history].reverse().find((item) => item?.role === "user" && String(item.content || "").trim());
  return previous ? String(previous.content).slice(0, 400) : "";
}

/** A model that pasted a payload instead of talking is not a reply. */
function looksLikeJson(text) {
  const clean = String(text || "").trim();
  if (!/^[[{]/.test(clean)) return false;
  try {
    const parsed = JSON.parse(clean);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function polish(text, results, nodes) {
  const clean = String(text || "").trim();
  if (!looksLikeJson(clean)) return clean;
  return composeReply(results, nodes) || "I have the result, but it came back as raw data. Open the relevant tab to see it.";
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
      const output = String(result?.output || "").trim();
      const detail = output ? `\n${output.split(/\r?\n/).slice(-6).join("\n")}` : "";
      lines.push(`That failed: ${String(result?.error || "unknown error").split("\n")[0]}${detail}`);
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
      const detail = nodes
        .slice(0, 6)
        .map((node) => {
          const bits = [String(node.name)];
          if (!node.online) bits.push("offline");
          if (node.gpu) bits.push(`${node.gpu}${node.vramGb ? ` ${node.vramGb}GB` : ""}`);
          if (node.memory?.totalGb) bits.push(`RAM ${node.memory.freeGb ?? "?"}/${node.memory.totalGb}GB free`);
          return bits.join(" · ");
        })
        .join("\n");
      lines.push(`${nodes.length} machine${nodes.length === 1 ? "" : "s"} linked, ${online} online.${detail ? `\n${detail}` : ""}`);
      continue;
    }
    if (name === "see_screen") {
      lines.push(String(result?.note || "Took a screenshot — it is on the SCREEN tab."));
      continue;
    }
    const where = nodeNameOf(nodes, args?.node);
    if (name === "node_processes") {
      const processes = result?.processes || [];
      if (!processes.length) {
        lines.push(`Could not read a process list from ${where}.`);
        continue;
      }
      lines.push(
        `${where} — top processes by memory:\n` +
          processes.slice(0, 6).map((process) => `· ${process.name} · ${Math.round(process.memMb || 0)} MB`).join("\n")
      );
      continue;
    }
    if (name === "node_action") {
      const op = String(args?.op || "");
      const target = String(args?.args?.app || args?.args?.path || args?.args?.url || "");
      if (op === "open" || op === "launch" || op === "start-app") {
        const opened = result?.opened || target || "it";
        lines.push(`Opened ${opened} on ${where}${result?.url ? ` — ${result.url}` : ""}.`);
      } else if (op === "apps") {
        const running = (result?.apps || []).filter((app) => app.running);
        lines.push(running.length ? `${where} — running: ${running.map((app) => app.id).join(", ")}.` : `${where} — nothing extra is running.`);
      } else if (op === "app-start" || op === "start-comfy") {
        lines.push(`${target || "It"} is running on ${where}.`);
      } else if (op === "app-stop" || op === "stop-comfy") {
        lines.push(`${target || "It"} stopped on ${where}.`);
      } else if (op === "speak") {
        lines.push(result?.spoken ? `Said it out loud on ${where}.` : `Could not speak on ${where}.`);
      } else if (op === "status") {
        const bits = [where, result?.online === false ? "offline" : "online"];
        if (result?.gpu?.name) bits.push(result.gpu.name);
        if (result?.cpu) bits.push(String(result.cpu).replace(/\s+/g, " "));
        lines.push(bits.filter(Boolean).join(" · "));
      } else {
        lines.push(summarize(result));
      }
      continue;
    }
    if (name === "control_mouse_keyboard") {
      lines.push(result?.did ? `Did it on ${where}: ${result.did}.` : `Did it on ${where}.`);
      continue;
    }
    lines.push(summarize(result));
  }
  return lines.filter(Boolean).join("\n").slice(0, 1200);
}

/** Human words instead of a raw JSON blob. */
function summarize(result) {
  if (result == null) return "";
  if (typeof result === "string") return result.slice(0, 400);
  if (typeof result !== "object") return String(result);
  const parts = [];
  for (const key of ["opened", "url", "note", "message", "output", "text", "error"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
  }
  if (parts.length) return parts.join(" · ").slice(0, 400);
  const json = JSON.stringify(result);
  return !json || json === "{}" ? "" : json.slice(0, 400);
}

function nodeNameOf(nodes, ref) {
  const key = String(ref || "").toLowerCase();
  const found = (nodes || []).find(
    (node) => String(node.id || "").toLowerCase() === key || String(node.name || "").toLowerCase() === key || String(node.name || "").toLowerCase().includes(key)
  );
  return found?.name || String(ref || "that machine");
}

const ACTION_WORDS = /\b(start|stop|restart|run|execute|exec|install|uninstall|upgrade|open|launch|click|press|type|screenshot|shutdown|pull|download|scan|pair)\b/i;

/** Plain-language progress for the controller while a tool is running. */
function progressFor(name, args, nodes) {
  const where = nodeNameOf(nodes, args?.node);
  if (name === "list_nodes") return "Checking the machines on the network…";
  if (name === "node_status") return `Checking ${where}…`;
  if (name === "node_processes") return `Reading processes on ${where}…`;
  if (name === "run_command") return `Running a command on ${where}…`;
  if (name === "see_screen") return `Looking at ${where}'s screen…`;
  if (name === "control_mouse_keyboard") return `Controlling ${where}…`;
  if (name === "manage_brain") return args?.action === "upgrade" ? "Looking for a larger local model…" : "Setting up the local brain…";
  if (name === "node_action") {
    const target = String(args?.args?.app || args?.args?.path || args?.args?.url || "it");
    if (args?.op === "open" || args?.op === "launch") return `Opening ${target} on ${where}…`;
    if (args?.op === "app-start" || args?.op === "start-comfy") return `Starting ${target} on ${where}…`;
    if (args?.op === "app-stop" || args?.op === "stop-comfy") return `Stopping ${target} on ${where}…`;
    return `Working on ${where}…`;
  }
  return `Working on ${where}…`;
}

/* One turn cannot run for longer than the controller's request timeout. */
const TURN_BUDGET_MS = 170_000;

const finished = (startedAt, extra = {}) => ({ ...extra, meta: { ms: Date.now() - startedAt, rounds: 0, tools: [], ...(extra.meta || {}) } });

export async function ask({ text, config, registry, history = [], admin = null, onToken = null, onStatus = null, modelTimeoutMs = MODEL_TIMEOUT_MS }) {
  const startedAt = Date.now();
  const brainConfig = config.brain || config;
  const brain = await resolveBrain(brainConfig);
  const nodes = nodeDigest(registry);
  const plain = String(text || "").trim();
  const convo = (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));

  /* A greeting is not a reasoning task. Answering it locally avoids loading or
     waiting for a model just to say hello. */
  const GREETING =
    /^(hi|hello|hey|yo|greetings|good (morning|afternoon|evening))(?:\s+(athena|there))?(?:\s*[,!.\u2013\u2014-]?\s*(how are you(?: doing)?|how('s| is) it going|how are things|what('s| is) up))?[.!?]*$/i;
  if (GREETING.test(plain)) {
    const online = nodes.filter((node) => node.online).length;
    const asksHow = /how are you|how('s| is) it going|how are things|what('s| is) up/i.test(plain);
    const state = online
      ? `with ${online} of ${nodes.length} node${nodes.length === 1 ? "" : "s"} answering`
      : "No nodes are linked yet — open NODES to add one whenever you are ready";
    return finished(startedAt, {
      reply: asksHow ? `Hello. I am running well and ready. ${online ? `I have ${online} node${online === 1 ? "" : "s"} answering.` : "No machines are linked yet."}` : `Hello. I am here, ${state}.`,
      actions: [],
      images: [],
      provider: "athena",
      model: null,
      meta: { path: "identity:greeting", rounds: 0, tools: [] },
    });
  }

  /* "Open it" with nothing before it is not a command; guessing would be worse
     than asking one short question. */
  if (isFollowUp(plain) && !convo.some((item) => item.role === "user")) {
    const verb = /^(open|launch|run|start|stop|check|find)\b/i.exec(plain)?.[1]?.toLowerCase();
    return finished(startedAt, {
      reply: verb
        ? `I don't have an earlier request to refer to. What should I ${verb}, and on which machine?`
        : "I don't have an earlier request to act on. Tell me what you would like me to do, and on which machine.",
      actions: [],
      images: [],
      provider: "athena",
      model: null,
      meta: { path: "clarify", rounds: 0, tools: [] },
    });
  }

  /* Identity questions are answered from the hub's own facts. This is both the
     correct answer and the fastest one: no model, no tools, no guessing. */
  const facts = identityFacts({ config, brain, nodes, startedAt: config.startedAt || null });
  const quick = quickIntent(plain);
  const asksQuestion = /^(what|what's|whats|which|who|where|how|is|are|do|does|can)\b/i.test(plain);
  if (quick && (asksQuestion || !ACTION_WORDS.test(plain))) {
    const reply = await answerQuick(quick, {
      text: plain,
      facts,
      history: convo,
      listProcesses: (nodeRef) => registry.action(nodeRef, "processes", {}, 20_000),
    });
    if (reply) {
      return finished(startedAt, {
        reply,
        actions: [],
        images: [],
        provider: "athena",
        model: brain.model || null,
        meta: { path: `identity:${quick}`, rounds: 0, tools: [] },
      });
    }
  }

  /* "status" does not need a model: the built-in report is instant, accurate
     and free of any app the user did not ask about. Asking a 7B model to
     paraphrase it took fifty seconds. */
  const NO_ACTION = !ACTION_WORDS.test(plain);
  if (NO_ACTION && plain.length < 60 && STATUS_QUERY.test(plain)) {
    return finished(startedAt, {
      ...(await heuristic({ text: plain, registry, nodes, admin })),
      images: [],
      provider: "builtin",
      model: null,
      meta: { path: "builtin:status", rounds: 0, tools: [] },
    });
  }

  const baseMessages = [
    {
      role: "system",
      content:
        SYSTEM +
        `\n\n${identityBlock(facts)}` +
        `\nCurrent time: ${new Date().toISOString()}`,
    },
    ...convo,
    { role: "user", content: String(text || "") },
  ];

  if (!brain.ready) {
    return finished(startedAt, {
      ...(await heuristic({ text, registry, nodes, admin })),
      images: [],
      provider: "builtin",
      model: null,
      meta: { path: "builtin:heuristic", rounds: 0, tools: [] },
    });
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
  const images = [];
  const multiStep = looksMultiStep(plain, nodes);
  const pickedTools =
    brain.tools !== false && ACTION_HINT.test(String(text || "")) && !isGeneralConversation(plain, nodes)
      ? pickTools(text, contextualText(text, convo))
      : null;
  const toolSet = !admin && pickedTools
    ? pickedTools.filter((tool) => tool.function.name !== "manage_brain")
    : pickedTools;
  let rounds = 0;
  try {
    for (let round = 0; round < 4; round += 1) {
      const remaining = TURN_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < 5_000) break;
      /* Keep tools available while a task has more than one step or after a
         failure. A single verified action is still answered immediately. */
      const retrying = results.some((entry) => !entry.ok);
      const offerTools = toolSet && (round === 0 || multiStep || retrying) ? toolSet : null;
      rounds = round + 1;
      if (round > 0) onStatus?.(retrying ? "That did not work — trying another approach…" : "Working through the next step…");
      const message = await chat(brain, messages, offerTools, onToken, Math.min(modelTimeoutMs, remaining));
      const calls = message.tool_calls || [];
      if (!calls.length) {
        const said = String(message.content || "").trim();
        return finished(startedAt, {
          reply: isUseful(said) ? polish(said, results, nodes) : composeReply(results, nodes),
          actions,
          images,
          provider: brain.provider,
          model: brain.model,
          meta: { path: "model", rounds: round + 1, tools: actions.map((action) => action.name) },
        });
      }
      messages.push({ role: "assistant", content: message.content || "", tool_calls: calls });
      for (const [index, call] of calls.entries()) {
        let parsed = {};
        let parseError = null;
        try {
          const raw = call.function?.arguments;
          parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
        } catch {
          parseError = "The tool arguments were not valid JSON, so nothing ran.";
        }
        const name = call.function?.name || "unknown";
        let result;
        let ok = true;
        onStatus?.(progressFor(name, parsed, nodes));
        if (parseError) {
          ok = false;
          result = { error: parseError };
        } else {
          try {
            result = await toolResult(registry, admin, text)(name, parsed);
            if (result && typeof result === "object" && !Array.isArray(result) && result.error) ok = false;
          } catch (error) {
            ok = false;
            result = { error: String(error?.message || error) };
          }
        }
        actions.push({ name, args: parsed, ok, at: new Date().toISOString() });
        results.push({ name, args: parsed, ok, result });

        /* The screenshot also goes back to the app, which shows it in the
           conversation instead of describing it. */
        if (result && typeof result === "object" && result.__image) {
          images.push({ node: parsed.node || null, url: `data:image/jpeg;base64,${result.__image}` });
          messages.push({ role: "tool", tool_call_id: call.id || `call_${index}`, content: String(result.note || "Screenshot taken.") });
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
          tool_call_id: call.id || `call_${index}`,
          content: typeof result === "string" ? result : JSON.stringify(result).slice(0, 6000),
        });
      }

      /* A single verified action needs no second model round. A multi-step
         request, a failed step or a screenshot does: the model must see the
         result before deciding what to do next. */
      const conclusive =
        !multiStep &&
        results.slice(-calls.length).every((entry) => entry.ok && FINAL_TOOLS.has(entry.name));
      if (conclusive && results.length) {
        return finished(startedAt, {
          reply: composeReply(results, nodes),
          actions,
          images,
          provider: brain.provider,
          model: brain.model,
          meta: { path: "model:action", rounds: round + 1, tools: actions.map((action) => action.name) },
        });
      }
    }
    return finished(startedAt, {
      reply: composeReply(results, nodes) || "I ran out of steps on that one — ask me to continue and I'll pick it up.",
      actions,
      images,
      provider: brain.provider,
      model: brain.model,
      meta: { path: "model:limit", rounds: rounds || 4, tools: actions.map((action) => action.name) },
    });
  } catch (error) {
    const fallback = await heuristic({ text, registry, nodes, admin });
    return finished(startedAt, {
      reply: `${fallback.reply}\n\n(brain unavailable: ${String(error?.message || error).slice(0, 160)})`,
      actions: fallback.actions,
      images: [],
      provider: "builtin",
      model: null,
      meta: { path: "builtin:fallback", rounds: 0, tools: [] },
    });
  }
}

/* Only verified actions are conclusive. Read tools still get a model round so
   the answer is phrased and the model can choose a different tool if the first
   result did not actually answer the question. */
const FINAL_TOOLS = new Set(["run_command", "node_action"]);

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

  if (!admin && /\b(install|set ?up|add|get|download|fix|upgrade|improve)\b[^.\n]{0,24}\bbrain\b|\bbrain\b[^.\n]{0,24}\b(install|set ?up|upgrade)\b/.test(lower)) {
    return {
      reply: "Only the Hub administrator can install or upgrade the brain. Ask on the Hub PC.",
      actions,
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

  /* "open chrome", "open task manager", "open youtube in chrome" — the
     machine launches it and confirms a real process appeared. */
  const openMatch = lower.match(
    /\b(open|launch|fire up)\s+(?:the\s+)?([a-z0-9 _.+#:/-]{2,60}?)(?:\s+(?:in|with)\s+([a-z0-9 ]{2,20}))?(?:\s+(?:on|in)\s+(?:this pc|the pc|my pc))?[.?!]*$/
  );
  if (openMatch && !/\b(file|folder|app page|panel)\b/.test(openMatch[2])) {
    const wanted = openMatch[2].replace(/\s+(app|application|program)$/, "").trim();
    const browser = openMatch[3]?.replace(/\s+(browser)$/, "").trim() || undefined;
    const id = target();
    const name = nodes.find((node) => node.id === id)?.name || "that machine";
    const args = { app: wanted, ...(browser ? { browser } : {}) };
    try {
      const result = await registry.action(id, "open", args, 25_000);
      if (result?.ok === false) {
        actions.push({ name: "open", args, ok: false });
        return { reply: `Could not open ${wanted} on ${name}: ${result.error || result.note || "it did not start"}`, actions };
      }
      actions.push({ name: "open", args, ok: true });
      const what = result?.url || result?.opened || wanted;
      return { reply: `Opened ${what} on ${name}.`, actions };
    } catch (error) {
      actions.push({ name: "open", args, ok: false });
      return { reply: `Could not open ${wanted} on ${name}: ${error?.message || error}`, actions };
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
