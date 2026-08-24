# ADR 0005: Markdown default + HTML artifact port + path-based images

## Status

Accepted (2026-07-19; amended 2026-08-24)

## Context

Need Claude-like artifacts and Codex-like image UX without unsafe ad-hoc iframes. Local `openwebui_m` already has a rigorous HTML artifact stack.

## Decision

1. Default chat rendering = **Markdown**
2. HTML artifact runtime = **port pure logic** from `openwebui_m` into `@piwin/artifact`
3. Images: preview in chat; paste saves under `~/.piwin/media/...`; host passes native image content to Pi by default (see amendment 2026-08-01)
4. **Coding-agent phase policy (2026-07-25 amendment):**
   - While an assistant message is **streaming**, render safe Markdown only: incomplete fences stay source, Mermaid does not execute, and Artifact iframes are not mounted.
   - When a message is **completed**, normal code fences remain source-first with copy affordances.
   - An HTML/UI Artifact is **source-first** and only mounts an iframe after an explicit user **Preview artifact** action (or an explicit-artifact-review mode), and only when security classification allows it.
   - Thinking/tool work uses timeline/cards, not Artifacts.

## Consequences

- Extra package boundary (`artifact`, `media`)
- Must invest in tests for security classifier
- Vision multipart is the default for composer media attachments (see amendment 2026-08-01)
- Ordinary coding turns stay legible and cheap to stream; Artifacts remain deliberate interactive deliverables

## Amendment (2026-08-01): Native image content for composer media

**Supersedes** the original “text models receive absolute path by default” decision for **composer paste/drop/file-picker media attachments**.

### Decision

1. Media is still saved under `~/.piwin/media/<session>/` (path remains the durable store + UI preview source + transcript attachment ref).
2. On `session/prompt`, host validates attachment paths stay under the media root, then the Pi adapter loads file bytes and calls:
   `piSession.prompt(text, { images: ImageContent[] })`.
3. Prompt **text** no longer receives `[attached image] path: ...` injection for media attachments by default.
4. Web-element attachments keep structured text injection (`formatTextModelWebElementInjection`); optional screenshot path remains a media-root-guarded ref.
5. Path-string injection (`formatTextModelImageInjection`) remains available as a **fallback** for text-only models without vision delegation / Pi vision extension — not the default path.
6. Still forbidden: stuffing base64 into the **text** prompt body.

### Why

- Path-only injection forced multimodal models through an extra `read` tool round-trip (or left them blind).
- Pi SDK/RPC already accept `images?: ImageContent[]` on `prompt`.
- Pi extensions (e.g. vision handoff) can intercept real image blocks; they cannot recover pixels from a path string in text.
- Durable path storage is retained; only the model-facing encoding changes.

### Consequences

- Large images increase prompt token/memory cost; resize/delegation can be added incrementally.
- Text-only models without a vision hook may not “see” pixels until delegation/extension is configured.
- Update AGENTS.md §1.6 and host tests that previously asserted path injection in prompt text.

## Amendment (2026-07-30): Artifact preview opt-in on Desktop

**Superseded by the 2026-08-24 amendment.** The live switch is
`config.artifact.enabled`, not a Desktop localStorage preference.
`evaluateCodeFence` and the flashcard `data-card-id` Preview-card exception
are deleted.

## Amendment (2026-07-31): SVG fences use the heavy Artifact path

- Desktop recognizes valid-root `svg` fences as `SvgArtifactDescriptor` values when `artifactPreviewEnabled` is on.
- SVG preview reuses the existing sandbox iframe, strict CSP, external-resource classifier, theme contract, height bridge, and init queue; it is not inserted into the parent chat document.
- Capability-off and streaming behavior remain source-only.
- A separate light/native SVG renderer with pan/zoom is still deferred and must not share the heavy Artifact switch implicitly.

## Amendment (2026-08-09): Stable streaming Artifact materialization

This amendment supersedes the source-only streaming clauses in the 2026-07-25,
2026-07-30, and 2026-07-31 decisions when Artifact preview is enabled.

- HTML/SVG Artifact generation may mount one sandboxed stream-preview iframe
  after a safe structural snapshot exists. Ordinary code, Mermaid, and
  capability-off paths remain source-only while streaming.
- Stream source is sanitized before rendering: scripts and unsafe embeds are
  removed, unfinished tags are withheld, and an unfinished `<style>` block is
  not applied.
- The iframe document is stable for the whole streaming phase. Sanitized token
  snapshots reconcile its DOM in place at most once per 300ms and report the
  resulting stream height.
- Completion commits the repaired final source into that same iframe once,
  removes its stream listener, activates final permitted scripts, and reports
  one settled height. Completed/history Artifacts load the final document
  directly.
- Inline Artifact title/status/byte chrome is not permanently visible. Source
  inspection remains available from an action overlay shown on hover or
  keyboard focus; activating `Show code` opens the source fully expanded.
- Model-authored Artifact motion is disabled by a host-owned style placed after
  model styles: CSS animations/transitions and SVG declarative motion do not
  run in either streaming or completed inline previews.
- Desktop completion stability (amended 2026-08-13): fence identity is sticky
  (`<messageId>-artifact-<ordinal>`, never a hash of the body). During token
  streaming the first lightweight document stays mounted while throttled body
  snapshots reconcile its DOM in place. Completion commits one final snapshot
  without navigating or remounting the iframe. Completed/history Artifacts load
  the same final document directly. Parent re-renders do not reload it.
- Artifact document canvas remains transparent. A host-owned theme guard is
  appended after model content to keep `html`/`body`/root transparent and map
  known fixed-light surfaces to the Artifact theme without creating a white
  page behind the component.

## Amendment (2026-08-13): Static-flow routing and one height observer

- Completed Inline HTML/SVG without JavaScript, external resource references,
  embedded browsing contexts, or form submission capability renders directly
  in a sanitized Shadow DOM. It participates in transcript flow and therefore
  has no iframe height protocol. Streaming stays sandboxed until the final
  source proves eligible; Canvas always stays sandboxed.
- Allowed YouTube/Google Maps embeds remain sandboxed. External scripts,
  stylesheets, images, fonts, APIs, and other network resources remain blocked
  by the existing classifier/CSP policy.
- Sandboxed Inline content uses one ResizeObserver-driven measurement stream.
  There is no height phase state machine, MutationObserver, measurement ladder,
  interaction shrink confirmation, or grow-only lock.
- Packaged macOS registers a frame-scoped `WKScriptMessageHandler`. It accepts
  bounded, whitelisted messages only from non-main frames; the main UI then
  requires an exact Artifact `channelId` match. Browser/dev keeps
  `window.postMessage` as a compatibility fallback. No Tauri invoke capability
  is exposed to Artifact HTML.
- Height transport, iframe admission, final-document lifecycle, and React
  presentation remain separate modules. `ArtifactFrame` does not own protocol
  timers or Tauri-native state.
- Inline iframe height is authoritative after a sandbox measurement. SVG
  attributes/viewBox may size the short-lived loading paint, but neither that
  seed nor an HTML/CSS source estimate is accepted as the measured height.
- If no measurement arrives before the timeout, Desktop keeps the iframe
  visible in a bounded 640px fallback viewport and allows clipping. This is a
  diagnostic degradation, not a render error: no error card replaces content,
  and a late valid measurement may still restore the real height.
- Canvas owns a fixed panel scrollport and therefore does not depend on the
  Inline height measurement. CSP, sandboxing, channel binding, message parsing,
  and action whitelisting remain unchanged.

## Amendment (2026-08-22): Source declaration and stable height contract

This amendment supersedes earlier clauses that treated native `html`/`htm`/`svg`
fences as if the model had explicitly declared an Artifact, and it narrows the
2026-08-13 height observer contract.

- Parsed descriptors record both `declaration: explicit | native` and
  `documentKind: fragment | document`. An `artifact-html`/Artifact marker is an
  explicit product declaration; an ordinary language fence is native source.
- Native HTML/SVG is source-first even when Artifact capability is enabled.
  Compatible fragments may be previewed Inline after user action. Full HTML
  documents and viewport-coupled source are offered only as a user-triggered
  Canvas preview. Merely writing ` ```html ` never auto-mounts an application in
  the conversation.
- Explicit Inline Artifacts may materialize automatically only when they satisfy
  the component contract. Full documents, viewport-height units/scripts, and
  fixed-position page shells are incompatible with parent-driven Inline sizing.
  Runtime reports the incompatibility and leaves source visible; it does not
  rewrite model CSS or silently change the declared surface.
- Full documents retain their `html`/`head`/`body` structure in Canvas. Host CSP,
  theme policy, and action bootstrap are injected into the existing document;
  the document is not stripped and nested under an Inline root wrapper.
- Sandboxed Inline uses one message shape only:
  `piwin-artifact:size { channelId, height, viewportHeight, revision }`. One
  `ResizeObserver` watches `.piwin-artifact-root` and reports its root rectangle
  when the distinct height changes. There are no ready/resize phases, viewport
  resize listener, canvas/video budgets, scene detection, or CSS layout repair.
- Browser messages must come from the current iframe `contentWindow`; the native
  frame handler remains bounded and the UI still requires the exact channel.
  Out-of-order revisions are ignored. Timeout selects the explicit 640px
  fallback instead of retaining a previously bad height; a later valid revision
  may recover it.
- Canvas owns a fixed viewport and sends no size messages. It keeps the same
  sandbox/CSP/action transport, but is entirely outside the Inline height loop.
- Transcript virtualization separates actual measurements from estimates:
  mounted DOM height is never capped, while remembered/speculative height stays
  bounded at 4000px and is distrusted when implausible. This prevents the outer
  row from truncating a correctly measured tall Artifact without making stale
  cache entries reserve large blank regions.

## Amendment (2026-08-24): Rendering convergence

Supersedes the 2026-07-30 opt-in preference, `evaluateCodeFence` /
`splitMarkdownBlocks` as live APIs, the flashcard HTML exception, and any
remaining “streaming is always source-only” reading of earlier clauses when
Artifact capability is on.

- **Master switch:** `PiwinConfig.artifact.enabled`. Desktop forwards it as
  `artifactPreviewEnabled`. Leftover `piwin.desktop.artifactPreviewEnabled`
  localStorage keys are ignored.
- **Unique routing:** `indexArtifactFences` is the only fence index.
  `analyzeArtifactFence` produces a `RenderIntent`; `materializeArtifact` is
  the only theme/srcdoc path. MarkdownView uses `renderingPhase` only
  (`streamComplete` is deleted).
- **Code-first is Inline-only.** Explicit Canvas still auto-reveals once on
  live completion when capability is on.
- **Streaming:** ordinary code and Mermaid stay source. HTML/SVG may
  stream-preview in one sandbox iframe with sticky fence identity. Canvas
  fences stay source until completion.
- **16 384 px overflow:** Inline flow that exceeds the defensive ceiling
  enters `inline-overflow`. Content is not silently cropped.
- **Theme:** preview repairs apply to `renderSource` only. Copy/export keep
  original model source.
- **Flashcards:** structured `FlashcardDisplayPayload` in tool presentation.
  Generic Artifact does not special-case `data-card-id`.
- See ADR 0029 and
  `docs/plans/2026-08-24-artifact-rendering-convergence-execution-plan.md`.
