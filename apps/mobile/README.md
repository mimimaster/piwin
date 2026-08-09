# @piwin/mobile

Tauri 2 Mobile shell for the remote Piwin Host.

This package intentionally contains no Node/Pi sidecar, terminal, MCP runner,
Skill executor, or direct filesystem access. The current screen is the first
remote Host slice: it connects through HostClient, reads the safe project and
session model, streams chat, resolves permissions, and uploads small images as
opaque Host assets. Pairing and secure credential storage are follow-up slices.

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
