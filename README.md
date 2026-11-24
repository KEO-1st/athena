# ATHENA

**Your machines, one intelligence.**

ATHENA is a private hub for every computer you own. Run one small agent on each
machine, run the hub on any of them (or a spare laptop / Raspberry Pi), and from
then on:

- the hub **finds your machines** on the LAN and keeps a token for each,
- **any tool you write** can drive them through a REST API with an API key —
  run commands, start ComfyUI, pull Ollama models, install nodes,
- **you** can drive them from your phone: the app installs to an iPhone/iPad
  home screen and answers voice commands,
- **an AI brain** turns a sentence ("render this on the 3060 and tell me when
  it's done") into real tool calls on the right machine.

Zero npm dependencies. Node 20+. Nothing leaves your network.

---

## 1 · Start the hub (this PC)

```
node athena/server.mjs
```

or double-click **Start Athena.cmd** on Windows (installs Node with winget if
missing).

It prints something like:

```
   hub         keoja-pc
   this PC     http://127.0.0.1:4790/
   phones      http://192.168.1.7:4790/
   access code 7KQ4M2
```

Open that address. On the PC the app unlocks itself — there is nothing to type.
On a phone you need that **access code** once; it is remembered afterwards.

**Where the code is:** the same black ATHENA window, printed in a box, and also
saved as plain text in `athena/data/access-code.txt`. If you lost the window,
just run **Start Athena.cmd** again: it prints the code before opening the app.

**Where the hub is:** the black window. It *is* the hub — no extra program.
Closing it stops ATHENA for everyone. If you close it, start it again.

---

## 2 · Turn the other PC into a node

Copy the **whole `dist/ATHENA-Node-0.1.0`** folder to the render PC (build it
with `npm run package:node`), then:

1. Double-click **Install Node.cmd** (installs Node if needed, starts the node).
2. Allow the Windows Firewall prompt for **Private networks**.
3. The node window shows a big ring and a **six-character pairing code**.
4. In the hub: **NODES → SCAN**, find the machine (GPU and VRAM shown), type its
   code, press **LINK**.

The node window flips to LINKED and prints its hub name. From then on the hub
owns it.

If discovery is blocked, use **LINK BY ADDRESS** (`192.168.x.x`, port `47910`)
with the same code.

After the first time, **Start Node.cmd** is all you need. The Node's id,
pairing token and settings live in `%LOCALAPPDATA%\ATHENA Node`, so replacing
the program folder with a newer Node package keeps the machine paired. There is
no automatic Node update; upgrading is a deliberate choice.

---

## 3 · Install it on iPhone / iPad

1. Both devices on the same Wi-Fi.
2. Open `http://<hub-ip>:4790/` in **Safari**.
3. Enter the access code.
4. **Share → Add to Home Screen.**

It opens full screen with its own icon, no browser chrome.

> **Two iOS limits worth knowing.** Safari only gives web apps the microphone
> and service-worker installation on **secure origins**. Plain `http://` on your
> LAN is fine for the UI and voice *if* Safari allows it, but if the mic is
> blocked that is why — put the hub behind HTTPS (Caddy/Tailscale/Cloudflare
> Tunnel) if you want voice in the installed app. Also, iOS suspends background
> web apps, so the "AI working in the background" lives on the **hub**, not on
> the phone: the hub keeps watching, queueing and pushing updates, and the phone
> reconnects the instant you open it.

---

## 3b · Watch and drive a screen

Open **SCREEN** in the app. Every online machine shows a live picture of its
desktop, all at once.

- **Tap the picture** → a real left click at that spot on that PC.
- **Long-press / right-click** → right click.
- **SEND** types the text into whatever window is focused there.
- Enter, Tab, Esc, Backspace and scroll buttons are under the picture.

This is real control (Windows `user32` + `SendKeys`, through the node's
`host-input.ps1`; pictures come from `host-screen.ps1`), so the mouse on that PC
actually moves. A node can switch it off: its window → **SETTINGS → Allow mouse
& keyboard control**.

With a **vision** model the AI can look too: "open that video with the old man
in the green hat" becomes `see_screen` → `control_mouse_keyboard` (click) →
`see_screen` to check. Models with eyes: `gpt-4o`, `gemini-2.0-flash`,
`claude`, or locally `qwen2.5vl:7b` / `llava` in Ollama. Without one, ATHENA
takes the screenshot but cannot read it — it will tell you so.

### Hearing it too

Each screen card has **🔊 LISTEN**, a **MUTE** for that machine, and the
SCREEN header has **MUTE ALL**. Sound is MP3 streamed from the node itself:

- the node needs **FFmpeg** (APPS → FFmpeg → INSTALL), then restart the node
  agent so it is on its PATH;
- it captures the Windows DirectShow audio device picked automatically. For the
  machine's **own** sound, enable **Stereo Mix** in Windows sound settings
  (Recording devices → right click → Show disabled devices). With only a
  microphone available, ATHENA listens to the mic and says so.

The relay starts a fresh FFmpeg per listener and kills it when you stop, so an
idle node captures nothing. API: `GET /api/nodes/:id/audio?token=…`
(`audio/mpeg`) and `GET /api/nodes/:id/audio/devices`.

---

## 4 · Give it a brain

Open **SYSTEM → BRAIN** and press **INSTALL BRAIN**. That is the whole setup:

1. Ollama is installed through winget (or the official installer if winget is
   missing), and started;
2. the hub reads this PC's RAM and picks the biggest free model that fits
   (`qwen2.5:1.5b` → … → `qwen3:32b`);
3. `ollama pull` runs with live progress in the app log on the same panel;
4. the hub switches itself to that model when it lands.

**UPGRADE BRAIN** runs the same search again and moves up the ladder only when a
bigger model fits. You can also just say *install brain* or *upgrade brain* in
the chat — both work before any brain exists, because they are built-in intents,
and the model gets `manage_brain` as a tool once it is alive.

Tick **also install a vision model** to add `qwen2.5vl` so `see_screen` can
truly read a screen. Or point the hub at any other provider by hand:

| Provider | What it is | What you need |
| --- | --- | --- |
| **Ollama** | free, local, private | install Ollama, `ollama pull qwen2.5:7b` |
| **OpenAI-compatible** | any `/chat/completions` endpoint: OpenAI, Groq, OpenRouter, LM Studio, Freebuff API | base URL + API key |
| **Gemini** | Google's compatibility endpoint | Gemini API key |
| **Off** | built-in command parser | nothing |

The key is stored **only** in `athena/data/config.json` on the hub. It is never
sent to the browser. The app shows you which brain is live; if it is not ready,
ATHENA still understands `status`, `run <command>`, `start comfy`, `scan`.

The model is given seven tools — `list_nodes`, `node_status`, `run_command`,
`node_action`, `manage_brain`, `see_screen`, `control_mouse_keyboard` — and a
description of every machine's GPU, VRAM, temperature and services. Ask in
plain language:

- "what's the 3060 doing?"
- "run nvidia-smi on the render pc"
- "restart comfyui on the pc with the 3060"
- "install ComfyUI-Manager on the render node"
- "which machine has the most free VRAM?"
- "speak 'render complete' on the render pc" (Windows SAPI voice)

---

## 4b · Software on a machine

There is no global Apps/Software tab. Open **NODES**, find the machine, and
expand **SOFTWARE ON THIS MACHINE**. That section reads, installs and starts
software on that PC only. ATHENA is a network, not a ComfyUI front-end:
ComfyUI is one card there, next to the rest, and it is only the star of the
show on a machine that actually renders.

| App | What it adds | Service |
| --- | --- | --- |
| **ComfyUI** | image / video generation | start · stop |
| **Ollama** | a local brain on that machine | start · stop |
| **FFmpeg** | sound relay, every conversion and encode | tool |
| **Python** | scripts and training jobs | tool |
| **Git** | clone custom nodes and repos | tool |
| **yt-dlp** | reference clips and audio | tool |
| **7-Zip** | unpack models and portable builds | tool |

Each app row shows INSTALLED / RUNNING / MISSING for that machine, with
INSTALL, START and STOP right there. Installs are winget (`Ollama.Ollama`,
`Gyan.FFmpeg`, …) and can take a few minutes; the card shows WORKING until the
node answers. After installing a command-line app, restart the node agent so
its PATH is picked up.

ComfyUI is installed by unzipping the portable build and letting **FIND COMFY**
locate it — a 2 GB download behind a GUI installer is not something to hide in
a button.

---

## 5 · Let other tools use your machines

**SYSTEM → API KEYS → CREATE KEY.** You get `ath_…` **once** — store it in the
other tool.

Every endpoint accepts either `x-athena-key: ath_…` or
`Authorization: Bearer ath_…`.

```bash
HUB=http://192.168.1.7:4790
KEY=ath_your_key

# what's on the network
curl -H "x-athena-key: $KEY" $HUB/v1/health

# run something, wait for the output
curl -X POST -H "x-athena-key: $KEY" -H "content-type: application/json" \
  -d '{"command":"nvidia-smi","wait":true}' \
  $HUB/v1/nodes/NODE_ID/exec

# queue it instead, poll the job
curl -X POST -H "x-athena-key: $KEY" -H "content-type: application/json" \
  -d '{"command":"python render.py","label":"night batch"}' \
  $HUB/v1/jobs
curl -H "x-athena-key: $KEY" $HUB/v1/jobs/JOB_ID

# ask the brain from your own bot
curl -X POST -H "x-athena-key: $KEY" -H "content-type: application/json" \
  -d '{"text":"free up the 3060 and tell me its temperature"}' \
  $HUB/v1/ask

# talk to ComfyUI through the hub (no ports opened on the render PC)
curl -H "x-athena-key: $KEY" $HUB/v1/nodes/NODE_ID/comfy/system_stats
```

### API surface

| Method · path | Purpose |
| --- | --- |
| `GET /api/health` | open: is the hub alive |
| `POST /api/session` | `{code}` → session token (the app uses this) |
| `GET /api/state` | hub, nodes, jobs, keys, brain |
| `POST /api/scan` | UDP discovery |
| `POST /api/nodes/pair` | `{host,port,code}` |
| `GET/DELETE /api/nodes/:id` | inspect / unlink |
| `POST /api/nodes/:id/action` | `{op,args}` — node control |
| `POST /api/nodes/:id/exec` | `{command,wait,timeoutSec}` |
| `GET /api/nodes/:id/tasks` | running tasks on that node |
| `GET /api/nodes/:id/screen` | one JPEG of that machine's screen |
| `GET /api/nodes/:id/screen/info` | resolution, input capability |
| `POST /api/nodes/:id/input` | `{op,x,y,text,key,amount}` — mouse & keyboard |
| `GET /api/nodes/:id/audio?token=` | live MP3 of that machine's sound |
| `GET /api/nodes/:id/audio/devices` | capture devices, `systemAudio` flag |
| `GET /api/apps` | the app catalogue the APPS page shows |
| `GET/POST /api/brain/install` | brain install status / start it |
| `POST /api/brain/upgrade` | search the ladder and move up |
| `POST /api/hub/shutdown` · `/api/hub/restart` | stop / restart the hub |
| `* /api/nodes/:id/comfy/*` | ComfyUI tunnel |
| `GET/POST /api/jobs` | list / enqueue |
| `GET /api/jobs/:id` · `POST …/cancel` | inspect / cancel |
| `POST /api/ask` | `{text,history}` → answer + tool log |
| `GET/POST /api/keys` · `DELETE /api/keys/:id` | keys |
| `POST /api/settings` | hub name, code, open mode, brain |
| `GET /api/events?token=` | SSE: state + job events |
| `GET /v1/*` | same resources, built for other tools |

### Node operations

`status`, `run` (background task), `task`, `tasks`, `task-cancel`, `exec`
(synchronous), `start-comfy`, `stop-comfy`, `restart-comfy`, `detect`,
`apps`, `app-install` (`{app}`), `app-start`, `app-stop`,
`install-node` (`{url}`), `pip` (`{packages}`), `pull-model` (`{model}`),
`speak` (`{text}`), `open-panel`, `config`, `shutdown`.

Node ports: HTTP **47910**, discovery UDP **48880**, ComfyUI tunnel `/comfy/*`
(ComfyUI itself stays on `127.0.0.1`).

---

## Security model

- Hub UI: 6-character access code → session token, 8 attempts/minute per IP.
- Tools: API keys, hashed with SHA-256, shown once, revocable.
- Nodes: pairing code shown only on the machine's own screen; the hub stores a
  32-byte token per node, and the node forgets it on unlink.
- Node capabilities can be switched off per machine in its window
  (**Allow shell commands**, **Allow remote shutdown**).
- There is no cloud, no account, no telemetry. LAN only. If you expose the hub
  to the internet, put HTTPS and real auth in front of it first — the access
  code is a convenience lock, not a hardened perimeter.

## Files

```
athena/
  server.mjs            hub
  lib/                  store · discovery · registry · jobs · brain
  public/               the PWA (index, app.js, styles.css, sw, icons)
  node/athena-node.mjs  the agent for each machine
  node/panel.html       the window it shows
  node/host-screen.ps1  Windows screen capture (PowerShell + .NET)
  node/host-input.ps1   Windows mouse & keyboard input (user32)
  data/                 config, keys, sessions, nodes, jobs  (gitignored)
  data/access-code.txt  the access code, in plain text, for when you forget it
```

## Honest limitations

- Voice input is Safari/Chrome Web Speech; iOS may require HTTPS. Voice output
  uses the device's own speech synthesis.
- iOS pauses web apps in the background — the hub is the part that keeps
  working, and jobs survive the phone locking.
- Screen view and remote control are **Windows only** (the node uses
  PowerShell + user32). Status, commands, ComfyUI and the API work anywhere.
- Screen is polled as JPEG a few times a second, not a video stream — fine on a
  LAN, not a remote-desktop replacement for 60 fps work. It pauses while the
  tab is in the background to save CPU.
- Windows Defender (AMSI) blocks a PowerShell script that both captures the
  screen and injects input, so ATHENA ships them as two small scripts. If you
  edit them, keep them separate.
- The AI must look first, then click, then look again. It cannot act faster
  than that loop, and it will mis-click sometimes; that is why every click is
  visible on the SCREEN tab.
- Sound from a PC is not captured.
- Background jobs are shell processes; a node restart drops them.
- The AI can run commands. That is the point. Keep `allowShell` off on machines
  other people use, and keep API keys out of client-side code.
