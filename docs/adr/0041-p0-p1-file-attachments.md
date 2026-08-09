# ADR 0041: P0/P1 file attachments stay Host-owned

- Status: accepted
- Date: 2026-08-09

## Decision

P0/P1 attachments use the existing path-backed `MediaAttachmentRef` contract with
optional `name` and `contentKind` fields. Desktop is responsible for optimistic
preview and browser-side GIF first-frame conversion; the Host remains the only
writer under `~/.piwin/media`, MIME allowlist authority, and prompt router.

Text, source, configuration, SVG, and PDF attachments are never sent as native
files to Pi. Host prompt preparation extracts bounded text and injects it with
explicit file delimiters. Static images keep the existing native `ImageContent`
path for vision-capable models, with the existing delegation/fallback behavior
for text-only models.

Workspace-tree drops use structured `contextRefs` and relative paths. External
files use `media/save`; user paths are never used as output filenames.

## Consequences

- Existing image transcript and agent-host adapters remain compatible.
- Generic file support works for SDK, RPC, local sidecar, and the current bounded
  remote upload path without teaching UI packages about Pi payloads.
- Credential-looking files and obvious secret material are rejected before write.
- DOCX/XLSX/PPTX, archives, audio/video, and remote chunked upload remain P2.
