# ATHENA — Task Proposal & Execution UX

**Status:** target design. Only conversation and simple actions exist today; the
proposal window and execution monitor are not implemented.

**Related:** `docs/ATHENA_ARCHITECTURE_AUDIT.md`,
`docs/ATHENA_DISTRIBUTED_COMPUTE_DESIGN.md`,
`docs/ATHENA_VISUAL_DESIGN_DIRECTION.md`.

---

## 1. Product identity

ATHENA is both:

- a **personal conversational AI assistant** — it talks, remembers, explains,
  and thinks with you; and
- an **intelligent operating system for your digital environment** — it sees
  your machines, your applications, your models and your files, and it can do
  work across them.

The interface must make that duality obvious without turning every sentence
into a task. Conversation stays conversation. Work gets a plan.

---

## 2. Three interaction classes

Every request is classified before any tool runs. Misclassification in either
direction is a product failure: a chat that opens a workflow window feels
heavy; a production run that starts without a plan feels dangerous.

### 2.1 Conversation

Examples: "Hello." · "Give me a plan to learn Python." · "What do you think
about this idea?" · "Explain diffusion models."

Rules:

- No task window, no workflow, no tools unless a fact is genuinely needed
  (e.g. reading the current time or a node's status).
- Asking for a *written plan* is conversation about planning, not an execution
  task. A plan in prose does not become a workflow.
- Answers may be long when the user asks for depth; the existing 40-word cap
  applies to operational replies, not to requests for explanation.

### 2.2 Simple actions

Examples: "Open Chrome." · "Open YouTube." · "Show my PC screen." · "Turn the
volume down." · "Take a screenshot."

Rules:

- Handled inside chat with the appropriate tool, with a one-line confirmation
  of what happened.
- No proposal window. A confirmation card appears only for a destructive or
  irreversible action (shutdown, delete, submit, purchase).
- If the target is ambiguous ("open it"), ask one short clarifying question.

### 2.3 Complex execution tasks

Examples: "Create a video using my AI Clip Studio." · "Produce a complete
UNORDINARY episode." · "Generate 20 images, inspect them, animate the good ones
and assemble a video."

Rules:

- ATHENA builds a multi-step workflow, selects applications, nodes and models,
  estimates time and resources, and presents an **editable Task Proposal**
  before anything executes.
- No execution begins without explicit approval.
- Ambiguous requests are clarified first; ATHENA must not guess a production
  pipeline from a vague sentence.

### 2.4 Classification signals

A transparent, testable classifier combines:

| Signal | Conversation | Simple action | Complex task |
| --- | --- | --- | --- |
| Verbs | explain, think, suggest, write | open, show, click, take | create, produce, render, assemble, generate N |
| Objects | ideas, concepts, plans in prose | one app/URL/screen | multi-artifact outputs, pipelines |
| Steps implied | none | one | two or more with dependencies |
| Duration | seconds | seconds | minutes to hours |
| Side effects | none | reversible UI state | files, renders, uploads |
| Explicit request | "tell me", "explain" | "open", "show" | "make", "build", "produce" |

The classifier returns `{class, confidence, reasons[], missing[]}`. Below a
confidence threshold, or when `missing` is non-empty, ATHENA asks a clarifying
question instead of proposing.

The classifier is a model-assisted rule pass, not a keyword lookup: the same
request phrased differently must land in the same class, and the tests must
cover ambiguous phrasings.

---

## 3. Task Proposal window

### 3.1 Contents

- **Objective** — one sentence, in the user's words where possible.
- **Ordered workflow** — stages with dependencies, shown as a readable DAG or
  numbered pipeline, not a wall of text.
- **Per stage:** application/integration, node, model, inputs, expected outputs,
  estimated duration (range), resource requirements, and a one-line reason for
  each choice.
- **Overall estimate** — range, confidence and basis.
- **Warnings** — missing app, insufficient VRAM, node offline, model not
  installed, dependency on an unapproved capability.
- **Actions** — Approve, Cancel, Revise (edit and re-plan).

### 3.2 Editing rules

- Each stage exposes its settings: model, node, prompt/parameters, output path,
  concurrency (if parallelizable).
- Model and node can be manually overridden; the override is honoured or the
  stage fails with a reason — never silently substituted.
- Stages can be reordered or replaced only when dependencies allow it; the UI
  disables invalid moves and explains why.
- Removing a stage removes its dependants or blocks approval until resolved.
- "Revise" re-runs planning with the edits as constraints; it does not execute.

### 3.3 Approval

- Approval is explicit and per-workflow.
- The approval records who approved, when, and the exact plan version.
- Any edit after approval invalidates it and requires re-approval.
- Approval of a workflow that uses shell, shutdown, upload or spending
  capabilities is called out separately.

### 3.4 Proposal schema (first cut)

```json
{
  "id": "wf_...",
  "objective": "Produce a complete UNORDINARY episode",
  "class": "complex",
  "confidence": 0.86,
  "reasons": ["multi-stage", "video artifact", "uses registered integrations"],
  "estimate": { "lowSec": 5400, "highSec": 9000, "confidence": "medium", "basis": "2 prior renders on Node A" },
  "warnings": [{ "level": "warn", "stage": "st_3", "text": "Model not installed on Node B" }],
  "stages": [
    {
      "id": "st_1",
      "name": "Generate storyboards",
      "app": "unordinary-story-maker",
      "node": "node_studio",
      "model": "flux-dev",
      "inputs": [{ "kind": "text", "ref": "brief" }],
      "outputs": [{ "kind": "image", "count": 12 }],
      "deps": [],
      "parallelizable": true,
      "maxConcurrency": 4,
      "estimate": { "lowSec": 900, "highSec": 1500 },
      "reason": "Node A has the only 24 GB GPU; model is warm"
    }
  ]
}
```

### 3.5 Integrations, not hardcoded apps

Connected applications are discovered through a registered integration/API
system. ATHENA must not contain a hardcoded list of product names to plan work.

An integration declares:

- id, display name, version, vendor;
- capabilities (generate image, animate, assemble video, read timeline, export);
- input/output schemas and artifact kinds;
- execution model (local app, HTTP API, CLI, node agent adapter);
- resource profile (GPU/VRAM/CPU estimate per unit of work);
- health check and version probe;
- permission scopes and consent requirements.

The user's **AI Clip Studio** and **UNORDINARY Story Maker** are integrations of
this kind, not special cases in the scheduler. Until they register an
integration descriptor, ATHENA can only discuss them, not plan them.

---

## 4. Execution Monitor

### 4.1 Structure

- **Workflow header** — objective, state, overall progress, elapsed vs
  estimated, estimated remaining (range).
- **Stage list** — name, state, progress, node, app, model, elapsed/estimate.
- **Expandable stage detail** — per-stage telemetry, current speed (tokens/s,
  frames/s, MB/s), CPU/GPU/RAM/VRAM, disk read/write, network up/down, hub RTT,
  node identity and user-configured location, current model/app, queue position.
- **Artifacts** — outputs as they appear, with preview, size, checksum and
  provenance.
- **Log** — stage-scoped, expandable, not a firehose by default.

### 4.2 Honesty rules

Every number is labelled:

- **LIVE** — measured within the last few seconds on a named node.
- **HISTORY** — measured on previous runs of this workload class.
- **ESTIMATE** — derived, shown with a range and confidence.

If a sensor is unavailable, show `—` and a short reason ("node does not report
disk I/O"), never a fabricated zero. Estimates must state their basis. The
first run of a new workload has no history and must say so.

### 4.3 Progress semantics

- Progress is based on units the system can actually observe (frames rendered,
  images done, tokens produced, bytes transferred), not on a timer.
- A stage with unknown total shows an indeterminate pulse plus elapsed time and
  throughput, not a fake percentage.
- Time remaining is recomputed as real throughput arrives.
- A stage waiting on a dependency shows "waiting for stage 2", not 0%.
- Failures and retries are visible in the stage row, with the attempt count.

### 4.4 Controls

- Cancel workflow (stops queued stages, asks running stages to stop).
- Cancel stage (only if the app supports it).
- Retry stage (only if idempotent; warns otherwise).
- Pause queue (does not interrupt a running render).
- Open artifact / open node / open app.

### 4.5 States

`draft → proposed → approved → running → (completed | failed | cancelled)`.
A proposal that is never approved expires without side effects. Any edit moves
it back to `proposed`.

---

## 5. Flow

```
user message
   │
   ▼
classify ──conversation──▶ answer in chat (no tools unless needed)
   │
   ├──simple action──▶ tool call ──▶ one-line result / confirmation card
   │
   └──complex task──▶ clarify if needed
                          │
                          ▼
                    build proposal (apps, nodes, models, estimates, reasons)
                          │
                          ▼
                    proposed ──edit/revise──┐
                          │                  │
                       approve ◀─────────────┘
                          │
                          ▼
                    approved → scheduler → execution monitor
                          │
                          ▼
                    completed / failed / cancelled
```

---

## 6. UX requirements

- The proposal is a focused surface, not a modal that hides the conversation;
  the user can ask a question while reviewing.
- Long plans scroll; the objective, estimate and approve action stay visible.
- Every automatic choice has a visible "why" and an override.
- Destructive capability use is visually distinct and requires its own consent.
- The monitor is reachable from the chat as a live card and from a Workflows
  list after completion.
- On mobile, stages collapse to one-line rows; detail opens as a sheet.
- Reduced-motion users get the same information without animated transitions.
- Keyboard: every stage control reachable, focus visible, escape closes detail
  without cancelling.
- Screen readers: progress uses `role="progressbar"` with `aria-valuenow` only
  when a real total exists; otherwise a status text.

---

## 7. Acceptance criteria (Phase 10)

1. Conversation, simple action and complex task are classified correctly for a
   documented test set, including ambiguous phrasings.
2. A written plan request never produces a workflow proposal.
3. "Open Chrome" executes without a proposal window.
4. A multi-stage request produces a proposal with stages, dependencies, nodes,
   models, estimates and reasons; nothing executes before approval.
5. Editing a stage and re-approving invalidates the old approval.
6. An offline pinned node or missing model appears as a blocking warning.
7. Integrations are discovered from descriptors; no product name is hardcoded
   in the scheduler.
8. The monitor distinguishes LIVE, HISTORY and ESTIMATE, and never shows a
   fabricated measurement.
9. Cancelling a workflow stops queued stages and requests cancellation of the
   running stage.
10. A completed workflow retains artifacts, provenance and the final plan
    version for later inspection.

---

## 8. What must exist first

The proposal UI depends on real backend capabilities, so it is deliberately
last:

- Phase 3: classification, planning primitives, conversation memory, agent loop.
- Phase 6A/6B: model registry, scheduler, executor, artifact manager, telemetry.
- Phase 2/4: consent, scoped capabilities, authenticated node channel.
- Phase 7: durable state and recovery for long workflows.

Building the window before these exist would produce convincing screenshots and
no working product. Phase 9 may still improve chat, voice and simple-action UX
in the meantime.
