# ADR 0061 — Deck: the desktop shell's design system

- Status: Accepted
- Date: 2026-08-23
- Supersedes the ad-hoc `--panel` / `--accent` / `--line-soft` token vocabulary
  that grew across 34 region stylesheets.

## Context

The Desktop shell had accumulated three overlapping visual vocabularies:

1. **Legacy aliases** (`--panel`, `--card`, `--muted`, `--faint`, `--line-soft`,
   `--surface-hover`) with no defined relationship to each other. Whether
   `--card` sat above or below `--panel` was decided per file.
2. **Per-region literals** — `rgba(0,0,0,0.35)` shadows, `#1e1e24` fallbacks,
   `12.5px` font sizes, and `opacity: 0.55` fades, repeated with slight drift in
   every sheet.
3. **Undifferentiated accent** — one `--accent` carried focus rings, primary
   buttons, active tabs, running spinners, and unread badges. The agent running
   looked the same as a selected list row.

The visible consequences: borders on nearly every element (the shell read as a
wireframe), no consistent depth model, and no way to tell at a glance whether
the agent was working.

Three stylesheets were also over the 1000-line cap in AGENTS.md §3.2
(`region-inspector.css` 4103, `settings-resources.css` 4144,
`region-composer.css` 3540), which is what let the drift accumulate unnoticed.

## Decision

Adopt **Deck**: one token scale, one depth model, one motion vocabulary.

### 1. Depth replaces borders

Five surface steps (`--void`, `--surface-1` … `--surface-4`) form a strict
ramp. An element is separated from its neighbour by *surface step plus shadow*,
not by a stroke. Hairlines (`--line-1` … `--line-3`) are reserved for genuine
dividers inside a single surface.

The shell is three panels floating on `--void` with a `--deck-gap` between
them. The gap replaces the old `border-right` / `border-left` column dividers.

### 2. Color carries exactly one meaning each

| Role | Token | Means |
|------|-------|-------|
| Affordance | `--iris` | Focus, primary action, current selection |
| Liveness | `--ember` | **The agent is running.** Nothing else. |
| Completion | `--mint` | Done, added |
| Attention | `--amber` | Needs your input |
| Failure | `--coral` | Failed, destructive |
| Background work | `--sky` | Subagent lane, waiting on a process |

`--ember` being reserved is the load-bearing rule: any surface that pulses
ember means the agent is doing something right now.

### 3. Motion is state, not decoration

Two ambient animations, both on one shared cycle (`--breath`) so everything in
the window pulses in phase:

- `breath` — liveness on running indicators.
- `ember-wash` — a slow warm gradient across the stage while a run is active,
  driven by `:has(.context-bar-phase-dot.is-running)` so no JSX change is
  needed to wire it.

Everything else is a `--t-1`…`--t-4` transition on the Deck easing curves.
Both ambient animations are disabled under `prefers-reduced-motion`.

### 4. The Deck ramp is part of the theme contract

`ThemeDeckTokens` is added to `@piwin/contracts` as an **optional** field on
`ThemeManifest`:

- Product built-ins (Obsidian, Bone) declare it explicitly, so the shell's
  layered depth is authored rather than guessed.
- Installed theme packages that only ship `ThemeColorTokens` get a ramp
  *derived* from their three colors, so a custom accent still produces coherent
  washes, glows, and focus rings.

Optional keeps every existing third-party manifest valid.

### 5. Built-in theme ids

`piwin-obsidian` (dark) and `piwin-bone` (light) replace the previous
`piwin-dark`, `piwin-light`, and `piwin-orange-white`. Old ids are aliased
(`piwin-orange-white` → `piwin-bone`) so stored user preferences keep resolving;
built-in ids always repaint from the desktop's own manifest rather than a copy
the Host may have cached.

Ink-wash remains a theme *package*, not a built-in.

## Consequences

**Good**

- Depth, color meaning, and motion each have a single authority, so a new
  region has an obvious correct answer instead of a per-file judgement call.
- Run state is legible from across the room without reading any text.
- Every CSS file is now under the 1000-line cap, split by responsibility.

**Costs**

- Large diff across the stylesheet tree; visual regression risk is real and is
  covered by screenshots rather than assertions.
- Legacy aliases are still emitted for compatibility. Regions not yet migrated
  read them and therefore render in Deck colors but not Deck *structure* (they
  keep their borders). Those files are listed as remaining work in
  `docs/design/deck-design-system.md`.
- `ThemeDeckTokens` being optional means two code paths (authored vs derived)
  must both stay correct.

## Alternatives considered

- **Incremental per-region migration.** Rejected: the whole problem was that
  regions drifted independently. Migrating them one at a time reproduces the
  failure mode, and the mixed state (some panels bordered, some floating) looks
  worse than either endpoint.
- **Keep borders, add depth on top.** Rejected: border plus shadow plus surface
  step is three separators doing one job, which is what made the old shell read
  as a wireframe.
- **Required `deck` field on `ThemeManifest`.** Rejected: it would invalidate
  every installed theme package.

---

## Amendment (2026-09-05) — Inkstone (砚) as Default Product UI

### Context

While Deck successfully established a unified depth model and token ramp,
user research and product direction converged on **Inkstone (砚)**
(`docs/design/inkstone/01-inkstone-theme.md`, `proto-00-shell.html`…`proto-07-components.html`)
as the full visual signature of piwin:
- Default face is light **Paper** (`piwin-inkstone-paper`), with deep-night **Ink** (`piwin-inkstone-ink`) as its full dark counterpart.
- Semantic signals: **朱** (vermillion) for user action/focus/gates, **灯** (warm lamp) for agent running, **砚** (dark slab composer) as the signature object.
- Deck (`piwin-obsidian` / `piwin-bone`) steps back to an alternative theme; Inkstone Paper becomes the default cold-start appearance for new installs and system defaults.

### Decision

1. `piwin-inkstone-paper` is the default appearance across Host bootstrap, desktop startup, and settings fallbacks.
2. All existing contract invariants (no raw Pi in apps, tokens in `@piwin/contracts`, 1000-line limit per file) remain strictly binding.
3. Non-Inkstone themes (Obsidian, Bone, ink-wash) retain their exact existing Deck visual behavior via scoped isolation.
4. Default appearance colors resolve to the authored Inkstone manifest (including its id, visual style and depth tokens). Only customized colors produce a derived appearance manifest. Stored, unmodified pre-Deck and Bone/Obsidian default color triples migrate to the corresponding Paper/Ink defaults; explicitly selected library themes and customized triples are preserved.
5. Paper and Ink are product appearance faces and support the titlebar and Settings light/dark controls. A visual-style theme package outside those product faces can still own its appearance and lock those controls.
6. Inkstone structural styles load after the legacy region styles. The full-window titlebar retains its tools when the inspector opens; general Chat uses the same quiet bylines and aligned paper cards as the Agent document. These changes stay scoped to the two Inkstone theme ids.

7. The September 5 structural follow-up adopts the prototype's 16px optical icons in the shared icon system, a model/mode/orchestration composer group, and ui-kit keyboard tabs with independently owned inspector panels. These shared primitives and the 640/720/840px readable-width choices also apply to alternative themes; Inkstone-specific surfaces and document styling remain scoped.
8. Appearance settings present the light/dark faces as visual previews with secondary expandable color editing. Settings theme rules belong to the deferred settings stylesheet, after its legacy region imports. Message memo policy, prop contracts, theme controls, theme catalog, and icon families are separate modules. See `docs/plans/2026-09-05-inkstone-structure-rebuild.md` for implementation and validation.

## Amendment (2026-09-08) — One Inkstone Theme, Two Faces

### Context

The previous amendment treated Paper and Inkstone Ink as separate selectable
theme ids. That made the theme library describe a visual mode as if it were a
different product theme, and it left the retired Deck/default entries visible
to users during upgrades.

### Decision

1. Inkstone is the sole built-in product theme identity: `piwin-inkstone`.
2. Paper and Ink are Inkstone faces selected by the existing appearance mode:
   system, paper/day, or ink/night. The settings page renders one Inkstone
   card and one Inkstone library entry.
3. Host theme storage and `theme/list` expose the canonical Inkstone package;
   the old default, Deck, and face ids remain read-compatible aliases but are
   hidden from the catalog and normalized on activation.
4. Ink Wash remains an independent optional theme package. It is the only
   bundled alternative shown beside Inkstone.

This keeps the product vocabulary aligned with the visual model while making
upgrades safe for existing `~/.piwin` theme preferences.
