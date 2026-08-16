# ADR 0052: Preview resource resolution and media read channel

| Field | Value |
|-------|-------|
| Status | Accepted; Slices 1–3 implemented |
| Date | 2026-08-16 |
| Related | ADR 0005, ADR 0019, ADR 0036, ADR 0037, ADR 0041 |
| Specification | [`../specs/preview-resource-resolution.md`](../specs/preview-resource-resolution.md) |

## Context

The right-panel Doc Preview has a single, text-only pipeline: every click funnels
into `handleOpenDocument`, which plans a route with `planDocumentOpenPath`
(`project | skill-legacy | legacy-absolute | relative-outside`) and reads through
`project/read-file` (text-only, registered-root + realpath containment) or
`skills/read`. Anything else becomes an `outside-project` unavailable card.

Generated images dead-end there. `image_gen` tool results expose absolute vault
paths (`~/.piwin/media/<sessionId>/<uuid>.jpg`); clicking a path pill classifies
as `legacy-absolute` and the user sees "无法预览 / outside-project" — even though
the bytes are piwin's own session assets and the local shell already has a legal
byte channel (Tauri asset protocol scoped to `$HOME/.piwin/media/**`).

Three structural gaps:

1. **No dispatch by resource kind.** Markdown, code, Skill docs, and binary
   media all enter the same text-preview pipeline.
2. **Read suffers write's sentence.** The project-root sandbox (correctly)
   guards `project/read-file`, but no other read domain exists, so *viewing*
   legitimately-owned assets fails.
3. **Remote hosts have no media bytes at all.** `media/save` is the only media
   IPC command. Remote projection rewrites vault paths to `remote-asset:<id>`
   refs and the Host remembers the id→path map — but no command returns bytes,
   and capabilities advertise no media download (ADR 0037 §4 stays unimplemented).

Prior art (VS Code / JetBrains / Claude Artifacts) converges on: dispatch by
resource kind, independent sandboxed renderers per kind, and defense focused on
*mutation* rather than *viewing*. Piwin adopts the shape, not the permissiveness:
VS Code can open any local file because it runs as a full-trust local editor;
piwin's reads cross a Host command boundary, and transcript path chips are
model-controlled, so "read anything read-only" would become a prompt-injection
primitive against remote / multi-client Hosts.

## Decision

### 1. Dispatch by store identity before channel selection

`planDocumentOpenPath` classifies a path into an additional `media` kind **by
store identity, not by file extension**: a path is media iff it is a piwin media
vault path (`~/.piwin/media/...`) or an opaque `remote-asset:<id>` ref. The Doc
Preview surface then selects a renderer (text viewer vs media viewer). Extension
sniffing decides *rendering* inside the media viewer, never read authority.

### 2. The media vault is a trusted read-only preview domain

- Local Desktop keeps using the Tauri asset protocol (scope
  `$HOME/.piwin/media/**`); no new local read surface is created.
- Remote clients get bytes through a new `media/read` Host command keyed by
  session + asset id (or a media-root-relative path), guarded by the media
  package's existing containment checks (`assertInsideMediaRoot`,
  realpath re-validation, session-id sanitization) and a byte cap. Host
  absolute paths are never accepted from remote clients.
- `project/read-file` stays exactly as strict as it is. New read domains get
  new commands with their own authority; no bypass flags on existing ones.

### 3. Outside-project text preview is narrowed to trusted domains

Read-only preview of non-project text is allowed only for paths inside piwin's
config-root domains (`~/.piwin/**`) plus registered project roots, rendered with
an explicit "项目外 · 只读" notice. Arbitrary host-filesystem reads stay
`outside-project`. If full VS Code-style opening is ever wanted, it must be
local-Host-only, user-gesture-gated, and confirmed per new root (Workspace-Trust
model) — a separate future decision.

### 4. Logical targets at the source

Tool presentations prefer `DocumentTargetRef` logical targets (including a
`media` variant: session + asset id) over raw absolute path pills, so click
entry points stop carrying host paths and remote projection stays consistent.

## Consequences

- Slice 1 fixes the reported local-Desktop pain with zero host changes:
  media-classified opens render in a media viewer via the existing asset
  protocol.
- Slice 2 (implemented) adds the `media/read` contract
  (contracts → media/host-runtime → host-server allowlist + `mediaRead`
  capability), the `DocumentTargetRef` media variant, host push-side
  registration of generated media refs for remote projection, and a desktop
  viewer path that fetches remote bytes via `media/read` into a data URL. A
  bare `remote-asset:<id>` path (no session identity) stays unavailable; the
  correct remote path is a structured media target.
- Slice 3 adds the trusted-domain read-only text channel.
  `preview/read-trusted-text` is addressed by a config-root-relative path
  only (never a host-absolute path). Host advertises `trustedTextPreview`,
  and Desktop renders with a `[项目外 · 只读]` badge. Media vault paths
  stay on `media/read` (`media-vault` reason if smuggled through the text
  command). `DocumentTargetRef.trusted-config` is the remote-safe click
  identity.
- Orchestration moved out of `App.tsx`: `hooks/use-active-document.ts` (doc
  preview) and `hooks/use-terminal-panel-state.ts` (terminal panel state).
  App.tsx is still over the 1000-line cap; extraction continues.
- Rejected alternatives: forging a project root via `dirname()` (historical bug,
  banned); a generic "read any path read-only" command (prompt-injection /
  remote info-exposure surface); loosening `project/read-file` guards (the
  command's authority is its registered root, full stop).
