# ATHENA — Visual Design Direction

**Status:** direction, not implementation. Phase 1 only added reduced-motion and
label fixes. The redesign is Phase 11 and must not be started by replacing the
working interface with a mock-up.

**Related:** `docs/ATHENA_TASK_PROPOSAL_AND_EXECUTION_UX.md`,
`docs/ATHENA_DEVELOPMENT_ROADMAP.md`.

---

## 1. Intent

ATHENA should feel like a **premium cinematic sci-fi system**: an intelligence
you enter, not a dashboard you operate. The existing cosmic eye is the anchor of
that identity and must survive the redesign.

Not this:

- a generic admin dashboard with cards in a grid;
- stock "AI" visuals — random neural nets, blue gradients, floating hexagons;
- replacing the eye with circles, dots, or unrelated geometry.

This:

- the eye as the persistent presence, with real depth and light;
- layered atmosphere (stars, dust, volumetric glow) that responds to state;
- work surfaces (proposal, monitor) that feel like instruments in the same
  world, not separate apps;
- motion that communicates state and hierarchy, not decoration;
- the same world on a phone and a desktop, scaled rather than redesigned.

---

## 2. Preserve the identity

| Element | Keep | Change |
| --- | --- | --- |
| Cosmic eye / oculus SVG | shape, iris, orbits, gold accent | real depth, parallax, lighting response |
| Palette | deep near-black, gold primary, ion/halo/ember/jade accents | add a strict token set; no ad-hoc colours |
| Typography | wide-tracked micro labels, light display headings | consistent scale, minimum readable size |
| Motion levels | CALM / DIVINE / ECSTATIC | map to a single motion token scale |
| Glass / ambient toggles | user control over blur and particles | performance-aware defaults |
| Lock screen | identity moment | richer entrance, same instant unlock |

`public/img/athena-bust.jpg` is currently unused. Either integrate it as a
material/lighting reference in the presence and proposal surfaces, or remove it;
do not leave dead art in the repo.

---

## 3. Visual system

### 3.1 Depth model

Five explicit layers, each with its own motion rate:

1. **Void** — background gradient and subtle noise.
2. **Atmosphere** — nebula, stars, drifting dust (slowest parallax).
3. **Structure** — horizon lines, frames, grids, HUD ticks.
4. **Presence** — the eye, its halo, iris, orbits, flares.
5. **Instruments** — chat, nodes, proposal, monitor, dialogs (sharpest, most
   legible, least animated).

Rules:

- Instruments never sit behind heavy blur or particles.
- Pointer parallax applies to layers 2–4 only, with small angles (≤ 8°).
- Depth is communicated by scale, blur and light, not by drop shadows alone.

### 3.2 Light

- One key light source, warm gold, originating behind/above the eye.
- Volumetric beams are additive and low-opacity; they must not wash out text.
- A cool rim light separates the eye from the void.
- State changes modulate light: idle = slow breathe; listening = iris
  contraction + warmer rim; thinking = travelling pulse; executing = directional
  energy along the workflow; error = desaturated, no red strobe.

### 3.3 Motion language

- **Breath** (4–8 s) — idle life.
- **Pulse** (600–1200 ms) — a message or state transition.
- **Sweep** (2–4 s) — scanning, analysis, progress.
- **Snap** (120–200 ms) — direct manipulation feedback.
- No motion may loop faster than 1.5 s in the periphery.
- Every animated state has a static equivalent that conveys the same meaning.

### 3.4 Surfaces

- Instruments use a restrained glass/steel material: thin 1px borders, inner
  highlight, very low-opacity fill, minimal blur.
- Elevation is expressed by light and border, not heavy shadow.
- Proposal and monitor surfaces are the most "solid" in the system: clarity
  wins over atmosphere.

---

## 4. Technical approach

### 4.1 Current stack

The interface is plain HTML, CSS and ES modules, with hand-built CSS animation
and an inline SVG eye. It is fast, dependency-free and works offline. That is a
real asset and should not be thrown away for a framework.

### 4.2 Recommended investigation (Phase 11, not now)

Evaluate, in this order, and record the decision in an ADR:

1. **Enhanced CSS/SVG** — layered transforms, `filter`, `mix-blend-mode`,
   SVG masks and gradients, `@property` for smooth custom-property animation.
   Cheapest, keeps zero dependencies, enough for most of the effect.
2. **Canvas 2D particle/light field** — a small custom renderer for dust,
   volumetric glow and star parallax, with device-pixel-ratio awareness and a
   particle budget. No dependency.
3. **WebGL with a minimal renderer** — custom shaders for the iris, caustics,
   volumetric light and post-processing. Highest fidelity, highest complexity.
4. **Three.js (pinned dependency)** — only if scene graph, lighting and
   post-processing needs justify the weight. It must be lazy-loaded, optional,
   and replaced by a static poster when unavailable.

Do not adopt a dependency before measuring: target 60 fps on a mid-range phone
and a stable 30 fps fallback. If WebGL is not available, the CSS/SVG version
must remain complete, not broken.

### 4.3 Performance budgets

| Surface | Budget |
| --- | --- |
| First paint (LAN) | < 1.5 s on a mid-range phone |
| Shell JS (gzip) | < 120 KB total; no framework unless justified |
| Continuous animation | ≤ 4 ms main-thread per frame |
| Particles | ≤ 400 on phone, ≤ 1200 on desktop, paused when hidden |
| Blur layers | ≤ 2 simultaneous full-screen backdrop filters |
| Battery | pause all ambient motion when the tab is hidden or reduced-motion is set |

Rules:

- `visibilitychange` and `prefers-reduced-motion` stop ambient animation.
- No animation of layout properties; transform/opacity only.
- Images are sized and lazy-loaded; no video backgrounds on mobile.

### 4.4 Image/video compositing

"Real image/video animation and compositing" means using actual media where it
adds meaning — user artifacts, generated frames, screen previews, render
progress — not fake film grain over everything.

- Preview generated images and video frames in the monitor with correct aspect
  ratios and no layout shift.
- Animate transitions between generated candidates (cross-fade, not spin).
- Do not autoplay audio; do not autoplay large video on cellular.
- Provide a poster and a static fallback for every media tile.

### 4.5 Workflow visualisation

- A readable pipeline: stages as nodes, dependencies as edges, current stage
  highlighted, completed stages dimmed, blocked stages marked.
- The same data drives the textual stage list; the graphic is an aid, never the
  only representation.
- Parallel branches are visually parallel; sequential stages are not drawn as
  parallel to look impressive.
- Live state uses light travelling along edges, not constant shimmer.

---

## 5. Screens

- **Presence / lock** — the eye at full scale, one clear action, instant unlock
  on the hub PC.
- **Home** — conversation with the eye as a listening presence; node orbs are
  secondary.
- **Nodes** — machines as distinct presences, not uniform cards; show location,
  capability and live load honestly.
- **Screen / focus** — the remote screen is the hero; controls recede; latency
  and connection state are visible.
- **Proposal** — calm, precise, editable; the plan is the hero.
- **Monitor** — instrument panel: progress, telemetry, artifacts, log; clarity
  over atmosphere.
- **System** — technical truth (versions, addresses, keys, health) with the same
  typography but minimal decoration.

---

## 6. Responsive and accessible

- Mobile first: one column, bottom tabs, sheets for detail.
- Desktop: the eye can be large; instruments dock around it without covering it.
- Touch targets ≥ 44 px; body text ≥ 15 px; micro labels ≥ 11 px with adequate
  contrast.
- Focus visible everywhere; overlays trap focus and restore it on close.
- `prefers-reduced-motion` removes ambient motion, parallax and sweeps, keeps
  instant state changes.
- Colour is never the only signal: pair accent with text/icon.
- All icon-only controls have accessible names.
- Screens and monitors remain usable at 200% zoom.

---

## 7. Asset and code organisation

- Tokens in one place: colour, spacing, type scale, motion durations, blur radii.
- One eye component used by lock, home and presence; no duplicated SVG ids.
- Components: `eye`, `instrument`, `stage-row`, `telemetry`, `artifact-tile`,
  `proposal`, `monitor`.
- No inline styles for anything themeable.
- Motion constants exported from CSS custom properties, mirrored in JS only when
  a canvas needs them.

---

## 8. Phase 11 acceptance criteria

1. The cosmic eye is still the identity anchor, now with depth, light and
   state-responsive motion.
2. No generic circles/dots replace the eye; no stock AI imagery.
3. Ambient motion pauses when hidden and under reduced-motion.
4. 60 fps on a mid-range phone for the home surface, with a documented fallback.
5. Proposal and monitor are visually part of the same world but optimised for
   legibility and speed.
6. Every media tile has a poster/static fallback and no layout shift.
7. All icon-only controls have names; focus is visible and trapped correctly.
8. The shell stays under the JS/CSS budgets or the overage is justified in an ADR.
9. `athena-bust.jpg` is either used meaningfully or removed.
10. The LAN experience remains instant: no redesign may add a blocking load
    before the eye appears.
