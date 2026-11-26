# ATHENA Hub 3.3.0 + ATHENA Node 0.3.0 — verified development release

Status: **development branches only. Not merged to `main`. No GitHub release
published.** Owner approval is required before either step.

## Branches

| Product | Repository | Branch | Base |
| --- | --- | --- | --- |
| ATHENA Hub 3.3.0 | `KEO-1st/athena` | `athena-3.3-wip` | `athena-3.2-wip` |
| ATHENA Node 0.3.0 | `KEO-1st/athena-node` | `athena-node-0.3-wip` | Node `main` (`v0.2.0`) |

Protocol remains **1** in both directions. New hardware fields are additive, so
an older Hub ignores them and a 0.2 Node still pairs as a protocol-1 Node.

## Hub 3.3.0

- Product title, manifest, About identity and startup screen now say **ATHENA
  Hub 3.3.0**, not `CORE OS 4.7`.
- Every Node card has a **HARDWARE & CAPABILITIES** detail view: CPU and live
  utilisation, installed / usable / available RAM, GPU and VRAM installed /
  available, disks, displays and refresh rate, audio endpoints, OS, installed
  applications and permission state. Missing measurements show `unavailable`;
  they are never replaced with zero.
- A Node running on the Hub PC is labelled **THIS PC** using the reported
  hostname. The label does not grant administrator authority or create a second
  identity.
- Hardware/specification questions and "which Node has the most available RAM?"
  are answered from measured Node values through a deterministic, read-only
  path. Controllers may use it; it exposes no shell, shutdown or input action.
- Controller reconnect uses a fresh stream ticket with exponential backoff, stops
  the stream while the app is hidden, and refreshes on return. Shell assets are
  network-first so an update cannot leave a controller on yesterday's `app.js`.
  Hub Node refresh is 15 seconds instead of 8.
- Browser speech starts speaking complete sentences while the model is still
  streaming. Google TTS still starts after the final text; failures are reported,
  never silently replaced with browser speech.
- Diagnostics record model time and Node action time separately in `meta`.
- A fresh local model choice prefers an ordinary tool-capable chat model when the
  person has not selected one; installed models are not removed or replaced.

## ATHENA Node 0.3.0

- One launch produces one panel. A second launch signals the running launcher,
  focuses/reopens its panel, and does not open a duplicate application window.
- Closing the panel leaves the agent running. The first close explains the tray
  behaviour; later closes can be remembered.
- Tray **Open**, **Restart**, **Data folder** and **Quit** remain functional.
  Restart uses exit code 75 and Quit uses 76 under the launcher supervisor.
- Public package has no `.cmd` launchers. The uninstaller is a compiled
  `Uninstall ATHENA Node.exe`; PowerShell helpers remain internal Windows
  capture/input implementation files, not user instructions.
- Original gold obelisk/wing sigil in `assets/athena-mark.svg` and
  `assets/athena.ico`. No supplied copyrighted reference artwork is copied.
- Adaptive fixed-height tabbed panel: Overview, Machine, Permissions,
  Diagnostics. No page scrolling at 1080×820; reduced-motion supported.
- Pairing code is clickable, keyboard accessible and copyable with confirmation.
- New installs deny shell, input and remote shutdown. Existing configs retain
  their saved values. Disabled input returns **403 before** any pointer work;
  disabled shutdown and shell are enforced by the Node, not merely hidden.
- Machine detail separates installed, usable and available RAM and includes
  disks, monitors, audio and installed apps. Windows display paths and LAN
  address objects are rendered for people, not as raw objects.

## Verification actually run

| Check | Result |
| --- | --- |
| Hub `npm run check` | 69/69 files parsed |
| Hub `npm test` | 133 tests: 131 pass, 2 skipped (opt-in live model) |
| Hub `npm run smoke` | ok · real Hub boot · v3.3.0 |
| Hub `git diff --check` | clean |
| Node `npm run check` | 16/16 files parsed |
| Node `npm test` | 22/22 pass |
| Node `npm run package` | 0.3.0 portable, zip, installer built |
| Node packaged lifecycle | one window; second launch exited; restart returned 0.3.0; quit stopped agent; no launcher left |
| Cross-product automated test | real Hub 3.3 paired with real Node 0.3 process; controller read hardware; Node stayed unprivileged |
| Visual inspection | Node Overview/Machine/Permissions/Diagnostics at 1080×820, no page scroll |

The cross-product test is in `tests/cross-product-03.test.mjs`. It is an
automated process test, not a second physical PC.

## Artifacts and SHA-256

Built locally under ignored `dist/` folders; not uploaded or released.

| Artifact | SHA-256 |
| --- | --- |
| `ATHENA-Node-Setup.exe` | `1d6b4a3350cdbede3f0c1ddfff4b22421790cc1af01706375dbc0f1e37126bda` |
| `ATHENA-Node-0.3.0-win64.zip` | `0c9c32dc794d672bb56d2996f12fac10e5aba370a6a0411aa1827209afcd2404` |
| `ATHENA-Hub-3.3.0-win64.zip` | `a985c2751b1ab5240425518426d4a69d7afe48354b8b52b5649c5155e7854b7f` |

## Not verified — physical device limitations

- No second Windows PC was available. Clean install, SmartScreen, firewall
  prompt, a second GPU/audio device and real LAN pairing were **not** physically
  tested.
- The Node installer and executables are **unsigned**. No code-signing
  certificate is available.
- Real iOS/iPad battery, background suspension, Bluetooth audio latency and
  installed-PWA behaviour were not re-tested on a physical device.
- Windows screen capture and input helpers were not exercised against a second
  machine in this run; existing automated framing and permission checks passed.
- No release was published. No branch was merged to `main`.

## Approval needed

1. Review the two branches and diffs.
2. Approve merging `athena-node-0.3-wip` and `athena-3.3-wip`.
3. Approve publishing `v0.3.0` and Hub `3.3.0` release artifacts.
4. Decide whether an unsigned installer is acceptable for this release.
