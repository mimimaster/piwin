# ADR 0005: Markdown default + HTML artifact port + path-based images

## Status

Accepted (2026-07-19; amended 2026-08-24; amended 2026-08-26; amended 2026-09-04)

## Context

Need Claude-like artifacts and Codex-like image UX without unsafe ad-hoc iframes. Local `openwebui_m` already has a rigorous HTML artifact stack.

## Decision

1. Default chat rendering = **Markdown**
2. HTML artifact runtime = **port pure logic** from `openwebui_m` into `@piwin/artifact`
3. Images: preview in chat; paste saves under `~/.piwin/media/...`; host passes native image content to Pi by default (see amendment 2026-08-01)
4. **Render contract (2026-08-24).** The 2026-07-25 source-only streaming /
   Preview-only iframe policy is superseded.
   - **Master switch:** `PiwinConfig.artifact.enabled`. Desktop forwards it as
     `artifactPreviewEnabled`. Leftover `piwin.desktop.artifactPreviewEnabled`
     localStorage keys are ignored.
   - **Streaming Inline:** compatible explicit and native HTML/SVG fences auto
     stream-preview from the first recognizable fence (no source flash).
     Ordinary code and Mermaid stay source.
     Canvas fences stay source in the transcript until completion; the right
     Canvas panel stream-previews from the first parseable `surface="canvas"`
     fence on a live message.
   - **Completed Inline:** compatible inert flow may render in a sanitized
     Shadow DOM; sandboxed content uses one height stream. Native and explicit
     HTML/SVG use the same default Inline path. `artifactCodeFirst` is
     Inline-only and is the source-first preference.
   - **Canvas:** `surface="canvas"` auto-opens the right panel as soon as the
     live opening fence is parseable when capability is on. Transcript stays
     source; the panel uses stream-preview then commits on completion.
     Hydrated history does not rearrange the shell.
   - **Overflow:** 16,384 px is a defensive ceiling that enters
     `inline-overflow` (host-owned viewport + hint). Content is not silently
     cropped.
   - **Routing:** `indexArtifactFences` → `analyzeArtifactFence` →
     `RenderIntent`; `materializeArtifact` is the only theme/srcdoc path.
     Preview repairs apply to `renderSource` only; copy/export keep original
     source. MarkdownView uses `renderingPhase` only.
   - **Flashcards:** structured `FlashcardDisplayPayload` in tool presentation.
     Generic Artifact does not special-case `data-card-id`.
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

**Superseded by the 2026-08-24 lead decision** for the capability switch and
native streaming policy. SVG uses the same Artifact sandbox as HTML (not a
parent-document renderer). A separate light pan/zoom SVG renderer remains
deferred.

## Amendment (2026-08-09): Stable streaming Artifact materialization

This amendment supersedes the source-only streaming clauses in the 2026-07-25,
2026-07-30, and 2026-07-31 decisions when Artifact preview is enabled.

- HTML/SVG Artifact generation may mount one sandboxed stream-preview iframe
  after a safe structural snapshot exists. Ordinary code, Mermaid, and
  capability-off paths remain source-only while streaming.
- Stream source is sanitized before rendering: scripts and unsafe embeds are
  removed, unfinished tags are withheld, and an unfinished `<style>` block is
  not applied.
- A prefix is visually streamable only at a completed element boundary. Class-
  driven markup without a completed stylesheet foundation stays behind a
  host-owned preparing state; `canStream: false` is not rendered as raw HTML.
  The model runtime contract requires complete `<style>` blocks before visible
  markup and completed logical siblings in emission order.
- If a late stylesheet unlocks a large buffered scene despite that contract,
  preview-only materialization hoists the completed fragment stylesheet and
  replays at most eight structurally closed prefixes. This bounded fallback
  preserves one iframe and stable DOM growth; it never executes scripts or
  slices characters.
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
- Model-authored Artifact motion is preserved. A host-owned style placed after
  model styles suppresses CSS animations/transitions and SVG declarative motion
  only when `prefers-reduced-motion: reduce` is active.
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
- Sandboxed Inline content uses one coalesced measurement stream. A root
  ResizeObserver and a root-subtree MutationObserver schedule the same
  animation-frame measurement; captured resource loads also request it.
  The mutation observer covers overflowing descendants whose changes do not
  resize the root box. Both observers disconnect on promotion to a viewport.
  There is no measurement ladder, interaction shrink confirmation, or grow-only lock.
- Packaged macOS registers a frame-scoped `WKScriptMessageHandler`. It accepts
  bounded, whitelisted messages only from non-main frames; Desktop routes each
  payload to subscribers for its exact Artifact `channelId` and retains the
  latest early size per channel until that frame subscribes. Browser/dev keeps
  `window.postMessage` as a compatibility fallback. No Tauri invoke capability
  is exposed to Artifact HTML.
- Height transport, iframe admission, final-document lifecycle, and React
  presentation remain separate modules. `ArtifactFrame` does not own protocol
  timers or Tauri-native state.
- Inline iframe height is authoritative after a sandbox measurement. SVG
  attributes/viewBox may size the short-lived loading paint, but neither that
  seed nor an HTML/CSS source estimate is accepted as the measured height.
- If no measurement arrives before the timeout, Desktop keeps the iframe
  visible in a compact 360px recovery viewport whose document owns scrolling.
  The parent requests a fresh measurement on iframe load, native-listener
  readiness, timeout, and explicit retry. A late valid measurement exits the
  recovery viewport and restores exact Inline flow.
- Canvas owns a fixed panel scrollport and therefore does not depend on the
  Inline height measurement. CSP, sandboxing, channel binding, message parsing,
  and action whitelisting remain unchanged.

## Amendment (2026-08-22): Source declaration and stable height contract

This amendment is superseded by the 2026-08-24 rendering convergence decision.
The current contract still records native versus explicit provenance and keeps
the 2026-08-13 height observer bounds.

- Parsed descriptors record both `declaration: explicit | native` and
  `documentKind: fragment | document`. An `artifact-html`/Artifact marker is an
  explicit product declaration; an ordinary language fence is native source.
- Native HTML/SVG uses the same compatible Inline path as explicit Artifact
  when the capability is enabled. `artifactCodeFirst` is the user-triggered
  source-first mode; full documents and viewport-coupled source remain
  `inline-viewport` in the transcript rather than being rerouted to Canvas.
- Explicit Inline Artifacts may materialize automatically only when they satisfy
  the component contract. Full documents, viewport-height units/scripts, and
  fixed-position page shells are incompatible with parent-driven Inline sizing.
  Runtime reports the incompatibility and leaves source visible; it does not
  rewrite model CSS or silently change the declared surface.
- Full documents retain their `html`/`head`/`body` structure in Canvas. Host CSP,
  theme policy, and action bootstrap are injected into the existing document;
  the document is not stripped and nested under an Inline root wrapper.
- Sandboxed Inline uses one message shape only:
  `piwin-artifact:size { channelId, height, viewportHeight, revision, seq }`.
  `seq` is a per-frame monotonic copy id. One `ResizeObserver` watches
  `.piwin-artifact-root` when present, otherwise `document.body`, and reports
  the larger of its border-box height and its scroll content height when that
  value changes. Never measure documentElement.scrollHeight: it includes the
  iframe viewport and can prevent shrinking. There are no ready/resize phases,
  viewport resize listener, canvas/video budgets, scene detection, or CSS
  layout repair.
- The iframe posts size/actions on **both** the native WK handler (when present)
  and `parent.postMessage`. Exclusive native delivery is forbidden: WK may
  expose `messageHandlers` and then drop the script message. Host ignores
  duplicate `seq` values so dual delivery is one event. Browser-channel trust
  prefers `event.source === iframe.contentWindow`; WK sandboxed data: frames
  often fail Window identity, so a non-parent source is accepted and bound by
  `channelId` — the same selector the native handler already uses. The parent
  page posting to itself is rejected. Native payloads stay trusted after the
  bounded protocol parse. Out-of-order revisions are ignored. Timeout selects
  the explicit 360px scrollable recovery viewport; a later valid revision
  restores exact flow height and clears recovery styling.
- Canvas owns a fixed viewport and sends no size messages. It keeps the same
  sandbox/CSP/action transport, but is entirely outside the Inline height loop.
- Transcript virtualization separates actual measurements from estimates:
  mounted DOM height is never capped, while remembered/speculative height stays
  bounded at 4000px and is distrusted when implausible. This prevents the outer
  row from truncating a correctly measured tall Artifact without making stale
  cache entries reserve large blank regions.


## Amendment (2026-09-04): Dual-channel sandbox height delivery

WKWebView packaged Desktop was trapping Inline sandbox previews in the 360px
recovery banner: the iframe rendered, but Host never received `piwin-artifact:size`.
The iframe treated `webkit.messageHandlers.piwinArtifact` as exclusive and
returned without `parent.postMessage`; the Rust handler also dropped messages
when WK mis-labeled a sandbox data: frame as `isMainFrame()`.

Decision: always post on both transports; Host dedupes by `seq`; measure
`.piwin-artifact-root` or `document.body`; native handler trusts the bounded
parser + channelId, not frame identity.

## Amendment (2026-08-24): Rendering convergence

This amendment **is the lead Decision**. It supersedes the 2026-07-25
Preview-only iframe policy, the 2026-07-30 opt-in preference,
`evaluateCodeFence` / `splitMarkdownBlocks` as live APIs, the flashcard HTML
exception, and `MarkdownView.streamComplete`. Compatible native and explicit
Inline fences auto stream-preview; only ordinary code, Mermaid, and Canvas
remain source-first during streaming.

See the lead Decision for the live contract. Details: ADR 0029 and
`docs/plans/2026-08-24-artifact-rendering-convergence-execution-plan.md`.
