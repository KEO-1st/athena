# Testing ATHENA

ATHENA has **no runtime dependencies** and no build step. The test suite uses
Node's built-in test runner, so a clean checkout plus Node 20+ is enough.

```bash
npm run check        # parse every .js/.mjs file with Node itself
npm test             # unit + integration tests (starts real hub/node on temp dirs)
npm run smoke        # one full hub boot: health, shell, service worker, auth wall
npm run package:node # standalone Node V0.1 folder + zip
npm run package:hub  # Hub folder + ATHENA Hub.exe + zip
```

All three must pass before a change is committed. There is no CI configuration
yet; run them locally.

## What is automated

| File | Covers |
| --- | --- |
| `tests/version.test.mjs` | `version.json` is valid semver, matches `package.json`, and no source file hard-codes a version. |
| `tests/catalog.test.mjs` | The hub and node read one app catalogue; install commands never reach the hub payload. |
| `tests/brain.test.mjs` | Provider probing is cached and invalidated explicitly. |
| `tests/jobs.test.mjs` | Reboot recovery, running-job cancellation through the node, and the no-cancel-after-done rule, against a fake node. |
| `tests/hub.test.mjs` | Auth wall, access-code-as-credential rejection, token-in-URL rejection, state contains no code/data dir, Host/Origin policy, CORS, body limits, settings re-confirmation, local intent header, stream tickets, service-worker version substitution. |
| `tests/node.test.mjs` | Node boots in a temp identity directory, loopback alone is insufficient, status requires a credential, log tail is redacted, a hub cannot widen node permissions, Host/body policy. |
| `tests/smoke.mjs` | Boots the real hub, checks health/version, index, `sw.js`, 401/200 on `/api/state`. |
| `tests/node-protocol.test.mjs` | Node has its own version; protocol ranges; legacy Nodes; pairing negotiation stores the Node version and refuses a future protocol. |
| `tests/package.test.mjs` | Node package layout, identity outside program files, no auto-updater wording, Hub `ATHENA Hub.exe` compilation and shell. |
| `tests/speech.test.mjs` | Pronunciation normalisation, word-boundary chunking, voice ranking (Natural first, legacy last). |
| `tests/hub.test.mjs` (shell) | No global Software tab, per-node software functions, Integrations and voice controls in SYSTEM. |

### How isolation works

- `ATHENA_DATA_DIR` points the hub at a temporary directory.
- `PORT` gives it an ephemeral port.
- `ATHENA_NODE_DIR` gives the node a temporary identity, config and log.
- `tests/helpers.mjs` starts and stops both processes, and provides an HTTP
  client that can set `Host` and `Origin` deliberately (browsers forbid that).
- `tests/helpers.mjs` also contains a fake node implementing just enough of
  `/api/status` and `/api/action` (`run`, `task`, `task-cancel`, `tasks`) to
  test the job queue without Windows, a GPU or port 47910.

Tests never read or write the real `data/` or `node/config.json`.

## What must be tested by hand (Windows / iPhone)

These depend on the host or a browser and are not automated:

1. **Screen capture and input** — start the hub and a node on Windows, open
   SCREEN, confirm frames update, click/type works, and FOCUS mode maps clicks
   to the right coordinates on a second monitor.
2. **Audio relay** — install FFmpeg on the node, enable Stereo Mix, press
   LISTEN, confirm sound and that STOP ends the FFmpeg child.
3. **ComfyUI tunnel** — start ComfyUI on the node, open its canvas through the
   hub. Request/response routes work; live WebSocket progress is known not to
   (see the audit, D-11).
4. **Voice** — iOS Safari: microphone requires HTTPS, which the LAN build does
   not provide. Confirm the lock screen, chat, and speech output over HTTP on a
   desktop first.
5. **PWA install / update** — install to the home screen, bump `version.json`,
   restart the hub, reload: the new shell must appear and the old cache must be
   gone.
6. **Node panel** — on the node itself, the panel must load status after
   bootstrap; from another LAN device the panel shows NODE DOWN by design.
7. **LAN access** — the hub answers only to its own hostnames and IPs. If the
   network uses an alias (for example `athena.home.arpa`), set
   `ATHENA_ALLOWED_HOSTS=athena.home.arpa` on the hub.
8. **Node install on a second PC** — copy `dist/ATHENA-Node-0.1.0`, run
   `Install Node.cmd`, allow the private-network firewall prompt, pair from the
   Hub, restart the PC, and confirm the same node id is reused from
   `%LOCALAPPDATA%\ATHENA Node`.
9. **Hub executable** — unzip `dist/ATHENA-Hub-3.0.0-win64.zip` to a writable
   folder, double-click `ATHENA Hub.exe`, confirm the browser opens, the access
   code is printed, and `data/` is created beside the exe. Check Defender's
   response to a new unsigned executable.
10. **Voice quality** — SYSTEM → SPOKEN VOICE lists the device's voices; choose a
    Natural/Online voice, press TEST VOICE, and confirm speed/pitch survive a
    reload. On Windows, compare with a legacy Desktop voice to hear the
    difference.
11. **Per-node software** — NODES → open SOFTWARE ON THIS MACHINE on node A,
    confirm it lists only A's software; install/start an app and confirm the
    other node is unaffected.

## Security checks worth repeating manually

- `GET /api/state` without a credential returns 401.
- The access code, sent as `x-athena-session`, returns 401 (it is only accepted
  by `POST /api/session`).
- `GET /api/state?token=<session>` returns 401.
- `GET /api/lock` without `x-athena-local: 1` returns 403 on the hub PC.
- `GET /api/local/status` on a node without `x-athena-local` returns 403.
- A hub request to a node's `config` action that changes `allowShell`,
  `allowInput`, `allowShutdown` or `pairOpen` returns 403.
- Enabling open mode from a phone returns 403; from the hub PC with the current
  code it succeeds.
- `node/node.log` contains no pairing code and `/api/status`'s `log` tail is
  redacted.

## Adding tests

Put `*.test.mjs` files in `tests/`. Prefer a real process boundary for auth,
Host/Origin and body limits — those behaviours live in the HTTP handler, not in
a pure function. Prefer the fake node for queue behaviour. Keep each test
independent of ordering where possible; the node and hub suites share one boot
for speed.
