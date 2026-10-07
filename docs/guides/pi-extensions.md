# Pi Extensions in piwin

| Field | Value |
|-------|-------|
| Status | Living document |
| Related | [ADR 0010](../adr/0010-pi-extensions-channel.md), [ADR 0047](../adr/0047-managed-pi-extension-activation.md), [ADR 0077](../adr/0077-github-extension-registry.md), [ADR 0080](../adr/0080-extension-ui-surface-bridge.md), [Extension registry guide](./extension-registry.md) |

piwin loads Pi Extensions into the **Agent Runtime**. They are TypeScript
modules. They are not Pi TUI plugins, and they do not restyle Desktop.

This guide documents the compatibility boundary. Settings → Extensions labels
each package (`compatible` / 仅 Pi 终端). CLI prints the summary from
`piwin extension list`, `piwin extension install`, and `piwin doctor`.

Static scan (no module execute) classifies extensions before Blueprint load.
Only **compatible** packages (tools / hooks / dialogs / notify / status) are
enabled by default. Mixed TUI packages are **degraded** and TUI-only packages
are **incompatible**: they stay in the list as 仅 Pi 终端 and are not loaded.

For a verified end-to-end install walkthrough, see
[安装 Pi 扩展：以 cc-safety-net 为例](./install-pi-extension.md).

## What works

- Extra tools the model can call (`pi.registerTool`)
- Lifecycle and tool hooks (`pi.on`, including `tool_call` intercepts)
- `ctx.ui.confirm` / `select` / `input` (Desktop prompt or CLI TTY)
- `ctx.ui.notify` (Desktop toast, CLI log line)
- `ctx.ui.setStatus`, text `ctx.ui.setWidget(key, string[])`, `setWorkingMessage`
  (Desktop chips and text blocks around the composer, CLI log lines; ADR 0080)
- `pi.registerCommand` names appear in the composer `/` menu under Extension
- `ctx.ui.theme` styling helpers return plain text instead of throwing
- Install from the extension registry, a local path or Git; enable, then apply
  at the current-run boundary ([registry guide](./extension-registry.md))

Bundled examples: `path-guard`, `questionnaire`, `goal`.

## What does not work

These Pi APIs no-op or error. They do not change the piwin window:

- `ctx.ui.custom()`, component-factory widgets, header / footer
- Theme switching, keyboard shortcuts, Pi CLI flags
- Custom TUI rendering for messages, tool results, or Markdown
- Editor APIs, autocomplete, Pi TUI-only flows such as `!bash`
- Native `ctx.reload()` / `/reload` — use **Apply to current Agent** instead
- Component-factory widgets (`setWidget(key, (tui, theme) => …)`); the static
  scan marks those as degraded, while text-line widgets stay compatible.

Porting a TUI-heavy extension: see the public developer guide
`apps/docs/docs/extension-development.md` (docs.piwinwin.com).

npm packages that need `npm install` cannot be staged from a Git URL. `pi
install npm:<name>` may still load an Agent-runtime module after Refresh. A
package that exists to customize Pi's terminal will still not work here.

## Compaction extensions

An extension that hooks `session_before_compact` replaces Pi's built-in summary
(the trigger timing stays Pi's). When several enabled extensions hook it, piwin
runs them as a first-wins chain instead of Pi's "last result wins":

1. Bundled extensions first. `pi-deepseek-cache` only takes the compaction on a
   DeepSeek model and declines otherwise.
2. User-installed extensions next, in load order.
3. Pi's default summary when nobody takes it.

An extension that already took the compaction stops the chain, so the others
do not spend a summarization request. See
`packages/agent-host/src/compaction-hook-priority.ts`.

## Privilege

Enabled extensions run with the Host user's OS privileges. Permission rules
are not a sandbox. Only install sources you trust.
