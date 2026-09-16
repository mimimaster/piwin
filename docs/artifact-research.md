# Artifact & Media Research Notes (for piwin)

| Field | Value |
|-------|-------|
| Date | 2026-08-24 |
| Source A | `~/Projects/openwebui_m` HTML artifact system |
| Source B | openwebui product design v1.1 |
| Source C | Codex-style image chat UX (product reference) |
| Goal | Port proven policies into `@piwin/artifact` + `@piwin/media`, not invent unsafe shortcuts |

---

## 0. Current implementation (2026-08-24)

Authoritative plan: `docs/plans/2026-08-24-artifact-rendering-convergence-execution-plan.md`.
ADRs: [0005](./adr/0005-artifact-and-media.md), [0029](./adr/0029-artifact-surface-routing.md).

- **Master switch:** `PiwinConfig.artifact.enabled`. Desktop workbench forwards
  it as `artifactPreviewEnabled`. There is no `localStorage` opt-in key.
- **One fence index:** `indexArtifactFences` + `projectArtifactMarkdownForRender`.
  Streamdown adapters bind by projected start offset → ordinal. Do not parse
  fences a second time in Canvas or MarkdownView.
- **One analysis:** `analyzeArtifactFence` returns `RenderIntent` (or code /
  blocked). `materializeArtifact` is the only theme/srcdoc path. Preview
  repairs (stream sanitization, theme contract) apply to `renderSource` only;
  copy/export use original model source.
- **Code-first is Inline-only.** Explicit `surface="canvas"` still auto-reveals
  on a live message when capability is on (as soon as the opening fence is
  parseable; later tokens update the same target).
- **Streaming:** ordinary code and Mermaid stay source. Native `html`/`htm`/`svg`
  and explicit Inline HTML/SVG may stream-preview in one sandbox iframe from
  the first recognizable fence; identity is sticky
  (`<messageId>-artifact-<ordinal>`). Canvas fences stay source in the
  transcript; the right Canvas panel stream-previews the same fence. Visible
  projection advances only at completed element boundaries after a complete
  style foundation. CSS-dependent prefixes otherwise show a preparing state;
  a large CSS-late unlock uses a bounded stable-prefix replay, never raw
  unstyled DOM.
- **16 384 px overflow:** Inline flow that exceeds the defensive ceiling
  enters `inline-overflow` (host-owned viewport + hint). No silent crop.
- **Height recovery (2026-09-16):** load confirmation and explicit measurement
  requests do not wait for animation callbacks. Native handler lookup failures
  cannot suppress browser delivery. A stream height is retained during document
  replacement, but only the replacement document's report confirms readiness;
  a missing report enables the scrollable recovery viewport.
- **Flashcards:** structured `FlashcardDisplayPayload` in tool presentation.
  Generic Artifact does not special-case `data-card-id`.
- **Deleted live APIs:** `evaluateCodeFence`, `splitMarkdownBlocks`,
  `MarkdownView.streamComplete`, DesktopPreferences `artifactPreviewEnabled`.

Desktop modules: `MarkdownView` (Streamdown adapter), `markdown-code-fence`
(dispatcher), `artifact-fence-controller`, `artifact-inline-preview`,
`artifact-sandbox-frame`, `artifact-frame-lifecycle`, `ArtifactStatic`.

`@piwin/artifact` stays policy/srcdoc/bridge parsers. Init queue and live-host
registry live in Desktop.

## 1. What openwebui_m already solved

Historical extraction notes. Live piwin names are in §0.

Path: `src/lib/components/chat/Messages/Artifacts/`

### 1.1 Module map (must understand before port)

| File | Role |
|------|------|
| `artifactTypes.ts` | Language aliases, size limits, status/phase unions, security result types |
| `artifactParser.ts` | Fence alias detection, HTML-like heuristics, title/attrs, native `html` promotion when HTML-UI mode on |
| `artifactSecurity.ts` | Placeholder detection, UTF-8 byte size, external resource scan, block reasons |
| `artifactSrcdoc.ts` | Strict CSP builder, theme CSS vars injection, responsive wrapper, postMessage bridge hooks |
| `artifactIframePolicy.ts` | iframe allowlist / mode |
| `artifactThemeContract.ts` | Detect/repair hard-coded light surfaces, full-page layouts |
| `artifactStreaming.ts` / `artifactStreamablePreview.ts` | Streaming-safe partial HTML handling |
| `artifactHeightPolicy.ts` / `artifactViewport.ts` | Height measurement & clamps |
| `artifactInitQueue.ts` | Serialize iframe inits (history perf) |
| `artifactCoordinator.ts` | Orchestrates status/phases across blocks |
| Svelte UI pieces | `ArtifactBlock`, preparing indicator, streaming footer — **UI only, do not port as-is** |

### 1.2 Key constants (baseline)

From `artifactTypes.ts`:

- Aliases: `artifact-html`, `artifact_html`, `ui-html`, `ui_html`, `html-artifact`
- Native languages: `html`, `htm`
- `MAX_ARTIFACT_BYTES = 100 * 1024`
- Height: completed inert Inline HTML/SVG uses sanitized Shadow DOM and follows
  parent-document flow with no height protocol. Active/embedded or streaming
  Inline content uses one ResizeObserver measurement stream; the transcript
  owns vertical scrolling. A 16384px defensive ceiling enters overflow mode
  rather than silently cropping. Canvas owns its internal scrollport.
- `ARTIFACT_READY_TIMEOUT_MS = 5000`
- `MAX_CONCURRENT_ARTIFACT_INITS = 1` (history)

### 1.3 Security model (non-negotiable)

`classifyArtifactSecurity`:

1. empty/placeholder → `blocked-empty`
2. over size → `blocked-too-large`
3. external http(s) resources (script/link/img/iframe/object/media) → `blocked-external-resource` (unless iframe allowlisted)
4. else `canRender: true`

CSP direction (`artifactSrcdoc.ts`):

- `default-src 'none'`
- inline script/style only
- `img-src data: blob:`
- `connect-src 'none'`
- no form action / object

postMessage bridge uses `channelId` + `event.source` checks (design doc).

### 1.4 Product design v1.1 lessons

From `docs/product/openwebui-html-rendering-design-v1.1.md`:

- Preview does **not** replace source code block
- MVP: single fenced block, not multi-file project artifact
- Default strict offline-ish mode (no CDN)
- Copy/download = **raw model source**, never wrapped srcdoc
- Streaming full interactivity is hard; partial preview is optional/later
- Do not claim hard CPU/memory limits

### 1.5 Port plan into piwin

```text
openwebui_m (Svelte-coupled)
        │ extract pure TS
        ▼
packages/artifact/src/
  types.ts
  parser.ts
  security.ts
  srcdoc.ts
  iframe-policy.ts
  theme-contract.ts
  streaming.ts
  height-policy.ts
  index.ts
        │
        ▼
apps/desktop UI adapter (React/WebView)
  ArtifactFrame component (iframe sandbox)
```

**Rules**

1. Zero Svelte imports in `@piwin/artifact`
2. Bring unit tests (`*.test.ts`) with policy cases
3. Rename CSS vars from `--owi-*` to `--piwin-artifact-*` but keep semantics
4. Markdown remains the default for short prose and ordinary source; dense reference
   content may proactively use an Artifact when visual grouping, search, filtering,
   copying, comparison, or reuse materially improves the result. Rendering still
   requires a detected HTML UI fence.

---

## 2. Markdown default

| Concern | Decision |
|---------|----------|
| Default body | Markdown (GFM-ish) |
| Ordinary code | Always source + Copy |
| Explicit `artifact-html` | RenderIntent; compatible Inline may auto-preview when capability is on and code-first is off |
| Native `html`/`svg` | Same default Inline path as explicit Artifact when capability is on; `artifactCodeFirst` keeps source-first |
| Canvas | Explicit `surface="canvas"` launcher; live panel stream-preview |

---

## 3. Images (chat preview + paste)

### 3.1 Display (assistant/user)

- Render image attachments as bubble previews (thumbnail → click open)
- Support markdown image syntax pointing to local paths or safe URLs
- Local paths resolved via media service / Tauri asset protocol (never raw file URL free-for-all)

### 3.2 Paste into composer

Flow:

```text
clipboard image
  → @piwin/media.savePaste({ sessionId, bytes, mime })
  → ~/.piwin/media/<sessionId>/<uuid>.png
  → ComposerAttachment { id, path, mime, width?, height?, bytes }
  → UI thumbnail chip (removable)
```

### 3.3 Model-facing payload

**Text models (v1 default)**:

```text
User text...

[attached image]
path: /Users/me/.piwin/media/<session>/<uuid>.png
mime: image/png
size: 245760 bytes
dimensions: 1280x720
```

**Do not** inject base64 into context by default.

**Vision-capable path (P1)**: when provider protocol + model advertise image input, host may send image content parts; still keep local file as source of truth.

### 3.4 Security

- mime allowlist: png/jpeg/webp/gif
- max paste size (e.g. 10MB)
- strip path traversal
- media dir only under `~/.piwin/media`

---

## 4. Hard problems (why research-first)

| Hard problem | Why | Mitigation |
|--------------|-----|------------|
| Streaming HTML partial DOM | Broken tags flash / XSS edge | Streaming preview only when balanced-enough; else preparing state |
| Height thrash | iframe resize loops | reject viewport-coupled Inline source; one root-box stream |
| Theme clash | white boxes in dark chat | theme contract repair |
| History perf | many iframes | init queue concurrency=1 |
| Tauri local image | custom protocol needed | media service + asset scope |
| Text model + images | model can't see pixels | path injection + clear UX label |

---

## 5. Acceptance for artifact/media MVP

1. Markdown messages render cleanly
2. Native ` ```html `/` ```svg ` and explicit compatible Artifact use the default Inline path when capability is on; `artifactCodeFirst` keeps source-first
3. Blocked states show reason (empty/too-large/external)
4. Paste image → disk → chip → send → text model receives absolute path
5. Chat shows image preview for that attachment
6. Unit tests cover security classifier + parser aliases

---

## 6. Implementation order

1. `@piwin/contracts` media + artifact types
2. `@piwin/media` save/list/resolve
3. `@piwin/artifact` pure runtime port (parser/security/srcdoc first)
4. Desktop markdown renderer + artifact frame + composer paste
5. Streaming/theme/height polish


---

## P2 polish landed (2026-07-20)

Historical. Current module map (2026-08-24):

| File | Role |
|------|------|
| `fence-index.ts` | Unique fence index + ordinals |
| `fence-parser.ts` | Descriptor from `ArtifactFenceRecord` |
| `render-intent.ts` | `analyzeArtifactFence` → RenderIntent |
| `materialize.ts` | Theme contract + stream sanitization + srcdoc/static source |
| `bridge-protocol.ts` | Parent parse/validate of size, action, and revisioned render snapshots |
| `height-policy.ts` | Pure normalization + 16 384 px defensive clamp |
| `streamable-preview.ts` | Script-stripped partial HTML preview |
| `theme-contract.ts` | Soft-repair hard-coded light surfaces for **preview source only** |
| `srcdoc.ts` / `srcdoc-css.ts` / `srcdoc-bridge.ts` | CSP + theme CSS + frame-mode CSS + bridge bootstrap |

Desktop schedulers (`artifact-init-queue.ts`, `artifact-live-host-registry.ts`)
are not `@piwin/artifact` exports. MarkdownView uses `renderingPhase` only.

## Height and routing (2026-08-24)

The 2026-08-22 height-chain notes and the 2026-08-24 overlay/streaming/canvas
amendments are superseded by the convergence plan. Current contract:

- Native `html`/`htm`/`svg` vs explicit `artifact-html` is recorded as
  `declaration`. Both compatible declarations use the default Inline path;
  `artifactCodeFirst` is the sole source-first preference for Inline.
- Full documents and viewport-coupled source use `inline-viewport` in the
  transcript; explicit `surface="canvas"` auto-opens the live Canvas panel and
  stream-previews until a successful completion.
- Canvas has no Inline height bridge. Sandboxed Inline observes
  `.piwin-artifact-root` or `document.body` and emits one revisioned size
  stream on both the native WK handler and `parent.postMessage`. Overflow
  above 16 384 px switches to `inline-overflow` with a host-owned viewport —
  content is not silently cropped.
- Theme/CSS repairs never rewrite stored descriptor source.
