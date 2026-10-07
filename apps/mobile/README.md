# @piwin/mobile

Tauri 2 Mobile shell for the remote Piwin Host.

This package intentionally contains no Node/Pi sidecar, terminal, MCP runner,
Skill executor, or direct filesystem access. The current screen is the first
remote Host slice: it connects through HostClient, reads the safe project and
session model, streams chat, resolves permissions, and uploads small images as
opaque Host assets. Pairing and secure credential storage are follow-up slices.

## Two interfaces

The shell bundles two front ends (ADR 0084):

- **Default** — the responsive workbench from `apps/desktop` (shell-only
  build), served at `/`.
- **Classic** — the Inkstone interface in this package, served at `/classic/`.
  Frozen: crash fixes only.

`pnpm --dir apps/mobile build:shell` assembles both into `dist/`; it is the
Tauri `beforeBuildCommand`. Switch in Settings → General → 界面模式 (default) or
案头 → 界面模式 (classic). `pnpm dev` / `ios:dev` still serve classic alone.

Device capabilities are shared by both interfaces and live in
`@piwin/host-client`: pairing-code parsing, the Keychain credential vault, the
client-tool runtime and the HealthKit bridge (`device-tools/`). This package
only binds them to the shell's Tauri `invoke`.

## Inkstone shell (classic)

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

The native iOS shell targets iOS 15 or later, matching its Swift plugins.
Tauri and the Xcode template must use the same minimum version. After building,
run `pnpm verify:mobile-ios-runtime` from the repository root: it rejects the
obsolete bundled concurrency runtime that conflicts with ActivityKit.

After Xcode/Android Studio prerequisites are available, generate the Tauri
platform projects:

    pnpm --dir apps/mobile ios:init
    pnpm --dir apps/mobile android:init

The generated src-tauri/gen/ directory is local build output and is ignored by
the repository. Do not add desktop sidecar resources or external binaries to
this app.

## Live voice and Dynamic Island

On iOS 17+, locally owned Live calls expose status, elapsed time, mute, end,
and return-to-session controls through a Live Activity. Session titles are
omitted from the lock-screen card. The generated Xcode project embeds the
`PiwinLiveActivityExtension` widget target; regenerate with `ios:init` after
updating the native project template.

Grok/OpenAI Realtime PCM runs through native iOS audio and an authenticated
native socket. The audio background mode applies only while a user-started
call owns the audio session. Codex WebRTC and Gemini remain foreground media
paths. Host task admission and permission handling may wait until the shell
resumes. Lock-screen recording and Bluetooth behavior require true-device
acceptance. See ADR 0085 for ownership, privacy and verification boundaries.
