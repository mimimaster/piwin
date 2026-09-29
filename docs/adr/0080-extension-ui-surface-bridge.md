# ADR 0080: Bridge Pi extension status, widgets and notices to piwin clients

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-09-27; ported to main 2026-09-29 from `feat/extension-registry` (numbered 0078 there) |
| Extends | [ADR 0011](./0011-rpc-sdk-fallback-and-prompts.md), [ADR 0047](./0047-managed-pi-extension-activation.md) |
| Related | [ADR 0077](./0077-github-extension-registry.md), [ADR 0081](./0081-declarative-extension-ui.md) |

## Context

Pi's `ExtensionUIContext` has two families of calls:

- **Dialogs** (`confirm`, `select`, `input`) — already bridged to Desktop and
  CLI through `extension/ui_request`.
- **Surface calls** (`notify`, `setStatus`, `setWidget`,
  `setWorkingMessage`) — stubbed as no-ops. `notify` was documented as working
  but the bridge never forwarded it.

Pi extensions from the registry use these calls to show state. Dropping them
makes a working extension look dead in piwin.

Extensions run in the Host, which can be remote and serve several clients at
once. UI therefore travels as data over `HostPush`; no extension code runs in
a client.

## Decision

1. **Contracts.** `ExtensionUiPort` gains optional `publish(update)`.
   `ExtensionUiSurfaceUpdate` carries `notify`, `status`, `widget` (text lines
   only) and `working-message`. `ExtensionUiSurfaceSnapshot` is the per-session
   state of statuses, widgets and the working message.
2. **agent-host** maps the Pi calls to `publish`. Widget component factories
   (TUI components) stay unsupported and are ignored. Text is stripped of ANSI
   escapes and capped (key, length, line and item counts). The stub theme's
   styling helpers return plain text so `theme.fg(...)` no longer throws.
   Worker mode relays updates with a fire-and-forget `extension-ui-publish`
   frame.
3. **host-runtime** owns `ExtensionUiSurfaceStore`: one snapshot per product
   session, reset when a new runtime generation is created (a replaced
   extension set must not leave stale status). Changes coalesce and push as
   `extension/ui_surface` with the full snapshot, so the push is idempotent for
   every client. `notify` is not state; it pushes `extension/ui_notice` once.
   `extension/ui_surface_get` returns the snapshot for a client that attaches
   late.
4. **Desktop** renders statuses as chips and widgets as text blocks above or
   below the composer, and notices as toasts. **CLI** prints notices and
   status changes as log lines. **Mobile** ignores both pushes for now.
5. **Slash commands.** Commands found by the static scan
   (`compatibility.capabilities.commands`) of enabled extensions are listed in
   the composer `/` menu under “Extension”. Selecting one sends `/<name> args`
   as a prompt; Pi executes the registered command. Reserved piwin command
   names win.

## Consequences

- Existing Pi extensions get visible state in piwin without code changes.
- `tui-widget` degradations for text widgets and `setStatus` are resolved. The
  static scan no longer counts `setStatus`, and counts `setWidget` only when
  its second argument is a component factory (arrow, `function`, `new …`);
  `setHeader`, `setFooter`, custom components, editor hooks and themes remain
  no-ops.
- Surface state is session-scoped and in memory. A Host restart clears it; the
  extension repopulates it when it runs again.

## Alternatives rejected

| Option | Why rejected |
|---|---|
| Push one message per `setStatus` call | Floods remote clients; not idempotent for late joiners |
| Keep state per client | Several clients would disagree; Host is the authority |
| Query live Pi commands from the runtime | Needs a new worker RPC for a menu; the static scan already has the names |
