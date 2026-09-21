# ADR 0052: Preview resource resolution and media read channel

| Field | Value |
|-------|-------|
| Status | Accepted; Slices 1–4 implemented |
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

### 5. A missed path is resolved, never guessed

Messages name files the way people do (`shot.png`), and unlike structured
targets those chips carry no directory. Failing such an open with `not-found`
contradicts what the user sees in the file tree, so the miss is resolved
through a dedicated Host command instead of trusting — or rejecting — the raw
text.

- New command `project/find-file` `{ projectPath, query }`: a **bounded** walk
  of one registered browse root (`requireBrowseRoot`, so remote clients still
  cannot name a root; `..` is rejected). It reuses the file tree's ignored
  directories, never follows symlinks, caps visited entries, matches by
  basename — or by path suffix when the query contains `/` — and reports
  `truncated` when a budget stopped it early.
- The command returns **candidates, not a verdict**. `unique` requires a
  complete walk with exactly one match; several matches surface as
  `ambiguous-file` in Doc Preview ("pick one from the file tree"), and an
  incomplete walk resolves nothing at all. The Host never picks a file.
- Desktop uses the same resolver for Reveal: an absent chip path is no longer
  passed to the native command, whose fallback opened the *parent* folder
  (silently landing the user in the project root). It now retries the resolved
  path and otherwise says the path holds no file.
- Markdown chips in Doc Preview / file tree carry the project root, so
  relative chips resolve to absolute paths for Reveal / Save As exactly like
  the conversation surface.
- A chip can also carry the *absolute* path of a workspace file through another
  form of the same folder (`/tmp/proj/a.md` while the registered root is
  `/private/tmp/proj`, or a symlinked checkout). Those opens used to go to the
  local-Host ingest channel (`preview/read-local-file`), which a remote client
  can never send — so a file that exists failed as `not-found`. Desktop now
  retries such a chip inside the project when the path's trailing segments
  after the root's folder name name a workspace file. An unrelated absolute
  path is never force-mapped onto the project.
- A registered root whose directory is gone (acceptance workspaces under
  `/tmp`, cleaned by the OS) answers `project-root-missing` instead of letting
  every file inside report `not-found`. Desktop renders that as its own
  reason ("工作区目录已不存在"), because blaming the file sends the user
  looking for the wrong problem.

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
  correct remote path is a structured media target. Generated video that
  exceeds the Host wire cap uses `offset`/`length` slices on the same
  command; live `tool/end` attachments project to `remote-asset:<id>` like
  resume. `<video>` never uses a raw `asset:` URL (no Range).
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
- Slice 4 (implemented) is the user-gesture + local-Host path called out
  above: clicking any host path the UI can render (`/tmp/shot.png`,
  `/tmp/notes.md`, a project PNG) previews it via `preview/read-local-file`.
  Images land in the session media store and reuse the Slice 1 media viewer;
  text opens read-only in Doc Preview. Remote clients cannot send this
  command. Files that cannot be rendered fail with `binary` / `not-found` /
  `too-large`, never `outside-project`.
- Slice 5 (implemented) resolves a path a message wrote incompletely:
  `project/find-file` plus the `ambiguous-file` Doc Preview reason. It adds no
  read authority — the walk is confined to an already-registered browse root —
  and never opens a file it cannot prove is the one the message meant.
- The docked Document tool surface forwards the whole document state
  (reason / suggestion / size / provenance). Before that it could only say
  "Preview unavailable", which made a resolvable path look like a broken app.
- Rejected alternatives: forging a project root via `dirname()` (historical bug,
  banned); a generic "read any path read-only" command (prompt-injection /
  remote info-exposure surface); loosening `project/read-file` guards (the
  command's authority is its registered root, full stop).
