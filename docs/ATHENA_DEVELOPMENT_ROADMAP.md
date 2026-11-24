# ATHENA — Development Roadmap

**Companion to:** `docs/ATHENA_ARCHITECTURE_AUDIT.md`
**Status:** Phase 0 and Phase 1 are implemented in v2.3.0 (delivery record in §21); Phase 2 onward is planned only.
**Baseline:** branch `main` at `60663d9`, hub `2.2.2`, node `2.2.1`, zero npm dependencies, no tests, no CI.

---

## 1. How to read this roadmap

Each phase is a shippable slice with a single purpose, a dependency list, concrete work items, and acceptance criteria written as observable behaviour. A phase is done only when every acceptance criterion can be demonstrated on a fresh checkout with a documented command or a documented manual script.

Three rules govern the ordering:

1. **Containment before capability.** The trust-plane defects (secrets in state, loopback trust, unvalidated settings, unscoped keys) are fixed before any new surface is added. Adding memory, presence or remote access on top of the current auth model would multiply the blast radius.
2. **Verify before extending.** Phase 0 adds the missing feedback loop (scripts, smoke test, version source). No later phase should be merged without the checks it introduces.
3. **One transport change, then features.** The outbound node channel (Phase 4) is a hard prerequisite for presence, distributed inference and remote access, because all three assume a node that can be reached without inbound ports.

Estimates are deliberately expressed as **relative effort** (S/M/L) rather than calendar time, since the work is currently one contributor and hardware-dependent.

---

## 2. Phase overview

| Phase | Theme | Effort | Depends on | Vision areas unlocked |
| --- | --- | --- | --- | --- |
| 0 | Verification baseline | S | — | — (enables all) |
| 1 | Correctness and containment | M | 0 | A, B (reliability), J (partial) |
| 2 | Identity and authorization | L | 1 | G (foundation), I (foundation) |
| 3 | Memory, agent runtime, interaction classification, proposal foundations | L | 1, 2 | A, B, C |
| 4 | Outbound node channel and transport security | L | 2 | I (foundation), 6A/6B (foundation) |
| 5 | Presence and enrollment | M | 2, 4 | G |
| 6A | Distributed AI inference | L | 3, 4 | F |
| 6B | Distributed computing and scheduling | L | 3, 4, 6A | F, B (at scale) |
| 7 | Updates, backup and rollback | M | 0, 2 | H |
| 8 | Remote access | M | 4, 7 | I |
| 9 | Vision and voice depth | M | 3, 6A | D, E |
| 10 | Task Proposal UI, Execution Monitor, integrations | L | 3, 6B, 7 | B, C (work), G (workflow consent) |
| 11 | Major visual redesign and advanced 3D/motion | L | 9, 10 | J |

Phases may overlap where dependencies permit. 5, 7 and parts of 9 can proceed in
parallel with 6A/6B once Phase 4 lands. Phase 10 must not be built before the
scheduler and telemetry exist, and Phase 11 must not begin before the work
surfaces exist, or it will be a beautiful shell around nothing. Conversely, the
voice and accessibility work in Phase 9 should not be delayed for the visual
redesign.

---

## 3. Phase 0 — Verification baseline

**Goal:** make the repository checkable, so every later claim is tested rather than reasoned.

**Scope**

- `package.json` with `"type": "module"`, `engines.node >= 20`, and scripts: `start`, `check`, `test`, `smoke`.
- A single version source (e.g. `version.json` or `package.json` `version`) read by hub, node, service worker cache key and the UI label.
- `node:test` harness with a temp-directory helper for `data/`.
- A smoke test that boots the hub on an ephemeral port with a temp data dir and asserts `/api/health`, static `/`, and 401 on a protected route.
- A fake node server helper used by later protocol tests.
- A short `docs/TESTING.md` describing what is automated and what must be run manually on Windows.

**Out of scope:** refactoring the hub; changing behaviour; adding dependencies.

**Acceptance criteria**

1. `npm test` runs on a clean checkout with Node 20+ and exits non-zero on failure.
2. `npm run smoke` boots and stops the hub without touching the real `data/` directory.
3. Changing the version in one place updates `/api/health`, the node's reported version and the service-worker cache key (verifiable by grep and by one assertion).
4. The service worker precache URLs and the asset query strings in `index.html` are generated from the same version value, or a test asserts they match.
5. No runtime dependency is added; `npm ls --omit=dev` shows an empty tree.

**Risks:** introducing a package manager where none existed. Mitigation: scripts only, no runtime deps, no lockfile churn beyond `package-lock.json` if npm is used.

**Exit criteria:** CI (or a documented pre-commit command) runs `check` + `test` + `smoke`, and all three pass on `main`.

---

## 4. Phase 1 — Correctness and containment

**Goal:** remove the defects that can lose work or expose the system, without changing the product's shape.

**Scope**

1. **Job lifecycle** (`lib/jobs.mjs`, hub boot): reconcile on load — `running` → `failed` with a reason, `queued` → pumped; implement cancellation of running jobs by forwarding `task-cancel` to the node and marking the job `cancelled`; make the UI's CANCEL affordance match the server's capability.
2. **Secret hygiene** (`server.mjs`): remove `code` and `dataDir` from `hubState()`; accept the access code only at `/api/session`; stop accepting session tokens in query strings for general API calls and introduce short-lived, single-purpose stream tickets for SSE and audio; hash the access code at rest; never log it.
3. **Node log redaction** (`node/athena-node.mjs`): remove the pairing code from the boot log; redact tokens/codes in `tailLog()`; keep the code visible only in the local panel.
4. **Request validation** (`server.mjs`, `node/athena-node.mjs`): validate `Host` and `Origin`; replace wildcard CORS with an explicit same-origin policy; add body size limits to node routes; return structured 400s for malformed bodies; validate settings keys and provider URLs.
5. **Provider override** (`/api/ask`): delete `body.context` merging; the server owns brain configuration.
6. **Settings protection** (`/api/settings`): require re-authentication for `openMode` and code rotation, and require a local confirmation (loopback or physical) for security-changing operations.
7. **Node config consent** (`config` action): require local approval for `allowShell`, `allowInput`, `allowShutdown`, `pairOpen`; log every change.
8. **Loopback trust** (`tokenOk`, `/api/local/*`): require a per-boot local capability token in addition to the loopback address, delivered to the panel through a local-only bootstrap; validate `Origin`.
9. **Housekeeping:** cache provider probes for 30–60 s; stop saving `nodes.json` on unchanged refreshes; deduplicate the app catalogue into one shared definition; add `prefers-reduced-motion` and missing `aria-label`s.

**Out of scope:** changing the auth model to keys/scopes (Phase 2), memory, transport changes.

**Acceptance criteria**

1. A hub started with a pending queued job executes it automatically; a persisted `running` job becomes `failed` with a visible reason.
2. Cancelling a running job succeeds and the node task stops; the UI never offers an operation the server rejects.
3. `GET /api/state` contains no access code, data directory or token; no URL used by the UI carries a long-lived secret.
4. No log line contains an access code or pairing code; a test asserts redaction.
5. Every route except `/`, static assets, `/api/health` and `/api/session` returns 401 without a credential; a request with a mismatched `Host` or a foreign `Origin` is rejected in both servers.
6. `POST /api/ask` with a `context` override does not change the provider used.
7. Turning on `openMode` requires re-authentication plus local confirmation; the action appears in the audit log introduced in Phase 2 (or a temporary log until then).
8. A loopback request without the local capability token is rejected by `/api/local/*`.
9. A manual iOS check shows the reduced-motion preference respected.

**Exit criteria:** the audit's D-02…D-10, D-14, D-16…D-19 are closed or explicitly deferred with a written reason.

---

## 5. Phase 2 — Identity and authorization

**Goal:** replace "authenticated means omnipotent" with identities, scopes and an audit trail.

**Scope**

- **Hub identity:** generated key pair + `hub_id`, stored with restrictive permissions; exposed as a public fingerprint in state.
- **Node identity:** key pair + `node_id`; pairing becomes a signed challenge exchange, with the 6-character code reduced to a short-lived one-time bootstrap secret.
- **Scoped credentials:** API keys carry scopes (`read`, `chat`, `screen`, `input`, `shell`, `admin`), an expiry, a last-used timestamp and a name; session tokens carry the same scope set derived from the login method.
- **Policy layer:** a single authorization function evaluated per route/action, with an explicit table of destructive operations that require a confirmation token issued out-of-band (local confirmation or a second factor).
- **Audit log:** append-only, rotating, with actor, action, target, result, timestamp and request id; readable in the System page with filters.
- **Credential lifecycle:** rotation, revocation, "sign out everywhere", and removal of node tokens on unlink (with a retry queue if the node is offline).
- **Rate limits:** per credential and per route class, not just per IP; lockout with backoff for pairing and login.

**Acceptance criteria**

1. A key scoped `read` can call state and status but receives 403 for shell, input, screen and settings.
2. Pairing a node without the one-time secret fails; replaying a used secret fails; the secret expires.
3. A node unlinked while offline is revoked on its next connection, not left with a working token.
4. Every destructive action appears in the audit log with actor and target, and the log survives restart.
5. Revoking a key invalidates it within one request, with no cached authorization.
6. `openMode`, if kept, is off by default, requires an explicit local confirmation, and is visible on the dashboard at all times.
7. A loopback-only attacker model is documented and tested: no local page can obtain a capability token without the bootstrap path.

**Risks:** cryptographic mistakes. Mitigation: use Node's `crypto` primitives (Ed25519, HKDF, timing-safe compare) with test vectors; do not invent a protocol; keep the LAN HTTP mode for development behind an explicit flag.

**Exit criteria:** the audit's R-01…R-09, R-15 and R-16 are addressed; the threat model is written down in `docs/SECURITY.md`.

---

## 6. Phase 3 — Memory and the agent loop

**Goal:** make ATHENA actually remember and actually plan, which is the heart of the vision.

**Scope**

0. **Interaction classification** (`lib/intent.mjs`): classify every request as
   conversation, simple action or complex task, with a confidence and the
   reasons; below threshold, ask a clarifying question instead of acting. A
   request for a written plan is conversation, not an execution task. The
   classifier is model-assisted but testable against a documented phrase set.
0b. **Proposal foundations**: the planner may emit a proposal payload (objective,
   stages, dependencies, app/model/node choices, estimates, warnings) without
   any UI. Integrations are described by a registered descriptor
   (`id`, capabilities, input/output kinds, resource profile, health check), not
   by hardcoded product names. This is the data Phase 10 renders.
1. **Memory store** (`lib/memory.mjs`): append-only JSONL for conversations, messages, task journal, preferences and summaries; conversation ids owned by the server; retention and deletion controls; optional summarisation job that compresses old turns.
2. **Server-owned chat:** the controller sends a conversation id, not an arbitrary history array; the server assembles the model context (recent turns + relevant summaries + preferences) and enforces a token budget.
3. **Retrieval:** keyword/recency retrieval first; embeddings only if a local embedding model is available, behind a feature flag.
4. **Task journal:** every job and tool call is recorded against the conversation, so "what did you do yesterday" is answerable.
5. **Agent runtime** (`lib/brain.mjs`): keep tools available on every round; add an explicit plan/step object with a step budget; support verification steps after mutating tools; support cancellation and timeouts; type tool results; separate "propose" from "execute" for destructive actions.
6. **Confirmation policy:** destructive tools (`run_command`, `shutdown`, `control_mouse_keyboard` with submit-like actions, `node_action` with restart) require an explicit user confirmation, surfaced as a card in the chat rather than a free-text assumption.
7. **Deterministic fallback:** the heuristic path uses the same policy layer, so a keyword match cannot bypass confirmation.
8. **UI:** conversation list, "new conversation", memory controls (what is remembered, forget this, export), and a visible plan/step trace for multi-step tasks.

**Acceptance criteria**

1. A two-step task ("take a screenshot, find the browser, open a new tab") completes in one user turn with at least two tool rounds and a verification screenshot.
2. Restarting the hub preserves conversations and task history; the same conversation id resumes on a second device.
3. The model receives no raw client-supplied history; a crafted request cannot inject assistant/tool turns.
4. Destructive actions are only executed after a confirmation event tied to the conversation.
5. Cancelling a running agent turn stops further tool calls within one step.
6. Old conversations are summarised under a token budget, and the summary is visible/exportable.
7. No memory write contains secrets (access code, tokens, API keys) after redaction tests.
8. Conversation / simple action / complex task are classified correctly on the
   documented phrase set; a written-plan request never becomes a proposal.
9. A proposal payload can be generated for a multi-stage request and validated
   against its schema, with no UI and no execution.

**Exit criteria:** vision areas A, B and C have end-to-end acceptance scenarios in `docs/TESTING.md` and pass on a LAN deployment; classification and proposal payloads are covered by tests.

---

## 7. Phase 4 — Outbound node channel and transport security

**Goal:** stop requiring inbound ports on nodes, and make every hop encrypted and mutually authenticated.

**Scope**

- **Outbound channel:** the node opens a persistent authenticated connection to the hub (WebSocket preferred; long-poll as fallback) and receives commands over it. The hub no longer needs to reach `http://<node>:47910` from outside the node.
- **Bind to loopback:** the node's HTTP listener moves to `127.0.0.1`, used only by the local panel and the local capability path.
- **Framing and backpressure:** request/response correlation ids, per-connection queue limits, chunked screen frames, cancellation messages, heartbeats and reconnect with exponential backoff.
- **TLS:** hub serves HTTPS with a documented certificate path (local CA or reverse proxy); WSS for nodes; certificate pinning for node↔hub after pairing.
- **Comfy tunnel:** proxy over the channel with streaming bodies and WebSocket upgrade support, or document it as unsupported and remove the half-implementation.
- **Discovery:** keep UDP discovery as a convenience only, with the pairing decision made by identity, not by an unauthenticated broadcast.

**Acceptance criteria**

1. A node behind NAT with no forwarded ports can pair and be controlled.
2. The node has no listener on a non-loopback interface in normal operation.
3. Killing the hub reconnects the node automatically with backoff and no duplicate command execution.
4. Large screen frames stream without unbounded memory growth; a stalled consumer is disconnected.
5. TLS is enforced by default for non-loopback clients; plain HTTP is available only with an explicit development flag.
6. A man-in-the-middle with a different certificate cannot impersonate the hub after pairing.
7. ComfyUI live progress works through the tunnel, or the feature is explicitly marked unsupported and hidden.

**Risks:** WebSocket implementation choice (Node built-in client vs. a pinned server library vs. hand-rolled). Decision required at phase start, documented in an ADR, with a bias toward the smallest auditable option.

**Exit criteria:** vision areas I and F have a stable transport foundation; the audit's R-03 and R-21 are closed.

---

## 8. Phase 5 — Presence and enrollment

**Goal:** make a new machine introduce itself, ask for consent, and join in one flow.

**Scope**

- **Presence page:** served by the node at install time (or by a small launcher), showing the cosmic-eye identity, the machine name, its capabilities (GPU, screen, audio, shell) and a clear "this machine can be controlled" statement.
- **One-time consent:** the presence page issues a short-lived, single-use enrollment token after a local click; the hub consumes it; the token is bound to the node's public key.
- **Install wizard:** `Install Node.cmd` becomes a guided flow (prerequisites check, firewall guidance, capability selection, hub address entry or discovery, confirmation), with a non-interactive mode for advanced users.
- **Capability consent at enrollment:** `allowShell`, `allowInput`, `allowShutdown`, screen and audio are chosen explicitly, with defaults off for shell and shutdown.
- **Visible state:** a persistent tray/panel indicator on the node when it is connected and when it is being observed or controlled.
- **Re-enrollment and transfer:** a documented way to move a node to a new hub, with explicit revocation on the old hub.

**Acceptance criteria**

1. A fresh Windows machine reaches a working paired node without copying files by hand beyond running one installer.
2. No capability is enabled without an explicit local choice; defaults are least-privilege.
3. The enrollment token is single-use and expires; a replayed token is rejected.
4. The node shows a visible indicator while screen or audio is being captured.
5. A node can be transferred to a new hub, and the old hub loses access.
6. Uninstalling the node removes its credentials and stops its processes.

**Exit criteria:** vision area G is satisfied; the "presence" identity is consistent with the controller's visual language.

---

## 9. Phase 6A — Distributed AI inference

**Goal:** use the GPUs and models that exist on the nodes, not only the hub's.

**Design:** `docs/ATHENA_DISTRIBUTED_COMPUTE_DESIGN.md`.

**Scope**

- **Model inventory:** each node reports installed Ollama models, sizes, quantization, context limits and GPU memory; the hub aggregates a registry.
- **Capability envelope:** per-node declarations (vision-capable, tool-calling, context size, expected tokens/sec) derived from probing, not model-name regexes.
- **Placement policy:** explicit user choice per task ("run this on NODE-B") plus an automatic policy (largest fit, lowest latency, prefer local); visibility into why a node was chosen.
- **Routing:** the hub proxies inference to the chosen node over the outbound channel; node Ollama stays on loopback; the hub enforces timeouts, cancellation and size limits.
- **Cost/latency accounting:** per-request duration and token counts recorded in the task journal.
- **Fallback:** if the chosen node is unavailable, fall back to the hub model or cloud provider with a visible notice, never silently.

**Acceptance criteria**

1. A model installed only on a node can be selected and used from the controller.
2. The UI shows which node will run a request and why, and allows overriding it.
3. Node Ollama remains unreachable from the LAN; all access is through the authenticated channel.
4. Vision/tool capability is determined by probing and matches observed behaviour for at least three models.
5. A node going offline mid-request produces a clear error and a documented fallback, with no hung request.
6. Token/latency metrics appear in the task journal.

**Exit criteria:** vision area F is satisfied for at least two nodes with different GPUs.

---

## 10. Phase 6B — Distributed computing and scheduling

**Goal:** run real multi-stage work across machines without pretending every
workload parallelises.

**Design:** `docs/ATHENA_DISTRIBUTED_COMPUTE_DESIGN.md`.

**Scope**

- **Workflow DAG:** stages with typed inputs/outputs, dependencies,
  `parallelizable` and `maxConcurrency`; validation rejects cycles and missing
  inputs.
- **Resource Registry:** live facts per node (GPU/VRAM, CPU, RAM, disk, models,
  apps, capabilities, queue, link health) with `observedAt`; stale facts are
  labelled stale.
- **Scheduler:** hard constraints (capability, fit, app/model present, platform,
  data locality, dependency order) and soft preferences (warm model, queue wait,
  measured throughput, transfer cost), with a recorded reason per choice and
  manual override.
- **Task Executor:** assignment over the Phase 4 channel, stage timeouts,
  cancellation, retries only for idempotent stages, node-loss handling.
- **Artifact Manager:** ids, checksums, media types, locations, retention and
  provenance (model, prompt, seed, app version).
- **Telemetry:** sampled CPU/GPU/RAM/VRAM/disk/network, queue depth and hub RTT,
  with explicit live / historical / estimated labels.
- **Estimates:** input size, workload class, measured throughput, queue and
  transfer time; ranges with a basis, never invented numbers.

**Acceptance criteria**

1. A three-stage workflow with one dependency runs across two nodes.
2. A non-parallelizable stage is never split; parallel branches do run together.
3. A pinned node that is offline fails the task with a reason, not a retry loop.
4. Artifacts are checksummed and provenance is recorded.
5. Hub restart reconciles running stages as failed and resumes queued ones.
6. Every monitor number is labelled live, historical or estimated; unavailable
   sensors read `—`, never zero.
7. The scheduler records and the UI can show why a node/model was chosen.

**Exit criteria:** vision area F holds at workflow scale; Phase 10 has real data
and real execution to render.

---

## 11. Phase 7 — Updates, backup and rollback

**Goal:** make the system safe to leave running and safe to change.

**Scope**

- **Release manifest:** signed JSON describing version, artifacts, checksums, minimum compatible version and release notes.
- **Update flow:** check → download to a staging directory → verify signature/checksum → back up `data/` and the current version → apply → health check → commit or roll back automatically.
- **Node updates:** the hub triggers a node update over the authenticated channel; the node verifies, stages, restarts and reports health; a failed health check restores the previous version.
- **Backup:** scheduled `data/` snapshots with retention, plus a manual export/import that includes node records (without tokens) and configuration (without secrets).
- **Health gate:** `/healthz` checks disk writability, brain reachability, job queue integrity and node connectivity; the updater refuses to commit on failure.
- **Migration framework:** versioned schema migrations for every JSON store, run once at boot, with a dry-run mode.

**Acceptance criteria**

1. An update from version N to N+1 succeeds on the hub and on a node, and the version is consistent in `/api/health`, the UI and the service worker.
2. A deliberately broken staged update triggers rollback and the previous version serves traffic.
3. Backups can restore a hub onto a fresh machine and preserve conversations, jobs, keys and node records.
4. Migrations are idempotent and a downgrade is refused with a clear message.
5. No update path requires manual file copying on the node.
6. Secrets are excluded from exports unless explicitly requested.

**Exit criteria:** vision area H is satisfied; the audit's R-19 and R-20 have documented mitigations.

---

## 12. Phase 8 — Remote access

**Goal:** reach the hub from outside the LAN without exposing it.

**Scope**

- **Preferred:** an authenticated relay or a WireGuard/Tailscale-style private network, with the hub making an outbound connection; no inbound port on the home network.
- **Alternative:** reverse proxy with TLS and strong auth for users who already run one; document the exact configuration and its risks.
- **Controller pairing:** devices are paired explicitly, with a name, scope and revocation; no shared password as the only factor.
- **Session security:** short-lived access tokens, refresh rotation, device revocation, and a visible list of active devices.
- **Abuse controls:** login rate limits, lockout, alerts on new device pairing, and an option to require confirmation from an existing device.
- **Documentation:** a deployment guide covering DNS, certificates, relay setup, firewall expectations and disaster recovery.

**Acceptance criteria**

1. The controller works over cellular data with no port forwarding and no public IP.
2. An unauthenticated scan of the public surface finds only the relay's authentication endpoint.
3. A new device requires explicit approval from an existing device or a local confirmation.
4. Revoking a device takes effect within one request.
5. The hub remains functional on the LAN if the relay is unreachable.
6. The deployment guide is sufficient for a reader who has never seen the repo.

**Exit criteria:** vision area I is satisfied end to end; the audit's R-02, R-06, R-12 and R-13 are closed in the remote configuration.

---

## 13. Phase 9 — Vision and voice depth

**Goal:** close the remaining experience gaps in D and E without destabilising the core. Visual identity work moves to Phase 11 so it is not done twice.

**Scope**

- **Vision:** capability-probed vision routing (no model-name regex), region selection before capture, OCR for text-heavy screens, screenshot upload for "what is this", multi-monitor targeting, and a visible capture indicator.
- **Voice:** continuous conversation mode with barge-in, wake phrase (local, opt-in), server-side ASR/TTS as an optional adapter, and a clear privacy statement for each mode.
- **Accessibility (still in scope here, improved again in 11):** reduced-motion,
  minimum text size, labels on icon-only controls, focus management in overlays.

**Acceptance criteria**

1. Vision routing is based on probed capability and works for a local VL model and a cloud vision model without a code change.
2. Selecting a screen region captures only that region and clicks map correctly.
3. Continuous voice mode can be interrupted mid-sentence and stops listening on command.
4. Reduced-motion is honoured automatically; a keyboard-only user can reach every action.
5. The capture indicator is visible on the node whenever screen or audio is being read.

**Exit criteria:** vision areas D and E are satisfied; the audit's D-14 is closed.

---

## 14. Phase 10 — Task Proposal UI, Execution Monitor and integrations

**Goal:** let complex work be planned, edited, approved and watched, on top of
real scheduler and telemetry data.

**Design:** `docs/ATHENA_TASK_PROPOSAL_AND_EXECUTION_UX.md`.

**Scope**

- **Interaction classes in the UI:** conversation stays in chat; simple actions
  get a one-line result or confirmation card; complex requests open a proposal.
- **Proposal window:** objective, ordered stages, dependencies, app/model/node
  per stage, inputs/outputs, duration and resource estimates, reasons for every
  choice, blocking warnings, editable settings, reorder/replace where legal,
  manual overrides, approve/cancel/revise.
- **Approval record:** who approved, when, which plan version; any edit
  invalidates approval.
- **Integrations:** descriptor-driven discovery and registration; AI Clip Studio
  and UNORDINARY Story Maker integrate through descriptors, never hardcoded
  product branches in the scheduler or planner.
- **Execution Monitor:** workflow and stage progress from observed units, live
  vs historical vs estimated telemetry, CPU/GPU/RAM/VRAM/disk/network, hub RTT,
  node identity and user-configured location, model/app in use, expandable
  stage detail, artifacts and provenance, stage-scoped logs, cancel/retry/pause.
- **Workflows list:** completed and failed runs remain inspectable.

**Acceptance criteria**

1. The three interaction classes behave distinctly; a written-plan request never
   opens a proposal.
2. Nothing executes before explicit approval; editing after approval forces a
   re-approval.
3. A missing model, offline pinned node or disabled capability blocks approval
   with a specific warning.
4. No product name is hardcoded; an integration appears only because it
   registered a descriptor.
5. The monitor never shows a fabricated measurement, and progress is based on
   observed units rather than a timer.
6. Cancelling a workflow stops queued stages and requests cancellation of the
   running stage; the result is visible immediately.
7. Completed workflows retain artifacts, provenance and the final plan.

**Exit criteria:** vision areas B and C are satisfied for real multi-stage work;
proposal and monitor meet the accessibility rules in the design doc.

---

## 15. Phase 11 — Major visual redesign and advanced 3D/motion

**Goal:** deliver the cinematic sci-fi system described in
`docs/ATHENA_VISUAL_DESIGN_DIRECTION.md`, without losing the current speed or the
cosmic eye.

**Scope**

- One token system for colour, type, spacing, motion and blur; one eye component
  shared by lock, home, presence and proposal surfaces.
- Real depth and light: layered parallax, volumetric glow, particles, iris and
  orbit response to state.
- Investigate in order: enhanced CSS/SVG → Canvas 2D light field → WebGL shaders
  → pinned Three.js only if justified. Record the decision in an ADR; lazy-load
  and provide a static fallback.
- Animated workflow visualisation driven by the same stage data as the text.
- Media compositing for real artifacts: posters, correct aspect ratios, no
  layout shift, no autoplay audio.
- Resolve `public/img/athena-bust.jpg` (use meaningfully or remove).
- Brand consistency: one version source, one name expansion, consistent labelling.

**Acceptance criteria**

1. The eye remains the identity anchor with depth, light and state-responsive
   motion; no generic circles or stock AI imagery replace it.
2. 60 fps on a mid-range phone on the home surface, with a documented 30 fps /
   no-WebGL fallback; ambient motion pauses when hidden or reduced-motion is set.
3. Proposal and monitor are legible and fast, part of the same world but not
   buried under atmosphere.
4. Media tiles have posters and no layout shift; workflow graphics match the
   real dependency graph.
5. All icon-only controls are named; focus is visible and managed in overlays.
6. Shell budgets are met or the overage is justified in an ADR.
7. No redesign adds a blocking load before the eye appears on the LAN.

**Exit criteria:** vision area J is satisfied; the audit's D-12, D-13 and D-14
are closed; the design doc's acceptance list passes.

---

## 16. Cross-cutting work (runs through every phase)

**Documentation**

- `docs/SECURITY.md` — threat model, trust boundaries, secret handling, disclosure process.
- `docs/PROTOCOL.md` — hub↔node messages, auth, versioning, error codes.
- `docs/TESTING.md` — automated vs. manual checks, Windows-specific scripts.
- ADRs for irreversible choices: WebSocket implementation, store engine, TLS termination, relay.

**Observability**

- Structured JSON logs with request ids, correlation ids across hub→node, and redaction by default.
- Audit viewer in the System page.
- A `/healthz` suitable for a monitor, and a simple dashboard of job/brain/node health.

**Compatibility**

- Protocol version negotiated at connection; hub refuses nodes outside its supported range with a clear message.
- Store schema versions with forward-only migrations and a documented downgrade policy.

**Performance budgets**

- Screen relay: target ≤ 150 ms frame latency on LAN, bounded memory per viewer.
- Chat: first token within 2 s for local models, or a visible "working" state.
- State: no provider probe on the hot path; state reads must not block on network I/O.

---

## 17. Traceability — vision area → phase

| Vision area | Primary phase | Also |
| --- | --- | --- |
| A. Conversation | 3 | 1 (reliability), 9 (voice) |
| B. Planning/execution | 3 | 2 (confirmation), 6B (placement), 10 (proposal UI) |
| C. Memory | 3 | 7 (backup/export) |
| D. Vision | 3, 9 | 4 (frame transport) |
| E. Voice | 9 | 4 (transport), 8 (remote) |
| F. Distributed AI | 6 | 4 (channel) |
| G. Presence | 5 | 2 (identity), 9 (visual) |
| H. Self-update | 7 | 0 (version source), 2 (signing) |
| I. Remote access | 8 | 4 (channel), 2 (authz) |
| J. Visual identity | 11 | 0 (version), 5 (presence), 9 (a11y) |
| Task proposal / monitor | 10 | 3 (payload), 6B (data), 7 (durability) |
| Integrations (Clip Studio, Story Maker) | 10 | 3 (descriptors), 6B (execution) |

---

## 18. Definition of done (per phase)

A phase is complete when all of the following are true:

1. Every acceptance criterion has a reproducible check (automated where possible, documented manual script otherwise).
2. New behaviour is covered by tests that fail if the behaviour regresses.
3. Security-relevant changes are reflected in `docs/SECURITY.md` and the audit's risk register is updated.
4. No secrets are added to state responses, logs, URLs or exports.
5. The version is bumped in one place and every surface agrees.
6. The change is documented for a reader who has not followed the work.
7. The previous phase's checks still pass — no phase is allowed to regress containment.

---

## 19. Explicit non-goals for this roadmap

- Rewriting the controller in a framework, or adding a build step.
- Replacing JSON storage with a database as a default.
- Cross-platform screen/input in the near term (declare Windows-only capabilities instead).
- Multi-user accounts with organisational roles.
- A public marketplace or remote code execution API.
- Mobile native apps.
- Automatic merging, pushing or deployment; all releases remain explicit and reviewed.
- Building the Task Proposal window before the scheduler, executor and telemetry
  exist, or the full visual redesign before the work surfaces exist.

---

## 20. Recommended first move

Start with **Phase 0 + Phase 1 together as one small release**, because Phase 1's fixes are mostly deletions and guards, and Phase 0 makes them testable. Do not begin Phase 3 (memory/agent loop) before Phase 2, and do not expose the hub beyond the LAN before Phase 4 and Phase 8 are both complete.

The single highest-value early change is the job reconciliation plus secret-hygiene work: it removes silent data loss (queued jobs never running, orphaned running jobs) and closes the credential disclosure paths that make every other feature riskier to add.
---

## 21. Phase 0 + Phase 1 delivery record (v2.3.0)

This release implements the immediate foundation. It is a behaviour-preserving
containment release plus the test harness the rest of the roadmap depends on.

**Phase 0 shipped**

- `package.json` with `start`, `node`, `check`, `test`, `smoke`; no runtime deps.
- `version.json` as the single version source, read by hub, node and the service
  worker template that the hub substitutes at serve time.
- `node:test` harness, temporary hub/node data directories via `ATHENA_DATA_DIR`
  and `ATHENA_NODE_DIR`, ephemeral ports via `PORT`, a fake node helper, a hub
  smoke test, and `docs/TESTING.md`.
- Version-consistency test: `version.json` ↔ `package.json`, no hardcoded
  versions in source, no `?v=` asset mismatch.

**Phase 1 shipped**

- Job recovery on boot (`running` → failed, queued resumes) and cancellation of
  running jobs through the node's `task-cancel`; the UI and server now agree.
- Removed the access code and data directory from `/api/state`; the code is no
  longer accepted as a generic credential; tokens are no longer accepted in
  query strings (scoped stream tickets replace them for SSE and audio).
- Pairing code removed from the node boot log; the `/api/status` log tail is
  redacted; the hub token is redacted too.
- Bounded JSON bodies with 400/413 errors on both servers.
- Host and Origin validation, same-origin CORS (no wildcard) on both servers.
- `body.context` provider override removed from `/api/ask`.
- Open mode and code changes require the hub PC plus the current code; provider
  and base-URL validation added.
- A hub may no longer change a node's `allowShell`, `allowInput`,
  `allowShutdown`, `pairOpen`, code or port; the node's own panel can.
- Loopback is no longer full authorization: a per-boot local panel token plus an
  explicit intent header is required on hub `/api/lock` and node `/api/local/*`.
- Provider probing cached for 45 s with explicit invalidation; unchanged node
  refreshes no longer rewrite `nodes.json`.
- One shared app catalogue (`lib/app-catalog.mjs`) for hub and node.
- Reduced-motion hardening and accessible names on screen control buttons.

**Verified automatically:** `npm run check` (24/24 files), `npm test`
(24/24 tests), `npm run smoke`.

**Still manual:** Windows screen/input, FFmpeg audio, ComfyUI live behaviour,
iOS microphone over HTTPS, PWA update, and a real two-machine LAN session. See
`docs/TESTING.md`.
