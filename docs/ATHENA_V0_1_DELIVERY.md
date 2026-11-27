# ATHENA v0.1 Delivery Report

Product generation **v0.1**. Software versions remain **Hub 3.3.0** and **Node
0.3.0**, protocol **1**. Work is on `athena-3.3-wip` and
`athena-node-0.3-wip`; nothing was merged to `main` and no release was
published.

## 1. What was implemented

### Priority 0 — the agent

- **Deterministic routing** for screenshots, window lists, Node status and
  opening an application. These no longer depend on a model choosing a tool.
- **Persistent Node aliases** (`Node 1`, `Node 2`, …) stored with the registry;
  `Node 2`, `node #2` and `second node` resolve through the registry, never a
  model guess. A re-pair cannot reuse another Node's index.
- **Structured action results** containing the target Node, operation, success,
  duration and verification. Screenshots return an image attachment, not a LAN
  URL.
- **Three-stage launch verification** on the Node: a process appeared, a window
  was created, and that window is visible. `calc.exe`'s UWP handoff is handled.
  A process without a visible window is reported as **partial**, not “opened”.
- **No fabricated success**: an offline Node, a disabled permission, a failed
  launch and a provider timeout each produce a failure message.
- **Provider timeout diagnostics** replace generic “brain unavailable” text, and
  the built-in fallback never re-executes an action that already ran.
- **Multi-step loop retained**: existing tools, duplicate suppression, failure
  recovery, intermediate observation and final verification remain in place.
- **Controller boundaries unchanged**: no shell, no Hub administration, no
  provider list or keys.

### Priority 1 — model providers

- Adapters for **Ollama, OpenAI, Google Gemini, DeepSeek, Anthropic, Groq,
  OpenRouter and custom OpenAI-compatible endpoints** in `lib/providers.mjs`.
- Anthropic uses its native Messages API, including system prompt, `tool_use`
  and `tool_result` blocks; the rest use `/chat/completions`.
- **Per-provider** model, base URL and key, with model discovery and a real
  **TEST CONNECTION** request.
- **BYOK storage** in `data/secrets.json`, owner-only where supported. Keys are
  removed from `config.json`, never returned in full, never sent to Nodes or
  controllers, and never written to browser storage. The UI shows a mask.
- Provider-specific errors for rejected keys, missing models, rate limits,
  server errors and timeouts; one deliberate retry for 429/5xx, no retry for a
  bad key or missing model.
- Streaming text for Ollama, OpenAI-compatible SSE and Anthropic SSE; tool turns
  stay unstreamed so the complete call is parsed.
- Vision is recognised from the model name; a screenshot is only attached as an
  image when the model can read it.

### Priority 2 — interface

- New `public/design.css` design layer: spacing/type/surface tokens, a desktop
  Hub rail, consistent panels/buttons/fields/badges/meters, responsive rules,
  focus rings and reduced-motion rules.
- **Model Center** in Settings: provider cards, masked key state, model list,
  real connection test and save.
- **Node panel**: Overview / Machine / Processes / Permissions / Diagnostics,
  CPU and memory meters, and an on-demand process table that stops polling when
  the tab is closed.
- The authoritative implemented specification is
  `docs/ATHENA_V0_1_DESIGN_SYSTEM.md`.
- This is a coherent v0.1 shell and component system, not a ground-up rewrite of
  every screen. The Store, Link, AEGIS and advanced optimizer surfaces are not
  built.

### Priority 3 — product foundation

- The existing app catalogue and integrations remain separate from the agent.
- No future product name is hardcoded into the engine or scheduler.
- The Store/Library, ATHENA Link, AEGIS, Clip Studio and Story Maker remain
  designed-for but unimplemented.

## 2. What actually passed

Hub (`athena-3.3-wip`):

- `npm run check` — **79/79 files parsed**
- `npm test` — **153 tests, 151 pass, 0 fail, 2 skipped** (the two skips are
  opt-in live-model tests that require `ATHENA_LIVE_MODEL`)
- `npm run smoke` — **ok**, real Hub boot on an ephemeral port
- `git diff --check` — clean

Node (`athena-node-0.3-wip`):

- `npm run check` — **21/21 files parsed**
- `npm test` — **27 tests, 26 pass, 0 fail, 1 skipped** (the skipped test is the
  opt-in real Chromium test)
- `npm run test:lifecycle` — **1/1 pass** (compiled Windows launcher: launch,
  second launch, restart, quit)
- `git diff --check` — clean (line-ending warnings only)

New regression coverage added for the exact reported failures:

- “How many nodes are connected?”
- “Take a screenshot of Node 2.” (real image, real Node id)
- “List open windows on Node 2.”
- “Open Calculator on Node 2.” (process + window verified)
- launch with no visible window → partial
- action on an offline Node
- permission refusal
- provider timeout → honest recovery, no action
- masked provider catalogue and isolated per-provider settings
- Anthropic request/response mapping
- provider error classification

Packages built:

- `athena-node/dist/_v0.1/ATHENA-Node-0.3.0-win64/` and `.zip`
- `athena-node/dist/_v0.1/ATHENA-Node-Setup.exe`
- `dist/_v0.1/ATHENA-Hub-3.3.0/` and `ATHENA-Hub-3.3.0-win64.zip`

They were built into `_v0.1` because a previously installed Node and Hub were
running from the normal `dist` folders and held their files open. Building did
not terminate those applications.

## 3. What failed during delivery

- The first lifecycle run failed because an already-running packaged Node holds
  the launcher's single-instance mutex. The launcher now supports
  `ATHENA_LAUNCHER_NAMESPACE` for test isolation; production names are
  unchanged. The lifecycle test then passed.
- Packaging into `dist/` failed with `EPERM` for the same reason (running
  products). The packages were built successfully into `dist/_v0.1/` instead.
- Two model-path tests were updated because those requests now take the new
  deterministic route; their assertions verify the stronger behaviour rather
  than the model round.

## 4. What remains unverified

- **No real provider account was called.** No key was supplied, so LOAD MODELS
  and TEST CONNECTION are verified by unit tests and local HTTP stubs, not by
  OpenAI/Gemini/Anthropic/Groq/etc. themselves.
- **No physical second PC** was available. LAN pairing, firewall prompts and a
  clean-machine install still need that test.
- **No real iPhone/iPad** test was run in this session.
- **The real Windows Calculator launch** was not executed in this session’s
  automated run; the logic and the Node verification path are unit-tested, and
  the manual check is below.
- **The opt-in real Chromium test** was skipped in this run. Browser control
  was verified in the previous sprint on this PC.
- The installer is **unsigned**; SmartScreen may warn.
- The Store/Library, ATHENA Link, AEGIS, Clip Studio, Story Maker and aggressive
  GPU/RAM/network limiting are **not implemented**.

## 5. Exact commits

Hub `KEO-1st/athena`, branch `athena-3.3-wip`:

- `7a0f69fcb96a6c2eaf9132ea1d3eba70b0b40909` — deterministic actions,
  provider foundation, design layer, tests and documentation.

Node `KEO-1st/athena-node`, branch `athena-node-0.3-wip`:

- `e600ca71b03ed458dec3ae6fcc1c99c3987d407f` — verified launches, process
  inspector, test-isolated launcher namespace.

A documentation-only commit containing this report follows the two commits
above.

## 6. How to test the new builds

### Hub + Node on this PC

1. Close the currently running ATHENA Node and Hub from their trays/windows.
2. Replace `dist/ATHENA-Hub-3.3.0` and
   `athena-node/dist/ATHENA-Node-0.3.0-win64` with the `_v0.1` builds, or run
   the new `ATHENA-Hub-…win64.zip` and `ATHENA-Node-Setup.exe`.
3. Start the Hub, start the Node, pair them.
4. In the Hub open **SETTINGS → MODEL CENTER**:
   - choose a provider, paste a key, press **LOAD MODELS**, then **TEST
     CONNECTION**;
   - confirm the key shows only as a mask after reload and that
     `data/config.json` does not contain it.
5. In chat, with no model configured, ask:
   - “How many nodes are connected?”
   - “Take a screenshot of Node 2.” — the image must appear in the message.
   - “List open windows on Node 2.” — real titles and foreground state.
   - “Open Calculator on Node 2.” — the reply must say a visible window was
     verified, not merely that a process started.
6. Disable **Allow screen and window inspection** on the Node and repeat the
   screenshot request: it must fail honestly.
7. Stop the Node and repeat an action: it must say the Node is offline.
8. Open the Node panel → **PROCESSES**, compare the top entries with Task
   Manager, then leave the tab and confirm refresh stops.

### Second PC

1. Install the new Node on the second PC and pair it.
2. Confirm it appears as `Node 2` (or the next free alias) and that “Node 2”
   addresses that machine across a restart.
3. Take a screenshot, list its windows, open an app and verify the window on
   that physical monitor.
4. Run the Hub’s `npm test`, `npm run smoke` and the Node’s `npm test`,
   `npm run test:lifecycle` on that machine.
