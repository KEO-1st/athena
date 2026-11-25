# ATHENA — Architecture Audit

**Status:** Historical audit of the pre-3.0 architecture, retained for evidence. It is no longer a description of `main`: the reliability/controller sprint added device sessions, bidirectional protocol checks, per-node audio sources, adaptive screen capture and a portable-package fix. The current behavior and remaining limits are in §15 at the end; earlier sections describe the audited commit and must not be read as current status.

**Repository:** `KEO-1st/athena` · branch `main` · historical HEAD `60663d9`; current implementation audited at `81f1484` plus this sprint · 1 contributor · tests and packaging now exist (see §15).

**Audit date:** 2026-11-24

**Method:** static inspection of the source tree. The application was **not** started, no dependency or winget install was run, and no network calls were made against a live hub or node. Everything marked CONFIRMED below is directly evidenced by code in this repository. Anything that depends on runtime, hardware, a provider API or a specific Windows build is marked LIKELY or HYPOTHESIS. Line numbers refer to the audited revision.

**Conventions used in this report**

| Tag | Meaning |
| --- | --- |
| CONFIRMED | Verified by reading the exact source lines cited. |
| LIKELY | Strongly implied by code, but would need a runtime test to be certain. |
| HYPOTHESIS | A plausible failure mode that the code does not settle either way. |

---

## 1. Executive summary

ATHENA is a single-repository, zero-npm-dependency Node.js system with four runtime pieces:

1. a **hub** (`server.mjs`, port 4790) that owns state, auth, the brain, jobs, and the PWA API;
2. a **node agent** (`node/athena-node.mjs`, port 47910) that runs on each remote Windows machine and exposes screen, input, audio, apps, shell and ComfyUI;
3. a **controller PWA** (`public/`) served by the hub — the "cosmic eye" UI, chat, screen focus mode, apps and system pages;
4. two **PowerShell host helpers** (`node/host-screen.ps1`, `node/host-input.ps1`) plus `.cmd` launchers.

The core loop — controller → hub → node → host helper → screen frame back to the controller — genuinely works end to end **on the same LAN, unencrypted, with Windows nodes only**. The distributed *intelligence* the vision describes, however, does not exist: the brain is a hub-local Ollama client or a hub-local cloud API client, with no memory on the server, no multi-step tool loop beyond the first model round, no presence flow, no updater, and no remote-access path that survives leaving the LAN.

### Vision scorecard

| Vision area | State | One-line verdict |
| --- | --- | --- |
| A. Conversation | **Partially implemented** | Real streaming chat, but history is client-supplied (last 8 messages) and stored in `localStorage`; nothing on the server remembers a conversation. |
| B. Planning / execution | **Partially implemented** | Tools exist and run, but the tool schema is only offered on round 0 of `ask()`, so see → act → verify → replan cannot happen without a new user turn. |
| C. Memory | **Missing** (server-side) | Only `public/app.js` `localStorage["athena.chat"]` (last 40 messages) and a client-sent 8-message window. Job history is never fed to the brain. |
| D. Vision | **Partially implemented** | Screenshot capture and image attachment to vision models work; no OCR, no region crop, no upload, model support detected by a model-name regex. |
| E. Voice | **Partially implemented** | Browser Web Speech STT/TTS + node SAPI speech; no wake word, barge-in, continuous conversation or server-side speech. iOS needs HTTPS, which does not exist. |
| F. Distributed AI | **Missing** | Node Ollama binds `127.0.0.1` and there is no route, registry or UI to place/route models on nodes. |
| G. Presence / onboarding | **Missing** | Node install is copying a folder and running a `.cmd`; no presence page, no consent screen, no enrollment wizard. |
| H. Self-update | **Missing** | No updater, no GitHub integration, no release manifest, no backup/rollback, no health check. |
| I. Remote access | **Missing** | Plain HTTP, LAN broadcast discovery, no TLS, no relay/tunnel/VPN integration. |
| J. Visual identity | **Mostly implemented** | Inline SVG oculus, hand-built CSS animation, accent/motion/glass controls; `athena-bust.jpg` is unused and version labels disagree. |
| External integrations | **Partially implemented** | `/v1/ask` + hashed API keys, but keys are unscoped (shell/shutdown included), no webhooks, no OpenAPI, no rate limit. |
| Hub portability | **Partially implemented** | State is portable JSON, but there is no export/import, no hub identity, and node links are keyed on hub *name*. |

### Highest-severity findings (details in §6–§9)

1. **Loopback is treated as full authorization on the node** (`tokenOk`, `node/athena-node.mjs:168`). Any process or web page on the node machine can drive the machine, and `GET /api/local/code` hands out the pairing code to any loopback caller.
2. **No Host/Origin validation anywhere**, with `Access-Control-Allow-Origin: *`. Combined with the loopback trust above, DNS rebinding is a realistic local-takeover path (CONFIRMED prerequisites, HYPOTHESIS on browser behaviour).
3. **The hub access code is returned to every authenticated client** by `hubState()` (`server.mjs:268`) and accepted directly as a credential (`authenticate`, `server.mjs:152`); secrets are also accepted as `?token=` query parameters for SSE and audio.
4. **Node pairing codes are logged in plaintext** at boot and returned to the hub in `/api/status` through `tailLog()`.
5. **Any session can disable authentication** (`openMode`) or rotate the access code via `/api/settings`, and the hub can remotely flip a node's `allowShell` / `allowInput` / `allowShutdown` without local approval.
6. **Queued jobs from a previous hub run never execute** and running jobs are orphaned; the UI offers CANCEL for running jobs but the server returns 409.
7. **The brain drops its tool schema after round 0**, so the agentic loop the vision describes is not possible in one turn.

---

## 2. What was inspected

| Path | Lines | What it is |
| --- | --- | --- |
| `server.mjs` | 861 | Hub HTTP server, auth, sessions, API keys, SSE, jobs, brain routes, static serving. |
| `lib/brain.mjs` | 819 | Tools, system prompt, provider probing, chat streaming, tool execution, reply composition, heuristic fallback. |
| `lib/brain-install.mjs` | 336 | Model ladders, RAM-based selection, Ollama install via winget, pull/upgrade. |
| `lib/nodes.mjs` | 212 | Node registry, pairing, refresh, action/run/screen/input/audio/apps calls. |
| `lib/jobs.mjs` | 126 | Persistent job queue, one job per node. |
| `lib/discover.mjs` | 126 | UDP broadcast discovery on 48880, LAN address enumeration, node HTTP helper. |
| `lib/store.mjs` | 70 | Atomic JSON read/write, SHA-256, random tokens, access codes, clamp. |
| `lib/apps.mjs` | 88 | Hub-side app catalogue (7 entries). |
| `node/athena-node.mjs` | 1542 | Node agent: tasks, ComfyUI, host bridge, screen, input, audio, apps, actions, Comfy proxy. |
| `node/panel.html` | 328 | Node identity window / pairing code / local settings. |
| `node/host-screen.ps1` | — | Windows screen capture helper. |
| `node/host-input.ps1` | — | Windows input injection helper. |
| `public/app.js` | 1843 | Controller logic. |
| `public/index.html` | 586 | Controller markup incl. inline SVG oculus. |
| `public/styles.css` | ~1760 | Visual system and animation. |
| `public/sw.js`, `public/manifest.webmanifest` | 50 / — | PWA shell. |
| `tools/icons.mjs` | 120 | Icon generator (raw PNG encoder, zlib only). |
| `Start Athena.cmd`, `node/Start Node.cmd`, `node/Install Node.cmd` | — | Launchers. |
| `README.md`, `.gitignore`, `.gitattributes` | — | Documentation and ignore rules. |

**Not inspected / not verifiable statically:** live provider responses, real Ollama/vision quality, actual GPU/ComfyUI behaviour, Windows Defender/AMSI behaviour of the two `.ps1` helpers, iOS/Android PWA behaviour, multi-subnet routing, the private GitHub repository settings, and the contents of `data/` (runtime state and secrets — deliberately not read; `data/` is gitignored). These are called out as runtime unknowns rather than asserted.

---

## 3. Architecture and dependency map

### 3.1 Processes, ports, protocols

| Process | Bind | Port | Protocol | Notes |
| --- | --- | --- | --- | --- |
| Hub (`server.mjs`) | `0.0.0.0` (`:831`) | 4790 (`PORT` default) | HTTP/1.1 + SSE | Serves the PWA and `/api/*`, `/v1/*`. |
| Node agent (`node/athena-node.mjs`) | `0.0.0.0` (`:1483`) | 47910 | HTTP | Internal API called by the hub; also serves `panel.html`. |
| Discovery | UDP broadcast | 48880 | JSON datagrams | `ATHENA_DISCOVER` → `ATHENA_NODE`. |
| ComfyUI | `127.0.0.1` on node | 8188 | HTTP | Reached only through the node's `/comfy/*` proxy. |
| Ollama | `127.0.0.1` | 11434 | HTTP | Hub-local only; nodes cannot share it. |

There is **no TLS listener in either process** — both use `http.createServer` and bind all interfaces. There is no reverse-proxy config, no tunnel, no relay, no VPN integration in the repo.

### 3.2 Module graph

```
Start Athena.cmd ──> server.mjs
                       ├── lib/store.mjs          (JSON persistence, hashing, tokens)
                       ├── lib/discover.mjs  ─────┐ (UDP + nodeRequest)
                       ├── lib/nodes.mjs     <────┘ (Registry)
                       │      └── lib/discover.mjs
                       ├── lib/jobs.mjs      ──> lib/store.mjs
                       ├── lib/brain.mjs     ──> lib/discover.mjs (lanAddresses)
                       ├── lib/brain-install.mjs
                       ├── lib/apps.mjs
                       └── public/ (static PWA)

public/app.js ──fetch/SSE──> hub ──HTTP──> node/athena-node.mjs
                                   │            ├── child_process (winget, git, pip, ffmpeg, ollama)
                                   │            ├── PowerShell host-screen.ps1 / host-input.ps1 (line protocol over stdio)
                                   │            └── /comfy/* proxy → 127.0.0.1:8188
                                   └──HTTPS──> Ollama 127.0.0.1:11434 or cloud provider
```

### 3.3 Runtime dependencies

**Zero third-party npm packages.** Only Node built-ins: `http`, `fs`, `path`, `os`, `crypto`, `dgram`, `stream`, `child_process`, `url`, `zlib` (icon tool only). This is a genuine strength: no supply-chain surface from `node_modules`, and the whole system can run on a stock Node 20 install.

External *system* dependencies, invoked through the OS: PowerShell/.NET (screen + input + SAPI), `winget` (Ollama and apps), `ffmpeg` (audio), `git`/`pip` (custom Comfy nodes), Ollama, ComfyUI, and a cloud LLM provider when configured.

### 3.4 State and secrets on disk

| File | Written by | Contents |
| --- | --- | --- |
| `data/config.json` | hub `saveConfig()` | hub name, port, brain provider/baseUrl/model/apiKey, `openMode`. |
| `data/nodes.json` | `Registry.save()` | node id, name, host, port, **plaintext node token**, GPU snapshot. |
| `data/jobs.json` | `Jobs.save()` | job queue and captured output (up to 60k chars each). |
| `data/sessions.json` | `saveSessions()` | session token → metadata, 30-day sliding expiry. |
| `data/keys.json` | `saveKeys()` | API key id/name/prefix/SHA-256 hash. |
| `data/access-code.txt` | `writeCodeFile()` | current 6-character access code, plaintext. |
| `node/config.json` | node | identity, **plaintext hub token**, capability toggles, Comfy paths, port. |
| `node/state.json` | node | hub name + token persistence. |
| `node/screen-frame.jpg` | node | last captured frame. |
| `node/node.log` | node | rolling log incl. **pairing code at boot**. |

All of `data/` and the node runtime files are gitignored. Secrets are stored unencrypted at rest; the node token is plaintext on both sides because it must be presented as a bearer header.

### 3.5 Trust boundaries as currently drawn

```
[Browser/controller] --(access code -> session token, or API key)--> [Hub] --(node token)--> [Node]
                                                                      |
                                                                      +--(provider API key)--> cloud LLM
[Any loopback process/page on a node] ----------------------------> [Node]  (trusted implicitly)
[Any LAN device] --(UDP broadcast + /api/hello)-------------------> metadata disclosure
```

The critical observation: the **hub↔node link is a static bearer token over plain HTTP for the lifetime of the pairing**, with no rotation, no expiry, no mutual authentication, and no channel binding. Anyone who can read one packet or one file owns the machine's shell.

---

## 4. Feature inventory

Classification: **FI** fully implemented · **PI** partially implemented · **BR** broken · **MI** missing · **DNI** documented/discussed but not implemented.

### 4.1 Hub (`server.mjs`, `lib/`)

| Feature | Class | Location | Notes |
| --- | --- | --- | --- |
| Static PWA serving with cache headers | FI | `serveStatic` `server.mjs:228` | Path check uses a prefix compare; not a traversal in practice, but weaker than `path.relative`. |
| Access-code login → session token | FI | `/api/session` `:370`, `authenticate` `:152` | 6-char code, 32-char alphabet, 8 attempts/min/IP; sessions persist 30 days sliding. |
| API keys | FI | `/api/keys` `:127`, `authenticate` | Random 18-byte keys, shown once, SHA-256 stored, prefix listed. **No scopes.** |
| Lock/unlock UX | FI | `/api/lock` `:359`, `public/app.js:144/152` | `/api/lock` returns the access code to loopback callers only. |
| Open mode (auth disabled) | FI | `isOpen()` `:295`, settings `:728` | Any authenticated session can enable it. |
| SSE event stream | FI | `/api/events` `:390`, `broadcast` `:253` | Emits `state`, `job`, `chat`, `brain` events; token in query string. |
| Node discovery | FI | `lib/discover.mjs`, `/api/scan` `:428` | Same-subnet UDP only; merges LAN addresses and stored nodes. |
| Node pairing | FI | `lib/nodes.mjs:53`, `/api/nodes/pair` `:445` | Exchanges code for token via `POST /api/link`. |
| Node registry + health refresh | PI | `Registry.refresh` `lib/nodes.mjs:98`, `tick()` `:299` | 8-second polling, writes `nodes.json` on every refresh; no backoff, no history. |
| Remote actions (lock/restart/update/etc.) | FI | `/api/nodes/:id/action` `:479` | Thin pass-through to node `/api/action`. |
| Remote command execution | FI | `/api/nodes/:id/exec` `:489`, `Registry.run` | Blocks the HTTP request until the node task finishes (`waitFor`). |
| Screen frame relay | FI | `/api/nodes/:id/screen` `:517` | Returns JPEG + bounds; polled by the UI. |
| Input relay (click/move/type/key) | FI | `/api/nodes/:id/input` `:531` | Pass-through to node; no policy layer. |
| Audio relay | PI | `/api/nodes/:id/audio` `:551`, node `:792` | FFmpeg dshow → MP3 stream; token in query; Windows-only. |
| ComfyUI tunnel | PI | `lib/nodes.mjs`, node `proxyComfy` `:1390` | Buffers whole response; no WebSocket upgrade, so Comfy's `/ws` live queue/preview protocol is not proxied. |
| Job queue | PI | `lib/jobs.mjs` | One job per node, persisted, but no boot reconciliation, no cancel of running jobs, no streaming output. |
| Jobs API + UI | PI | `/api/jobs` routes, `public/app.js:294/1246` | UI offers CANCEL for running jobs → server 409. |
| Brain status/install | FI | `lib/brain-install.mjs`, `/api/brain/*` | winget `Ollama.Ollama` + official installer fallback; ladder by RAM. |
| Brain chat | PI | `/api/ask` `:650`, `lib/brain.mjs:575` | Streaming for tool-less Ollama turns; tool turns are non-streaming. |
| External `/v1/ask` | PI | `:779` | Bearer key, NDJSON; no model selection, no scopes, no per-key limits. |
| Settings | PI | `/api/settings` `:728` | Saves name, brain config, openMode; no validation of provider URLs. |
| Audit log | MI | — | Only `console` output; no record of who ran which command. |
| Health endpoint | MI | — | `/api/health` exists but is unauthenticated and shallow. |
| Update mechanism | MI | — | None. |
| Tests / CI | MI | — | None. |

### 4.2 Brain (`lib/brain.mjs`)

| Feature | Class | Location | Notes |
| --- | --- | --- | --- |
| Provider probing | FI | `probeBrain` `:161` | Ollama `/api/tags` + `/api/show` capabilities; OpenAI-compatible `/models`. |
| Model selection | PI | `pickModel` `:145`, `BRAIN_OPTIONS`, `resolveBrain` `:208` | First installed candidate from ladder; no user-facing per-node placement. |
| System prompt | FI | `SYSTEM` `:119` | Names the hub, nodes, admin state, hard 40-word reply limit. |
| Seven tools | FI | `TOOLS` `:10` | `list_nodes`, `node_status`, `run_command`, `see_screen`, `control_mouse_keyboard`, `manage_brain`, `node_action`. |
| Tool execution | FI | `toolResult` `:413` | Executes sequentially; `see_screen` returns an image part for vision models. |
| Tool selection heuristic | PI | `pickTools` `:486` | Keyword-based; can omit a needed tool or include an unneeded one. |
| Agentic loop | BR | `ask` `:575` | Max 5 rounds, but `tools` are only passed on round 0; later rounds see tool results but cannot call anything. |
| Vision routing | PI | `VISION_MODEL` regex `:1` | Model-name regex, not capability probing; false positives/negatives possible. |
| Reply composition | FI | `composeReply` `:521` | Summarises tool results when the model produces nothing useful. |
| Heuristic fallback | PI | `heuristic` `:699` | Regex intent parser when no model is available; limited to status/run/see/basic actions. |
| Warm-up | FI | `warmBrain` `:328` | Preloads the model. |
| Server-side memory | MI | — | History is a parameter from the client. |

### 4.3 Node agent (`node/athena-node.mjs`)

| Feature | Class | Location | Notes |
| --- | --- | --- | --- |
| Identity + pairing | PI | `/api/hello` `:1128`, `/api/link` `:1144` | 5-byte id, 24-byte token; `/api/link` unthrottled. |
| Local panel | FI | `node/panel.html`, `/api/local/*` `:1346–1372` | Loopback-only by request address. |
| Status snapshot | FI | `status()` `:1039`, `/api/status` `:1172` | Includes GPU, caps, tasks, **last 10 log lines**. |
| Screen capture | FI | `captureFrame` `:559`, `host-screen.ps1` | Virtual-screen capture, JPEG; 5 fps while observed, 15 s idle window. |
| Input injection | FI | `screenInput` `:631`, `host-input.ps1` | Move/click/scroll/type (clipboard paste)/key combos; 4000-char cap. |
| Audio capture | PI | `startAudio` `:792` | FFmpeg dshow → MP3 stream; device enumeration cached. |
| Task execution | PI | `startTask` `:229`, `taskList` `:214` | In-memory, output captured, no persistence across restart. |
| App catalogue / install | PI | `APP_SPECS`, `appStates` `:876`, `appInstall` `:906` | winget installs; ComfyUI only detected, not installed. |
| Open program | FI (by design, unsafe) | `openProgram` `:979` | `cmd /c start`; arbitrary launch for an authenticated caller. |
| Custom Comfy node install | FI (unsafe) | `installCustomNode` `:668` | Clones an arbitrary git URL and runs pip. |
| Speech | FI | `speak` `:693` | PowerShell SAPI on the node. |
| Config action | BR (security) | `:1320` | Hub can flip `allowShell`/`allowInput`/`allowShutdown`/`pairOpen` remotely. |
| Shutdown/restart | FI | `:1335` | No confirmation, no grace period. |
| Comfy proxy | PI | `:1390` | No websocket upgrade, whole-body buffering. |
| Self-update | MI | — | None. |
| Presence/consent UI | MI | — | None. |

### 4.4 Controller (`public/`)

| Feature | Class | Location | Notes |
| --- | --- | --- | --- |
| Lock screen + unlock | FI | `public/app.js:144/152`, `index.html` | Inline SVG oculus on the lock screen. |
| Live state via SSE | FI | `connectStream` `:719` | Refetch + re-render on events. |
| Chat with streaming | FI | `submitAsk` `:590` | NDJSON reader, live message bubble. |
| Local chat persistence | PI | `store`, `saveChat`/`loadChat` `:26–44` | Last 40 messages, browser-only, sent back as history (last 8). |
| Voice input | PI | `startListening` `:670` | Web Speech recognition; needs a secure context on iOS. |
| Voice output | PI | `primeVoice`/`speak`/`speechChunks` `:443–550` | speechSynthesis, chunked sentences; no barge-in. |
| Node cards + orb | FI | `render`, `renderOrbNodes` `:193/235` | Status ring, actions, jobs summary. |
| Screen grid + focus mode | FI | `:743–940` | Polling per node, generation guard, click/key mapping, Escape to close. |
| Audio listening UI | PI | `:972–1037` | Per-node `<audio>`, mute toggle, device info. |
| Apps page | FI | `loadApps`/`renderApps` `:1041/1074` | Hub catalogue merged with node state. |
| Jobs page | PI | `renderJobs` `:294`, `loadJobs` `:1246` | Cancel offered for running jobs (server refuses). |
| System page + settings | FI | `renderSystem` `:1147`, `saveSettings` `:1686` | Brain install/upgrade, model picker, hub name, open mode, keys. |
| Motion / accent / glass controls | FI | `applyLook` `:52`, `styles.css:1708+` | Three motion levels, accent swatches, glass/art toggles. |
| Reduced-motion support | MI | `styles.css` | No `prefers-reduced-motion` block; motion level is a manual setting only. |
| Offline shell | PI | `public/sw.js` | Precaches shell, but version mismatch (below). |
| Server-side chat sync | MI | — | Not implemented. |

### 4.5 Vision areas, restated concretely

- **Conversation** — works with a configured provider; "memory" is a browser array. Opening the PWA on a second device starts from nothing.
- **Planning/execution** — a single model turn may call several tools in parallel *once*. After results are returned, the follow-up turn cannot call tools, so "screenshot → decide → click → screenshot again" collapses into multiple user turns.
- **Memory** — no store, no summaries, no preferences, no task recall.
- **Vision** — screenshot + optional image message; no OCR, no crop, no upload, no multi-monitor targeting.
- **Voice** — browser speech only; no always-listening mode, no wake phrase, no interruption.
- **Distributed AI** — no node-hosted inference path at all.
- **Presence** — nothing to see or consent to before a node is installed and paired.
- **Self-update** — nothing.
- **Remote access** — nothing that works off-LAN.
- **Identity** — the strongest area; a real visual system exists, with two loose ends (unused art asset, version label drift).

## 5. Broken and incomplete functionality

Each defect is stated with its cause in code, its observable effect, and its evidence class.

### D-01 — The agentic loop cannot replan (CONFIRMED)

`ask()` (`lib/brain.mjs:575`) loops up to five rounds but offers the tool schema only on round 0. After tool results are appended, the next call has no `tools`, so the model can describe results but cannot request another action. Any task that needs "look, then act, then look again" requires a new user message. This directly contradicts the vision's planning/execution loop.

### D-02 — Queued jobs never run after a hub restart (CONFIRMED)

`Jobs` loads `jobs.json` in its constructor but `pump()` is only called from `create()`. On hub boot there is no `pump()` call, so jobs persisted as `queued` stay queued forever. Jobs persisted as `running` are never reconciled and stay `running` forever, blocking their node's queue slot (`drain()` runs at most one job per node).

### D-03 — CANCEL is offered for running jobs but rejected (CONFIRMED)

`public/app.js` renders a CANCEL control for jobs whose state is not finished, while `Jobs.cancel()` (`lib/jobs.mjs:67`) only acts on `queued` and otherwise throws, which the route turns into 409. The UI and server disagree about what is cancellable.

### D-04 — The pairing code leaks to the hub and to disk (CONFIRMED)

The node prints `node up on <port>, code <code>` into `node.log` at boot. `/api/status` returns `log: tailLog(10)` (`node/athena-node.mjs:1039`), so every hub refresh receives the node's current pairing code in plaintext. Anyone with hub access can therefore re-pair a fresh node without physical access. The panel deliberately hides the code from non-loopback callers, which this log path defeats.

### D-05 — The hub access code is disclosed to every client (CONFIRMED)

`hubState()` (`server.mjs:268`) returns `code: isOpen() ? null : config.code` and `dataDir` alongside ordinary state. Every authenticated controller — including a borrowed API key or a session created from a one-time code — receives the long-lived code. The code is also accepted as a direct credential in `authenticate()` (`server.mjs:152`), so disclosure is equivalent to permanent re-entry.

### D-06 — Secrets in query strings (CONFIRMED)

`presentedSecret()` (`server.mjs:142`) accepts `?token=`, and the UI uses that for `/api/events` (`EventSource` cannot set headers) and for audio streams. Query strings land in browser history, proxy logs and any screen-share of a URL, and the code path is not limited to those two endpoints.

### D-07 — Any session can turn authentication off (CONFIRMED)

`/api/settings` (`server.mjs:728`) accepts `openMode` from any authenticated caller with no re-authentication and no admin distinction. It also rotates the access code. A stolen API key or session can therefore make the hub permanently open on the LAN.

### D-08 — Node security toggles are remotely mutable without consent (CONFIRMED)

The node's `config` action (`node/athena-node.mjs:1320`) accepts `allowShell`, `allowInput`, `allowShutdown`, `pairOpen` and Comfy paths from any caller holding the hub token, with no local confirmation and no logging beyond the standard line. `pairOpen` in particular re-opens the node to pairing with any hub that knows the code.

### D-09 — Node and hub treat loopback as fully trusted (CONFIRMED)

`tokenOk()` (`node/athena-node.mjs:168`) returns true for every loopback request, and all `/api/local/*` routes rely only on `isLoopback`. The hub's `isLoopback()` (`server.mjs:181`) is used to release the access code. No route validates `Origin` or `Host`. Consequences: any local process (malware, another user's script, a browser extension) has full shell control of a node; and a DNS-rebinding page can reach `127.0.0.1:47910` or `127.0.0.1:4790` and be treated as local (the rebinding path is HYPOTHESIS pending a browser test; the missing checks are CONFIRMED).

### D-10 — `body.context` overrides hub config without validation (CONFIRMED)

`/api/ask` (`server.mjs:650`) merges `body.context` over `config` before calling `ask()`. A caller can redirect `baseUrl` to an arbitrary host and receive the system prompt plus the node digest, or bypass the configured provider entirely. Authenticated-only, but API keys are unscoped, so this is not a meaningful boundary.

### D-11 — ComfyUI proxy is not a real proxy (CONFIRMED)

`proxyComfy()` (`node/athena-node.mjs:1390`) buffers the response and forwards only request/response bodies. ComfyUI's canvas uses a WebSocket at `/ws` for queue and preview events, and there is no `upgrade` handling in either process. Live progress, interrupts and previews will not work through the tunnel; only request/response calls do.

### D-12 — Version identity drift (CONFIRMED)

Hub `VERSION = "2.2.2"` (`server.mjs:39`), node `VERSION = "2.2.1"` (`node/athena-node.mjs:27`), service worker `athena-v18`, UI label "CORE OS 4.7". `public/sw.js` precaches `/styles.css?v=12` and `/app.js?v=12` while `index.html` requests `?v=13`, so the shell cache and the page disagree and stale assets can survive an update.

### D-13 — `athena-bust.jpg` is unused (CONFIRMED)

The file exists in `public/img/` and is referenced nowhere in markup, CSS or JS. The visual identity is carried entirely by the inline SVG oculus duplicated between the lock screen and the hero.

### D-14 — Accessibility gaps (CONFIRMED)

No `prefers-reduced-motion` media query; motion is only reduced through a manual setting. Most icon-only buttons have no `aria-label`; focus handling in the screen overlay is manual and not trapped; the smallest UI text is well below comfortable mobile sizes. This matters because the controller is a phone-first PWA.

### D-15 — Shallow health endpoint (CONFIRMED)

`/api/health` is unauthenticated and reports version and node count only. It does not check the brain, disk, node reachability or the job queue, so it cannot support an updater or a monitor.

### D-16 — No input validation or schema (CONFIRMED)

Hub `readBody` returns `{}` on malformed JSON, node routes parse bodies without limits, settings accept arbitrary keys, and `/api/nodes/:id/action` forwards whatever `op` is given. Failures surface as generic 500/400s rather than actionable errors.

### D-17 — Refresh writes on every tick (CONFIRMED)

`Registry.refresh()` saves `nodes.json` every 8 seconds even when nothing changed. On a small SSD this is unnecessary churn, and it widens the window for a torn write (mitigated by tmp+rename).

### D-18 — Provider probing on every state read (CONFIRMED)

`hubState()` calls `probeBrain()`, and `tick()` also probes. With Ollama this means repeated `/api/tags` and `/api/show` calls; with a cloud provider it means repeated `/models` requests, which costs latency and, for some providers, quota.

### D-19 — App catalogue duplicated (CONFIRMED)

`lib/apps.mjs` (hub) and `APP_SPECS` (node) both define the seven apps with different shapes and must be edited together. Drift is inevitable.

### D-20 — Node tasks are not durable (CONFIRMED)

`tasks` is an in-memory `Map` (`node/athena-node.mjs:214`). Restarting the node loses output and status for every running command, while the hub's job record still says `running` (see D-02).

### D-21 — Heuristic intent routing is brittle (CONFIRMED)

`pickTools()` and `heuristic()` are keyword/regex driven. Ambiguous phrasing silently drops a needed tool, and the heuristic fallback can execute destructive actions (`shutdown`, `run`) from a matched phrase with no confirmation step.

### D-22 — Streaming is inconsistent (CONFIRMED)

`/api/ask` streams tokens only for tool-less Ollama turns; tool turns, cloud providers and `/v1/ask` are effectively non-streaming. The UI has one code path for two very different latency profiles.

### D-23 — No graceful shutdown or crash recovery (CONFIRMED)

Neither process handles `SIGINT`/`SIGTERM` to persist in-flight state or stop child processes. The node's `killHosts()` exists for its own exit path, but a hard kill leaves PowerShell helpers, FFmpeg and ComfyUI running.

## 6. Architectural weaknesses and their causes

1. **A LAN demo shape hardened into the architecture.** Discovery is UDP broadcast, every URL is `http://<lan-ip>:port`, and controller and hub share an origin. Remote access cannot be layered on top of this; it requires outbound connections from nodes and an authenticated relay.
2. **Identity is a shared secret, not a key pair.** The hub authenticates with a 6-character code; nodes with a static bearer token; API clients with an unscoped key. There is no hub identity, no node identity, no rotation, and no revocation beyond deleting a row.
3. **Authorization is a single boolean.** "Authenticated" means "may do anything", including shell, shutdown, settings changes and pairing. There is no capability model, no per-action approval, and no distinction between the owner's phone and a borrowed API key.
4. **The hub is a monolith by construction.** Auth, state, brain, jobs, static serving, Comfy tunnelling and SSE live in one 861-line request handler with no service seams. Any change to auth risks the whole surface, and the brain or relay cannot run separately.
5. **State is "JSON files plus hope".** No schema, no versioning, no migrations, no locking, no transactional multi-file updates. `config.json`, `nodes.json`, `jobs.json`, `sessions.json` and `keys.json` can disagree after a crash.
6. **The brain is a chat completion call, not an agent runtime.** No plan representation, no step budget, no verification, no retry policy, no memory, no typed tool results, no cost or latency accounting. The loop is a few `if` statements around `chat()`.
7. **No observability.** `console.log` only — no request ids, no audit trail of destructive actions, no metrics, no error aggregation. Debugging a remote node failure means reading a 10-line log tail.
8. **No verification layer at all.** No tests, no CI, no lint, no type checking, no smoke script, no `package.json` scripts. Every claim in this report had to be derived by reading code, and every future change carries the same cost.
9. **Versioning is manual and already inconsistent.** Three different version labels, and a service-worker cache key that does not match the asset URLs.
10. **Windows assumptions are unmarked.** Screen, input, audio, SAPI, winget and PowerShell are Windows-only, but the node starts on any OS and fails at call time rather than at boot.

## 7. Gap analysis against the vision

| # | Stated vision | Present today | Gap |
| --- | --- | --- | --- |
| A | Natural two-way conversation with a persistent, personalised intelligence | Streaming chat, 8-message client history, `localStorage` transcript, 40-word reply cap | Server memory, summaries, preferences, cross-device continuity, conversation lifecycle |
| B | Plan, execute, verify, replan | One tool-bearing round; parallel tool calls; result summarisation | Multi-round tool loop, explicit plan/step state, verification and retry, destructive-action confirmation |
| C | Remember context, preferences, tasks | Browser transcript only; job history never reaches the brain | Durable memory store, retrieval, task journal, summaries, user profile |
| D | See the screen and act on it | Whole-virtual-screen JPEG every ~200 ms while observed; image part to vision models; click/key/type | Screen-region targeting, OCR, upload, capability-based vision detection, coordinate verification, multi-monitor selection |
| E | Talk and listen naturally | Browser STT, browser TTS, node SAPI speech; chunked sentences | Continuous mode, wake phrase, barge-in, server-side ASR/TTS, HTTPS for iOS mic |
| F | Distribute inference across nodes | Hub-local Ollama or cloud key | Node model registry, capability envelopes, placement/routing, remote model use, per-node GPU accounting |
| G | Presence / identity / onboarding / consent | Manual folder copy + `.cmd`; loopback-only pairing code | Presence page on the target machine, one-time consent token, install/enroll wizard, visible connection state |
| H | Self-update, health check, rollback, backup | None | Signed release manifest, staged update, data backup, health gate, rollback |
| I | Work remotely, not tied to the LAN or one PC | Plain HTTP on `0.0.0.0`, UDP discovery, no TLS | TLS, authenticated outbound node channel, relay, device pairing for the controller, hub export/import |
| J | Unified cosmic-eye identity and animation | Inline SVG oculus, CSS animation, accents, motion levels, glass/art toggles | Use the unused bust asset, fix version labels, reduce-motion support, reuse identity in presence/updater flows |

**The honest summary:** the *control plane* (hub, node, controller, screen/input relay) is real and reasonably complete for a LAN. The *intelligence plane* (memory, planning, distributed inference) and the *trust plane* (identity, consent, updates, remote transport) are largely absent. Almost every high-severity issue lives in the trust plane.

## 8. Security, privacy and reliability risk register

Severity reflects impact × likelihood for the intended deployment (a home/LAN network of personal Windows machines, controlled from a phone).

| ID | Risk | Severity | Evidence | Mitigation direction |
| --- | --- | --- | --- | --- |
| R-01 | Any loopback process or page on a node has shell, input and screen control | Critical | `tokenOk` `node/athena-node.mjs:168`; `/api/local/*` | Require a per-request signed capability or a local-only one-time token bound to `Origin`; validate `Origin`/`Host`; bind local endpoints to a random path token. |
| R-02 | DNS rebinding reaches loopback-trusted endpoints | High | No `Host`/`Origin` checks in either server | Reject requests whose `Host` is not the expected host/IP; require an `Origin` allowlist for browser calls. |
| R-03 | LAN attacker captures the static node token (plain HTTP) and gains RCE | Critical | `lib/nodes.mjs` sends token as header over `http://`; node binds `0.0.0.0:47910` | TLS or an authenticated tunnel; rotate tokens; bind node to loopback and require an outbound channel. |
| R-04 | Pairing code disclosed via logs and `/api/status` | High | `node.log` boot line; `status()` `:1039` returns `tailLog(10)` | Never log the code; redact logs in `status()`; rotate code after pairing. |
| R-05 | Access code disclosed to every authenticated client and accepted as a credential | High | `hubState()` `:268`; `authenticate()` `:152` | Remove the code from state; accept it only at `/api/session`; hash it at rest. |
| R-06 | Token leakage through URLs | Medium | `presentedSecret()` `:142`; SSE/audio use `?token=` | Short-lived one-time stream tickets instead of the session token; `Referrer-Policy: no-referrer`. |
| R-07 | Any session can disable auth or rotate the code | High | `/api/settings` `:728` | Require re-authentication plus a local (loopback/physical) confirmation for security-changing operations. |
| R-08 | Hub can silently weaken a node's security posture | High | node `config` action `:1320` | Local approval UI on the node; audit each change; make `pairOpen` loopback-only. |
| R-09 | Unscoped API keys (shell/shutdown included) | High | `lib/store.mjs` key records; `/v1/ask` | Scopes per key, expiry, per-key rate limits, last-used metadata, revocation UI. |
| R-10 | Arbitrary code execution by design | High | `installCustomNode` `:668`; `openProgram` `:979`; `run_command` tool | Allowlists, explicit confirmation for each execution, command preview, audit log. |
| R-11 | Unvalidated provider override leaks system prompt/node inventory | Medium | `/api/ask` `:650` `body.context` | Remove client-side config override; server owns provider config. |
| R-12 | CORS `*` without credentials lets any site probe the LAN hub | Medium | request handler headers | Same-origin only plus explicit allowlist; no wildcard. |
| R-13 | Brute force of the 6-character code | Medium | 8/min/IP at `/api/session` | Exponential backoff, lockout, longer code or device-bound pairing, alerting. |
| R-14 | Node `/api/link` unthrottled | Medium | `:1144` | Rate limit, one-time codes, code rotation, link attempt log. |
| R-15 | Secrets at rest in plaintext | Medium | `data/config.json`, `data/nodes.json`, `node/config.json` | OS credential store / DPAPI on Windows, or at minimum file ACLs and documented risk. |
| R-16 | No audit trail of destructive actions | Medium | console logs only | Append-only audit log with actor, action, target, result, timestamp. |
| R-17 | Orphaned jobs after restart | Medium | D-02 | Boot reconciliation: mark running as failed, re-pump queued. |
| R-18 | Node restart loses task state | Medium | in-memory `tasks` | Persist task records; adopt/kill orphaned processes at boot. |
| R-19 | No backups; `data/` is the only copy | Medium | — | Scheduled backup with retention, export/import, documented restore. |
| R-20 | Single hub, no failover | Medium | architecture | Make hub state portable and restorable; optional standby with shared state. |
| R-21 | ComfyUI proxy buffers and cannot carry WebSockets | Low | `proxyComfy` `:1390` | Proper streaming proxy with `upgrade` handling. |
| R-22 | Repeated provider probing costs latency/quota | Low | `hubState()`, `tick()` | Cache probe results for 30–60 s. |
| R-23 | Service worker stale-cache mismatch | Low | `sw.js` shell `?v=12` vs `?v=13` | Derive cache key and asset versions from one constant. |
| R-24 | Windows-only features fail at call time | Low | node capabilities | Declare capabilities at boot; hide unavailable actions in the UI. |
| R-25 | Screen/audio data leaves the LAN unencrypted | High (privacy) | plain HTTP relays | Encrypt transport; keep frames in memory where possible; document retention (currently `node/screen-frame.jpg` is written to disk). |

**Privacy notes.** Screenshots can contain anything on the desktop and are written to `node/screen-frame.jpg`. Audio is captured from the default input device and streamed to any authenticated controller. Chat transcripts are stored in browser `localStorage` and sent to a cloud provider when one is configured. There is no retention policy, no redaction, no per-capture consent, and no indicator on the node that it is being observed (the panel shows state, but there is no always-visible capture light).

## 9. Recommended target architecture

The recommendation keeps the project's real strengths — zero runtime dependencies, plain Node, one repo, a strong visual identity — and adds the missing planes incrementally.

### 9.1 Target shape

```
                    ┌──────────────────────────────┐
   phone / desktop  │  Controller PWA (public/)    │
                    │  identity · chat · presence  │
                    └──────────────┬───────────────┘
                          HTTPS / WSS (or relay)
                    ┌──────────────▼───────────────┐
                    │  Hub (server.mjs, split)     │
                    │  authn/authz · audit · state │
                    │  brain runtime · jobs        │
                    │  memory store · updates      │
                    └──────┬───────────────┬───────┘
             outbound WSS  │               │  provider HTTPS
                    ┌──────▼──────┐   ┌────▼─────────────┐
                    │  Node agent │   │  LLM provider /  │
                    │  identity   │   │  local Ollama    │
                    │  caps/consent│  └──────────────────┘
                    │  screen/in  │
                    │  apps/tasks │
                    │  local model│
                    └─────────────┘
```

Key changes in shape:

1. **Nodes connect outbound** to the hub over a persistent, mutually authenticated WebSocket (or HTTPS long-poll fallback), instead of the hub calling inbound HTTP on `0.0.0.0:47910`. This removes the need for port forwarding, fixes NAT, and lets the node stay bound to loopback.
2. **The hub is split into modules with explicit interfaces**: `auth`, `state`, `brain`, `jobs`, `memory`, `nodes`, `updates`, `http`. Same process initially; seams allow extracting the relay and brain later.
3. **Identity becomes cryptographic**: hub key pair + `hub_id`; node key pair + `node_id`; pairing signs a challenge and issues a scoped, rotating credential. The pairing code becomes a one-time, short-lived bootstrap secret.
4. **A memory service** stores conversations, summaries, preferences and task journals in an append-only format (JSONL initially, SQLite if queries demand it), with retrieval injected into the system prompt instead of raw client history.
5. **The brain becomes an agent runtime**: a plan object, a bounded step loop that keeps tools available every round, typed tool results, verification after mutating actions, confirmation policy for destructive operations, and cancellation.
6. **Transport security is mandatory**: HTTPS for the controller, WSS for nodes, TLS for the Comfy tunnel, with a documented local-CA or reverse-proxy path and an optional relay (WireGuard/Tailscale or a small authenticated relay service) for off-LAN use.

### 9.2 What deliberately does *not* change

- Keep zero runtime npm dependencies for the core; if a dependency is unavoidable, isolate it and pin it.
- Keep the single-repo, single-command launch experience.
- Keep the cosmic-eye identity and the existing CSS animation system; extend it to the new presence and update flows.
- Keep JSON files as the default store for a single-user deployment, with versioned schemas and migrations, and make SQLite optional rather than mandatory.

## 10. Required changes and dependencies

| # | Change | Depends on | Touches |
| --- | --- | --- | --- |
| C-01 | Add `package.json` with `start`, `check`, `test` scripts and a Node engine pin; add `.nvmrc` | — | repo root |
| C-02 | Extract hub into `src/hub/*` modules without changing behaviour; add a request router table | C-01 | `server.mjs` |
| C-03 | Version single source of truth (`version.json`), inject into hub, node, SW cache key, UI label | C-01 | all |
| C-04 | Boot reconciliation for jobs; running→failed, queued→pump; cancel running via node task cancel | C-02 | `lib/jobs.mjs`, hub |
| C-05 | Remove secrets from state/logs/URLs; one-time stream tickets; code hashed at rest | C-02 | hub, node, UI |
| C-06 | `Host`/`Origin` validation + CORS allowlist in both servers | C-02 | hub, node |
| C-07 | Loopback trust removal: local capability token, `Origin` checks, confirmation UI | C-06 | node, `panel.html` |
| C-08 | Capability model: scoped API keys, per-action policy, confirmation for destructive ops, audit log | C-02, C-05 | hub, node, UI |
| C-09 | Identity: hub/node key pairs, signed pairing, rotating node credentials | C-08 | hub, node, `lib/discover.mjs` |
| C-10 | Outbound node channel (WSS) replacing inbound HTTP; keep LAN HTTP as a dev fallback | C-09 | node, hub, `lib/nodes.mjs` |
| C-11 | Memory store + retrieval + summaries; migrate client history to server-owned conversation ids | C-02 | new `lib/memory.mjs`, `lib/brain.mjs`, UI |
| C-12 | Agent runtime: multi-round tools, plan/step state, verification, cancellation, typed results | C-11 | `lib/brain.mjs` |
| C-13 | Vision upgrade: capability detection, region crop, OCR hook, upload, observation indicator | C-12 | brain, node, UI |
| C-14 | Voice upgrade: continuous mode, barge-in, server ASR/TTS adapter (optional), HTTPS requirement | C-10 | UI, hub |
| C-15 | Distributed model registry: node model inventory, capability envelope, placement/routing policy | C-10, C-12 | hub, node, UI |
| C-16 | Presence + enrollment: presence page on target machine, one-time consent token, install wizard | C-09 | node, new `presence/`, UI |
| C-17 | Updater: signed manifest, staged download, backup of `data/`, health gate, rollback | C-03, C-15 | new `lib/updates.mjs`, launchers |
| C-18 | Remote access: HTTPS termination, relay/tunnel integration, controller device pairing | C-10 | ops docs, relay config |
| C-19 | Observability: structured logs, request ids, audit viewer, `/healthz` with real checks | C-02 | hub, node, UI |
| C-20 | Visual pass: use the bust asset, reduced-motion support, a11y labels, consistent version/label | C-03 | `public/` |

**Dependency ordering.** C-01 → C-02 → (C-03, C-04, C-05, C-06) → C-07 → C-08 → C-09 → C-10 → (C-11 → C-12), C-16, C-17, C-19, C-20 → C-13, C-14, C-15 → C-18. Security work (C-05…C-09) must precede any exposure beyond the LAN; C-10 must precede the distributed-model and presence work because both assume an authenticated outbound channel.

**No new runtime dependency is strictly required** for phases 0–4. Optional additions, each to be justified before use: a SQLite driver (only if memory queries outgrow JSONL), a TLS/ACME helper (only if not using a reverse proxy), and a WebSocket implementation — Node's built-in `WebSocket` client exists in Node 22+, but a server-side WebSocket needs either an upgrade to Node's experimental support, a tiny hand-rolled RFC 6455 server, or one pinned dependency. That decision should be made explicitly in Phase 4, not assumed now.

## 11. Roadmap summary

The phased plan, dependencies, deliverables and acceptance criteria live in `docs/ATHENA_DEVELOPMENT_ROADMAP.md`. In short:

- **Phase 0** — verification baseline (scripts, version source, smoke test).
- **Phase 1** — correctness and containment (jobs reconciliation, secrets, CORS/Host/Origin, loopback trust, provider override).
- **Phase 2** — identity and authorization (scoped keys, capability policy, audit, pairing).
- **Phase 3** — memory and the agent loop.
- **Phase 4** — outbound node channel and transport security.
- **Phase 5** — presence and enrollment.
- **Phase 6** — distributed inference.
- **Phase 7** — updates, backup and rollback.
- **Phase 8** — remote access.
- **Phase 9** — vision/voice depth and the visual/a11y polish.

## 12. Testing and acceptance criteria (per phase)

The project currently has **no tests and no CI**, so the first acceptance criterion for every phase is that its behaviour is checkable without a live phone, a live GPU, or a live cloud account. Recommended shape:

- **Unit tests** with `node:test` for pure logic: `lib/store.mjs`, `lib/jobs.mjs` state transitions, `lib/nodes.mjs` request shaping, `lib/brain.mjs` tool selection/composition, `lib/brain-install.mjs` ladder ranking, `lib/discover.mjs` datagram parsing.
- **Protocol contract tests** against a fake node server: pairing, status, screen, input, action, job execution, error shapes.
- **Integration tests** that boot the hub on an ephemeral port with a temp `data/` dir and a fake provider, then drive `/api/*` and `/v1/*` with `fetch`.
- **Manual acceptance scripts** (documented, not automated) for Windows capture/input, audio, ComfyUI and provider vision, because those depend on the host.
- **Security regression checks** that assert: code never appears in `/api/state`, logs or URLs; unauthenticated requests to every route return 401 except an explicit allowlist; `Origin`/`Host` mismatches are rejected; a loopback request without the local capability token is rejected.

Per-phase acceptance criteria are listed in the roadmap document, each phrased as an observable behaviour rather than an implementation detail.

## 13. Limitations of this audit

- Runtime behaviour was not observed. Claims about streaming, latency, provider compatibility, Ollama vision support, Defender/AMSI, GPU paths and mobile Safari are code-derived (LIKELY/HYPOTHESIS), not tested.
- The contents of `data/` and `node/config.json` were intentionally not read; findings about secrets are based on the writing code, not on the values.
- No live network topology was inspected, so the severity of LAN-capture risks assumes an untrusted shared network.
- The private GitHub repository's settings (branch protection, Actions, secrets) were not accessible from this environment.
- ComfyUI, FFmpeg and winget behaviour is inferred from invocation code; version-specific flags may differ.
- Browser DNS-rebinding feasibility depends on the browser and was not executed; the missing `Host`/`Origin` validation that enables it is confirmed in code.
- No dependency audit was performed because there are no third-party runtime dependencies.

---

## 14. ATHENA 3.0 implementation notes (supersedes the 2.2 audit where stated)

**Hub 3.0.0 · Node 0.1.0.** The audit above was written before Phases 0–1 and the
2.4.0/3.0.0 work. These statements are current and were verified by tests.

### 14.1 Control surface

- The BASIC/ADV switch was decorative except for one hidden branch in the
  screen grid: basic mode made a preview tap open Focus, advanced mode sent a
  remote mouse click. Nothing told the user which mode did what, and a misclick
  on a thumbnail could act on the remote PC. It has been removed. Previews
  always navigate to Focus; remote clicks happen on the full-size focused image,
  where the target is visible.
- Software is no longer a global tab. Each machine card contains a lazy-loaded
  Software section that queries that node only. The Hub-level Integrations
  registry moved to SYSTEM. `/api/apps` is still the catalogue endpoint.

### 14.2 Jobs

The two jobs visible in `data/jobs.json` were created on 2026-11-23 at 01:59 and
02:00 UTC by `POST` requests to a node `/exec` endpoint (the same handler serves
`/api` and `/v1`), with commands `echo athena-ok` and `echo keyed-ok`. Both
completed with exit code 0 in about one second and were the API smoke checks
recorded in the Phase 1 delivery. They are not system jobs, not scheduled work,
and not failures. They were left untouched.

New jobs now record `source` (`api` or `hub`) and `createdBy` (the API key's
label, or the app session). The Jobs page states what a job is, that the AI
answers in chat without queueing jobs, and each card shows why it exists, its
timeline, exit code, failure reason and output. Cancel is offered only while a
job is queued or running.

### 14.3 Node / Hub boundary

The Node previously imported the Hub's `lib/version.mjs`, so a Hub upgrade
changed the Node's reported version. Node software is now versioned by
`node/version.json` and negotiated by protocol (`docs/ATHENA_NODE_V0_1.md`).
Pairing fetches `/api/hello` first and refuses an out-of-range protocol; every
Hub request carries `x-athena-hub-protocol`, and a Node answers 426 rather than
half-executing. Legacy Nodes remain usable and are labelled. Nothing upgrades a
Node automatically.

### 14.4 Speech

TTS is browser-generated (`window.speechSynthesis`) on the viewing device; the
Hub never synthesises audio. The old code picked the first English voice whose
name matched `samantha|serena|aria|zira|female`, then applied `pitch = 0.92` and
`rate = 1.02`. On Windows that usually lands on a legacy SAPI voice and the
lowered pitch reinforces the robotic impression. The replacement:

- ranks installed voices by Natural / Neural / Enhanced / Online names, with
  legacy desktop voices last;
- defaults pitch to 1.0 and rate to 1.0, with per-device controls;
- stores the chosen voice name and settings in `localStorage` (per device);
- normalises ATHENA, GPU/CPU/VRAM/API, IP addresses, versions, percentages and
  arrows before speaking;
- splits on word boundaries, because Safari truncates long utterances.

Quality is bounded by the voices installed in Windows/iOS. A local neural engine
(Piper/Kokoro) is a later Phase 9 option, not a speed tweak.

### 14.5 Distribution

`tools/package.mjs` assembles a standalone Node folder/zip and a Hub folder/zip
containing `ATHENA Hub.exe`, a bundled `runtime/node.exe`, the server, `lib/` and
`public/`. The launcher is a small C# program compiled by the compiler included
with Windows; it performs no installation. The data directory stays beside the
executable, so the hub folder must live somewhere writable.

---

## 15. Reliability, multi-PC and controller sprint (2026-11-25)

This section supersedes the stale “no tests / no packaging” statements above.
It is an implementation record, not a claim that every hardware path was tested.

### 15.1 The three concepts, as the code actually works

| Concept | Current implementation | Boundary |
| --- | --- | --- |
| **Hub** | `server.mjs`: authority for config, access code, API keys, controller sessions, node registry/tokens, jobs, integrations, brain, SSE and static PWA. | Owns state; does not need to be the only controller. |
| **Controller** | Any browser/PWA that signs in with the access code. The hub PC's browser is simply one controller with local auto-unlock. | Its chat and voice settings are in that browser's `localStorage`; the hub does not merge them. |
| **Node** | `node/athena-node.mjs`: hardware, screen, input, audio, apps, tasks and ComfyUI. Paired to one hub with a token. | Has no brain and no shared conversation state. |

**Is the Hub unnecessarily also a controller?** It serves the controller UI, but
the authority and the client are separable: the hub process does not depend on
its own browser. The PC is a controller only because someone opens the app
there. This sprint gives that browser the same device identity/session model as
a phone; it does not create a second state owner.

**Can a PC be Hub and Node?** Yes, without duplicated responsibility: start the
hub and the node as two processes. The node is still a node (token, capabilities,
local identity); the hub still owns authority. Pairing over loopback works. It
is not recommended to expose the node port to the internet just because the hub
is on the same PC.

**Can the Hub manage multiple controllers?** Yes. `POST /api/session` creates an
independent token per device with a visible name/platform; `GET /api/sessions`
lists metadata (never tokens) and `DELETE /api/sessions/:id` revokes one. The
same browser signing in again replaces its own old session, not another
device's. Legacy timestamp-only sessions are preserved and labelled “Earlier
device”.

**Can multiple Nodes connect?** Yes. `Registry` stores every node separately,
with its own token and negotiated protocol. Jobs are serialized per node, not
globally. A node may only be paired to one hub; unpair first to move it.

**Why no major rewrite?** The current split already matches the target model.
The safe path was additive: session metadata, protocol-range validation, proxy
header coverage, per-node source selection and UI organization. Existing node
tokens, device session tokens, identities and job records were not rewritten.
A future signed identity/outbound-channel phase can replace transport without
changing these concepts.

### 15.2 Reliability changes

- Node runtime resolution checks the standard install locations before PATH and
  enforces Node 20+, fixing the fresh-PC `'node' is not recognized` path.
- Hub launcher polls `/api/health` before opening a browser and prints a useful
  failure instead of silently closing.
- Both packages carry `BUILD-INFO.json` with per-file SHA-256 hashes.
- Device sessions are individually revocable; the all-device sign-out remains.
- Screen capture is demand-driven (30 fps focused, 10–12 preview, stops after the
  last viewer) with measured browser FPS/latency and available capture timing.
- Click mapping subtracts `object-fit: contain` letterboxing before normalizing,
  which addresses the iPad offset; mouse/touch use CSS pixels once, not DPR
  again.
- Audio source selection is explicit (`desktop` vs `microphone`), never mixed or
  silently substituted. FFmpeg uses low-delay/no-buffer flags and 48 kHz MP3.
- Software install reports `result.note`, refreshes PATH, forces detection, and
  labels ComfyUI's action “FIND FOLDER” because it only detects an existing
  folder.
- Thumbnail context-menu remote right-click was removed; previews only navigate.

### 15.3 Security changes and limits

- Pairing codes use `crypto.randomInt`, not `Math.random`, with 8 failed
  attempts/minute per source IP and a one-minute lockout.
- Every Hub→Node request, including screen/audio/Comfy proxies, carries
  `x-athena-hub-protocol`.
- The Hub validates the Node's declared Hub-protocol range as well as the Node
  protocol, refusing both before pairing/action. Legacy Nodes remain accepted.
- Already-paired nodes and existing session tokens are preserved.
- **Not solved:** LAN traffic is plain HTTP; node tokens are bearer tokens; no
  TLS, signed node identity or outbound-only channel. Pairing is LAN-grade, not
  internet-safe. HTTPS/VPN is still required across untrusted networks.

### 15.4 Verification status

Automated: `npm run check` (45/45), `npm test` (84/84), `npm run smoke`.
Coverage includes controller sessions/revocation, both protocol ranges, raw
request headers, pairing lockout, screen geometry/adaptive profiles, audio
classification, software labels, package layout and existing hub/node behavior.

**NOT YET VERIFIED:** a fresh Windows PC with no Node.js, winget under a real
installer, second-PC firewall/Defender, real iPad/iPhone tap alignment, real
FPS/latency targets, audible microphone/desktop separation and the >10 s audio
latency fix. These are manual tests, not passed features.
