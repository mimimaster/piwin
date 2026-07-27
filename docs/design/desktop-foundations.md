# Desktop UI Foundations

## Intent

piwin is a focused native-feeling coding workspace, not a marketing surface or
a collage of other agent products. The transcript is the primary working area;
navigation and inspection tools stay quiet until the user needs them.

## Quiet Workbench (current product chrome)

The live desktop shell targets the **Quiet Workbench** visual language:

| Resource | Role |
| --- | --- |
| [`quiet-workbench-proposal.html`](./quiet-workbench-proposal.html) **v2.3** | Interactive prototype (pixel / interaction source of truth) |
| [`docs/plans/2026-07-27-quiet-workbench-implementation.md`](../plans/2026-07-27-quiet-workbench-implementation.md) | 1:1 implementation spec + W1–W4 work packages |

Hard rules from that program (do not regress):

1. **No-frame chrome** — icon buttons ghost by default; borders only on composer card, menus, dialogs.
2. **One graphite field** — sidebar / stage / titleband / right panel share the same surface; hairline separators only.
3. **Work panel toggle on titleband** (not context bar); directory home → drill, never auto-expand on terminal output.
4. **Assistant is document flow** (no bubble); user may keep a soft accent bubble.
5. **Motion = state only**; honor `prefers-reduced-motion`.
6. **No transcript edge mini-nav** scale rail.

When this file and the prototype conflict, **v2.3 prototype + quiet-workbench implementation plan win**, then update this foundations note.

## Visual direction

- Neutral graphite surfaces with restrained depth and no decorative glass.
- One system-blue action color. Semantic green, amber, and red communicate
  state only.
- Compact controls, clear text hierarchy, and keyboard-visible focus states.
- Flat panel anatomy: header, optional toolbar, content, optional footer.
- Motion is limited to state changes and disclosure; reduced-motion disables it.

## Desktop scale

| Token | Value | Use |
| --- | --- | --- |
| `--radius-control` | 6px | buttons, inputs, list rows |
| `--radius-surface` | 8px | cards, compact panels |
| `--radius-overlay` | 12px | menus, dialogs |
| `--control-height-compact` | 28px | icon and dense controls |
| `--control-height-default` | 32px | normal controls |
| `--control-height-large` | 36px | primary list rows/actions |

## Component ownership

`@piwin/ui-kit` owns shared component behavior and visual contracts, backed by
Mantine. Desktop domain components own their layout and host-derived data but
must not recreate buttons, fields, menus, dialog chrome, list-row selection,
or status treatment.

The UI kit remains renderer-only: it must not import Tauri, host, Pi, network,
or filesystem APIs.

## Non-goals

- No large gradients, translucent glass, or shadow-heavy cards in normal work.
- No theme-controlled layout dimensions.
- No product behavior changes as part of a visual migration.
- No direct Mantine use in feature components; the public boundary is
  `@piwin/ui-kit`.
