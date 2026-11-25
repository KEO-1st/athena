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
- **The Hub also checks the Node's declared Hub range.** A Node whose
  `hubProtocol` excludes this Hub's protocol is refused as
  `hub-incompatible` before pairing or action, and stored records report the
  same reason after a refresh. A Node with no range is legacy and remains
  accepted.
- **Pairing calls `/api/hello` before `/api/link`.** An incompatible Node is
  refused with the reason, and no record or token is stored.
- **Every Hub→Node request carries `x-athena-hub-protocol`**, including raw
  screen JPEGs, audio streams and the ComfyUI proxy. They all use
  `nodeFetch()` from `lib/discover.mjs`; a direct `fetch()` bypasses the guard
  and is a bug. A Node that does not support that Hub protocol returns HTTP 426
  instead of half-executing. A request with no header is still accepted for
  compatibility with legacy Hubs; new Hubs always send it.
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
| `hub-incompatible` | Node's Hub-protocol range excludes this Hub | Refused before pairing/action; update the side named in the reason |
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
the three shared modules the agent imports (`lib/security.mjs`,
`lib/app-catalog.mjs`, `lib/audio-sources.mjs`) — it is not a second
implementation. Both artifacts contain `BUILD-INFO.json`, a deterministic map
of relative path → SHA-256 for every packaged file; it contains no timestamp.

The Node is a **portable folder**, not an installer. It needs Node.js 20+.
`Install Node.cmd` installs the LTS runtime with winget when needed, and
`node\run-node.cmd` resolves the standard Program Files / LOCALAPPDATA / winget
locations before `where node`. That is what avoids the previous stale-PATH
failure where a just-installed Node was invisible to the running cmd process.
The launcher prints the actual version and a clear message when it is below 20.

The Hub launcher (`tools/hub-launcher.cs`) is compiled with the C# compiler that
ships with Windows and starts the bundled `runtime/node.exe`. It polls
`/api/health` for up to 15 seconds before opening the browser. No installer, no
registry writes, no service. The folder is portable; `data/` lives beside the
executable, so the folder must be somewhere writable (not `Program Files`).

## 5. What is and is not tested

Automated: protocol assessment and ranges in both directions, protocol header on
raw node requests, pairing refusal for a future protocol, stored negotiation
fields, Node self-version, Node `/api/hello` and `/api/status` fields, 426 on an
unsupported Hub protocol, pairing-code rate limiting, and package layout
(including `run-node.cmd`, shared audio module, build manifest, and compilation
of `ATHENA Hub.exe` when `csc` is available).

**Security limitation:** node pairing and control traffic is plain HTTP on the
LAN. The six-character code is now cryptographically random and rate-limited,
but it is still readable on the wire and the node token is bearer-only. Use a
trusted LAN, or place the hub behind HTTPS/VPN; do not expose node ports 47910
or discovery UDP 48880 to the internet.

Not automated: installing on a second physical Windows PC, a fresh-PC winget
run, the firewall prompt, a real Explorer double-click of the exe, and
Defender's opinion of an unsigned new executable. Those are listed in
`docs/TESTING.md` and marked **NOT YET VERIFIED**.
