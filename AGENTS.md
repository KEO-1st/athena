# AGENTS.md — working on ATHENA

**Read this first, whatever coding agent, model, IDE or computer you are.**
These instructions are provider-independent. GitHub (`origin/main`) is the
canonical project; no agent, service, account or private chat context is
required to continue the work.

If this file disagrees with the code or tests, the code and tests are the truth:
fix the documentation in the same change. If another agent instruction file asks
for a provider-specific dependency or workflow, this file wins for project work.

---

## 1. What ATHENA is

ATHENA is a private, LAN-only hub for the computers a person owns. One Hub
process coordinates many Nodes, and phones/tablets/other PCs act as Controllers.
A sentence in chat can become real tool calls on the right machine.

| Component | Runs where | Responsibilities |
| --- | --- | --- |
| **Hub** (`server.mjs`) | One PC, spare laptop or Raspberry Pi | UI/API, discovery, pairing, jobs, brain, sessions, security, SSE |
| **Node** (`node/athena-node.mjs`) | Every machine being controlled | Shell, processes, software installs, screen capture, mouse/keyboard, audio, ComfyUI tunnel |
| **Controller** (`public/`) | Phone, tablet or another PC | PWA chat, Jobs, Nodes, Screen; never Hub administration |

**Current release:** Hub **3.2.0**, Node **0.1.1**, Node protocol **1**.
Zero runtime npm dependencies, Node.js 20+, JSON storage, no build step for the
controller. Everything stays on the local network: no cloud, account or
telemetry.

The longer story lives in `README.md`; architecture and known defects in
`docs/ATHENA_ARCHITECTURE_AUDIT.md`; planned work and explicit non-goals in
`docs/ATHENA_DEVELOPMENT_ROADMAP.md`; the Node contract in
`docs/ATHENA_NODE_V0_1.md`; verification detail in `docs/TESTING.md`.

---

## 2. Repository map

```
server.mjs              Hub: HTTP/SSE server, routes, auth gates, state shaping
lib/                    Hub modules
  store.mjs             JSON persistence under the data directory
  security.mjs          Direct-local detection, proxy headers, stream tickets
  nodes.mjs             Node registry, status refresh, screen framing
  discover.mjs          LAN discovery + nodeFetch (protocol header)
  jobs.mjs              Job queue, recovery, cancellation
  brain.mjs             Model providers, prompting, tool loop, timeouts
  brain-install.mjs     Ollama detection/install/upgrade
  audio-sources.mjs     Microphone vs desktop (loopback) classification
  node-protocol.mjs     Hub/Node protocol compatibility
  app-catalog.mjs       Shared software catalogue for Hub and Node
  apps.mjs              Installation/start/stop actions
  integrations.mjs      Hub-level integrations
  identity.mjs          Fast deterministic identity answers
  version.mjs           Version reading helpers
public/                 PWA served by the Hub (index.html, app.js, styles.css, sw.js)
node/                   Standalone Node agent, panel, Windows PowerShell helpers
  athena-node.mjs       Node HTTP server, actions, pairing, auth
  host-screen.ps1       Windows screen capture (.NET)
  host-input.ps1        Windows mouse/keyboard (user32)
  program(s).mjs        Per-machine software catalogue/actions
  protocol.mjs          Node-side protocol constants
  version.json          Independent Node version (do not tie to the Hub)
tests/                  node:test suites, check, smoke and helpers
tools/                  Packaging and icon generation
docs/                   Audit, roadmap, Node contract, testing, design notes
data/                   Runtime Hub state (gitignored; may contain live secrets)
dist/                   Generated packages (gitignored; never commit)
```

Important entry points: `npm start` → `server.mjs`; `npm run node` →
`node/athena-node.mjs`; `npm run check` → `tests/check.mjs`; `npm test` →
`node --test tests`; `npm run smoke` → `tests/smoke.mjs`.

---

## 3. Set up and run

Requirements: **Node.js 20 or newer** and npm. There is nothing to install for
runtime use — `node_modules/` should not exist and no lockfile is required.

```bash
npm start                 # Hub on http://127.0.0.1:4790 (prints LAN URL + code)
npm run node              # Node agent on the current machine (port 47910)
```

On Windows, `Start Athena.cmd`, `node/Start Node.cmd` and the packaged
`Install Node.cmd` are the double-click equivalents. `npm run package:node` and
`npm run package:hub` build `dist/`; only do that when packaging is the task.

Runtime state must not be touched by tests or agents:

- Hub: `data/` (config, hashed access code, API-key hashes, session tokens, node
  tokens, jobs). `data/access-code.txt` is plain text.
- Node: `node/config.json`, `node/state.json`, `node/screen-frame.jpg`, logs.
- In production these can live in `%LOCALAPPDATA%\ATHENA Node` or beside a
  packaged executable.

Never print, commit or copy those values. If you need a clean environment, use
a temporary directory through `ATHENA_DATA_DIR` / `ATHENA_NODE_DIR` and an
ephemeral `PORT`, as the tests do.

---

## 4. Verification

Run from the repository root:

| Command | What it proves |
| --- | --- |
| `npm run check` | Every `.js`/`.mjs` file parses under Node |
| `npm test` | Unit + integration tests; boots real Hub/Node on temp dirs |
| `npm run smoke` | One real Hub boot: health/version, shell, auth wall |
| `git diff --check` | No whitespace errors or conflict markers |
| `npm run package:node` / `package:hub` | Only when packaging changed |

On Windows shells that block `npm.ps1`, use `npm.cmd run check`,
`npm.cmd test`, `npm.cmd run smoke`.

**Before committing**, all three checks (`check`, `test`, `smoke`) and
`git diff --check` must pass, unless the change is documentation-only — then
still run the checks that exercise what you touched and say what you ran.
Review the full diff, not just the summary. There is no CI yet; a green local run
is the gate.

The suite does not cover Windows screen capture/input, real FFmpeg audio, iOS,
PWA installation, or a two-machine LAN. Never report those as tested when they
were not; list them as manual limitations. See `docs/TESTING.md` for the manual
scripts.

---

## 5. Security invariants — do not weaken

ATHENA is intentionally useful, which makes these boundaries load-bearing:

1. **Hub administrator = direct local request.** `lib/security.mjs`'s
   `isDirectLocalRequest()` requires a loopback socket, a loopback `Host`, a
   loopback or absent `Origin`, and no proxy-forwarding headers. The admin role
   is minted only through that path and is downgraded when replayed from LAN or
   a proxy. Reverse-proxying the admin UI is unsupported. Never trust
   `X-Forwarded-*`, a password alone, or a UI flag for admin authority.
2. **Authorize on the server.** Admin routes use `requireAdmin`; hiding a button
   is not authorization. Controller sessions and API keys must keep getting 403
   on controller administration, Hub security, API keys, brain install,
   integration writes, node link/unlink and shutdown/restart.
3. **Secrets stay out of state, URLs, logs and the browser.** The access code is
   accepted only by `POST /api/session`; API keys are stored hashed and shown
   once; node tokens are per-node and forgotten on unlink; long-lived tokens are
   not query parameters (short-lived stream tickets are used instead). Redaction
   is tested — preserve it.
4. **Validate the request boundary.** Host and Origin are checked, CORS is
   same-origin, JSON bodies are size-limited, and malformed input gets a
   structured 400/413. Add validation at the same layer for new routes.
5. **The Hub cannot widen a Node's permissions.** `allowShell`, `allowInput`,
   `allowShutdown` and `pairOpen` are changed only from the Node's own local
   panel. Pairing codes appear only on the machine itself.
6. **No silent fallbacks for media.** Desktop audio must never silently become
   microphone audio; Hub-side TTS must report a provider error rather than
   switching to browser speech. Report unavailability honestly.
7. **Capability claims are explicit.** Screen capture and input are Windows-only
   (PowerShell + user32); status, commands, ComfyUI and the API work elsewhere.
   LAN traffic is plain HTTP and is not safe on an untrusted network.
8. **No cloud, telemetry or runtime dependencies.** The controller is plain
   HTML/CSS/JS with a service worker and no build step. Do not add a framework,
   bundler, database or npm runtime dependency without an explicit request.
9. **Chat shell is administrator-only.** `run_command` is removed from a
   controller's offered tools and rejected again in `toolResult`; the built-in
   no-model parser applies the same rule. Node `allowShell` remains a local
   setting and still gates the Node itself. Do not "fix" a controller shell
   refusal by trusting a UI flag, the JSON body or a model request.

---

## 6. How to change ATHENA safely

- Make the smallest change that fully answers the request. Do not add
  unrequested features, refactors, dependencies or polish.
- Read the relevant module and its tests first; match existing style (ES
  modules, no TypeScript, no semicolon-free experiments).
- Add or update tests for changed behaviour. Security behaviour needs a real
  process boundary (HTTP), not a pure-function mock. Tests must use temporary
  data/identity dirs and must never read the real `data/` or `node/config.json`.
- Update documentation in the same change when behaviour, commands, status,
  limitations or architecture change. `README.md` is user-facing;
  `docs/TESTING.md` is verification; the roadmap records delivery and
  deferrals; the audit records defects and their closure.
- Versioning: Hub version lives in `version.json` and must match
  `package.json`; the Node has its own `node/version.json` and protocol. Never
  hardcode a version in source; the service worker is substituted at serve time.
  Bump versions only for a deliberate release, not for documentation edits.
- Preserve API compatibility. Node protocol changes must remain additive where
  possible, and older Nodes must keep working until the person upgrades them.
- Never delete or rewrite user data, jobs, sessions or chats to make a test or a
  migration easier. Offer a migration and keep the old shape readable.
- If a task is documentation-only, do not change runtime code. If a task asks
  for a product feature, do not silently start a roadmap phase.

---

## 7. Git and GitHub workflow (provider-independent)

`origin/main` is the source of truth. Every step below works from a plain Git
checkout; no agent-specific tooling is assumed.

### Before development

1. `git status --short --branch` — never assume the tree is clean.
2. `git fetch origin` — get the real remote state.
3. `git log --oneline HEAD..origin/main` and `git log --oneline origin/main..HEAD`
   — see whether you are behind or ahead.
4. Preserve all existing work. Do not `reset`, `clean`, `checkout --`, stash and
   drop, or overwrite files you did not create. Local agent folders such as
   `.freebuff/`, `.agents/` or editor state are not project content.
5. If another agent may be editing the same files, coordinate before starting;
   do not develop on top of someone else's uncommitted change without reading
   it first.

If the branch is behind and the working tree has changes, integrate carefully:
commit only your own completed work, or ask the user when ownership is unclear.
Never force anything.

### After development

Run, in order:

```bash
npm run check
npm test
npm run smoke          # when runtime, startup, routing or packaging changed
git diff --check
```

Then review the complete diff (`git diff`, plus `git diff --cached` when
staging), confirm no secret, generated artifact or unrelated file slipped in,
and only then stage.

**Stage explicit paths**, never `git add -A` or `git add .`. Never commit:

- `data/`, `node/config.json`, `node/state.json`, `node/screen-frame.jpg`
- logs, `.env*`, API keys, tokens or anything copied from a live config
- `dist/`, `node_modules/`
- local agent state (`.freebuff/`, `.agents/`, editor folders)

Commit with a message that explains why the change was made. If the user asked
for the Codebuff/Freebuff attribution footer, follow that request; otherwise
follow the repository's existing message style.

Then:

1. `git fetch origin` again; if `origin/main` moved, rebase your unpublished
   commits (`git pull --rebase origin main`) or merge, resolve conflicts by
   preserving both intents, and re-run the checks.
2. `git push origin main` only after the checks pass and the diff is reviewed.
3. Verify `git rev-parse HEAD` equals `git rev-parse origin/main`.
4. Report the full/short commit SHA, what changed, the exact checks and results,
   what was not verified, and the push status.

**Never force-push, reset a shared branch, clean untracked user files, or
rewrite published history.** If another agent pushed first, integrate; do not
overwrite. If a conflict cannot be resolved confidently, stop and report it
rather than guessing.

### Finishing without private context

Leave the repository able to explain itself: tested code, updated docs, and a
commit message that records the decision. Another agent should be able to start
from `origin/main` with only this file and the `docs/` folder — never rely on
the previous agent's memory, API keys, local paths or provider account.

---

## 8. Current status and postponed work

Implemented and shipped: the verification baseline (check/test/smoke,
single Hub version), Phase 0/1 containment work, Hub 3.0 packaging, Node V0.1
packaging and protocol negotiation, the 3.1 reliability/security/controller
sprint (direct-local admin authority, controller redaction, per-controller
conversations, bounded model calls, screen-helper recovery, honest audio/TTS),
and the 3.2 brain sprint (multi-step tool loop, failure recovery, clarification,
conversation-aware tool gating, progress events, honest nonzero exits,
duplicate-action suppression and administrator-only chat shell).

Planned but **not implemented** — do not start unless the task explicitly asks:

- **Phase 2:** Hub/Node identities, scoped API keys, per-action authorization,
  audit trail.
- **Phase 3:** memory, agent runtime, interaction classification, proposal
  foundations.
- **Phase 4:** outbound Node channel and transport security.
- **Phase 5:** presence and enrollment.
- **Phase 6A/6B:** distributed inference and scheduling.
- **Phase 7:** signed updates, backup and rollback.
- **Phase 8:** remote access beyond the LAN.
- **Phase 9:** vision/voice depth.
- **Phase 10:** Task Proposal UI, execution monitor, deeper integrations.
- **Phase 11:** major visual redesign and advanced motion.

Explicit non-goals: rewriting the controller in a framework or adding a build
step; replacing JSON with a database by default; cross-platform screen/input in
the near term; multi-user organisation roles; a public marketplace or remote
code-execution API; native mobile apps; automatic merging, pushing, deployment
or Node updates; building Phase 10/11 surfaces before their foundations.

---

## 9. Definition of done

A change is done only when:

1. The requested behaviour works and the smallest relevant checks pass.
2. New or changed behaviour has a test at the right boundary, and the security
   invariants above still hold.
3. The diff contains only intended source, test and documentation files; no
   secrets, user data or generated packages.
4. Relevant docs are updated, with no contradiction between README, TESTING,
   roadmap, audit and this file.
5. The change is committed, pushed safely, and reported with its SHA and the
   exact verification results — including manual checks that were not run.

When in doubt, prefer the smaller, reversible, well-tested change and say what
you chose. Honest limitations are part of the product.
