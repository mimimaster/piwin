# @piwin/mobile

Tauri 2 Mobile shell for the remote Piwin Host.

This package intentionally contains no Node/Pi sidecar, terminal, MCP runner,
Skill executor, or direct filesystem access. The current screen is the first
remote Host slice: it connects through HostClient, reads the safe project and
session model, streams chat, resolves permissions, and uploads small images as
opaque Host assets. Pairing and secure credential storage are follow-up slices.

## Inkstone shell (UI-first)

The rendered shell is the Inkstone mobile UI transcribed 1:1 from
`docs/design/inkstone/proto-08-mobile.html` (see `docs/design/inkstone/09-mobile.md`).
It lives in `src/inkstone/` — theme tokens, phone shell, pages, bottom sheets, and a
local demo reducer ported from the prototype's interactions. This round is
intentionally UI-first: screens run on prototype data and make no Host calls.

The previous Deck implementation (`components/`, `surfaces/`, `hooks/`, legacy CSS)
is kept in place but not rendered; the follow-up pass wires the Inkstone screens to
the live host connection and then removes dead code.

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
