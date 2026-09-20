# Pi Extensions in piwin

| Field | Value |
|-------|-------|
| Status | Living document |
| Related | [ADR 0010](../adr/0010-pi-extensions-channel.md), [ADR 0047](../adr/0047-managed-pi-extension-activation.md) |

piwin loads Pi Extensions into the **Agent Runtime**. They are TypeScript
modules. They are not Pi TUI plugins, and they do not restyle Desktop.

This guide documents the compatibility boundary. Settings → Extensions labels
each package (`compatible` / 仅 Pi 终端). CLI prints the summary from
`piwin extension list`, `piwin extension install`, and `piwin doctor`.

Static scan (no module execute) classifies extensions before Blueprint load.
Only **compatible** packages (tools / hooks / confirm|select|input|notify) are
enabled by default. Mixed TUI packages are **degraded** and TUI-only packages
are **incompatible**: they stay in the list as 仅 Pi 终端 and are not loaded.

## What works

- Extra tools the model can call (`pi.registerTool`)
- Lifecycle and tool hooks (`pi.on`, including `tool_call` intercepts)
- `ctx.ui.confirm` / `select` / `input` / `notify` (Desktop prompt or CLI TTY)
- Install from a local path or Git; enable, then apply at the current-run boundary

Bundled examples: `path-guard`, `questionnaire`, `goal`, `compact`
(Devin-style context compaction: every compact — tool, `/compact`, threshold,
overflow — writes `~/.piwin/compact/<session>/*.md`, returns a Devin `<summary>`
from `session_before_compact`, and re-injects edited files on the next turn).

## What does not work

These Pi APIs no-op or error. They do not change the piwin window:

- `ctx.ui.custom()`, widgets, header / footer, status
- Theme switching, keyboard shortcuts, Pi CLI flags
- Custom TUI rendering for messages, tool results, or Markdown
- Editor APIs, autocomplete, Pi TUI-only flows such as `!bash`
- Native `ctx.reload()` / `/reload` — use **Apply to current Agent** instead
- Extension slash commands are not listed in the composer `/` menu. Typing a
  known command name may still reach Pi.

npm packages that need `npm install` cannot be staged from a Git URL. `pi
install npm:<name>` may still load an Agent-runtime module after Refresh. A
package that exists to customize Pi's terminal will still not work here.

## Privilege

Enabled extensions run with the Host user's OS privileges. Permission rules
are not a sandbox. Only install sources you trust.
