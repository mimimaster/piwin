# Artifact flicker and white-background investigation

Date: 2026-08-10

## Scope

Investigate the remaining Inline Artifact flicker and page-like white background by comparing
piwin with the local `openwebui_m` implementation. Keep the fix limited to rendering lifecycle,
document background, and final stream commit; do not add presentation features.

Reference implementation:

- `/Volumes/BigDisk/Projects/Projects/openwebui_m/src/lib/components/chat/Messages/Artifacts/ArtifactBlock.svelte`
- `/Volumes/BigDisk/Projects/Projects/openwebui_m/src/lib/components/chat/Messages/Artifacts/artifactSrcdoc.ts`
- `/Volumes/BigDisk/Projects/Projects/openwebui_m/src/lib/components/chat/Messages/Artifacts/artifactTheme.ts`
- `/Volumes/BigDisk/Projects/Projects/openwebui_m/src/lib/components/chat/Messages/Artifacts/artifactThemeContract.ts`
- `/Volumes/BigDisk/Projects/Projects/openwebui_m/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte`

## Findings

### 1. The white page fill is a piwin divergence

`openwebui_m` keeps the iframe element, `html`, `body`, and `.owi-artifact-root` transparent. It
also appends a theme guard after model content so model-authored `html/body` backgrounds cannot
win the cascade.

The current uncommitted piwin implementation instead resolves transparent Artifact backgrounds
to `#141416` or `#f6f6f7` and forces that color onto `html`, `body`, and
`.piwin-artifact-root`. In light mode this creates the reported page-like white block. A solid
document fill also becomes visible whenever the frame height grows before the next content paint.

The transcript canvas already supplies the visual background behind the transparent host frame,
so the sandboxed document does not need to own an opaque page background.

### 2. Stream completion currently guarantees an iframe teardown

piwin uses a stable iframe while `stream-preview` source grows, but the completion boundary is not
stable:

- `MarkdownView` gives the streaming and completed `ArtifactFrame` different React keys.
- `ArtifactFrame` changes the channel from `<id>-stream` to `<id>`.
- The init effect depends on that channel, sets `granted=false`, removes the iframe, then waits for
  another init grant.
- The completed `srcdoc` is assigned as a new document.

This creates an unavoidable empty browsing-context interval and therefore a visible WebKit white
flash, even when every token-time update was stable.

`openwebui_m` uses a stable Artifact identity and channel within an `ArtifactBlock` lifecycle. Its
current v1 still throttles `srcdoc` updates, which is acceptable in Chromium but is not a suitable
operation to copy literally into Tauri WebKit. piwin's existing in-place postMessage path should be
retained and extended through final commit.

### 3. Theme repair and page transparency are separate concerns

Reverting the page canvas to transparent is not enough. Model output can still contain fixed white
cards or `html/body` backgrounds. `openwebui_m` handles this twice:

1. soft-repair known fixed-light declarations before render;
2. append a final theme guard after model HTML.

piwin already has the soft-repair layer but is missing the final guard. The fix must add the guard
instead of making the whole iframe document opaque.

### 4. Desktop also swaps the Markdown renderer tree at completion

`streamdown@2.5.0` does not treat `mode="streaming"` and `mode="static"` as presentation flags.
The two modes return different React trees: streaming mode renders stable keyed blocks, while
static mode renders one direct Markdown subtree. Changing that prop when the model finishes
unmounts `CodeFenceView`, so even a stable Artifact key and channel cannot preserve its iframe.

`openwebui_m` keeps the Artifact block identity under its token tree across completion. Desktop
must likewise keep Streamdown's keyed block tree for the lifetime of a message that rendered live
tokens, then disable only incomplete-Markdown repair, animation state, and the caret when
generation completes. Completed history that mounts without a live phase can still use the cheaper
static renderer.

## Minimal implementation

1. Restore transparent Artifact page, host frame, and iframe backgrounds; gate iframe visibility
   until the bridge reports its first ready paint.
2. Append a piwin-named theme guard after model content. Force only the document/root canvas to
   transparent; map known fixed-light internal surfaces to `--piwin-artifact-surface`.
3. Use one Artifact key and one channel for streaming and completed phases.
4. Keep the stream-initialized `srcdoc` frozen. Submit the repaired final body through the existing
   bridge with a `final` marker, reconcile once, activate final inline scripts inside the existing
   sandbox, and request final measurement. Do not remount or requeue the iframe.
5. Directly opened completed/history Artifacts continue to load their final `srcdoc` normally.
6. Once a message enters Streamdown's keyed streaming/block mode, retain that mode through its
   completed phase. Use the rendering phase only for incomplete-Markdown repair, the caret,
   animation state, and Artifact policy. Completed history may enter the static renderer directly.

## Regression coverage

- srcdoc page/root remains transparent and the final theme guard appears after model content.
- default and mapped themes preserve transparent Artifact backgrounds.
- stream updates and the final update retain the same iframe DOM node and unchanged `srcdoc`.
- the final bridge message is immediate, carries the repaired final render source, and marks the
  update as final.
- a real Markdown render transition from `streaming` to `completed` retains the same iframe node.

## Verification

- `@piwin/artifact`: 115 tests passed; typecheck passed.
- Desktop Artifact/Markdown/theme targets: 43 tests passed; typecheck passed.
- Desktop production build passed.
- Full Desktop suite: 1041 of 1046 tests passed. The five failures are outside this change in
  `renderer-resource-boundaries.test.ts` (existing `region-shell.css` backdrop expectation) and
  `resolve-document-content.test.ts` (existing document extraction behavior).
