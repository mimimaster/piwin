# Preview Resource Resolution — Spec

Status: Slices 1–4 implemented.
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

Classification rule: **store identity, not extension**. `planDocumentOpenPath`
returns `kind: 'media'` iff `isPiwinMediaPath(path)` or the path is an opaque
`remote-asset:<id>` ref. The media viewer may use extensions/MIME to pick
image vs video *rendering*.

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

## Security invariants

1. Read authority = store identity. Media vault reads stay inside
   `~/.piwin/media/` after realpath; project reads stay inside registered
   roots. The only absolute-path preview command is local-Host
   `preview/read-local-file` (user click; render image or text);
   remote clients cannot send it.
2. Remote clients never send host-local absolute paths for media; they send
   opaque ids. Host absolute paths never appear in remote payloads.
3. Model-emitted path chips gain no new read authority beyond existing
   channels (project/skill/media vault). Anything wider requires a user
   gesture and a local Host.
4. `project/read-file` semantics are frozen; new domains = new commands.
