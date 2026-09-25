# @piwin/mobile

Tauri 2 Mobile shell for the remote Piwin Host.

This package intentionally contains no Node/Pi sidecar, terminal, MCP runner,
Skill executor, or direct filesystem access. The current screen is the first
remote Host slice: it connects through HostClient, reads the safe project and
session model, streams chat, resolves permissions, and uploads small images as
opaque Host assets. Pairing and secure credential storage are follow-up slices.

## Inkstone shell

The rendered shell is the Inkstone mobile UI (visual source:
`docs/design/inkstone/mobile/`). It is a thin Host client: every screen reads
Host commands and pushes, and every action is a Host command. Nothing is
executed or inferred on the phone.

- `src/inkstone/transcript/` — turn projection (one head per Host run, ink-line
  work fold with thinking / tools / interventions), on-demand tool output
  (`session/tool-output`), permission seals, questionnaire cards
  (`extension/ui_request` → `extension/ui_resolve`).
- `src/inkstone/host/` — per-session live state (context occupancy, queued
  turns and interventions, plan / todo, change summaries).
- `src/inkstone/settings/` — settings sections backed by `settings/get` /
  `settings/apply` and the matching list commands.
- `src/hooks/mobile-offline-cache.ts` — the only device-side copies: the last
  Host session list (read-only stand-in while the Host is unreachable) and
  per-session composer drafts, both keyed by Host endpoint. Credentials never
  go to localStorage.

Execution plan and status: `docs/plans/2026-09-25-mobile-shell-host-parity.md`.

## Web development

From the repository root:

    pnpm --dir apps/mobile dev

## Typecheck and build

    pnpm --dir apps/mobile typecheck
    pnpm --dir apps/mobile build

## Native setup

After Xcode/Android Studio prerequisites are available, generate the Tauri
platform projects:

    pnpm --dir apps/mobile ios:init
    pnpm --dir apps/mobile android:init

The generated src-tauri/gen/ directory is local build output and is ignored by
the repository. Do not add desktop sidecar resources or external binaries to
this app.
