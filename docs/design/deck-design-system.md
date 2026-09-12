# Deck — desktop design system v1

Status: **Accepted** · Branch `feat/ui-deck` · Prototype: [`deck-shell-proposal.html`](./deck-shell-proposal.html)

Supersedes the visual layer of [Quiet Workbench](./desktop-foundations.md). Architecture
rules in `AGENTS.md` §1–§3 are unchanged: this is a presentation-layer change only.

Current product identity is the single **Inkstone** theme (`piwin-inkstone`),
whose paper and ink faces are selected by appearance mode. The Obsidian/Bone
ramps below are retained as legacy Deck compatibility references, not as
separate entries in the user-facing theme library.

---

## 1. Intent

Quiet Workbench recedes: one graphite field, hairline separators, ghost chrome. It is
calm but undifferentiated — the shell reads as a generic IDE pane stack, and every
surface carries the same visual weight, so nothing guides the eye.

**Deck** treats the shell as an *instrument you own*. Regions float as discrete cards
over a dark field. Depth comes from light, not lines. Chrome is precise and dense;
the transcript is generous and quiet. One accent means "you can act"; a second,
warmer signal means "the machine is working".

### Principles

1. **The transcript is the product.** Everything else is instrumentation that must not
   compete with it. Reading comfort beats density in the stage; density beats comfort
   everywhere else.
2. **Depth through light.** A floating surface is defined by a 1px top rim highlight and
   a dark outer hairline, not by a border. This is the single strongest "designed" cue.
3. **Motion is state.** Every animation reports something real about the agent. Nothing
   moves for decoration.
4. **One accent, two signals.** Iris = affordance / focus / primary action.
   Ember = the agent is running. Everything else is neutral.
5. **Numerics are monospace.** Token counts, durations, percentages, paths, and line
   numbers use tabular mono. It makes chrome look engineered and stops layout jitter.

---

## 2. Color

Two faces on one geometry. Inkstone is the product default; the Obsidian and
Bone ramps below document the legacy Deck palette.

### Roles

| Role | Meaning |
| --- | --- |
| `--void` | The field behind the deck; visible in the gaps between panels |
| `--surface-1` | Chrome panels — rail, sidebar, inspector |
| `--surface-2` | The stage / transcript canvas |
| `--surface-3` | Raised — composer, cards, tool rows, menus |
| `--surface-4` | Highest — dropdowns, tooltips, command palette |
| `--text-1…4` | Primary → disabled |
| `--line-1…3` | Subtle → emphasis strokes |

### Obsidian (dark)

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `--void` | `#08080B` | | `--text-1` | `#EDEDF2` |
| `--surface-1` | `#101014` | | `--text-2` | `#9A9AA8` |
| `--surface-2` | `#141419` | | `--text-3` | `#62626F` |
| `--surface-3` | `#1A1A21` | | `--text-4` | `#414150` |
| `--surface-4` | `#22222B` | | `--line-1` | `rgb(255 255 255 / .055)` |
| `--iris` | `#6E5DFF` | | `--line-2` | `rgb(255 255 255 / .09)` |
| `--iris-lift` | `#8B7CFF` | | `--line-3` | `rgb(255 255 255 / .15)` |

### Bone (light)

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `--void` | `#E5E2DC` | | `--text-1` | `#17161B` |
| `--surface-1` | `#F3F1ED` | | `--text-2` | `#5C5A66` |
| `--surface-2` | `#FBFAF8` | | `--text-3` | `#8B8896` |
| `--surface-3` | `#FFFFFF` | | `--text-4` | `#B4B1BC` |
| `--iris` | `#5B4BD6` | | `--line-1` | `rgb(20 18 30 / .06)` |

`--void` is a warm paper grey, not white: the gaps must read as *behind* the panels.

### State language

| Signal | Obsidian | Bone | Means |
| --- | --- | --- | --- |
| Iris | `#6E5DFF` | `#5B4BD6` | Affordance, focus, primary action, selection |
| Ember | `#FF8A4C` | `#DD6318` | **Agent is running** — the only warm hue in the UI |
| Mint | `#3ECF8E` | `#17A672` | Completed, added |
| Amber | `#F5B544` | `#C7860B` | Needs your input |
| Coral | `#FF5F56` | `#DC4438` | Failed, destructive |
| Sky | `#4CC2FF` | `#1A8FD0` | Subagent lane, waiting |

Ember is reserved. If ember appears anywhere the agent is not actively working, the
signal is broken.

---

## 3. Elevation

Never a plain `border`. Every raised surface composes three parts: an inset top rim
light, a dark outer hairline, and (from level 2) a drop shadow.

```css
--elev-1: inset 0 1px 0 rgb(255 255 255 / .05), 0 0 0 1px rgb(0 0 0 / .5);
--elev-2: inset 0 1px 0 rgb(255 255 255 / .06), 0 0 0 1px rgb(0 0 0 / .55),
          0 2px 8px -2px rgb(0 0 0 / .5);
--elev-3: inset 0 1px 0 rgb(255 255 255 / .07), 0 0 0 1px rgb(0 0 0 / .6),
          0 12px 32px -8px rgb(0 0 0 / .7);
--elev-4: inset 0 1px 0 rgb(255 255 255 / .08), 0 0 0 1px rgb(0 0 0 / .65),
          0 24px 64px -12px rgb(0 0 0 / .85);
```

| Level | Used by |
| --- | --- |
| 1 | Tool rows, chips, inputs, code blocks, search field |
| 2 | Deck panels, user message cards, plan cards |
| 3 | Composer, popovers, menus |
| 4 | Dialogs, command palette |

Code blocks invert the convention: they sit on `--void` and read as a *window into the
file*, not a raised card.

---

## 4. Geometry

| Radius | Value | Use |
| --- | --- | --- |
| `--r-chip` | 4px | Badges, inline code, tree rows |
| `--r-control` | 7px | Buttons, inputs, list rows, icon buttons |
| `--r-card` | 10px | Message cards, plan cards, code blocks |
| `--r-panel` | 14px | Deck panels, composer |
| `--r-overlay` | 18px | Dialogs, command palette |
| `--r-pill` | 999px | Status pills, gauges, dots |

Spacing scale (`--s-1…10`): `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40`.

Control heights: `--h-xs` 24 · `--h-sm` 28 · `--h-md` 32 · `--h-lg` 38.

Deck frame: `--deck-inset` 7px (window edge), `--deck-gap` 7px (between panels).

Columns: `--sidebar-width` 246 · `--right-panel-width` 320 · `--conversation-width` 760.

---

## 5. Typography

| Token | Size | Use |
| --- | --- | --- |
| `--fs-micro` | 10px | Section labels — uppercase, `600`, `0.09em` tracking, `--text-3` |
| `--fs-mono` | 11.5px | Paths, counts, durations, code — tabular, `0.01em` |
| `--fs-chrome` | 12.5px | All chrome: sidebar, buttons, tabs, status |
| `--fs-body` | 13.5px | Chrome that reads as sentences — notices, descriptions, card copy |
| `--chat-font-size` | 14.5px | Transcript prose, at `--chat-line-height` `1.68` |

Transcript prose does **not** size from `--fs-body`. It is a user preference: App writes
`--chat-font-size` / `--chat-line-height` inline from the Appearance setting, defaulting to
14.5px / 1.68. That default is a deliberate increase over the pre-Deck 13.5px/1.45 — sessions
run for hours and the stage is a reading surface that was set too tight. `--fs-body` keeps
the 13.5px step for the chrome rows that read as sentences rather than as labels.

**Micro-labels** are the signature chrome device. Uppercase, tracked, tiny, muted —
they mark every section (`ACTIVE`, `ASSISTANT`, `PLAN`, `WORKING TREE`) and are what
make the shell read as designed rather than assembled.

---

## 6. Motion

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);     /* movement, reveal */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);    /* breathing, loops */
--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);  /* press feedback only */
--t-1: 90ms;   --t-2: 150ms;  --t-3: 240ms;  --t-4: 380ms;
--breath: 2.4s;
```

| Duration | Use |
| --- | --- |
| `--t-1` | Press / release, icon swaps |
| `--t-2` | Hover, focus, tint changes |
| `--t-3` | Popovers, disclosure, theme flip |
| `--t-4` | Panel open/close, layout reflow |

### The Breath

One `@keyframes breath` at `--breath` drives every "alive" indicator — the run-state
dot, running tool glyphs, the active plan step, the live session node in the sidebar.
Because they share one animation name and duration, they pulse **in phase**. That
synchrony is the point; it makes the app feel like a single running system rather than
several independent spinners.

### The Ember Wash

While `html[data-run='running']`, a radial ember gradient bleeds up from behind the
composer and slowly cycles opacity over 4.8s. It is peripheral — never legible as a
shape, only as warmth. It is the ambient answer to "is it still working?" without
occupying any chrome.

All motion collapses to `0.001ms` under `prefers-reduced-motion: reduce`.

---

## 7. Layout — the Deck

```text
┌──┬─────────────┬───────────────────────────────┬──────────────┐
│  │ ⬤⬤⬤  ⊟ ← →  │  title · run state    theme   │  tabs        │ ← titleband overlays
│R │  project    │                               │              │   the columns' top
│A │  search     │                               │  inspector   │   strip; columns run
│I │  ───────    │        transcript             │  body        │   to the window top
│L │  ACTIVE     │        (measure 720)          │              │
│  │  ├─ session │                               │              │
│  │  ├─ session ├───────────────────────────────┤              │
│  │  EARLIER    │        composer (elev-3)      │              │
│  │  ├─ session ├───────────────────────────────┤              │
│  │             │  status strip · mono          │              │
└──┴─────────────┴───────────────────────────────┴──────────────┘
   ↑ each region is a separate floating card, 7px gaps, void behind
```

Changes from the current three-column grid:

1. **The titleband overlays the columns' top strip** rather than taking a grid row above
   them. The deck has no top inset, so every column runs to the window top and the 7px gap
   between them reads as one continuous seam from the top edge to the bottom — three
   columns, not a band stacked on three columns. The band itself has no fill, no radius and
   no elevation, so the window controls land on the sidebar's surface and the title lands
   on the stage's, each column's own colour showing through behind its own chrome.

   The geometry is forced, not stylistic. macOS pins the Overlay traffic lights to a fixed
   offset from the *window* top and `trafficLightPosition` is not honoured by the current
   tao build (verified: `y` 18 and 21 both render a centre 15.75px down). A row inset from
   the window top can never reach that line, so `--titleband-height` is twice the lights'
   centre offset and the band is flush with the window top.

   That hole is not a global layout constant. `data-window-chrome` on `<html>` selects
   the contract: `macos-overlay` (Tauri on macOS) sets `--traffic-light-clearance` to
   78px; `native-frame` (Windows/Linux packaged, OS titlebar) and `web` leave it at 0.
   Titlebands read `--titleband-leading` / `--titleband-flush-leading`. Do not paint
   fake traffic lights except as an invisible Overlay spacer.

   Two consequences worth keeping: the window controls are a single DOM node that never
   migrates between columns as the sidebar opens and closes, and the title's leading edge
   is held to the sidebar's live width so it starts at the stage column's edge instead of
   straddling the seam. Panels are square at the top for the same reason — macOS's own
   corner rounding is the only rounding that belongs at the window edge.
2. **No navigation rail.** An earlier revision of this deck called for a persistent 46px
   rail carrying top-level navigation, on the premise that collapsing the sidebar strands
   the user. It does not: the titleband's `rail-chats-btn` (`IconPanelLeft`) is full-width
   and always mounted, the command palette is a keystroke away, and `toggle-sidebar` /
   `search-sessions` / `open-settings` all have bindings. A rail was built against that
   premise and removed — four of its five buttons duplicated `sidebar-library-btn`,
   `sidebar-flashcards-btn`, the sidebar search row, and `settings-open-btn`, so the
   default state showed every top-level entry point twice and spent 53px of stage width
   serving a non-default one. Top-level navigation lives in the sidebar; collapse recovery
   lives in the titleband.
3. **Panels float** with 7px gaps over `--void`, instead of sitting flush with hairline
   dividers.
4. **The composer ends the stage chrome.** Per-turn duration, token, and cache metrics do
   not sit below it; detailed usage belongs in Settings → Usage instead of competing with
   the conversation.
5. **The composer is elevation 3 inside the stage**, over a gradient fade, rather than a
   bordered card flush to the bottom.

### Sidebar thread line

Sessions in a group hang off a single vertical hairline with a node per session. The
active session's node lights iris with a gradient segment above it; a live session's
node is ember and breathes. This replaces flat highlighted rows and makes session
lineage legible at a glance.

---

## 8. Implementation contract

- `apps/desktop` continues to consume only public `@piwin/*` APIs (`AGENTS.md` §1).
- `@piwin/ui-kit` stays renderer-pure; Mantine remains encapsulated behind it.
- No `HostCommand` / `HostPush` / `AgentEvent` changes. This is presentation only.
- **All `data-testid` attributes are preserved.** ~90 desktop test files depend on them.
- Existing region CSS consumes `--surface-*`, `--text-*`, `--accent`, `--line-*`. Because
  the runtime token authority (`appearance-tokens.ts`) is the single writer of those
  variables, replacing the token layer reskins every surface at once — including panels
  not hand-rebuilt in this pass.
- No file exceeds 1000 lines (`AGENTS.md` §3.2); region sheets split by responsibility.

## 9. Non-goals

- No Tailwind, CSS-in-JS, or replacement design system.
- No layout dimensions controlled by installed theme packages — geometry stays
  product-owned.
- No behavior changes bundled with the visual migration.

---

## 10. Migration state

There are two distinct levels of adoption, and the difference matters when
reading a screenshot:

**Recolored (all 78 stylesheets).** `apply-appearance.ts` emits 145 legacy
aliases (`--panel`, `--accent`, `--muted`, `--line-soft`, …) mapped onto the
Deck ramp. Every region therefore renders in Obsidian/Bone colors without being
touched. This is what makes the whole product reskin at once.

**Deck-native (78 of 78 stylesheets).** Every stylesheet has been hand-rebuilt
against the Deck scale directly: borders replaced by elevation, spacing on the
`--s-*` scale, motion on the shared cycle, semantic colors used for their one
assigned meaning. The shell, transcript, composer (frame + all leaves),
settings, inspector, knowledge/flashcard layers, auxiliary panels (subagent
inspector, browser session, usage, behavior/run activity, artifact, goal),
notes, conversation message, and history ticks are all through. (The file count
rose from 72 as large regions split by responsibility during their rewrite — see
each file's header comment for what moved where.)

Run the counter in "Verifying a rewrite" below — it should return **0** now
that every stylesheet reads Deck tokens directly.

### Migration complete

The legacy alias layer (`--panel`, `--muted`, `--accent`, …) still exists in
`apply-appearance.ts` for any third-party or un-audited CSS, but **no region
stylesheet reads those aliases anymore**. The alias block can be deleted in a
follow-up once the product has shipped on Deck for a release cycle.

### Composer leaves: same object language as the plus menu

The composer frame was already Deck-native; the six leaf files
(`composer-popovers`, `composer-interrupt`, `composer-attachments`,
`composer-steer`, `composer-context-rail`, `composer-ink-wash` active-jobs
strip) are now rewritten too. Decisions worth carrying forward:

- **Flyouts are surface-4 + elev-4.** Thinking-effort popover, branch picker,
  and context-usage popover match the plus-menu pattern from
  `composer-menus.css` — no borders, real elevation.
- **Interruptions are lids, not separate dialogs.** Steer queue and agent
  interruption dock snap to the top of the composer card with shared
  `surface-3` + `elev-1/2`; tone is a left inset stripe (iris / amber / coral),
  not a repainted surface.
- **Permission buttons use iris + coral, not hardcoded blue.** The pre-Deck
  rules pinned allow buttons to `#2563eb` regardless of theme; they now use
  `--iris` / `--iris-wash` for allow and `--coral` for deny.
- **Running jobs pulse ember, not accent.** Active-jobs strip dots use
  `--ember` for running state — same signal as the status bar and streaming
  caret.

### Goal mode: slash-only entry, truthful strip

Goal is not a toolbar picker. Agent is the resting composer mode; Goal is
armed by `/goal` (or `/goal <objective>`). While it is armed the composer
shows one exit chip (`GoalModeChip`); after the first turn a sticky strip
reports the real loop phase, derived from `goal_*` tool presentation rather
than from `streaming`.

| Phase | Signal | Colour |
| --- | --- | --- |
| running | the agent is working | ember, on the shared `breath` |
| waiting | parked on an external condition | sky, on `breath` |
| blocked | the model asked for a decision | coral, static |
| completed | acceptance criteria declared met | mint, static |

The round pill on the strip opens a timeline of those events. Abort cancels
the current run; Leave Goal exits the mode. They are not the same gesture.

### Transcript leaves: one card gets to break the recess rule

The transcript frame and its inline cards (tool calls, diffs, plans) were
already Deck-native; `transcript-markdown`, `transcript-files-changed`,
`transcript-message`, and `transcript-walkthrough` — the leaf stylesheets for
prose, the files-changed summary bar, message bubbles, and the walkthrough
artifact card — are now rewritten too. Two decisions worth carrying forward:

- **Code, tables, and diagrams recess; errors do not.** Every structured object
  a message can contain (fenced code, `.md-table-wrapper`, `.md-mermaid`) drops
  to the `--void` step with an inset `--line-1`, matching the doc-preview
  treatment in `inspector-code-preview.css`. `.turn-error-card-inner` and
  `.md-mermaid-error` are the deliberate exception — they lift onto a coral-
  tinted `--surface-2` instead, so a failure cannot be mistaken for settled
  output by reading the same as everything around it.
- **A callout's badge and its border must agree.** The pre-Deck rules changed
  `border-left-color` per callout type (`note`/`tip`/`warning`/`important`/
  `caution`) but left the background and badge text pinned to `--accent` for
  every type — a warning callout had an orange rule down its side and a purple
  badge. Each `.md-callout-*` variant now sets border, background tint, and
  badge color together from one semantic token (mint/amber/coral), mirroring
  `.enhanced-callout` in `inspector-markdown-doc.css`. `caution` and `important`
  both resolve to coral; the palette carries one red.

The streaming caret in `.markdown[style*='--streamdown-caret']` now uses
`--ember` instead of a hardcoded accent — same signal as `.stream-dot`, since
both only exist while the agent is actively producing tokens.

The legacy alias layer is the migration seam: a file is done when it stops
reading aliases, and the alias block can be deleted when the count reaches zero.

### Two mappings that had drifted

Worth knowing, because both produced wrong output rather than merely unmigrated
output:

- **`bg` means the field, not the first panel.** `deck-palette.ts` projects
  `void → bg` and `surface1 → panel`; `deck-derive.ts` used to read `bg` back as
  `surface1` and synthesise a darker void beneath it, sliding every layer down a
  step on the round trip. `deck-derive.test.ts` now pins the round trip.
- **Appearance defaults are the Deck faces.** `buildAppearanceTheme` re-derives
  the ramp from the three colors the settings page exposes, so those defaults
  *are* the shipped palette. They used to be pre-Deck VS Code values
  (`#EEEEEE` / `#007ACC`), which meant Bone rendered with a blue accent on a cold
  grey field and its authored palette was unreachable. They now read off
  `PIWIN_APPEARANCE_BONE` / `PIWIN_APPEARANCE_OBSIDIAN`. On load,
  `migrateStoredAppearanceTheme` upgrades users who still have the retired VS
  Code triple in localStorage onto the Deck faces without touching anyone who
  picked a custom accent.
- **`KnowledgeLibraryView.tsx` (the per-folder card gallery) had no CSS at
  all.** `.knowledge-library-grid` and friends were never styled; the grid
  rules that belonged to them existed under an orphaned name, `.doc-cards-grid`,
  that nothing rendered. Found while rewriting `region-doccards.css` — the
  audit script cannot catch a class that was *never* styled, only one that
  stops being styled, so this predates the Deck migration. Fixed by giving
  `.knowledge-library-grid` the same rule as `.doc-cards-grid` in
  `doccards-grid.css`.

### One name per token

`--mono` and `--font-mono` were two names for the same stack (a pre-boot
fallback in `tokens.css` and a runtime emit in `apply-appearance.ts`). The
runtime now emits `--font-mono` as the canonical name, pairing with `--font`,
and keeps `--mono` only in the legacy alias block.

### Tokens the un-migrated regions read

No region stylesheet still reads those never-defined aliases. `tokens.css`
keeps `--panel2`, `--text-secondary`, `--text-muted`, `--text-faint`,
`--shadow-sm`, and `--shadow-md` as a safety net for any third-party or
un-audited CSS; they resolve onto the Deck ramp and can be deleted once the
product has shipped a release on Deck.

### Verifying a rewrite

`apps/desktop/scripts/css-rewrite-audit.mjs` runs both checks that catch the
failure modes a screenshot will not:

- **Selector coverage.** Diffs the selector set of every stylesheet against
  `git show HEAD:<file>`. A Deck rewrite is a restyle, not a re-scope: every
  selector must still exist somewhere, or the markup that used it loses its
  styling silently. Deliberate drops (mode-specific patches the token ramp now
  handles) go in `DELIBERATE_SELECTOR_DROPS` with a reason.
- **Token resolution.** Confirms each `var(--x)` name is defined in
  `tokens.css`, emitted by `apply-appearance.ts`, or set in `ui-kit`. An
  undefined token is invisible in review — the declaration just does nothing.

To see how far the migration has got, count stylesheets with no remaining
alias reads:

```bash
cd apps/desktop/src/styles
rg -l "var\(\s*--(line-soft|panel|card|muted|accent|border|surface-hover|mono|faint|ok|danger|text|line|surface)\s*[,)]" *.css | wc -l
```

States that depend on live agent traffic (expanded tool body, pending diff
verdict, blocked permission gate, running plan step) are not reachable from the
mock host. They are reproduced as static markup in `src/e2e/primitive-gallery.tsx`
under the build-time-gated `#/e2e/primitives` route, so the Deck stylesheets for
those states stay under visual review in both Obsidian and Bone.
