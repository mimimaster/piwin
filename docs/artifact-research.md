# Artifact & Media Research Notes (for piwin)

| Field | Value |
|-------|-------|
| Date | 2026-07-19 |
| Source A | `~/Projects/openwebui_m` HTML artifact system |
| Source B | openwebui product design v1.1 |
| Source C | Codex-style image chat UX (product reference) |
| Goal | Port proven policies into `@piwin/artifact` + `@piwin/media`, not invent unsafe shortcuts |

---

## 1. What openwebui_m already solved

## 0. piwin coding-agent rendering policy

The artifact security model remains independent from the chat presentation
phase. In the coding-agent transcript:

- `streaming` renders Markdown source safely; HTML fences remain source-only,
  Mermaid is not executed, and no Artifact iframe is mounted.
- `completed` may render normal Markdown and shows Artifact source first. An
  Artifact iframe is mounted only after the user explicitly chooses `Preview
  artifact`.
- `explicit-artifact-review` is the same source-first policy with an explicit
  review intent; it does not bypass the security classifier or CSP.
- Thinking, tool output, permission waits, and process activity belong in the
  run timeline/cards rather than becoming HTML artifacts.

Copy actions always copy raw model source, never an iframe `srcdoc` wrapper.

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
- Height: min 160, initial 260, max collapsed 900, max expanded 2200
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
4. Markdown remains default message renderer; artifact only for detected HTML UI fences

---

## 2. Markdown default

| Concern | Decision |
|---------|----------|
| Default body | Markdown (GFM-ish) |
| Code fences | Always show source |
| HTML fence | If UI-like + mode enabled → artifact preview under/beside source |
| SVG | v1: treat via iframe like openwebui MVP (optional follow-up) |

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
| Height thrash | iframe resize loops | port height policy + settle windows |
| Theme clash | white boxes in dark chat | theme contract repair |
| History perf | many iframes | init queue concurrency=1 |
| Tauri local image | custom protocol needed | media service + asset scope |
| Text model + images | model can't see pixels | path injection + clear UX label |

---

## 5. Acceptance for artifact/media MVP

1. Markdown messages render cleanly
2. ` ```html ` UI-like block gets sandboxed preview when security allows
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

Module map in `@piwin/artifact` after polish:

| File | Role |
|------|------|
| `bridge-protocol.ts` | Parent parse/validate of `piwin-artifact:ready|resize` |
| `height-policy.ts` | Pure height settle (protected / interactive / shrink confirm) |
| `init-queue.ts` | Serialize iframe srcdoc assignment |
| `streaming.ts` | Open fence detect + synthetic close while streaming |
| `streamable-preview.ts` | Script-stripped partial HTML preview |
| `theme-contract.ts` | Soft-repair hard-coded light surfaces for preview |
| `srcdoc.ts` | CSP + theme CSS + bridge bootstrap script |

Desktop: `ArtifactFrame` (height + init queue), `MarkdownView` (`streamComplete`), `artifact-theme-map.ts`.

Residual: D-ART-05..08 in `todo-deferred.md`.
