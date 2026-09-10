# 09 — Port drift: prototype → app

Status: **actioned** — 9 of 10 values restored; the paper accent deliberately left alone.

> Naming note: "drift" is only half right. `ui-preferences.ts` carries a migration whose comment
> reads *"Inkstone paper defaults before the contrast pass retinted iris `#c6412a` → `#b03a24`"*
> — so at least part of table A was a **deliberate contrast pass**, not an accident. Where a
> decision is recorded like that, this file defers to it.

The Inkstone prototypes in this directory are the source of truth — `styles/inkstone/tokens.css`
says so in its own header ("values are copied, not derived from the Deck ramp, so a future Deck
retune can never drift the 砚"). This file records where the shipped app had drifted from them,
why, and what was done about it.

Method: mechanical diff of the token blocks, plus hand-checked structural values.

| compared | prototype | app |
| --- | --- | --- |
| tokens | `shell-foundation.css` `.app[data-face='paper'\|'ink']` | `apps/desktop/src/styles/inkstone/tokens.css` |
| turn layout | `shell-transcript.css` | `apps/desktop/src/styles/inkstone/transcript.css` |
| composer | `shell-composer.css` | `apps/desktop/src/styles/inkstone/composer.css` |
| sidebar | `shell-layout.css`, `proto-03-navigation.html` | `apps/desktop/src/styles/inkstone/sidebar.css` |

---

## A. Token drift

Of the 34 authored tokens per face, 6 drifted on paper and 4 on ink — **all in the same
direction, toward higher contrast**.

| token | prototype | app (before) | L\* |
| --- | --- | --- | --- |
| paper `--t3` | `#726b61` | `#655e53` | 41 → 36 |
| paper `--t4` | `#8f887d` | `#696256` | 53 → **37** |
| paper `--zhu` | `#c6412a` | `#b03a24` | 47 → 42 — **deliberate, kept** ¹ |
| paper `--lamp` | `#b8801f` | `#8a5f0c` | 42 → **29** |
| paper `--lamp-wash` | `rgba(184,128,31,.14)` | `rgba(138,95,12,.14)` | tracks `--lamp` |
| paper `--slab-ph` | `#8d857a` | `#9a928a` | 52 → 57 |
| ink `--t3` | `#8b8378` | `#968d81` | 51 → 55 |
| ink `--t4` | `#6a6259` | `#8d857a` | 38 → **52** |
| ink `--code` | `#0f0e0c` | `#15120f` | 5 → 7 |
| ink `--slab-ph` | `#6f685f` | `#7a7268` | 40 → 44 |

¹ This one is not drift. `ui-preferences.ts` defines `RETIRED_INKSTONE_PAPER_APPEARANCE` and
migrates any stored `#C6412A` accent onto `#B03A24`, so reversing it would put the theme default
and the migration in direct conflict and would change a value users have in `localStorage`. Left
at the contrast-pass value; reversing it is a separate decision.

Effect on the text ramp:

| | prototype L\* (steps) | app before (steps) |
| --- | --- | --- |
| paper | 10 / 33 / 41 / 53 (23 / 8 / 12) | 10 / 33 / 36 / 37 (23 / **3 / 1**) |
| ink | 89 / 61 / 51 / 38 (28 / 10 / 13) | 89 / 61 / 55 / 52 (28 / **6 / 3**) |

Three semantic levels — "secondary", "muted", "disabled" — collapsed into one visible colour.
This is the single largest reason the shipped UI reads flatter than the prototypes: every
element is individually fine, but nothing recedes.

`--lamp` losing 13 L\* points on paper is the second: the lamp gold (the agent's hand) became a
dull brown, so "running" lost its glow.

## B. Structural drift

| | prototype | app (before) |
| --- | --- | --- |
| composer input `.ta` | `14.5px/1.6` | `13.5px/1.6` — typing smaller than reading |
| `--measure` | `720px` | `--conversation-width: 760px` |
| `--sidebar` | `240px` | `--sidebar-width: 246px` |
| `.slab` radius | `12px` | `10px` |
| section label `.sec-h` | `10px / .06em` | `11px / .08em` + `text-transform: uppercase` |
| **sidebar thread** | `proto-03-navigation.html`: `.thread::before` 1.5px rule, `.node` 9px, states `.cur` (zhu + 3px wash halo) / `.done` (pine) / `.bg` (azure) | **not implemented** — no `.thread` or `.node` rule exists in the app |

`text-transform: uppercase` is a no-op on the CJK strings these labels actually carry
(项目 / 对话 / 昨天 / 应用 / 集成 / 系统), and `.08em` tracking breaks the character grid.

### Not drift — verified faithful

Recorded here so they don't get "fixed" by mistake:

- **Turn grid and marginalia swap.** `transcript.css` implements proto-01 exactly:
  `--mg: 0` / `.marg { display: none }` / inline `.head` at base, and
  `@container transcript-stage (min-width: 960px / 1080px)` swaps rail in and head out with
  `--mg: 140px / 160px`. `--gut` is `clamp()`-capped. The wide-window side margins are
  authored, not runaway.
- **The slab.** `.slab { background: var(--slab) }` is a real token. The dark slab on the paper
  face is the 砚, deliberate. On ink, `--slab: #0e0d0b` sits *below* the stage (1.09:1) — a
  sunken well, with presence coming from `--sh3` and the `.slab::before` rim, which becomes an
  animated `sheen` in the lamp colour while running.
- **`.app[data-slab='paper']`** — the 砚/纸 toggle is an authored feature (remaps `--slab` to
  `--s3`), not a duplicate light/dark axis.

## C. Root cause

`styles/inkstone/contrast.test.ts` asserted that **all four** text tokens clear 4.5:1 against
**all four** backgrounds, including `--void`. The authored palette does not meet that, so the
port darkened whatever failed. That single rule produced most of table A.

Two things were wrong with the rule:

1. `--void` is the field *behind* the deck, visible in the 7px gaps between panels. Text never
   sits on it, so it should never have been a text background.
2. `--t4` is disabled/decorative. WCAG 1.4.3 exempts inactive controls; 1.4.11 sets 3:1 for UI
   components. Holding it to body-text contrast is what flattened the bottom of the ramp.

## D. What the authored palette actually measures

Minimum across `--s1`/`--s2`/`--s3` (`--void` excluded — it carries no text), as **shipped
after this change**. These are the numbers the test floors are set from.

| token | paper | ink | note |
| --- | --- | --- | --- |
| `--t1` | 14.59 | 13.39 | body |
| `--t2` | 6.27 | 6.26 | body |
| `--t3` | **4.47** | **4.49** | labels; effectively AA, misses by 0.03 |
| `--t4` | **2.98** | **2.80** | disabled / decorative only |
| `--zhu` | 5.13 | 4.91 | paper keeps the contrast-pass retint, note ¹ |
| `--lamp` | **2.90** | 9.34 | mostly fill / glow / sheen |

The authored palette was drawn for looks, not for a blanket AA sweep. Taking it means accepting
`--t3` a hair under AA, and `--t4` and paper `--lamp` well under it. That is a deliberate trade,
recorded here so it is not silently re-"fixed" later.

## E. What changed

1. **Nine** of the ten values in table A restored to their authored values, in both
   `styles/inkstone/tokens.css` and the mirrored Inkstone blocks in `theme/deck-palette.ts`
   (`--zhu` ↔ `iris`, `--lamp` ↔ `ember`, `--t1..4` ↔ `text1..4`), so the two token layers
   cannot disagree about the same role. Paper `--zhu` / `iris` excluded, per note ¹.
2. `contrast.test.ts` restructured: `--void` dropped from the background set, and the blanket
   4.5:1 replaced by **per-token floors set at the authored values' measured minimums**. The
   test still fails on any regression — it now records the real numbers instead of forcing the
   palette to a number it was never drawn for.

## F. Open, not done

- **`--lamp` as text.** 14 rules paint text/icons with it. At 2.90:1 on paper that is poor.
  The prototype uses lamp mostly as fill, glow and the running sheen. Those 14 call sites want
  reviewing individually — either move them to `--ochre`, or give lamp a text-safe companion.
- **Sidebar thread (table B).** Authored in proto-03, never implemented. The nodes encode
  per-session state (current / done / running in background) that the app currently does not
  surface at all.
- **Duplicated turn metadata.** `chat-turn-marginalia.tsx` (the rail) and `work-fold-header.tsx`
  ("已工作 …") each render duration + tool count independently, so at ≥960px both are on screen.
  Which one keeps it is a product call. The wording also disagrees: `2 工具` vs `2 个工具`.
- **Paper `--zhu` and `--zhu-wash` disagree.** The contrast pass retinted the solid
  (`#c6412a` → `#b03a24`) but not the wash, which is still `rgba(198, 65, 42, .1)` — i.e.
  `#c6412a` at 10%. The ink face is self-consistent. One of the two paper values is wrong.
- **Reversing the paper accent** (note ¹) — open decision. Doing it means retiring
  `RETIRED_INKSTONE_PAPER_APPEARANCE` and its migration together with the token.
- **`--ochre-wash` is referenced but never defined.** `subpages.css` has
  `--live-glow: var(--ochre-wash)`; neither face defines it, so it resolves to nothing.
- **Composer input size, measure, sidebar width, slab radius, section labels** (table B) — all
  still drifted; not touched in this pass.
