# Design: Artifact Preview Opt-In (Markdown-first)

| Field | Value |
|-------|-------|
| Status | Reviewed — ready for implementation plan |
| Date | 2026-07-30 |
| Branch context | Desktop chat + `@piwin/artifact` |
| Related | [ADR 0005](../../adr/0005-artifact-and-media.md), [artifact-research](../../artifact-research.md), PRD AR-01..AR-09 |
| Decision | **Approach 1**: global **Artifact preview** off by default; when on, per-fence **Preview artifact** still required before iframe mount |

---

## 0. Context: original ask and design thinking

This section records **why** the design exists, before the formal problem statement. It is a compact log of the product discussion that produced Approach 1.

### 0.1 Original requirements (user)

| # | Ask | Notes |
|---|-----|--------|
| R1 | Review whether project **Artifact 具现** is usable | Assessment: heavy stack (`@piwin/artifact` + Desktop `ArtifactFrame`) is solid and shippable as MVP, but always “armed” on HTML candidates; P1 gaps (side panel, export, config wiring) remain. |
| R2 | Prefer **抽出按钮开启**；**正常就 markdownRender** | Default chat should feel like ordinary Markdown + code. Materializing HTML UI should be an explicit user action / capability, not ambient chrome. |
| R3 | Confirm how today’s path works | Entry is Markdown **fence languages** (not a custom URL scheme). Runtime uses sandbox `srcdoc` + a **custom postMessage bridge** (`piwin-artifact:ready \| resize \| action`). |
| R4 | Current system feels **relatively heavy**; may later want a **lightweight** render path similar to Cherry Studio (special Markdown / fence formats that render in-thread) | Do not force light formats through CSP/iframe/height-bridge. Reserve a separate light fence path for later. |
| R5 | Choose among three extraction shapes for the “button” | User accepted the recommended **Approach 1** (see §0.3). |

In one line: **Markdown is the default product surface; heavy HTML Artifact is opt-in; leave room for a future light renderer without rewriting security.**

### 0.2 Rough design thinking (agent)

**What the codebase already is**

- `@piwin/artifact` is a correct **heavy** pipeline: parse → security → theme soft-repair → CSP srcdoc → parent height/action bridge. Flashcards already depend on it for interactive flip cards.
- Desktop is already **source-first** after complete (Preview button before iframe). Streaming never mounts Artifact. Mermaid/KaTeX are separate **light** branches inside `MarkdownView`.
- Pain is product policy and wiring, not a missing sandbox: capability is effectively always on; config `htmlUiModeDefault` / `maxBytes` are not driven from UI.

**Two capabilities must not share one switch**

| Path | Role | When |
|------|------|------|
| **Light** | In-document enhancements (mermaid, math; later svg / `html-preview`) | Everyday readability; soft-fail to source |
| **Heavy** | Sandboxed interactive HTML deliverable + optional host actions | Explicit opt-in; flashcards; full UI artifacts |

Cherry-style features belong on **Light**. Current openwebui_m port belongs on **Heavy**. The opt-in button in this design gates **Heavy only**.

**How to “抽成按钮” — three options considered**

| # | Shape | Off | On | Verdict |
|---|--------|-----|-----|---------|
| **1** | Global capability default **off** + per-fence Preview when on | HTML fences = ordinary code (Copy only) | Show **Preview artifact**; click mounts iframe | **Chosen** — matches R2, small scope, room for light path later |
| **2** | Always detect HTML; never auto-mount iframe | N/A (no global off) | Always show Preview button | Rejected — still not “normal Markdown”; barely changes today |
| **3** | Dual: global + per-fence + optional auto-preview | Same as 1 | Global on → Preview; plus auto-open mode | Deferred — auto-preview is a third mode (`explicit-artifact-review`); add later if needed |

**Why Approach 1 (recommendation locked with user)**

1. Delivers **正常 markdownRender** when off — no Artifact chrome, no evaluate-for-display.
2. Keeps existing **per-fence Preview** when on — safer and cheaper than auto-mounting every HTML block.
3. Cheaper than Approach 3; more honest than Approach 2.
4. Does not block future light fences: mermaid/math stay ungated; new light languages get their own registry later.
5. Heavy stack (CSP, bridge, init-queue) is **retained**, not deleted — only **offered** when the user opts in (plus a narrow flashcard exception so interactive cards stay one click away).

**Out of scope for this redesign (called out early)**

- Side panel / fullscreen Artifact workspace, export HTML to project, CLI preview.
- Implementing Cherry-style light HTML/SVG (boundary only in §10).
- Rewriting the postMessage protocol or security classifier.

### 0.3 Decision snapshot

```text
User need:     default Markdown; Artifact by explicit enable
Chosen shape:  Approach 1 — global "Artifact preview" OFF by default
               + per-fence "Preview artifact" when ON
Later:         light special Markdown formats ≠ this switch
Ship bar:      preference + MarkdownView policy + maxBytes wiring
               + flashcard one-shot preview when global is off
```

---

## 1. Problem

Today Desktop already uses source-first Preview for HTML candidates, but:

1. **Heavy path is always “armed”** for UI-like `html` / explicit `artifact-*` fences after a message completes — users see Artifact chrome and a Preview button even when they only wanted normal Markdown/code.
2. **Config is not wired**: `PiwinConfig.artifact.htmlUiModeDefault` and `maxBytes` exist in host config-store, but `MarkdownView` hard-codes `htmlUiModeEnabled = true` and never receives `maxBytes`.
3. **Mental model is muddy**: coding turns and interactive HTML deliverables share one path. Future Cherry-style *light* fence renderers must not be forced through sandbox + bridge.

Goal: **normal transcript = Markdown render**; **heavy HTML materialization = explicit product opt-in**, without throwing away the security stack in `@piwin/artifact`.

---


## 2. Goals and non-goals

### Goals

| ID | Goal |
|----|------|
| G1 | Default assistant rendering is Markdown + ordinary code fences (Copy only). No Artifact frame, no Preview button, no iframe — **except the narrow flashcard exception in §6**. |
| G2 | A single user-visible control enables the **heavy** Artifact capability for the Desktop shell. |
| G3 | When capability is on, keep **source-first + per-fence Preview** (never auto-mount iframe on complete). Streaming remains source-only (ADR 0005). |
| G4 | Wire `maxBytes` (and capability default) from real config/preferences into evaluate. |
| G5 | Flashcards interactive cards remain usable without hunting obscure settings (narrow exception). |
| G6 | Leave a clean boundary so future **light** fence renderers (svg / html-preview / …) do not use `@piwin/artifact` bridge. |

### Non-goals (this change)

| ID | Non-goal |
|----|----------|
| NG1 | Side panel / fullscreen Artifact workspace (PRD AR-07). |
| NG2 | Export single artifact HTML to project file (PRD AR-08). |
| NG3 | Cherry-style light HTML/SVG renderers (design only reserves the slot). |
| NG4 | Stream-preview iframes while the assistant is still streaming. |
| NG5 | Removing or rewriting `@piwin/artifact` CSP / height / init-queue. |
| NG6 | CLI HTML preview. |

---

## 3. Product decision (locked)

**Approach 1 — Global capability switch + existing per-fence Preview.**

```text
artifactPreviewEnabled = false  (default)
  → every fence renders as ordinary Markdown code (language + source + Copy)
  → evaluateCodeFence / ArtifactFrame not used for display
  → exception: flashcard fences (see §6)

artifactPreviewEnabled = true
  → completed messages: HTML/artifact candidates get source + [Preview artifact]
  → click Preview → ArtifactFrame (sandbox iframe, bridge, height, security)
  → Hide preview → unmount iframe, source remains
  → streaming: still source-only (unchanged)
```

Rejected for this iteration:

- **Approach 2** (always show Preview, no global off) — does not deliver “normal Markdown”.
- **Approach 3** (global + auto-preview mode) — defer auto-preview; can layer later via existing `explicit-artifact-review` phase.

---

## 4. Concepts and naming

| Term | Meaning |
|------|---------|
| **Markdown path** | Paragraphs, lists, inline, ordinary code fences, Mermaid, KaTeX (existing light renderers). |
| **Heavy Artifact path** | `@piwin/artifact` evaluate → security → srcdoc → `ArtifactFrame` + postMessage bridge. |
| **Artifact preview enabled** | Desktop (and optionally host default) flag: whether the heavy path may be *offered* in chat. |
| **Preview open** | Per-fence React state: whether the iframe is mounted for that block. |
| **Light fence renderer** | Future/present in-document renderers (mermaid/math today). Not gated by Artifact preview. |

**UI copy (Desktop, EN / ZH):**

| Surface | EN | ZH |
|---------|----|----|
| Preference / switch label | Artifact preview | Artifact 预览 |
| Description | Allow sandboxed HTML UI previews for artifact fences. Off = Markdown and code only. | 允许对 artifact 代码块做沙箱 HTML 预览。关闭后仅 Markdown 与源码。 |
| Per-fence button | Preview artifact / Hide preview | 预览 Artifact / 收起预览 |
| Off + flashcard hint (optional) | Interactive card — enable Artifact preview | 交互卡片 — 请开启 Artifact 预览 |

Do **not** name the switch “HTML mode” in UI — that confuses with raw `html` fences and future light HTML preview.

---

## 5. State model

### 5.1 Desktop preference (primary runtime control)

Extend `DesktopPreferences` in `apps/desktop/src/ui-preferences.ts`:

```ts
export type DesktopPreferences = {
  // ...existing fields...
  /**
   * When false (default), chat never offers heavy Artifact iframe path
   * except flashcard exception (§6).
   */
  artifactPreviewEnabled: boolean;
};
```

- Storage key: `piwin.desktop.artifactPreviewEnabled`
- Default when key missing: **`false`**
- Persist via existing `loadDesktopPreferences` / `saveDesktopPreferences`
- Presentation-only (localStorage), same class as tool density — **not** session product state under `~/.piwin` session files

### 5.2 Host config (security limits + reserved seed)

Keep `PiwinConfig.artifact`:

```ts
artifact: {
  maxBytes: number;              // security limit when evaluating
  htmlUiModeDefault: boolean;    // reserved seed; see below
};
```

| Field | Role after this design |
|-------|------------------------|
| `maxBytes` | **Must** be passed into `evaluateCodeFence` whenever the heavy path runs (capability on, or flashcard Preview card open). |
| `htmlUiModeDefault` | **Reserved / backward-compat seed only.** Desktop v1 **does not read it** (R1, locked). The host default is changed to `false` in this same change so the field is consistent with the Markdown-first product intent and does not mislead future CLI/other clients that may choose to honor it. Operators who want a kiosk-like install with preview on can still set `htmlUiModeDefault: true` in config; non-Desktop clients are free to honor it later. |

**Two distinct flags — do not conflate:**

| Flag | Layer | Meaning |
|------|-------|---------|
| `artifactPreviewEnabled` | Desktop preference (product capability) | Whether the heavy Artifact path may be *offered* in chat. Gates iframe mount + Preview button. |
| `htmlUiModeEnabled` | `@piwin/artifact` parser option | Whether `evaluateCodeFence` promotes native `html`/`htm` fences to artifact descriptors. Pure parser concern. |

**Mapping (locked):**

- `capability === false` ⇒ `htmlUiModeEnabled = false` passed to `evaluateCodeFence`. Evaluate still runs (see §7) so language/source normalization is preserved, but native `html` fences fall through to the `code` decision and no iframe is mounted.
- `capability === true` ⇒ `htmlUiModeEnabled = true`. Explicit aliases (`artifact-html`, …) parse as descriptors regardless; they only matter when evaluate runs (capability on, or flashcard Preview card open).

### 5.3 Per-fence UI state

Keep local `useState` `artifactPreviewOpen` in `CodeFenceView` (or successor):

- Initial: `false`, except `renderingPhase === 'explicit-artifact-review'` → `true` (escape hatch; only honored when capability on — see §7).
- Reset when fence identity changes (language/source/message) as today via remount keys.

**Note on `explicit-artifact-review` today:** `resolveAssistantRenderingPhase` in `chat-thread.tsx` currently only ever returns `'streaming' | 'completed'` — the `explicit-artifact-review` phase is a future hook and is **not reachable** from any current code path (no model/tool can trigger it). The §7 rule "only honored when capability===true" is therefore defensive: it keeps the phase inert under capability=false if a future caller sets it. No change to `resolveAssistantRenderingPhase` is needed in v1.

### 5.4 Not session-scoped

No per-session override in v1. One Desktop-wide preference is enough. Session-level override is NG.

---

## 6. Flashcards exception

Flashcard tools instruct the model to emit `artifactHtml` inside a ` ```html ` fence. Interactive rating uses `piwin-artifact:action` and `data-card-id`.

**Rule:**

A fence is a **flashcard artifact fence** if the source contains a `data-card-id="..."` attribute (product contract already required for action validation).

| Capability | Flashcard fence behavior |
|------------|---------------------------|
| `artifactPreviewEnabled === false` | Still show ordinary source + Copy. Additionally show a compact affordance: either (A) **Preview card** that temporarily allows heavy path for this fence only, or (B) hint “Enable Artifact preview” linking focus to settings. **Prefer (A)** so review works one click without changing global default. |
| `artifactPreviewEnabled === true` | Same as any other HTML candidate: Preview artifact button. |

**(A) temporary allow** does **not** flip the global preference; only mounts iframe for that fence while open.

Detection helper (Desktop-local pure function, unit-tested):

```ts
function isFlashcardArtifactSource(source: string): boolean {
  return /data-card-id="[^"]+"/.test(source);
}
```

Do not special-case by language alone (`html` vs `artifact-html`).

**HTML comments:** the regex will also match `data-card-id` inside `<!-- … -->`. This is acceptable: a fake match only grants the *Preview card affordance* (a button), not any privilege. Action validation in `ArtifactFrame` still requires the `data-card-id="${cardId}"` substring to be present in the actual (non-commented) source and the action name to be whitelisted (§11). The unit test must固化 this behavior: a commented `data-card-id` yields `true` from the helper, but no interactive action can fire without a real matching id in source.

---

## 7. Rendering policy (normative)

Let `capability = artifactPreviewEnabled` (Desktop preference).

**Preprocessing (locked, addresses byte-stability):**

`MarkdownView` always calls `normalizeStreamingArtifactFences(text, htmlUiModeEnabled, !streamMode)` before splitting blocks, where `htmlUiModeEnabled = capability` (true when on, false when off). This keeps fence structure stable across capability toggles — the same `artifact-html` fence produces the same block boundaries and source bytes in both modes; only the per-fence decision branch differs. Skipping this call when capability is off would risk divergent fence splitting and is explicitly rejected.

For each code fence after stream policy:

| Condition | Behavior |
|-----------|----------|
| `renderingPhase === 'streaming'` | Source-only code block. No Mermaid execute (existing). No Artifact. |
| Mermaid / math languages | Unchanged light path. **Not** gated by `capability`. |
| `capability === false` and not flashcard source | Call `evaluateCodeFence` with `htmlUiModeEnabled: false`, `maxBytes` from host config. Native `html`/`htm` fences fall through to `code` decision → **ordinary code fence** (language, source, Copy). No Preview button, no iframe. |
| `capability === false` and flashcard source | Ordinary source + **Preview card** (exception §6). On open → re-evaluate with `htmlUiModeEnabled: true` + `ArtifactFrame`. |
| `capability === true` and not streaming | Call `evaluateCodeFence` with `htmlUiModeEnabled: true`, `maxBytes` from host config, theme from map. |
| decision `code` | Ordinary code fence (uses `decision.language` / `decision.source` so normalization stays consistent). |
| decision `blocked` | Source + muted “Artifact blocked: {reason}” (only when capability on or flashcard preview attempted). |
| decision `render` \| `preparing` | Source + Preview toggle; iframe only if preview open. |
| `explicit-artifact-review` | Only honored when `capability === true`; then initial `artifactPreviewOpen = true`. If capability false, ignore phase (treat as completed source-first without auto-open). Phase is unreachable today (§5.3). |

### 7.1 What “ordinary code fence” means

Same chrome as today’s non-artifact `code` branch:

- `md-code-block` / header language / `CopyCodeButton` / `<pre><code>`
- No `artifact-with-source` wrapper, no blocked strip, no ArtifactFrame
- Renders `decision.language` / `decision.source` (the evaluated+normalized values), **not** raw `props.language` / `props.source`, so language labels and source stay identical whether capability is on or off and the fence falls through to `code`.

### 7.2 Security invariants (unchanged)

1. Model HTML never executes in the parent document.
2. Iframe: `sandbox="allow-scripts"` without `allow-same-origin`; CSP offline-by-default.
3. Copy/export always raw model source, never srcdoc.
4. Actions: whitelist + `channelId` + `data-card-id` present in source.

---

## 8. Architecture and data flow

```text
┌─────────────────────────────────────────────────────────────┐
│ App / Settings                                               │
│  DesktopPreferences.artifactPreviewEnabled (localStorage)    │
│  PiwinConfig.artifact.maxBytes (host getConfig)              │
└───────────────────────────┬─────────────────────────────────┘
                            │ props
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ ChatThread → MarkdownView                                    │
│  artifactPreviewEnabled, artifactMaxBytes, artifactTheme…  │
└───────────────────────────┬─────────────────────────────────┘
                            │
              CodeFenceView decision tree (§7)
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Light: mermaid/math   Ordinary code     Heavy (opt-in)
   (always eligible)     (default)         evaluateCodeFence
                                                │
                                                ▼
                                          ArtifactFrame
                                          (existing bridge)
```

**Package boundary:**

| Layer | May change |
|-------|------------|
| `@piwin/artifact` | Optional: export a tiny pure helper `isFlashcardArtifactSource` **or** keep helper in Desktop only. Prefer **Desktop-local** helper in v1 to avoid package churn. No bridge protocol change. |
| `@piwin/contracts` | No required type change if preference stays Desktop-only. Optional doc comment on `htmlUiModeDefault` meaning “seed for clients”. |
| `apps/desktop` | Preference, Appearance switch, prop plumbing, `MarkdownView` policy, tests. |
| Host | Ensure Desktop can read `config.artifact` (already via getConfig / bootstrap). |

### 8.1 Where the global control lives

**Primary:** Settings → Appearance → Switch **Artifact preview** (next to code wrap / density).

**Optional convenience (same preference, not a second state):** compact toggle on transcript toolbar / context bar if a low-density control already exists for presentation prefs. **v1 minimum = Appearance only** to avoid chrome sprawl; toolbar is P2 if UX feels buried.

Both bind to the same `artifactPreviewEnabled` preference.

---

## 9. Component and file impact

### Modify

| File | Change |
|------|--------|
| `apps/desktop/src/ui-preferences.ts` | Add `artifactPreviewEnabled`; load/save; default `false`. |
| `apps/desktop/src/ui-preferences.test.ts` | Round-trip + default false. |
| `apps/desktop/src/settings/pages/appearance-page.tsx` | Switch + EN/ZH copy; include in reset-to-defaults. |
| `apps/desktop/src/App.tsx` | Pass `preferences.artifactPreviewEnabled` + `config?.artifact?.maxBytes` into `ChatThread`. `config` is already held in App state via `use-host-bootstrap`; no new IPC needed. |
| `apps/desktop/src/chat-thread.tsx` | Add `artifactPreviewEnabled`, `artifactMaxBytes` props; plumb into `MarkdownView`. |
| `apps/desktop/src/MarkdownView.tsx` | Implement §7 policy; flashcard exception; pass `maxBytes` + `htmlUiModeEnabled=capability` into evaluate; gate Preview/iframe on capability. |
| `apps/desktop/src/host-client-mock.ts` | Change mock `artifact.htmlUiModeDefault` to `false` to match new host default. |
| `apps/desktop/src/settings/settings-shell.test.tsx` | Already uses `false`; leave as-is (verify still green). |
| `packages/agent-host/src/config-store.ts` | Change `defaults.artifact.htmlUiModeDefault` from `true` to `false` (consistency with R1 + Markdown-first product default). |
| `docs/adr/0005-artifact-and-media.md` | Short amendment: capability opt-in default off on Desktop; host `htmlUiModeDefault` default lowered to `false`. |
| `docs/todo-deferred.md` | Note light fence registry / AR-07/08 still deferred. |

### Add

| File | Change |
|------|--------|
| `apps/desktop/src/MarkdownView.test.tsx` (new if none) | Policy tests: off→no Preview; on→Preview for artifact-html; streaming→no iframe; flashcard off→Preview card. |
| `apps/desktop/src/flashcard-artifact.ts` (optional small module) | `isFlashcardArtifactSource` + tests. |

### Do not change (v1)

- `packages/artifact` runtime modules (parser/security/srcdoc/bridge) unless a one-line export is justified.
- Flashcard HTML templates (still emit interactive HTML + `data-card-id`).
- CLI.

### Seed algorithm (first load)

```text
prefs = loadDesktopPreferences()
// R1 (locked): Desktop v1 ignores host seed; always defaults false
// until the user explicitly enables. localStorage missing key → false.
prefs.artifactPreviewEnabled = readBool(ARTIFACT_PREVIEW_KEY) ?? false
```

**R1 (locked):** ignore host `htmlUiModeDefault` for Desktop default; always default `false` until user enables. Simplest, matches “正常 markdownRender”. Host field remains as backward-compat seed for non-Desktop clients (default now also `false`, §5.2).

---

## 10. Future light-render boundary (informative)

Not implemented here; constrains naming and switches:

```text
MarkdownView fence registry (future)
  light: mermaid, math, (svg, html-preview, …)  ← NOT gated by artifactPreviewEnabled
  heavy: artifact-* / explicit deliverable HTML ← gated by artifactPreviewEnabled
```

When light `html-preview` ships, it must:

- Use a **distinct fence language** (e.g. `html-preview`), not silently replace heavy path.
- Forbid script / external URL (or strip), soft-fail to source.
- Not use `piwin-artifact:*` actions.

Heavy remains for flashcards and full UI deliverables.

---

## 11. Error and edge cases

| Case | Behavior |
|------|----------|
| User disables capability while a preview iframe is open | Next render: unmount all heavy frames; fences become ordinary code (or flashcard compact). |
| Theme switch with preview open | Existing remount via `artifactThemeKey` when capability on. |
| Blocked external resource | Only surfaces when user opened Preview (or capability on shows blocked strip without mounting). Prefer: show blocked reason when Preview clicked or when evaluate runs for open preview. |
| `maxBytes` exceeded | `blocked-too-large` same as today when evaluate runs. |
| Preference localStorage unavailable | In-memory default false; switch still works for session. |
| Explicit `artifact-html` with capability off | Ordinary code (source visible). No silent evaluate. |
| Malicious fence with fake `data-card-id` | May show Preview card affordance; actions still require matching id in source and whitelist — no privilege beyond current Artifact action model. |

---

## 12. Testing plan

| Layer | Cases |
|-------|-------|
| `ui-preferences` | default false; save/load true/false |
| `isFlashcardArtifactSource` | positive `data-card-id`, negative plain html |
| `MarkdownView` | (1) capability off + `artifact-html` → no `artifact-preview-toggle`; (2) capability on + safe artifact → toggle present; (3) streaming → no ArtifactFrame; (4) flashcard source + off → preview affordance present; (5) mermaid still renders when capability off; (6) **byte-stability**: `artifact-html` fence renders identical `decision.language` + `decision.source` bytes in both capability modes (only the action chrome differs); (7) capability off + plain `html` fence → ordinary code (no Preview), language label normalized via evaluate with `htmlUiModeEnabled=false` |
| Package artifact | No change required; existing 59 tests stay green |
| Manual smoke | Appearance toggle; Preview/Hide; flashcard rate with global off via Preview card; external script blocked |

---

## 13. Documentation updates

1. **ADR 0005** — amendment bullet: Desktop heavy Artifact path is **opt-in** (`artifactPreviewEnabled`, default false); per-fence Preview remains; streaming source-only unchanged.
2. **This design** — source of truth for the opt-in UX.
3. **PRD AR-04** — clarify dual view is available only when capability enabled (or flashcard exception).
4. Flashcard skill / tool description (optional follow-up): mention that users may need one-click Preview card if global preview is off.

---

## 14. Implementation phases

### Phase A — Policy + preference (shippable slice)

1. `DesktopPreferences.artifactPreviewEnabled` default false  
2. Appearance switch  
3. Plumb into `MarkdownView` + implement §7 without flashcard exception first  
4. Pass `maxBytes` from config into evaluate when heavy path runs  
5. Unit tests  

### Phase B — Flashcard exception

1. Detect `data-card-id`  
2. Preview card affordance when global off  
3. Action path regression (rate / open-source)  

### Phase C — Docs

1. ADR 0005 amendment  
2. Short note in artifact-research / backlog  

Phase A alone already delivers “正常 markdownRender”; Phase B is required before calling flashcards “done” under the new default.

---

## 15. Acceptance criteria

- [ ] Fresh Desktop profile: assistant ` ```html ` / ` ```artifact-html ` UI blocks look like normal code (Copy only); no Preview, no iframe.
- [ ] Mermaid / math still work with Artifact preview **off**.
- [ ] Enabling Artifact preview in Appearance shows **Preview artifact** on completed HTML candidates; iframe only after click.
- [ ] Streaming messages never mount Artifact iframes.
- [ ] `maxBytes` from host config applied when evaluating.
- [ ] Flashcard HTML with `data-card-id`: user can open interactive preview and rate without enabling global preference (Phase B).
- [ ] Disabling preference while previews open removes iframes.
- [ ] Typecheck + Desktop/package tests green for touched areas.
- [ ] ADR 0005 amended.

---

## 16. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Users never find the switch; “preview broken” | Clear Appearance label; Phase B flashcard one-click; optional later toolbar toggle. |
| Flashcards feel broken after default false | Phase B is part of the same feature ship bar, not a vague follow-up. |
| Confusing with future light HTML | Naming “Artifact preview”; reserve other fence languages for light path. |
| `htmlUiModeDefault` config field | Now reserved/seed with host default lowered to `false`; Desktop v1 ignores it (R1). Documented in ADR 0005 amendment. No silent dual sources of truth. |

---

## 17. Summary

| Question | Answer |
|----------|--------|
| How is the button extracted? | **One global “Artifact preview” preference (default off)** + existing **per-fence Preview** when on. |
| Default transcript? | **Markdown + ordinary code** (+ mermaid/math). |
| Heavy stack? | Kept; only offered when opted in (or flashcard one-shot preview). |
| Cherry-style light render later? | Separate fence registry; not this switch. |

---

## 18. Open points (resolved in this doc)

| Topic | Resolution |
|-------|------------|
| Approach 1 vs 2 vs 3 | **1** |
| Host seed vs hard default false | **R1 hard default false** for Desktop; host `htmlUiModeDefault` default lowered to `false` for consistency; field kept as backward-compat seed for non-Desktop clients |
| `htmlUiModeEnabled` vs `artifactPreviewEnabled` | **Distinct**: capability gates product path; parser flag = `capability` value passed to evaluate so native `html` falls through to `code` when off |
| `normalizeStreamingArtifactFences` when off | **Still called** with `htmlUiModeEnabled=false` for byte-stable fence splitting |
| Flashcards | **Per-fence Preview card without flipping global** |
| Toolbar toggle | **Optional P2; Appearance is v1** |
| Package changes | **Minimize; Desktop-first** + one-line host default change in `config-store.ts` |
