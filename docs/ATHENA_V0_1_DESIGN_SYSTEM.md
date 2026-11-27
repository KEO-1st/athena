# ATHENA v0.1 Design System

This is the implemented specification for the Hub, Node and Controller. It
describes the product as it exists on `athena-3.3-wip` / `athena-node-0.3-wip`,
not a future concept. If code and this document disagree, the code is the truth
and this document is updated in the same change.

## 1. Principles

1. **Proof over theatre.** Status, actions and hardware values are shown from
   real state. A surface never fills a missing measurement with a decorative
   zero.
2. **One intelligence, three bodies.** Hub, Node and Controller share the same
   token vocabulary, type scale and component rules, but each has a different
   job and therefore a different information architecture.
3. **Cosmic, not noisy.** The identity is a dark field, a gold eye-in-star and
   thin orbital lines. Motion is restrained: no particle storms, no continuous
   glow behind text, no animation that blocks reading.
4. **Calm defaults.** The common path is visible first. Advanced controls,
   diagnostics, API keys and provider configuration are grouped and, where
   appropriate, behind a disclosure.
5. **Honest states.** Loading, empty, offline, refused, partial and failed are
   distinct states with words, not just colours.

## 2. Design tokens

Tokens live in `public/styles.css` (atmosphere) and `public/design.css`
(structure). The Node panel defines the same names inside `panel.html`. Do not
add a new colour or radius in a component when an existing token fits.

| Token | Value / rule | Use |
| --- | --- | --- |
| `--void` / `--surface-0` | `#04050a` | page field |
| `--shell` / `--surface-1` | `#0b0d15` / translucent | panels |
| `--surface-2` | `rgba(15,18,27,.94)` | raised rows, disclosures |
| `--accent` | `#d8a94e` (Gold) | primary action, active nav, focus |
| `--accent-l` / `--accent-hi` | `#f2cf8a` / `#fff0cd` | hover, emphasis text |
| `--dim` | `#857e6d` | metadata, secondary labels |
| `--live` | `#6cf0b0` | online / verified |
| `--bad` | `#ff7d58` | failed / offline / dangerous |
| `--hair`, `--line` | gold or neutral at 9–36% | borders |
| `--space-1…7` | 4, 8, 12, 16, 24, 32, 48 px | spacing rhythm |
| `--text-2xs…display` | 9 → clamp(44–78) px | type scale |
| `--radius-sm/md/lg` | 6 / 10 / 16 px | controls, cards, shells |
| `--rail` | 228 px (250 px ≥1500 px) | desktop navigation |
| `--content` | 1440 px | maximum Hub width |

Accent skins (Gold, Ion Blue, Halo Cyan, Ember, Jade) change only the accent
family. Layout, contrast and meaning never change with the skin.

## 3. Typography and icons

- Display: Bahnschrift / Segoe UI Variable Display / system sans, weight 300–500.
- Data and labels: Cascadia Mono / ui-monospace, uppercase, `0.14–0.24em`
  tracking. Body copy is never uppercase.
- Headings use sentence case in content, uppercase only for micro-labels.
- Icons are a single line-art family (eye, orbit, node, list, gear). The Hub
  mark is the oculus; the Node mark is the winged star. No emoji as UI icons.

## 4. Components

| Component | Rule |
| --- | --- |
| Panel | Translucent surface, 1 px line, 10–16 px radius, 16–22 px padding. One panel explains one subject. |
| Card | Machine/job/provider summary. 6 px radius, 1 px border, hover lifts 1 px only. |
| Button | Minimum 40 px height, mono 9 px uppercase, 6 px radius. `solid` is the single primary action in a group; `danger` is destructive only. |
| Field | Label above control, 6 px gap, 42 px control height. Placeholder is an example, never the only label. |
| Badge / chip | Short measured state: READY, OFFLINE, RUNNING, PARTIAL, FAILED. Colour is never the only signal. |
| Meter | Thin 3 px bar for CPU or memory; an unavailable value reads as an empty muted bar, not a full one. |
| Provider card | Name, readiness, active model, masked key or locality. Selected card has a visible gold border. |
| Process row | Name, memory, pid/count and a relative memory bar. Sorted by resident memory. |
| Evidence image | Screenshot from a real Node, capped in height, `object-fit: contain`, attached to the conversation message that caused it. |
| Toast | One line, transient, never the only record of a failure. Persistent results stay in the message or job card. |

## 5. Information architecture

### Hub (desktop and large tablet)

- **Left rail**: Workspace label, Home, Screen, Nodes, Jobs, Settings, and
  Controllers for the Hub administrator.
- **Header**: ATHENA HUB identity, hub name / version / LAN address, voice and
  sync controls.
- **Home**: compact command deck (network vitals) plus the conversation, its
  history, quick actions and composer. Chat is the primary work surface.
- **Screen**: all online machines, one focused view with keyboard, mouse, audio
  and evidence controls.
- **Nodes**: linked machines, measured status, software and node actions.
- **Jobs**: queue, run, result and cancellation with attribution.
- **Settings**: this hub, **Model Center**, spoken voice, look and feel,
  controllers, security, API keys, integrations and network diagnostics.

### Hub (below 1024 px)

The rail becomes the existing bottom tab bar with safe-area padding. Model
Center fields stack into one column. Chat remains the first screen.

### Node (desktop application window)

- Header: identity, live link state and **HIDE PANEL** (explains that the agent
  stays in the tray).
- Tabs: Overview, Machine, Processes, Permissions, Diagnostics.
- Overview: pairing identity, live link, measured summary, services, tray
  behaviour.
- Machine: CPU, RAM installed/usable/available, GPU/VRAM/temperature/driver,
  disks, displays, audio, installed applications. Missing values say
  unavailable.
- Processes: on-demand process table; refresh runs only while the tab is open.
- Permissions: local-only toggles with plain-language consequences.
- Diagnostics: local checks, connection, versions, log tail, update check.

### Controller (phone)

Mobile-first: bottom navigation, chat first, node picker before a screen,
persistent reconnection with backoff, screen previews paused while hidden.
Controllers never receive Hub administration, provider keys or the shell.

## 6. Responsive behaviour

| Width | Behaviour |
| --- | --- |
| `< 520 px` | two-column provider grid, stacked Model Center, capped screenshot height, composer above the tab bar |
| `520–1023 px` | stacked forms, bottom navigation, full-width panels |
| `≥ 1024 px` | 228 px left rail, scrollable content column, sticky composer, wider cards |
| `≥ 1500 px` | 250 px rail, content capped at 1440 px |
| Node window `< 620 px` | single-column identity, two-column metrics, scrollable tabs |

## 7. Accessibility and performance

- Every control is a native button, input, select or summary; keyboard order
  follows visual order.
- `:focus-visible` uses a 2 px `--accent-hi` ring with offset.
- Meaning is carried by text plus colour (ONLINE/OFFLINE, VERIFIED/PARTIAL).
- `prefers-reduced-motion` removes view, pane, hover and ambient motion.
- `data-motion="0/1/2"` and `data-glass` let a slow device reduce effects.
- Decorations are `aria-hidden`; screenshots carry descriptive alt text.
- Node process polling and controller screen polling stop while hidden.
- The shell has no framework, bundler or runtime dependency. Static assets are
  network-first in the service worker so a controller cannot run yesterday's
  app.js after an update.

## 8. Branding assets

- Hub mark: `public/icons/icon-192.png`, `icon-180.png` (oculus / eye-in-star).
- Node icon: `athena-node/assets/athena.ico`, embedded by the launcher and
  installer.
- Wordmark: wide-tracked ATHENA with a gold terminal node accent; never stretch,
  recolour outside the token set, or place on a light field.
- Window title, taskbar, tray and installer all use the Node icon. The Hub uses
  the oculus favicon and PWA icons.

## 9. What this release does not include

The ATHENA Store/Library, ATHENA Link, AEGIS, AI Clip Studio, UNORDINARY Story
Maker, a native mobile app and aggressive GPU/RAM/network limiting are future
products. The design keeps them as catalogue entries and future surfaces; none
of their names are hardcoded into the agent engine or scheduler.
