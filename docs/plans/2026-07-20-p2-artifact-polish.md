# P2 Artifact Polish — Executable Plan

| Field | Value |
|-------|-------|
| Status | **Executed 2026-07-20** |
| Date | 2026-07-20 |
| Goal | Close D-ART-01..04 on top of the existing static Artifact core |
| Canonical backlog | [`docs/todo-deferred.md`](../todo-deferred.md) §2.3 |
| Roadmap phase | [`docs/specs/v1-completion-roadmap.md`](../specs/v1-completion-roadmap.md) §6 |
| Research baseline | [`docs/artifact-research.md`](../artifact-research.md) |
| Reference source | `~/Projects/openwebui_m/src/lib/components/chat/Messages/Artifacts/` |
| Target package | `packages/artifact` + `apps/desktop` adapter only |

---

## 0. Design summary (brainstorm conclusions)

### 0.1 What is already solid (do not re-architect)

piwin already has a **correct security-first static core**:

| Module | Role | Status |
|--------|------|--------|
| `parser.ts` | fence aliases, ambiguous/html promotion, markdown split | done |
| `security.ts` | empty / size / external resource classifier | done |
| `iframe-policy.ts` | disabled / allowlist / permissive | done |
| `srcdoc.ts` | strict CSP + theme CSS wrap | done **without** postMessage bridge |
| `evaluate.ts` | fence → decision pipeline | done |
| `theme.ts` | default `--piwin-artifact-*` tokens | done |
| `ArtifactFrame.tsx` | sandboxed iframe + blocked UI | done, **fixed height** |
| `MarkdownView.tsx` | evaluate complete fences only | done, **no open-fence streaming** |

Hard rules that stay binding:

1. Model HTML **never** runs in the parent document.
2. Copy/export = **raw model source**, never wrapped `srcdoc`.
3. Offline-by-default CSP (`connect-src 'none'`, no CDN scripts).
4. `@piwin/artifact` stays pure TS (no React, no DOM APIs in policy modules except where bridge script is a string).
5. Apps never import Pi packages; artifact does not talk to host/FS.

### 0.2 What openwebui_m proved that piwin still lacks

| Gap | openwebui_m source | User pain if skipped |
|-----|--------------------|----------------------|
| Height bridge | `artifactSrcdoc.ts` bootstrap + `artifactHeightPolicy.ts` | short cards leave empty space / tall UIs clip |
| Init concurrency | `artifactInitQueue.ts` (`MAX_CONCURRENT=1`) | resume long chat = many iframe inits thrash WebView |
| Streaming preview | `artifactStreaming.ts` + `artifactStreamablePreview.ts` | blank until fence closes; feels broken mid-stream |
| Theme repair | `artifactThemeContract.ts` + `artifactCssContract.ts` | model hard-codes white cards; dark theme looks broken |
| Status model | `artifactRenderStatus.ts` / generation status | UI cannot show preparing / streaming / ready / timeout |

### 0.3 What we deliberately **do not** port in P2 polish

These exist in openwebui_m but are out of scope for this plan (record as deferred if still wanted later):

| Skip | Why |
|------|-----|
| Full `artifactCoordinator` multi-open dispose graph | piwin chat is single-column; simple per-frame lifecycle is enough |
| `LazyArtifactBlock` eviction / virtualization | only needed after history is very long; measure first |
| Nested surface / deep iframe nesting policies | rare in coding-agent HTML UI |
| `blocked-theme-incompatible` hard block | prefer **soft repair** so preview still shows |
| Svelte stores / `artifactIframePolicyStore` | desktop keeps React local state / props |
| Expanded height 2200 + multi-phase “final-trim” full fidelity | start with protected → interactive + shrink confirm; expand later if needed |
| Parent↔child rich command channel (beyond ready/resize) | YAGNI until interactive host tools inside artifact |

### 0.4 Recommended execution order (dependency-driven)

```text
A0 Types + message protocol constants
  → A1 Height postMessage bridge + policy  (D-ART-02)   [biggest static UX win]
  → A2 Init queue + historical lazy mount  (D-ART-03)   [needed once many iframes measure]
  → A3 Streaming open-fence + streamable preview (D-ART-01)
  → A4 Theme / layout contract soft-repair (D-ART-04)
  → A5 Wire theme from active @piwin/theme tokens
  → A6 Docs + backlog closeout
```

Rationale:

- Height improves **already-complete** artifacts without changing the markdown stream path.
- Init queue becomes valuable **after** height measurement work loads more iframes.
- Streaming touches `MarkdownView` + chat stream state and is the riskiest surface.
- Theme repair is pure-source transform; can land after height so repaired HTML still measures correctly.

### 0.5 Architecture after polish

```text
MarkdownView / Chat message stream
        │
        ├─ complete fence ──► evaluateCodeFence(...)
        │                         │
        │                         ├─ kind: code
        │                         ├─ kind: blocked
        │                         └─ kind: render | stream-preview
        │
        └─ open fence (streaming) ──► buildStreamablePreview → evaluate (scripts stripped)

ArtifactFrame (React)
  requestArtifactInit(id) ──► assign srcdoc
  window message listener ──► channelId match → height policy → iframe height
  releaseArtifactInit(id) on unmount
```

Package layout target:

```text
packages/artifact/src/
  constants.ts              # + bridge types, concurrent init max
  types.ts                  # + status/phase, theme issues, stream result
  parser.ts                 # existing
  security.ts               # existing
  iframe-policy.js          # existing
  html-document-fragment.ts # existing
  theme.ts                  # existing defaults
  srcdoc.ts                 # + bridge bootstrap script (string)
  bridge-protocol.ts        # NEW: message type constants + parse/validate parent messages
  height-policy.ts          # NEW: pure height resolve (from owi)
  init-queue.ts             # NEW: pure concurrent grant/release
  streaming.ts              # NEW: open fence detection / ambiguous normalize
  streamable-preview.ts     # NEW: script-stripped partial HTML
  theme-contract.ts         # NEW: soft repair light surfaces
  css-contract.ts           # NEW (subset): full-page height / root scroll-lock issues
  evaluate.ts               # + streaming/options hooks
  index.ts
  *.test.ts

apps/desktop/src/
  ArtifactFrame.tsx         # height listener, init queue, status chrome
  MarkdownView.tsx          # streaming props, open fence branch
  useArtifactBridge.ts      # optional hook: message filter by channelId
  artifact-theme-map.ts     # map active ThemeTokens → ArtifactThemeVariables
```

---

## 1. Success criteria (P2 polish exit)

A phase is done only when **all** of the following pass:

1. **Static complete artifact** resizes to content height (clamped min/max) within ~1.2s of load; no parent DOM execution of model HTML.
2. **History with ≥5 artifacts** does not assign more than `MAX_CONCURRENT_ARTIFACT_INITS` srcdocs at once; queue drains without stuck grants.
3. **While assistant is streaming** an open ` ```html ` / ` ```artifact-html ` fence, user sees a **non-script** growing preview or a clear “generating…” state — not a permanent blank card.
4. **On stream end**, preview switches to full interactive srcdoc (scripts allowed under CSP) and final height settles.
5. **Hard-coded light surfaces** (`background: white`, `bg-white`, etc.) are rewritten to `var(--piwin-artifact-surface)` in preview path; raw source in details still shows model original.
6. **Security regressions zero**: external CDN scripts still blocked; streamable preview never injects incomplete `<script>` tails.
7. Tests: package unit tests green; desktop typecheck green; new policy tests cover height/stream/repair golden cases.
8. `docs/todo-deferred.md` marks D-ART-01..04 done with dates; roadmap §6 notes polish complete.

---

## 2. Slice A0 — Types, constants, bridge protocol

### Intent

Lock the wire format before React work so height/stream/status share one vocabulary.

### Files

| File | Change |
|------|--------|
| `packages/artifact/src/constants.ts` | Add `MAX_CONCURRENT_ARTIFACT_INITS = 1`, `ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS = 70`, bridge type string constants, measure ladder delays, expand max height optional constant |
| `packages/artifact/src/types.ts` | Extend `ArtifactStatus`; add `ArtifactRenderPhase`, height phase/mode types, theme contract issue types, streamable preview result; optional `kind: 'stream-preview'` on decision **or** keep `render` + `mode: 'interactive' \| 'stream-preview'` |
| `packages/artifact/src/bridge-protocol.ts` | **NEW** pure parse: `{ type, channelId, height?, mode? }` → typed parent event or null |
| `packages/artifact/src/index.ts` | export new symbols |

### Message protocol (rename from openwebui_m)

| openwebui_m | piwin |
|-------------|-------|
| `open-webui-artifact:ready` | `piwin-artifact:ready` |
| `open-webui-artifact:resize` | `piwin-artifact:resize` |
| payload `channelId` | same |
| payload `height` | number (ceil ≥ 0) |
| payload `mode` | `'normal' \| 'interaction' \| 'trim'` |

Parent listener **must** reject when:

- `event.source` is not the iframe’s `contentWindow`
- `channelId` ≠ frame’s channel id
- height is not a finite number

### Decision: decision kind shape

**Prefer** extending render decision rather than a third kind:

```ts
kind: 'render'
mode: 'interactive' | 'stream-preview'
descriptor, security, srcdoc, csp
```

Blocked stays `kind: 'blocked'`. Non-artifact stays `kind: 'code'`.

### Tests

- `bridge-protocol.test.ts`: accept valid ready/resize; reject wrong type/missing channel/NaN height.
- constants exported and re-exported from index.

### Exit A0

Types compile; no UI behavior change yet.

---

## 3. Slice A1 — Height postMessage bridge (D-ART-02)

### Intent

Complete artifacts auto-size. Pure policy in package; DOM listener only in desktop.

### Port map

| openwebui_m | piwin target | Port style |
|-------------|--------------|------------|
| `artifactHeightPolicy.ts` | `height-policy.ts` | **near-literal** pure functions |
| `artifactSrcdoc.ts` bridge bootstrap | `srcdoc.ts` inject bootstrap `<script>` | adapt names (`owi` → `piwin`, class `.piwin-artifact-root`) |
| Svelte height wiring | `ArtifactFrame.tsx` | rewrite React |

### Package work

1. **`height-policy.ts`**
   - `normalizeArtifactHeight`
   - `resolveImmediateArtifactHeight` (protected floor / interactive non-shrink)
   - `resolveInteractiveArtifactShrink` (defer shrink + 70ms confirm)
   - Phases: `'protected' | 'final-trim' | 'interactive'`
   - Modes: `'normal' | 'interaction' | 'trim'`
   - Clamp with existing `MIN` / `MAX` (optionally add `MAX_EXPANDED` later; v1 polish uses single max 900)

2. **`srcdoc.ts`**
   - After theme CSS, inject `buildBridgeBootstrapScript(channelId)` (string template only).
   - Measure root `.piwin-artifact-root` visible bounds (port owi algorithm; keep comments explaining why scrollHeight alone fails).
   - Ladder: `[0, 80, 180, 360, 720, 1200]` ms re-measure after ready.
   - MutationObserver on body for dynamic content.
   - Interaction listeners: click/input/change/toggle/transitionend/animationend → measure with mode `interaction`.
   - Do **not** port the full secondary “blocked external embed runtime” script in the first pass unless tests show need; security classifier already blocks external resources pre-render.

3. **Optional `buildArtifactLayoutGuardCss`**
   - Minimal: `html, body { overflow: hidden }` already in owi; piwin currently allows body scroll differently — align to owi (iframe owns scroll via height, not internal page scroll) to make height stable.

### Desktop work

1. **`ArtifactFrame.tsx`**
   - Generate stable `channelId` = `descriptor.id` (already used).
   - State: `height`, `phase` (`protected` → after ready timeout or first ready → `interactive`), `floor`.
   - `useEffect` register `window.addEventListener('message', ...)`.
   - On ready: apply height; arm `ARTIFACT_READY_TIMEOUT_MS` fallback to interactive with current height.
   - On resize: run height policy; set iframe style height.
   - Show status pill: `loading` / `ready` / `timeout` (map from phase).
   - Keep source `<details>` with **raw** descriptor.source.

2. **CSS**
   - `.artifact-iframe { width:100%; border:0; transition: height 120ms ease; }` (transition optional; avoid fighting shrink confirm).

### Tests

| Test file | Cases |
|-----------|-------|
| `height-policy.test.ts` | protected never shrinks below floor; interactive normal only grows; interaction shrink deferred then applies |
| `srcdoc.test.ts` | srcdoc contains `piwin-artifact:ready` and channelId; CSP still present; meta channel present |
| desktop (light) | if feasible, pure helper for “apply message → next height” without jsdom iframe |

### Acceptance A1

- Static tall HTML grows iframe past 260px up to max.
- Static short HTML stays ≥ min 160.
- Spoofed `postMessage` from `window` without matching channelId ignored.
- Existing security tests still pass.

### Exit A1 → mark **D-ART-02** done in todo after verification.

---

## 4. Slice A2 — Init queue (D-ART-03)

### Intent

When history shows many artifacts, serialize iframe **srcdoc assignment** so WebView does not jank.

### Port map

| openwebui_m | piwin |
|-------------|-------|
| `artifactInitQueue.ts` | `init-queue.ts` |
| `MAX_CONCURRENT_ARTIFACT_INITS = 1` | same default (export for tests) |

### Package work

```ts
requestArtifactInit(id, { priority? }) → Promise<{ granted: true }>
releaseArtifactInit(id)
resetArtifactInitQueueForTests()
getActiveArtifactInitCount()
```

Semantics (match owi):

- If already active → resolve immediately.
- If slots free and queue empty → grant immediately.
- Else enqueue by priority (higher first); grant on release.
- Re-request same id while queued: replace queue entry.

### Desktop work

1. `ArtifactFrame`:
   - On mount: `await requestArtifactInit(id)` **before** setting `srcDoc` (use state `granted` + `srcDoc` empty until granted).
   - On unmount / decision change: `releaseArtifactInit(id)`.
   - Priority: visible latest message higher than older (pass `priority={messageIndex}` or `Date.now()` for newest).
2. `MarkdownView` / App: pass optional `initPriority` into frame (newest assistant message = higher).

### Tests

- Concurrent grants never exceed max.
- Release drains queue FIFO among equal priority; higher priority first.
- Double-release is safe.
- Re-queue same id does not leak resolvers.

### Acceptance A2

- 10 historical artifacts: only 1 (or configured N) initializes at a time; all eventually ready.
- Unmount mid-queue does not leave permanently stuck grants.

### Exit A2 → mark **D-ART-03** done.

---

## 5. Slice A3 — Streaming partial preview (D-ART-01)

### Intent

While the model streams an unfinished HTML fence, show a **safe, non-executing** preview that grows; on completion, swap to interactive srcdoc.

### Port map

| openwebui_m | piwin | Notes |
|-------------|-------|-------|
| `artifactStreaming.ts` | `streaming.ts` | open fence find + ambiguous normalize |
| `artifactStreamablePreview.ts` | `streamable-preview.ts` | strip scripts/styles tails; balance tags for preview |
| `artifactHtmlBalance.ts` | import only what streamable needs | port helpers used by preview, not entire unused surface |
| generation status helpers | optional thin `render-status.ts` | map streaming/done → phase labels |

### Critical product rules

1. Stream preview **must strip**:
   - complete + trailing incomplete `<script>`
   - trailing incomplete `<style>`
   - inline `on*` handlers
   - `javascript:` urls
   - nested iframe/object/embed
2. Stream preview **may** show structure-only HTML (cards/grids) when `canStream` is true; else show “Generating HTML UI…” chrome without iframe.
3. Security classifier still runs on preview source **and** final source.
4. Do not promote incomplete ambiguous fences until HTML-like heuristic says yes (port `normalizeAmbiguousArtifactFences` / `findOpenArtifactFence`).

### Package API

```ts
// streaming.ts
findOpenArtifactFence(content, htmlUiModeEnabled): OpenArtifactFence | null
normalizeAmbiguousArtifactFences(content, htmlUiModeEnabled, done): string

// streamable-preview.ts
buildStreamableArtifactPreview(source: string): { canStream: boolean; previewSource: string }

// evaluate.ts extension
evaluateStreamingMarkdown(text, { done, htmlUiModeEnabled, theme, iframePolicy })
  → Array of markdown blocks where last open fence may be stream-preview
```

Prefer **not** forcing full re-parse of entire chat every delta if expensive; acceptable v1: re-evaluate last assistant message text only (desktop already has message text).

### Desktop work

1. `MarkdownView` gains:
   ```ts
   type Props = {
     text: string;
     htmlUiModeEnabled?: boolean;
     /** false while assistant message still streaming */
     streamComplete?: boolean; // default true for history
   };
   ```
2. When `streamComplete === false`:
   - normalize ambiguous fences with `done: false`
   - if open artifact fence at end → build streamable preview → evaluate as `mode: 'stream-preview'`
   - show `ArtifactFrame` with non-interactive chrome (“streaming”) and **no** script-capable expectation (still sandbox allow-scripts but source has no scripts)
3. When `streamComplete` flips true:
   - re-evaluate final complete fences as interactive
   - remount iframe (new channelId suffix `-final` optional to avoid stale messages) and re-request init
4. App: pass `streamComplete={message.status !== 'streaming'}` for assistant bubbles.

### Tests

| Area | Cases |
|------|-------|
| open fence | incomplete ```html ... no close → found; closed → null |
| ambiguous | `artifact` + html-like body promotes only when heuristic hits |
| streamable | strips half script; strips onClick; canStream true for simple div grid |
| evaluate | streaming path never returns interactive srcdoc containing user script tags from incomplete source |
| security | external script in stream still blocked |

### Acceptance A3

- Mid-stream: user sees growing preview or explicit generating state within first meaningful HTML tags.
- Stream end: interactive preview matches static path quality (height + security).
- Abort mid-stream: no stuck queue grant; frame unmounts cleanly.

### Exit A3 → mark **D-ART-01** done.

---

## 6. Slice A4 — Theme / layout soft-repair (D-ART-04)

### Intent

Dark theme does not get blinded by model `background: #fff` / Tailwind `bg-white`.

### Port map

| openwebui_m | piwin | Scope for polish |
|-------------|-------|------------------|
| `artifactThemeContract.ts` | `theme-contract.ts` | light surface / variable / tailwind class repairs |
| `artifactCssContract.ts` | `css-contract.ts` | **subset**: full-page `100vh` on root-like selectors; root `overflow: hidden` scroll-lock issues |

### Product decision

- **Soft repair only** for preview: repaired source feeds `srcdoc`; details panel shows **original** `descriptor.source`.
- Do **not** introduce `blocked-theme-incompatible` in this slice.
- Repair runs **after** parse, **before** security?  
  **Order decision:** parse → **repair for preview copy** → security(classify original OR repaired?)  
  - Security must classify **original** for external resources (repair does not invent scripts).  
  - Size limit: classify original bytes; if original oversize, block even if repair would shrink (rare).  
  - Srcdoc uses **repaired** source when repairs applied.

### Package API

```ts
applyArtifactThemeContract(source: string): {
  source: string;          // maybe repaired
  issues: ArtifactThemeContractIssue[];
  repairs: ArtifactThemeContractRepair[];
  changed: boolean;
}
```

Rename CSS var replacement target to `var(--piwin-artifact-surface)`.

Integrate in `evaluateHtmlArtifactDescriptor`:

```ts
const contract = applyArtifactThemeContract(descriptor.source);
const security = classifyArtifactSecurity(descriptor.source, ...); // original
const bodySource = contract.changed ? contract.source : descriptor.source;
buildHtmlArtifactSrcdoc({ source: bodySource, ... });
// optional: attach contract.issues to decision for UI badge “theme adjusted”
```

### Desktop

- Optional small badge: “theme adjusted (N)” when `issues.length > 0`.
- No settings toggle required for v1 polish (always on for dark/light consistency).

### Tests

Port golden cases from owi tests (rename tokens):

- `background: white` → surface var
- `bg-white` class → repaired
- CSS variable `--card-bg: #fff` → surface var
- Do not rewrite intentional dark colors
- Full-page `html, body { height: 100vh }` flagged or softened per subset policy

### Acceptance A4

- Dark host theme + white-card model HTML renders readable dark surface in preview.
- Raw source details still show model white declarations.
- Security still blocks external scripts.

### Exit A4 → mark **D-ART-04** done.

---

## 7. Slice A5 — Theme token mapping from `@piwin/theme`

### Intent

Artifact CSS variables follow the active desktop theme, not only `createDefaultArtifactTheme('dark')`.

### Work

1. `apps/desktop/src/artifact-theme-map.ts`  
   Map active theme tokens (bg/surface/text/muted/accent/border/radius/font) → `ArtifactThemeVariables`.
2. `MarkdownView` / App reads active theme (already ThemePanel path) and passes `theme` into `evaluateCodeFence`.
3. When theme switches, remount or re-evaluate visible artifacts (key=`${themeId}:${descriptor.id}`).

### Tests

- Mapper unit test: light/dark fixtures produce expected `--piwin-artifact-*` keys.
- No package circular dep: mapping stays in desktop (or thin helper in artifact that accepts plain record).

### Exit A5

Switching ThemePanel updates new artifacts; existing frames remount with new tokens.

---

## 8. Slice A6 — Docs, backlog, verification matrix

### Docs updates

| Doc | Update |
|-----|--------|
| `docs/todo-deferred.md` | D-ART-01..04 → done with date; note any residual skips (§0.3) as new deferred IDs if desired |
| `docs/specs/v1-completion-roadmap.md` §6 | Status → **Polish complete**; link this plan |
| `docs/artifact-research.md` | Add “P2 polish landed” subsection with final module map |
| `AGENTS.md` if needed | only if new invariant (e.g. bridge message filter) |

### Residual deferred IDs (create only if still wanted)

| ID | Item |
|----|------|
| D-ART-05 | Lazy eviction / virtualize off-screen artifacts |
| D-ART-06 | Expanded height mode (>900) with user toggle |
| D-ART-07 | Runtime external-embed reporter script inside iframe |
| D-ART-08 | Hard theme-incompatible block mode |

### Full verification matrix

```bash
# from repo root
pnpm --filter @piwin/artifact test
pnpm --filter @piwin/artifact typecheck
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/desktop test
```

Manual Desktop checklist:

1. Prompt model for a short HTML card → height tight.
2. Prompt for a tall dashboard HTML → grows to max, not clipped silently without scroll policy.
3. Stream a long HTML reply → streaming preview appears before close fence.
4. Resume session with many artifacts → staggered init, UI remains responsive.
5. Dark theme + white-card HTML → repaired surfaces.
6. External `<script src="https://cdn...">` → blocked with reason.
7. Copy/source details = original model HTML.

---

## 9. Task checklist (execution order)

Copy into session todos when implementing.

### A0 — Protocol & types
- [ ] T0.1 constants + bridge type strings
- [ ] T0.2 types: phase/status/stream mode/theme issues
- [ ] T0.3 `bridge-protocol.ts` + tests
- [ ] T0.4 export from `index.ts`

### A1 — Height (D-ART-02)
- [ ] T1.1 `height-policy.ts` + tests (port owi pure functions)
- [ ] T1.2 inject bridge bootstrap into `srcdoc.ts` + tests
- [ ] T1.3 `ArtifactFrame` message listener + phase machine
- [ ] T1.4 visual clamp CSS; timeout → interactive
- [ ] T1.5 verify spoof message ignored

### A2 — Init queue (D-ART-03)
- [ ] T2.1 `init-queue.ts` + tests
- [ ] T2.2 ArtifactFrame grant-before-srcdoc
- [ ] T2.3 priority from message order
- [ ] T2.4 unmount release

### A3 — Streaming (D-ART-01)
- [ ] T3.1 `streaming.ts` open fence + normalize
- [ ] T3.2 `streamable-preview.ts` sanitizer + tests
- [ ] T3.3 evaluate streaming helpers
- [ ] T3.4 MarkdownView `streamComplete` branch
- [ ] T3.5 App wiring message.status
- [ ] T3.6 final remount interactive + height

### A4 — Theme repair (D-ART-04)
- [ ] T4.1 `theme-contract.ts` soft repair + tests
- [ ] T4.2 optional `css-contract.ts` subset
- [ ] T4.3 evaluate uses repaired body for srcdoc
- [ ] T4.4 optional UI “theme adjusted” badge

### A5 — Active theme mapping
- [ ] T5.1 desktop mapper
- [ ] T5.2 pass theme into evaluate
- [ ] T5.3 remount on theme change

### A6 — Closeout
- [ ] T6.1 update todo-deferred + roadmap
- [ ] T6.2 update artifact-research module map
- [ ] T6.3 full test/typecheck matrix
- [ ] T6.4 manual Desktop checklist

---

## 10. Implementation notes (pitfalls from openwebui_m + piwin)

1. **`exactOptionalPropertyTypes`**: do not assign `prop: undefined`; omit keys (piwin house style).
2. **channelId stability**: changing id mid-stream without remount causes height drops; on stream→final, prefer remount with new id suffix.
3. **srcdoc string size**: repair + bridge script increases bytes; security max is on **model source**, not srcdoc — keep that invariant explicit in tests.
4. **Tauri WebView postMessage**: use `window.addEventListener('message')` on parent; verify `event.source === iframeRef.contentWindow` (works in WKWebView; if not, channelId-only is necessary but weaker — document fallback).
5. **Do not run streamable preview security with incomplete tags falsely empty** — placeholder detection must not treat half-written HTML as empty if it already has tags.
6. **No host IPC for artifact** — pure client-side; keep it that way (offline, private).
7. **Prefer porting tested pure functions over re-inventing** height/stream heuristics; rewrite only the React shell.
8. **Git commits**: one commit per slice (A1, A2, A3, A4) for reviewability when user asks to commit.

---

## 11. Effort estimate (planning only)

| Slice | Relative effort | Risk |
|-------|-----------------|------|
| A0 | S | low |
| A1 | M | medium (WebView message quirks) |
| A2 | S | low |
| A3 | L | high (stream edge cases) |
| A4 | M | medium (false-positive repairs) |
| A5 | S | low |
| A6 | S | low |

Suggested implementation sessions:

1. Session 1: A0 + A1 + A2 (static polish complete, shippable alone)
2. Session 2: A3 (streaming)
3. Session 3: A4 + A5 + A6 (theme quality + docs)

Session 1 alone is a valid partial ship if streaming slips.

---

## 12. Open questions (resolved defaults for execution)

| Question | Default for this plan |
|----------|----------------------|
| Concurrent inits | `1` (match owi history safety) |
| Max height | keep 900; expand mode deferred (D-ART-06) |
| Stream cannot preview | show preparing chrome, not raw partial script soup |
| Theme repair | always-on soft repair for preview |
| Hard theme block | no |
| Coordinator / eviction | no |
| Bridge secondary embed guard script | defer (D-ART-07) |

If product later wants different defaults, change constants only — policy modules stay pure.

---

## 13. Ready to execute

This plan is **implementation-ready**. Next action when starting work:

1. Create todos from §9 checklist.
2. Execute **A0 → A1 → A2** first; stop for visual check in Desktop.
3. Then A3; then A4–A6.
4. Close D-ART-01..04 only after §1 success criteria and §8 verification matrix.

Do not mark P2 polish complete based on scaffolding alone.


---

## 14. Execution record (2026-07-20)

| Slice | Status | Notes |
|-------|--------|-------|
| A0 Protocol & types | done | `bridge-protocol.ts`, extended types/constants |
| A1 Height (D-ART-02) | done | srcdoc bootstrap + height-policy + ArtifactFrame listener |
| A2 Init queue (D-ART-03) | done | grant-before-srcdoc; priority from message order |
| A3 Streaming (D-ART-01) | done | normalizeStreaming + streamable-preview; MarkdownView streamComplete |
| A4 Theme repair (D-ART-04) | done | soft-repair; theme adjusted badge |
| A5 Theme mapping | done | `artifact-theme-map.ts` + App activeTheme |
| A6 Docs | done | todo-deferred + roadmap + this record |

**Verification:** `@piwin/artifact` 51 tests; `@piwin/desktop` typecheck + 7 tests green.
