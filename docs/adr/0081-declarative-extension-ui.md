# ADR 0081: Declarative extension UI panels (proposed)

| Field | Value |
|-------|-------|
| Status | **Proposed** — design only, not implemented |
| Date | 2026-09-27 |
| Extends | [ADR 0080](./0080-extension-ui-surface-bridge.md) |

## Context

ADR 0080 maps Pi's existing text calls (status, widgets, notices) to piwin
clients. Extensions that want richer UI — a form, a table, buttons that call
back into the extension — have no path today. Pi's own rich path is TUI
components (`ctx.ui.custom`, component widgets), which cannot run in a React
or native client.

## Proposal

1. **UI as data.** An extension describes a panel as a JSON tree of a small,
   closed node set: `stack`, `text`, `markdown`, `keyValue`, `table`,
   `progress`, `button`, `textField`, `select`, `checkbox`. Nodes carry stable
   `id`s. No HTML, no script, no styles beyond a `tone` enum.
2. **Transport.** Host keeps panels in the ADR 0080 surface snapshot
   (`panels: { key, title, placement, tree }[]`). Clients render with
   `@piwin/ui-kit`. User actions return through a new
   `extension/ui_action { sessionId, panelKey, nodeId, value? }` command, which
   the Host delivers to the owning runtime generation.
3. **Extension API.** agent-host adds `ctx.ui.piwin` (feature-detected):
   `setPanel(key, tree | undefined, options)` and `onAction(key, handler)`.
   The same extension still loads in plain Pi, where `ctx.ui.piwin` is absent.
4. **Manifest.** `package.json#piwin.ui` declares panels and placements so the
   registry and the compatibility scanner can show "has piwin UI".
5. **Clients.** Desktop and Mobile render the node set; CLI prints a text
   projection and accepts no actions.

## Open questions

- Validation limits (tree depth, node count, update rate).
- Whether actions may be delivered while a Run is streaming.
- A sandboxed HTML panel (artifact iframe + CSP + postMessage) as a later
  escape hatch for charts; not part of this ADR.
