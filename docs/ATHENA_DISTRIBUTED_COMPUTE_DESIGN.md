# ATHENA — Distributed Compute Design

**Status:** target design, not implemented. In the current codebase only the
foundations exist: a multi-node registry with independent tokens, a per-node
job queue, bidirectional protocol negotiation, per-device controller sessions
and a hub-local brain. There is still no scheduler, artifact manager, scoped
node identity or outbound node channel. The three-concept split (Hub authority /
Controller client / Node resources) is documented in
`docs/ATHENA_ARCHITECTURE_AUDIT.md` §15.

**Related:** `docs/ATHENA_ARCHITECTURE_AUDIT.md`, `docs/ATHENA_DEVELOPMENT_ROADMAP.md`,
`docs/ATHENA_TASK_PROPOSAL_AND_EXECUTION_UX.md`.

---

## 1. Two kinds of distribution

ATHENA must distribute two different things, and they must not be conflated:

1. **Distributed AI inference** — running a model on a machine that has the GPU
   and memory for it, and routing a request there.
2. **General distributed computing** — running application work (video render,
   image batch, ComfyUI graph, script) across one or more machines, including
   multi-stage workflows with dependencies.

Inference is a special case of compute with unusually strict latency and memory
constraints. Both share one logical **Resource Orchestrator**, but inference has
its own placement rules and its own health signals.

---

## 2. Logical architecture

```
                       ┌─────────────────────────────────────┐
                       │        Resource Orchestrator        │
                       │                                     │
  controller ─────────▶│  Resource Registry                  │
  (approval)           │    nodes · capabilities · models    │
                       │    apps · GPU/RAM · location        │
                       │                                     │
                       │  Scheduler                          │
                       │    fit · constraints · cost · queue │
                       │                                     │
                       │  Task Executor                      │
                       │    stages · deps · retries · cancel  │
                       │                                     │
                       │  Artifact Manager                   │
                       │    inputs · outputs · provenance     │
                       └───────────────┬─────────────────────┘
                                       │ authenticated channel
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
        Node A (RTX 4090)        Node B (RTX 3060)        Node C (CPU only)
        ollama · comfy · ffmpeg  comfy · ffmpeg           ffmpeg · scripts
```

### 2.1 Resource Registry

The registry is the only place that knows what a node can do. It is built from
node-reported facts, never from assumptions or model-name regexes.

Per node:

| Field | Source | Notes |
| --- | --- | --- |
| `node_id`, name, location label | node identity | location is user-configured (e.g. "studio"), not geolocated |
| platform, agent version | handshake | capability negotiation uses this |
| CPU model, cores, RAM | node | static |
| GPUs: name, VRAM total/free, driver, compute capability | node (`nvidia-smi`, later ROCm/Metal) | sampled, with timestamp |
| Models: name, size, quantization, context, tool/vision capability, measured tokens/sec | node probing | capability is probed, not guessed |
| Applications: id, version, path, running state | node app catalogue | plus integrations registered through the integration API |
| Capabilities: screen, input, audio, shell, filesystem roots | node config + consent | least privilege, per capability |
| Live load: CPU, GPU util, VRAM used, disk free, queue depth, network | node telemetry | timestamped; never fabricated |
| Connectivity: hub link type, RTT, last seen | hub | used for placement and estimates |

Registry rules:

- Every fact carries `observedAt`. Stale facts are shown as stale, never as live.
- A node with an unknown capability is treated as not having it.
- Registry state is persisted without secrets; tokens are separate.

### 2.2 Scheduler

The scheduler answers one question: **which node and which model/app should run
this stage, and why?**

Hard constraints (a candidate is rejected, never "best effort"):

- required app/model installed;
- sufficient VRAM/RAM for the declared requirement plus headroom;
- required capability enabled and consented;
- platform support (e.g. screen control is Windows-only today);
- data locality (input artifact accessible or transferable within budget);
- dependency order (a stage cannot start before its inputs exist);
- user override (a pinned node/model is honoured or the task fails loudly).

Soft preferences, with an explicit reason recorded:

- warm model already loaded;
- lowest projected queue wait;
- highest measured throughput for this workload class;
- shortest data transfer;
- user-configured preference ("prefer the studio PC for video").

Parallelism rules:

- Stages declare `parallelizable: true|false` and a `maxConcurrency`.
- A single node never runs two GPU-saturating stages at once unless the task
  explicitly allows it.
- Multi-stage graphs are scheduled as a DAG; independent branches can run in
  parallel, dependent stages cannot.
- The scheduler must never assume a workload is parallelizable because it has
  multiple items — image batches may be, a single video render usually is not.

### 2.3 Task Executor

- Owns the lifecycle of every stage: `queued → assigned → running → verifying →
  done | failed | cancelled | blocked`.
- Sends work over the authenticated outbound channel (Phase 4), not by the hub
  dialling an open port.
- Enforces per-stage timeouts, cancellation and retry policy.
- On node loss: mark the stage `failed` or re-queue it, depending on whether the
  work is idempotent. Never duplicate a non-idempotent side effect silently.
- Records every state transition with timestamps for the Execution Monitor.

### 2.4 Artifact Manager

- Every stage input and output is an artifact with an id, size, checksum, media
  type, origin and retention class.
- Artifacts live on the node that produced them; the registry stores location
  and metadata, not bulk bytes, in the hub's default configuration.
- Transfers are explicit, resumable where possible, and counted in the time
  estimate.
- Provenance records which model, prompt, seed and app version produced an
  artifact, so a result can be reproduced.

---

## 3. Inference specifics

- The hub holds a model registry aggregated from node reports.
- A request carries requirements: modality, context length, tool calling,
  vision, minimum quality tier, latency budget, privacy class.
- The scheduler chooses a node/model, or an explicit user choice overrides it.
- The hub proxies the request over the channel; node Ollama/llama.cpp stays on
  loopback and is never exposed to the LAN.
- Streaming tokens, cancellation and token accounting travel over the same
  channel.
- Cloud providers are a fallback with a visible notice, never a silent switch.
- If no node fits, the task is rejected with the reason ("needs 16 GB VRAM;
  largest free is 8 GB on Node B"), not queued forever.

---

## 4. Estimation and telemetry (honesty rules)

The Execution Monitor must distinguish three kinds of numbers:

1. **Live telemetry** — measured now on a named node (GPU util, VRAM, disk I/O,
   network rate, queue depth).
2. **Historical measurement** — measured before, for this workload class on this
   node/model (median tokens/sec, median frames/sec, median encode time).
3. **Estimate** — derived from 1 and 2 plus input size, dependencies, transfer
   cost and queue time, shown with a range and a confidence.

Rules:

- Never invent a number. If a sensor is unavailable, show `—` and why.
- Estimates always show a range and the basis ("12–18 min · based on 3 prior
  renders of similar length on Node A").
- The first run of a new workload class has no history: say so.
- Confidence falls when the node is under load, the model is cold, or the input
  differs materially from history.
- Time remaining is recomputed on real progress, not linearly projected from a
  guessed total after the first 5%.

Suggested telemetry sample shape (per node, every 2 s while a task runs):

```json
{
  "node": "node_ab12",
  "at": "2026-11-24T12:00:00Z",
  "cpu": { "util": 0.42, "load1": 6.1, "cores": 16 },
  "memory": { "totalGb": 64, "usedGb": 38 },
  "gpu": [{ "index": 0, "util": 0.91, "vramUsedGb": 19.2, "vramTotalGb": 24, "tempC": 71 }],
  "disk": { "readMBs": 120, "writeMBs": 340, "freeGb": 480 },
  "network": { "rxMBs": 2.1, "txMBs": 0.3 },
  "queue": { "running": 1, "queued": 2 },
  "hub": { "rttMs": 7, "link": "wss" }
}
```

If a field cannot be measured on that platform, it is omitted and the UI says
"not reported", not zero.

---

## 5. Workload classes and scheduling policy

| Class | Example | Parallel? | Placement signal |
| --- | --- | --- | --- |
| Chat inference | conversation | yes (independent requests) | model fit, latency, warmth |
| Image batch | 20 stills | usually yes | VRAM fit, throughput, artifact size |
| Video render | one episode | stages sequential; some stages parallel | VRAM, encoder, disk, transfer |
| Screen/input action | click, type | no | the specific node, never relocated |
| Shell task | build, script | depends | capability, working directory locality |
| Data transfer | copy artifacts | bounded | bandwidth, disk |

The scheduler records its reason for every choice, and the UI shows it. "Why
this node?" must always be answerable.

---

## 6. Failure handling

- **Node offline at schedule time** — exclude it; if the user pinned it, fail
  with a clear message.
- **Node lost mid-stage** — mark failed; re-queue only idempotent stages; keep
  partial artifacts marked incomplete.
- **Hub restart** — reconcile: running stages become failed/unknown, queued
  stages resume, artifacts are re-verified by checksum.
- **Model/app missing** — block the stage before execution, not after.
- **Insufficient resources** — reject at schedule time with the numbers.
- **Transfer failure** — retry with backoff, then fail the stage with the
  artifact id.
- **Clock skew** — all scheduling decisions use hub time; node timestamps are
  recorded but not trusted for ordering.

---

## 7. Security and privacy

- Only paired, consented nodes join the registry.
- Capabilities are per-node, per-user, revocable, and never widened remotely.
- Inference payloads are private data: they travel only over the authenticated
  channel; cloud fallback requires an explicit per-task privacy choice.
- Artifacts inherit a retention class; the default is delete-after-task for
  screen/audio-derived data.
- Scheduling decisions and executions are audited (actor, node, app, model,
  artifact ids, result), never prompts or file contents.
- A node can refuse a workload class locally (e.g. no shell), and the scheduler
  must treat that as a hard constraint.

---

## 8. Data model (first cut)

```text
Node        id, name, location, platform, caps, consent, lastSeen
Resource    nodeId, kind (gpu|model|app|disk), facts, observedAt
Model       nodeId, name, sizeGb, context, tools, vision, tokPerSec
App         nodeId, appId, version, path, running
Workflow    id, objective, stages[], createdAt, approvedBy, approvedAt
Stage       id, workflowId, app/model, nodeId, deps[], inputs[], outputs[],
            estimate{low,high,basis}, state, attempts, startedAt, endedAt
Artifact    id, kind, bytes, sha256, nodeId, path, retention, provenance
Telemetry   nodeId, at, sample (as above)
```

---

## 9. Phasing

- **Phase 6A — distributed AI:** model registry, capability envelopes, explicit
  placement, routing over the channel, fallback, accounting.
- **Phase 6B — distributed computing:** workflow DAG, scheduler with hard/soft
  constraints, artifact manager, multi-node execution, Execution Monitor data.
- **Phase 10** consumes both to render the proposal and monitor UI.

### Acceptance (6A)

1. A model installed only on a node is selectable and usable from the controller.
2. The UI shows the chosen node and the reason; the user can override.
3. Node inference stays on loopback; all access is through the channel.
4. Capability is probed and matches observed behaviour for at least three models.
5. Node loss mid-request produces a clear error and a documented fallback.
6. Token/latency accounting appears in the task journal.

### Acceptance (6B)

1. A three-stage workflow with one dependency runs across two nodes.
2. A non-parallelizable stage is never split.
3. A pinned node that is offline fails the task with a reason, not a retry loop.
4. Artifacts are checksummed and provenance is recorded.
5. Hub restart reconciles running and queued stages.
6. Every number in the monitor is labelled live, historical or estimated.
