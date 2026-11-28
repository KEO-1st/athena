# ATHENA // ASTRAL COMMAND

A native Windows 3D prototype of ATHENA's command environment. It is a real
Godot 4.5 / C# desktop application: **no browser, no WebView2, no HTML, no local
web server**. Hub and Node services are untouched and are not embedded here.

The executable and all required runtime files are already built on the
development machine:

```
athena-desktop/build/ATHENA.exe
athena-desktop/build/data_AthenaDesktop_windows_x86_64/
athena-desktop/build/ATHENA.pck
```

Ship those three paths together. Double-click `ATHENA.exe`. The build is a
self-contained Windows x86_64 release and does not need a separate .NET install.

## The environment

The command chamber is fully procedural C# geometry and shaders. There are no
external art packs, stock textures or copyrighted assets.

- Celestial intelligence core: obsidian sphere, animated iridescent-gold corona,
  engraved orbital rings, six floating diamond stations and a breathing light.
- Monumental architecture: mirror platform with a chromatic diffraction rim,
  tall gold-seamed monoliths, planetary halos, orbiting bodies and dust.
- Four-point astral stars, gold motes and a deep nebula veil.
- Three floating command panels (`SYSTEM`, `NODE`, `SETTINGS`) with real
  physics colliders, hover response and animated transitions.
- Spatial navigation: drag or right-drag to orbit, wheel to move closer/farther,
  automatic slow drift when idle.

Every visible UI label is real 3D text in the scene. Nothing is an HTML overlay.

## Controls

| Action | Control |
| --- | --- |
| Open a panel | Click its button / panel |
| Close detail console | `ESC`, or `CLOSE [ESC]` |
| Orbit camera | Drag empty space or right-drag |
| Zoom | Mouse wheel |
| Switch render profile | `1` `2` `3` `4`, or buttons in Settings |
| Toggle VSync / fullscreen / glow | Settings panel |
| Recenter eye | `R` or Settings > Recenter |
| Quit | Close the window |

## Render profiles

| Profile | 3D scale | Target | Stars | Motes | Shadows | Reflections | Lights | Animation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ULTRA | 100% | uncapped | 1800 | 180 | on | on | 3 | 100% |
| HIGH | 86% | 60 fps | 1200 | 120 | on | on | 2 | 100% |
| BALANCED | 72% | 45 fps | 700 | 72 | on | off | 2 | 72% |
| COMPATIBILITY | 56% | 30 fps | 320 | 36 | off | off | 1 | 35% |

The profiles change actual rendering work (viewport 3D scale, particle counts,
shadow state, reflection probe, lights, glow and animation speed). They are not
a label change.

## Measured on the development machine

Hardware: AMD Ryzen 5 7430U with integrated AMD Radeon graphics, 16 GB RAM,
Windows, 1440 x 900 window. VSync was disabled for measurement.

Engine-side 40 s four-profile run (`measurements/benchmark.csv`):

| Profile | Avg FPS | 1% low FPS | Avg frame | Max frame | Draw calls | App working set |
| --- | --- | --- | --- | --- | --- | --- |
| ULTRA | 103.5 | 100.0 | 9.66 ms | 10.63 ms | 183 | 422 MB |
| HIGH | 60.0 | 60.0 | 16.67 ms | 16.67 ms | 142 | 422 MB |
| BALANCED | 45.0 | 45.0 | 22.23 ms | 24.29 ms | 139 | 422 MB |
| COMPATIBILITY | 30.0 | 30.0 | 33.33 ms | 33.33 ms | 114 | 422 MB |

External Windows Performance Counter samples during the same run
(`measurements/gpu-samples.csv`, 35 one-second samples):

- 3D GPU engine: 97.2% peak in ULTRA, about 46% in HIGH, 28% in BALANCED,
  12% in COMPATIBILITY; 40.7% mean across the mixed-profile run.
- Process CPU: 15.6% mean of the whole machine.
- Private working set: 945 MB peak.

These numbers are for this integrated-GPU machine. No independent low-end GPU
has been tested yet, so low-end compatibility is not claimed. HIGH holds a
steady 60 fps here; ULTRA is uncapped and GPU-bound.

## Prototype data vs real metrics

- FPS, frame time, app CPU, working set and draw calls in the HUD and SYSTEM
  console are read from the real engine/process.
- NODE data is explicitly marked **PROTOTYPE DATA — NOT REAL TELEMETRY**. It is
  a designed lattice snapshot; no Hub is attached.

There is an optional read-only integration seam for a future Hub/Node adapter:

```
ATHENA.exe --state=C:\path\snapshot.json
```

or set `ATHENA_DESKTOP_STATE`, or place `bridge.json` in the Godot user data
directory. When a snapshot is loaded, NODE remains marked as a non-live bridge
snapshot. See `scripts/AthenaBridge.cs` for the small JSON envelope.

## Reproduce the build

Prerequisites:

- Godot 4.5 stable **.NET/Mono** editor and matching Windows export templates.
- .NET SDK 8.

From the repository root:

```bash
export DOTNET_ROOT="$PWD/tools/.cache/dotnet"
export PATH="$DOTNET_ROOT:$PATH"
dotnet build athena-desktop/AthenaDesktop.csproj

GODOT="tools/.cache/godot/Godot_v4.5-stable_mono_win64/Godot_v4.5-stable_mono_win64.exe"
"$GODOT" --headless --path athena-desktop \
  --export-release "Windows Desktop" "$PWD/athena-desktop/build/ATHENA.exe"
```

Or use `athena-desktop/build.sh`, which looks for the cached toolchain first and
falls back to `godot` / `dotnet` on `PATH`.

Launch modes:

```bash
ATHENA.exe --capture=<dir>      # five screenshots, then quit
ATHENA.exe --benchmark=<csv>    # 4 x 10 s profile benchmark, then quit
ATHENA.exe --demo               # scripted panel/profile pass, then quit
```

## Demonstration and screenshots

- `screenshots/01-command.jpg` through `05-compatibility.jpg` are captured from
  the exported executable.
- `demo/athena-demo.mp4` is a 19 s screen recording of the exported executable
  opening panels, cycling profiles and returning to the command environment.

## Known limitations

- This is a prototype, not the Hub/Node production client. It does not mutate
  Hub state or connect to Node agents.
- The NODE console is simulated and labeled as such.
- Only this integrated-GPU machine has been measured. Four profiles exist to
  scale the work, but low-end hardware validation is still pending.
- The build is unsigned. SmartScreen may show an "unknown publisher" prompt.
- This prototype lives on the WIP branch and is isolated from Hub/Node services.
