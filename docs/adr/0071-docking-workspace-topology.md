# ADR 0071: Docking workspace topology (v1)

- Status: accepted
- Date: 2026-09-15
- Supersedes (Desktop presentation): the 8-pane recursive tree and primary-pane privilege in [ADR 0063](./0063-conversation-multi-pane-workspace.md)
- Product spec: [docs/specs/2026-09-15-docking-workspace-product.md](../specs/2026-09-15-docking-workspace-product.md)

## Context

ADR 0063 shipped a recursive binary split tree with a privileged primary pane
and an 8-leaf ceiling. Product v1 requires a Group/View model, a hard cap of
four stage groups, two-level topology, session/tool views that can move, and
no dual-write with the v1 pane engine.

The product spec referenced `0063-docking-workspace-topology.md`; that filename
was never created. This ADR is the topology decision. ADR 0063 remains the
authority for Host session identity, device-local storage, and "close view ≠
stop run".

## Decision

1. Desktop owns a two-level stage tree of **groups**. Each group holds ordered
   `viewIds` plus `activeViewId`. Views are session or movable tool instances
   (`browser` / `changes` / `canvas` / `doc`). A session has at most one
   editable view per window.
2. Stage group count is hard-capped at **4**. Depth > 2 is illegal. Templates
   are single, columns, rows, and quad. Three-pane layouts arise only from
   drag. Growing a template never auto-creates a fifth group.
3. Stored split `ratio` is a user weight. Viewport constrain must not rewrite
   it. Display allocation applies min sizes (session 420×320) without persisting
   the squeezed ratio.
4. Right panel is one group in v1 and never accepts session views. Feature flag
   `piwin.desktop.dockingWorkspace.enabled` (default on this branch) selects
   the new engine. When enabled, the conversation-pane v1 engine does not write
   storage.
5. Schema v2 migrates conversation-pane v1: legal ≤4 trees convert in place;
   5–8 leaves become a quad with leftover sessions as tabs on group 4; raw v1
   JSON is backed up once. Transient maximize / right-tool expand / focused
   presentation are not persisted.
6. Triple identity stays orthogonal: focused view, session target, tool binding.
   Closing the session target does not silently retarget. Live subscriptions
   stay within the existing 8-stream budget; no new Host pause protocol.
7. Implementation lives under `apps/desktop/src/workbench/docking/` as pure
   policy + a Desktop surface. Apps still must not import Pi packages.

## Consequences

- Old 8-pane presets and primary-pane-only close protection are gone when the
  flag is on.
- Slice A still requires a Tauri WebView anti-reparent soak (20 cross-dock
  moves) before treating browser/canvas hosts as done.
- Terminal move and right-panel dual groups stay out of v1 (slices F/G).

## Rejected alternatives

- Keep the ADR 0063 binary tree and add tabs later — tabs and 4-cap would fight
  the leaf=session model.
- Dockview / React Mosaic as the source of truth — product topology is tighter
  than those frameworks; Pragmatic DnD is the interaction layer, not the model.
- Dual-write v1+v2 storage — forbidden by the product spec.
