# Grok image preview and Library bridge correction

Verified on 2026-10-02 against the current local workspace and Desktop preview at `http://localhost:1420/`.

## Cause and correction

The executable extension proposed the generated image and Host imported it into the vault, but the saved asset returned by `importAgentPluginMedia` was discarded. Live and replay completion events lacked attachments, so the conversation showed only a completion card. The relative Markdown link from Grok was blocked by the existing renderer policy.

Both delivery paths now attach successfully imported media to the originating tool completion event. The existing Desktop preview and durable transcript consume the same attachment. Failed imports preserve the original event. The Library continues to use the generated asset's existing metadata.

Live import and legacy backfill previously used different import keys and could duplicate the same output. Receipt identity now uses the checked source file and its content. Id-only legacy receipts reuse matching imported assets, and restored refs retain their name/content kind.

## Automated verification

- `pnpm typecheck`: passed across the workspace.
- `pnpm test:architecture`: passed.
- `@piwin/media`: 5 test files, 33 tests passed.
- `@piwin/host-runtime`: 432 test files, 3700 tests passed.
- The Host suite required permission to start its local loopback fixture servers; the unrestricted rerun passed fully.
- Production files changed for this correction: 156, 355, 371 and 126 lines, all under the 1000-line cap.

New regression assertions cover live event attachments, transcript persistence, the same Library asset, replay/reload reuse, failure preservation, legacy receipt migration and different live/backfill keys.

## Existing-image smoke

Reused the image from `Imagine Girl Image Generation Prompt`, product session `session-mupucx95-favg5q4z`, native Grok session `01a0f8a1-7844-76b0-ace2-abeb11851cb4`. No additional paid image generation was submitted.

- The conversation directly displays the image through `MediaPreview`; the loaded bitmap is 683 × 1024.
- Copy, download and fullscreen actions appear on the preview.
- Searching the Library for the original prompt finds one item.
- The vault and transcript each reference one generated original, asset `60898d58-3ab4-4ab9-9807-1254d6093965`, after recovery/replay.
- The temporary duplicate produced while reproducing legacy backfill was moved to `/private/tmp/piwin-grok-image-repair-9rwuieup` with a transcript backup. The original file was preserved.

Screenshots: `grok-chat-preview.png` and `grok-library.png` in the current conversation's visualization directory. This verifies the development Host; no packaged release was rebuilt.
