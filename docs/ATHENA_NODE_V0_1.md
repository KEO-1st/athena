# ATHENA Node V0.1 — contract and packaging

**Status:** implemented in Hub 3.0.0. Node software version `0.1.0`, protocol `1`.

This document is the compatibility contract between the Hub and a Node. It is
deliberately separate from the Hub's version. A Node 0.1 installation must keep
working when the Hub is updated, until the person at that PC chooses to replace
the Node.

---

## 1. Why the Node is separate

The Hub is the brain, the UI and the API. A Node is a pair of hands on one PC:
screen capture, input, processes, shell, software, audio and ComfyUI. They ship
on different schedules and may be installed weeks apart. Sharing one version
number (the old behaviour: `node/athena-node.mjs` imported `../lib/version.mjs`)
made that impossible to reason about: a Hub upgrade silently redefined what a
Node claimed to be.

Now:

| Component | Version file | Reported as |
| --- | --- | --- |
| Hub | `version.json` | `hub.version`, `/api/health` |
| Node | `node/version.json` | `nodeVersion` in `/api/hello`, `/api/status` and the Hub's node list |

The Node still sends `version` for older Hubs; new code reads `nodeVersion`.
Additive fields never change the protocol number.

## 2. Protocol negotiation

- The Node declares `protocol` (currently `1`) and the Hub protocol range it
  can speak (`hubProtocol: { min, max }`).
- The Hub declares `HUB_PROTOCOL` and accepts Node protocols in
  `[NODE_PROTOCOL_MIN, NODE_PROTOCOL_MAX]` (`lib/node-protocol.mjs`).
- **Pairing calls `/api/hello` before `/api/link`.** An incompatible Node is
  refused with the reason, and no record or token is stored.
- **Every Hub→Node request carries `x-athena-hub-protocol`.** A Node that does
  not support that Hub protocol returns HTTP 426 instead of half-executing.
- Status refreshes re-read `protocol`, `nodeVersion` and `features`, so a Node
  replaced on disk is reflected without re-pairing.
- **Legacy Nodes** (no `protocol` field) are accepted and marked `legacy` in
  the UI. They keep working with the fields the Hub has always understood.
- **Unknown capabilities are ignored.** `features` is advisory; the Hub checks
  only the features it needs.

Compatibility states shown in NODES:

| State | Meaning | Action result |
| --- | --- | --- |
| `ok` | Inside the supported range | Allowed |
| `legacy` | Predates negotiation | Allowed, visibly marked |
| `too-old` | Below `NODE_PROTOCOL_MIN` | Refused with "update the Node" |
| `too-new` | Above `NODE_PROTOCOL_MAX` | Refused with "update the Hub" |
| `incomplete` | Missing a required feature | Refused with the missing list |

The Hub never writes into a Node's folder, never restarts it and never upgrades
it. There is no automatic Node updater.

## 3. Identity and configuration

The packaged Node keeps identity outside its program files:

```
%LOCALAPPDATA%\ATHENA Node\config.json   name, port, code, permissions
%LOCALAPPDATA%\ATHENA Node\state.json    node id, hub token, pairing
%LOCALAPPDATA%\ATHENA Node\node.log      log (secrets redacted in status)
```

Replacing `node\` and `lib\` with a newer package therefore preserves the node's
id, pairing token and settings. `ATHENA_NODE_DIR` can point this elsewhere for a
portable or test install.

## 4. Packaging

```
npm run package:node   → dist/ATHENA-Node-0.1.0/ + zip
npm run package:hub    → dist/ATHENA-Hub-3.0.0/ + zip (ATHENA Hub.exe)
npm run package        → both
```

`tools/package.mjs` uses only Node built-ins plus `Compress-Archive` for the zip.
The Node package is assembled from the files that already exist in `node/` and
the two shared modules the agent already imports (`lib/security.mjs`,
`lib/app-catalog.mjs`) — it is not a second implementation.

The Hub launcher (`tools/hub-launcher.cs`) is compiled with the C# compiler that
ships with Windows and starts the bundled `runtime/node.exe`. No installer, no
registry writes, no service. The folder is portable; `data/` lives beside the
executable, so the folder must be somewhere writable (not `Program Files`).

## 5. What is and is not tested

Automated: protocol assessment and ranges, pairing refusal for a future
protocol, negotiation fields stored on the pairing record, Node self-version,
Node `/api/hello` and `/api/status` fields, 426 on an unsupported Hub protocol,
and the package layout (including compilation of `ATHENA Hub.exe` when `csc` is
available).

Not automated: installing on a second physical Windows PC, the firewall prompt,
a real Explorer double-click of the exe, and Defender's opinion of an unsigned
new executable. Those are listed in `docs/TESTING.md`.
