# Generated media library (Library)

Shipped 2026-08-27. Updated 2026-08-28: Studio is now two workspaces — one
unified Library for images, videos, and files, plus a separate Flashcards page.
Images and videos are never separate top-level destinations. Updated
2026-09-21: the Library tabs are Images / Videos / Favorites — there is no
Files tab. The Host still lists `kind: 'file'` vault assets and the mobile
Library still shows them; the desktop Library just has no browse category for
them.

The library lists **generated** images and videos from this app's vault,
not a coding project's working tree. User paste / drop / file-picker
attachments stay in chat; they do not appear here.

## Product

- Collect generated images / videos under `~/.piwin/media/<sessionId>/`
  (`source: generated` sidecar). Conversation sessions and project-bound
  sessions share that vault. User-sent screenshots and uploads do not appear.
  Repo files from coding work do not.
- Clicking 资料库 is a full-window jump: sidebar and titleband disappear.
  Back or Escape returns to the session.
- One page. Title on the left, pill search in the middle, New on the right.
  Default tab is Images. Text tabs: Images / Videos / Favorites. Sort +
  grid/list sit on the tab row. Library has no composer.
- Sort newest first. Search matches prompt / model / session / asset id.
- Preview is lazy: the list is metadata only. Host writes two WebP
  sidecars next to each image (`<assetId>.thumb.256.webp` and
  `.thumb.384.webp`). A tile picks the smallest tier that covers
  `cellCss × devicePixelRatio`, attaches that thumb only while it is
  on screen, and never fetches the original. Lightbox loads the full
  file when opened. Pages of 40, infinite scroll.
- Library has no composer. Generate stays in chat; new items show up when
  you come back.

## Why this shape

ChatGPT Images is an account-wide generated grid, newest first, with create
from the same product surface. Grok Imagine puts the prompt on the gallery.
piwin has no account, so the Host media vault is the collection.

## Host

- `media/list` returns `{ items, total, nextCursor? }`. Items are logical
  (`sessionId` + `assetId`). `absolutePath` / `thumbAbsolutePath` are
  local-only and stripped on remote projection; `hasThumb` stays.
- `media/read` `variant: 'thumb'` returns a WebP sidecar. Optional
  `thumbEdge` is `256` (dense) or `384` (standard, default). Generated
  on save, or on first list/read for older vault files. Leftover
  `<assetId>.thumb.webp` files from the single-tier rollout are ignored
  by the grid and deleted with the original.
- `media/delete` removes the vault file, thumb, and optional sidecar. The Library
  exposes a one-click trash on each tile and in the lightbox.
- `image_gen` / `video_gen` write `<assetId>.json` sidecars (`source:
  generated`) so prompts stay searchable. Media uploads write a sidecar with
  the original filename; the Library ignores those. A JSON file asset uses
  `<assetId>.meta.json` to avoid colliding with its own `.json` extension.
  Assets without a generated sidecar do not list.
