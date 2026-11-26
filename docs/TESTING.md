# Testing ATHENA

ATHENA has **no runtime dependencies** and no build step. The test suite uses
Node's built-in test runner, so a clean checkout plus Node 20+ is enough.

```bash
npm run check        # parse every .js/.mjs file with Node itself
npm test             # unit + integration tests (starts real hub/node on temp dirs)
npm run test:live    # opt-in real local model; skips unless ATHENA_LIVE_MODEL is set
npm run smoke        # one full hub boot: health, shell, service worker, auth wall
npm run package:node # standalone Node V0.1 folder + zip
npm run package:hub  # Hub folder + ATHENA Hub.exe + zip
```

Run `check`, `test` and `smoke` before committing any runtime change; run the
packaging command only when that package changed. There is no CI configuration
yet; run them locally. The full provider-independent development and GitHub
workflow is in `AGENTS.md`.

## What is automated

| File | Covers |
| --- | --- |
| `tests/version.test.mjs` | `version.json` is valid semver, matches `package.json`, and no source file hard-codes a version. |
| `tests/catalog.test.mjs` | The hub and node read one app catalogue; install commands never reach the hub payload. |
| `tests/brain.test.mjs` | Provider probing is cached and invalidated explicitly; controller brain refusal; instant greeting; `think:false`/token cap; timeout abort cleanup; sequential tool-capability retry with no overlap. |
| `tests/brain-conversation.test.mjs` | Mocked multi-step tool loop, result observation, natural read-tool follow-up, no-tool general questions, greeting, no-history clarification, malformed arguments, context, unknown Node, controller shell refusal (tool and fallback paths), duplicate suppression, timeout retry, and provider death after a verified action. |
| `tests/brain-live.test.mjs` | Opt-in real local-model checks: capability conversation without tools and reading a real fake-Node RAM value through a tool. Skips in the default suite. |
| `tests/jobs.test.mjs` | Reboot recovery, running-job cancellation through the node, and the no-cancel-after-done rule, against a fake node. |
| `tests/hub.test.mjs` | Auth wall, access-code-as-credential rejection, token-in-URL rejection, state contains no code/data dir, Host/Origin policy, CORS, body limits, settings re-confirmation, local intent header, stream tickets, immediate chat status/NDJSON, no TTS browser fallback, service-worker version substitution. |
| `tests/node.test.mjs` | Node boots in a temp identity directory, loopback alone is insufficient, status requires a credential, log tail is redacted, a hub cannot widen node permissions, Host/body policy. |
| `tests/smoke.mjs` | Boots the real hub, checks health/version, index, `sw.js`, 401/200 on `/api/state`. |
| `tests/node-protocol.test.mjs` | Node has its own version; both protocol ranges; legacy Nodes; pairing negotiation stores the Node version and refuses a future/incompatible peer; `nodeFetch` sends the Hub protocol header on raw requests. |
| `tests/sessions.test.mjs` | Device identity, independent controller sessions, same-browser replacement, Hub-only admin API, rename persistence, configurable remembering/expiry, individual revocation without signing out the hub. |
| `tests/security.test.mjs` | Direct-local admin bootstrap (loopback socket, loopback Host/Origin, no proxy headers); LAN/proxy replay downgrades admin sessions and tickets; every admin endpoint refuses controllers and API keys; controller/admin SSE audiences; local code endpoint gating. |
| `tests/screen.test.mjs` | `object-fit: contain` letterboxing, iPad-like offset, portrait pillarboxing, CSS-pixel mapping, adaptive FPS profiles, separate capture/Node/browser telemetry. |
| `tests/audio.test.mjs` | Microphone and desktop/loopback devices are classified separately; explicitly requested devices cannot cross sources; no silent microphone fallback. |
| `tests/software.test.mjs` | Result notes are surfaced, ComfyUI is labelled detection, PATH refresh and selected-node targeting are present. |
| `tests/package.test.mjs` | Node package layout, `run-node.cmd` runtime/version resolution, identity outside program files, build manifest, no auto-updater wording, Hub `ATHENA Hub.exe` compilation and shell. |
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
   SCREEN, confirm measured FPS/latency and that a focused screen asks for more
   frames than a preview. Tap near the top, centre and bottom of a letterboxed
   picture on iPad and a phone; verify each lands at the same point on the PC.
   Check that capture stops after the last viewer leaves. **NOT YET VERIFIED on
   real iPad/iPhone hardware after this change.**
2. **Audio sources and latency** — install FFmpeg on the node, enable Stereo
   Mix, choose PC SOUND and confirm you hear the PC; choose MICROPHONE and
   confirm you hear the room. Confirm switching stops the first FFmpeg child and
   never mixes the two. Measure startup-to-sound latency on the affected iPad;
   the >10 s observation has **NOT YET been re-measured**. Also test a machine
   with no loopback device: PC SOUND must error, not fall back to the mic.
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
8. **Node install on a second PC** — copy `dist/ATHENA-Node-0.1.1` to a PC with
   **no Node.js**, run `Install Node.cmd`, allow the private-network firewall
   prompt, pair from the Hub, restart the PC, and confirm the same node id is
   reused from `%LOCALAPPDATA%\ATHENA Node`. This is **NOT YET VERIFIED**; the
   code now resolves the standard install path instead of trusting the stale
   cmd PATH.
9. **Hub executable** — unzip `dist/ATHENA-Hub-3.2.0-win64.zip` to a writable
   folder, double-click `ATHENA Hub.exe`, confirm the browser opens, the access
   code is printed, and `data/` is created beside the exe. Check Defender's
   response to a new unsigned executable.
10. **Voice quality** — SETTINGS → SPOKEN VOICE lists the device's voices; choose a
    Natural/Online voice, press TEST VOICE, and confirm speed/pitch survive a
    reload. On Windows, compare with a legacy Desktop voice to hear the
    difference.
11. **Per-node software** — NODES → open SOFTWARE ON THIS MACHINE on node A,
    confirm it lists only A's software; install/start an app and confirm the
    other node is unaffected. Install a command-line tool and confirm the result
    note says whether it was detected immediately or needs a restart. Press
    ComfyUI's FIND FOLDER on a machine without it and confirm the label/error
    says detection, not download. **NOT YET VERIFIED on real winget installs.**
12. **Controller identities and authority** — sign in from an iPhone and an iPad
    with different names; SETTINGS → CONTROLLERS on the Hub should list both,
    leave their chats separate, rename and revoke one while the other stays
    signed in. On the iPhone, confirm the admin panels are absent and that
    **NEW CHAT / HISTORY / CLEAR** only affect that device. Open an old legacy
    chat and confirm it appears in HISTORY rather than disappearing.
13. **Speech provider** — with Browser speech, TEST VOICE uses the selected
    device voice. With Google Cloud TTS selected and no key, spoken replies must
    show a provider error, never switch to browser speech. With a real key,
    confirm the Hub-generated MP3 plays on iPhone/iPad and after an async chat
    reply. Record the result honestly; this was not tested on hardware here.
14. **Screen recovery and FPS** — watch SCREEN for at least a minute and record
    B (browser), C (capture) and round-trip values separately. Open and close an
    elevated Task Manager: input may be refused by Windows while it is open, but
    capture must recover after it closes without restarting the Node.
15. **Audio gesture and sources** — on iPhone/iPad, tap LISTEN once for PC SOUND
    and once for MICROPHONE. Confirm no false "playback blocked" on the first
    tap when the ticket is ready, that switching replaces the stream, and that a
    missing loopback device reports PC Sound unavailable rather than mic audio.

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

## Live-model tests

The default suite is deterministic and uses an OpenAI-compatible stub for the
brain loop. Real local inference is a separate, explicit check:

```bash
ATHENA_LIVE_MODEL=qwen2.5:7b npm run test:live
```

It needs Ollama on `127.0.0.1:11434` (override with `ATHENA_LIVE_BASE`) and a
model that supports tools. Without `ATHENA_LIVE_MODEL`, both live tests skip.
Report live results separately from mocked results; a passing stub proves the
Hub contract, not the model's judgement.

## Adding tests

Put `*.test.mjs` files in `tests/`. Prefer a real process boundary for auth,
Host/Origin and body limits — those behaviours live in the HTTP handler, not in
a pure function. Prefer the fake node for queue behaviour. Keep each test
independent of ordering where possible; the node and hub suites share one boot
for speed. Do not assert inside a fake provider handler: `ask()` catches errors
and falls back, which hides the real failure. Assert after the call instead.
