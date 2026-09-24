# Preview Resource Resolution — Spec

Status: Slices 1–6 implemented.
ADR: [`../adr/0052-preview-resource-resolution.md`](../adr/0052-preview-resource-resolution.md)

## Problem

Clicking a generated-image path (`~/.piwin/media/<sessionId>/x.jpg`) in the
transcript opens the right-panel Doc Preview and fails with
`outside-project`. Root cause chain: single text-only pipeline →
`project/read-file` root containment → no other preview domain.

## Resource dispatch matrix

| Resource | Identity | Read channel | Renderer |
|----------|----------|--------------|----------|
| Project file (text) | registered root + relative path | `project/read-file` | Markdown / code viewer |
| Project file (binary image) | registered root + relative path | Slice 4 `preview/read-local-file` (local) | media viewer |
| Skill doc | `skillId` | `skills/read` (+ `session/tool-output` snapshot) | Markdown viewer |
| Media vault asset | vault path or `remote-asset:<id>` | local: Tauri asset protocol; remote: `media/read` (Slice 2) | media viewer (zoom / video) |
| Trusted config-root text | config-root-relative path | `preview/read-trusted-text` | text viewer + `[项目外 · 只读]` |
| Local clicked file | host-absolute path + user click | Slice 4 `preview/read-local-file` (local Host only) | media viewer or text |
| Anything else | — | none | unavailable with a real reason (`not-found` / `binary` / `too-large`) |

Classification rule: **store identity, not extension**, decided by the Host
(Slice 6). `preview/resolve-path` returns `kind: 'media'` iff the path is in
this Host's media root (or the conventional `~/.piwin/media/`), never by
extension. The media viewer may use extensions/MIME to pick image vs video
*rendering*.

The client sends exactly what was clicked, and dispatches on the returned
`DocumentTargetRef`:

| Target | Client channel |
|--------|----------------|
| `project-file` | `project/read-file` (+ bounded `project/find-file` retry) |
| `skill` | `skills/read` |
| `media` | Tauri asset protocol (local) / `media/read` (remote) |
| `trusted-config` | `preview/read-trusted-text` |
| `local-file` | `preview/read-local-file` — **refused on remote projection** |

## Slice 1 — Desktop dispatch + media viewer (implemented)

- `apps/desktop/src/media-path.ts`: pure helpers — `isPiwinMediaPath`,
  `REMOTE_MEDIA_ASSET_PREFIX`, `isRemoteMediaAssetRef`,
  `mediaKindForPath` (`'image' | 'video' | null`). `media-utils` re-exports
  `isPiwinMediaPath` for existing callers.
- `document-open-path.ts`: new `media` plan kind, checked before the project
  branch (vault paths always preview as media, even under a weird project root).
- `active-document.ts`: ready variant gains optional `media` payload
  (`{ path, assetId?, mimeType?, byteSize? }`); `content` stays `''` for media.
- `hooks/use-active-document.ts`: extracted from `App.tsx` (state, request-id
  guard, `requestToolSnapshot`, `handleOpenDocument`) + media branch:
  - vault path → `ready` with `media` (viewer resolves bytes);
  - bare `remote-asset:` path (no session identity) → `unavailable` with
    reason `media-unavailable`; structured media targets fetch via `media/read`.
- `MediaDocPreview.tsx`: right-panel media renderer. Image: fit-to-panel,
  wheel zoom (≤ 8×), drag pan, double-click reset, click-through to fullscreen
  lightbox. Video: `<video controls>`. Header mirrors DocPreviewPanel
  (title / displayRef chip / provenance `会话媒体`).
- `App.tsx` `docPreviewContent` picks `MediaDocPreview` iff
  `activeDocument.media` is set; otherwise the existing `DocPreviewPanel`.
- Errors: unresolvable URL (non-Tauri host, moved file) → unavailable card
  with reason `media-unavailable`, never a broken-image glyph.

### Slice 1 test matrix

- `document-open-path.test.ts`: vault path (with and without project root),
  `remote-asset:` ref, media beats project classification, non-media
  extensions in the vault still classify as media.
- `use-active-document.test.tsx`: media open produces ready-with-media without
  any host request; a bare `remote-asset:` path produces `media-unavailable`;
  project text open still issues `project/read-file`.
- `MediaDocPreview.test.tsx`: image renders from resolved URL; zoom controls;
  video element for video paths; unavailable state when resolution fails.

## Slice 2 — `media/read` contract + remote enablement (implemented)

- `@piwin/contracts`:
  - `media/read` command: `{ sessionId, assetId, maxBytes? }` →
    `MediaReadData = ready { base64Data, mimeType, byteSize } |
    unavailable { reason }` with stable reasons
    (`not-found | outside-media-root | too-large | invalid-request`).
    No `mediaPath`, no `truncated`, no `session-mismatch`. Oversized whole-file
    reads return `too-large`; clients retry with `offset`/`length`.
  - `DocumentTargetRef` gains `{ kind: 'media'; sessionId; assetId; displayRef }`.
- `@piwin/media`: read API alongside `saveMediaAsset`, reusing
  `assertInsideMediaRoot` / `assertRealPathInsideMediaRoot`; byte cap
  (whole-file cap is the Host wire budget; larger originals use ranged
  `media/read`. Ticketed HTTP download remains the future remote streaming
  path, ADR 0037 §4).
- `@piwin/host-runtime`: command dispatch + session-ownership check.
- `@piwin/host-server`: allowlist `media/read` for remote clients, resolve
  `remote-asset:<id>` through the existing id→path map (raise the 256-ref cap
  or persist refs if it proves limiting), advertise `mediaRead: true`
  capability, keep `sanitizeRemoteValue` masking host paths.
- `apps/desktop`: transcript and Studio fall back to `media/read` → blob URL
  when convertFileSrc misses or `<video>` cannot play an `asset:` URL (no
  Range). Oversized mp4s are assembled from ranged slices. `host-client-mock.ts`
  gains the command.
- Source fix: `image_gen` tool presentation emits `DocumentTargetRef`
  media targets (via `document-targets.ts` enrichment) instead of bare
  absolute-path pills.

## Slice 3 — Trusted-domain read-only text preview (implemented)

- Host command `preview/read-trusted-text` accepts a config-root-relative
  path only (`relativePath`). Remote clients never send host-absolute paths.
- Reader lives in `@piwin/host-runtime` (`trusted-text-reader.ts`); handler
  is `preview-commands.ts` (not catalog-commands). Containment reuses
  `resolveInsideRootWithRealpath`. First path segment `media` is rejected
  (`media-vault`) so vault bytes cannot bypass `media/read`.
- Text sniff (NUL in first 8 KiB) + 256 KiB default / 512 KiB hard cap.
  Oversized **text is truncated** (same policy as `project/read-file`).
- Ready payload always includes `readOnly: true`. Failure reasons:
  `not-found | outside-config-root | media-vault | not-a-file | binary |
  too-large | invalid-request`.
- `DocumentTargetRef.trusted-config` is the remote-safe click identity.
  Host advertises `trustedTextPreview`.
- Desktop: planner classifies `/.piwin/**` (after media / project / skill)
  as `trusted-config`; Doc Preview shows `[项目外 · 只读]`. Remaining
  `outside-project` cards mention the Finder/访达 escape hatch.
- Never accepts arbitrary absolute paths from transcript-emitted chips.

## Slice 4 — Local-Host click-to-preview for any displayable file (implemented)

ADR 0052 Slice 1 only previews **vault** paths (`~/.piwin/media/...`). A Read
tool that opened `/tmp/ncg-boot2.png` still classified as `legacy-absolute`
→ `outside-project`. The product rule on local Desktop is: **if the UI can
render it, render it.** `outside-project` is not a preview reason.

- New local-only Host command `preview/read-local-file`
  `{ sessionId, absolutePath }`:
  - raster magic (PNG/JPEG/GIF/WEBP) → copy into the session media vault
    and return `{ kind: 'media', asset }`
  - no NUL in the text sample → `{ kind: 'text', content, readOnly: true }`
    (truncated at 256 KiB)
  - otherwise `{ unavailable, reason: binary | not-found | too-large }`
- Desktop: any `legacy-absolute` click goes through this command. Project
  text still uses `project/read-file`; project binary falls through here.
- Remote host-server rejects the command (`isSafeRemoteCommand` → false).
- A `.png` name with text bytes previews as text. Location is not a deny
  list — capability (can we render) is the only local gate.

## Slice 5 — Resolving a path the message wrote incompletely (implemented)

Agent messages name files the way people do, so a chip can carry `shot.png`
while the file lives in `docs/design/inkstone/shots/`. `not-found` is then
false: the file exists, the message was not a path. Slices 1–4 never
addressed that, because every one of them trusted the click text.

- New Host command `project/find-file` `{ projectPath, query, maxMatches? }`
  → `{ projectPath, query, matches[], truncated }`.
  - Authority: `requireBrowseRoot` (registered project or General workspace);
    `..` in the query is rejected. Remote-safe like `project/read-file`.
  - Walk: BFS from the browse root, shared `IGNORED_DIR_NAMES` with the file
    tree, no symlink descent, `PROJECT_FIND_FILE_MAX_VISITED` entry budget,
    `PROJECT_FIND_FILE_MAX_MATCHES` result cap, and a fixed nesting cap.
    Matches by basename, or path suffix for a query with `/`.
  - Shallowest first, then path order — deterministic for the same tree.
- Desktop (`resolve-project-file.ts`): the miss handler runs only after
  `project/read-file` failed.
  - one match + complete walk → read that relative path and open it
  - ≥2 matches → `unavailable` with reason `ambiguous-file` (never picks one)
  - one match but `truncated` → resolves nothing; existing fallbacks run
- Reveal uses the same resolver: `revealLocalFileInFolder` now returns
  `missing` for an absent path (instead of letting the native command open the
  parent folder), and the chip retries the resolved path or reports that the
  path holds no file.
- Absolute chips are resolved too: when the ingest channel is unavailable
  (remote client) or misses, and the chip path contains the workspace folder
  name as a segment, the remainder is treated as the project-relative path
  (`/tmp/proj/a.md` → `a.md` for root `/private/tmp/proj`). No match → the
  original answer stands; an unrelated absolute path is never remapped.
- Host failure code `project-root-missing`: a registered browse root whose
  directory no longer exists. Returned by `project/read-file`,
  `project/list-dir` and `project/find-file` before any file-level error, so
  Desktop (and the file tree) can say the workspace is gone rather than
  "file not found".
- Diagnostics: the docked Document surface forwards `unavailableReason`,
  `suggestion`, `byteSize`, `maxBytes`, `provenance`, `warning` — the previous
  omitting of those made every failure read "无法加载预览 / 文件当前无法读取。".

## Slice 6 — Host-side path resolution (implemented)

Every slice above taught one more interpreter what a spelling meant; a single
click still crossed seven of them, and whichever missed answered `not-found`.
Slice 6 moves interpretation to the Host, which is the only party that knows the
host user's home, its own config root, realpath aliases, and whether the client
is local.

- `preview/resolve-path` `{ sessionId?, projectPath?, rawPath }` →
  `{ status: 'resolved', target, attempts }` or
  `{ status: 'unresolved', reason, attempts }`. `attempts` is a list of
  `{ route, reason, detail? }` with `route` ∈ `media | skill | project |
  trusted-config | local-file | find-file`; it is returned for successful
  resolutions too, because it is the diagnostic.
- Failure reasons are stable and specific: `empty-path`, `invalid-path`,
  `not-found`, `not-a-file`, `outside-domains`, `ambiguous-file`,
  `project-root-missing`, `remote-local-path-denied`.
- One classifier (`document-path-classify.ts`) serves both this command and the
  tool-card `buildDocumentTargetsForPath`; tool cards never emit `local-file`.
- Resolution order: media → skill → project (realpath containment on both the
  clicked path and the root) → config store (`configStoreRelativePath`, Host
  home) → local file. `~` is expanded, `file://` stripped, percent escapes
  decoded by the Host.
- `project/find-file` is invoked by the Host only after the project route
  matched and the exact path was not on disk; unique + complete resolves,
  several matches answer `ambiguous-file`, an incomplete walk resolves nothing.
- Remote projection applies `denyRemoteLocalFileTarget`: a `local-file` target
  becomes `remote-local-path-denied`, so the client is told it may not read the
  path and is not told whether it exists. The command stays on the remote
  allowlist because the Host is resolving *for* the remote shell.
- Desktop sends the raw path once. `planDocumentOpenPath` and
  `projectRelativeAliasForPath` no longer route; they cover a Host that does
  not implement the command (a rejected answer falls back to them instead of
  surfacing "Unhandled command") and transcript recovery.
- Unavailable states carry `attempts`; Doc Preview renders the specific reason
  plus a diagnostic disclosure listing each route.
- `use-active-document.ts` is split (it was 1057 lines): per-target loaders
  (`project`, `skill`, `trusted-config`, `local-file`, `media`), a shared
  snapshot → read → transcript ladder, the target dispatcher, and the legacy
  planner.

### Slice 6 test matrix

- Golden table (`document-path-resolution.test.ts`): every spelling ×
  {local Host, remote shell, test root `~/.piwin-test`, Windows root} → expected
  target or reason. Rows cover the historical regressions: a `~/.piwin/...`
  chip, a workspace reached through `/tmp` while the root is `/private/tmp`,
  `file://`, percent escapes, a bare file name only `find-file` can place, an
  ambiguous name, a vanished workspace, and a Windows spelling arriving at a
  POSIX Host.
- Command test (`document-path-commands.test.ts`): real filesystem —
  registered browse root, bounded search, ambiguity, vanished root, config
  identity, media identity, and a miss that reports its attempts.
- Projection test (`remote-path-resolution.test.ts`): payload validation and
  the `local-file` refusal (the response must not contain the host path).
- Desktop tests: dispatch by the returned target, the specific reason +
  attempts (never the generic `not-found` copy), transcript recovery on an
  unresolved answer, and the fallback when the Host rejects the command.

## Security invariants

1. Read authority = store identity. Media vault reads stay inside
   the Host media root after realpath; project reads stay inside registered
   roots. The only absolute-path preview command is local-Host
   `preview/read-local-file` (user click; render image or text); remote clients
   cannot send it, and Slice 6 refuses the `local-file` target in projection so
   a remote client cannot even be handed the path.
2. Remote clients never send host-local absolute paths for media; they send
   opaque ids. Host absolute paths never appear in remote payloads.
3. Model-emitted path chips gain no new read authority beyond existing
   channels (project/skill/media vault). Anything wider requires a user
   gesture and a local Host.
4. `project/read-file` semantics are frozen; new domains = new commands.
5. `project/find-file` grants no read authority: it only lists candidate
   relative paths inside an already-registered browse root, and Desktop opens
   nothing unless the answer is unique and complete.
6. Absolute-path remapping is decided by realpath containment inside the
   resolver: the clicked path and the registered root are both realpath'd
   before comparison, and any resolved `project-file` still goes through
   `project/read-file`'s own root check. `preview/resolve-path` grants no read
   authority of its own — it only names the channel.
