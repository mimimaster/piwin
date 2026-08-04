# Artifact Surface Routing + Canvas Shell Implementation Plan

> **For agentic workers:** implement with `subagent-driven-development` or
> `executing-plans`. Use test-driven development for parser, bridge, policy,
> and rendering changes. Do not begin implementation until this plan is
> approved.

**Plan classification:** Long. The work spans contracts, model resource loading,
the portable Artifact runtime, Desktop presentation state, security validation,
and documentation. Tasks 2 and 3 may run in parallel after Task 1; Desktop
Tasks 4 and 5 should remain sequential because they share the same rendering
and state paths.

**Goal:** Preserve the existing Inline Artifact experience, including
Expand/Collapse within the chat stage, while adding an explicit semantic route
for a small class of workspace-like artifacts to open in a right-side Canvas.
Make the model generate Inline UI that responds to the actual available space,
and allow Canvas interactions to propose bounded text for insertion into the
Composer without exposing a generic host bridge.

**Architecture:** Contracts define the stable `inline | canvas` surface
metadata and the concise model-facing generation contract. `@piwin/artifact`
parses the fence metadata, applies surface-specific layout policy, builds the
sandboxed document, and validates the narrow iframe action protocol. The host
appends the generation contract through Pi's existing `DefaultResourceLoader`
system-prompt seam so SDK and RPC-to-SDK-fallback sessions receive the same
rules. Desktop owns only ephemeral Canvas selection, the right-panel shell,
and Composer insertion. No Canvas data store, host IPC, filesystem service,
new package, or React/TSX compiler is introduced.

**Tech stack:** TypeScript strict, React 19, Tauri 2, `@piwin/contracts`,
`@piwin/artifact`, Pi `DefaultResourceLoader`, Vitest, Playwright.

---

## 1. Original requirement

The implementation must preserve the following product intent rather than
generalizing Canvas into a second editor or making every Artifact openable in
the right panel.

1. Existing Inline Artifact remains the default.
   - Inline keeps its current **Expand / Collapse** behavior.
   - Expand temporarily uses the full chat-stage width but never exceeds the
     chat region or becomes a separate workspace.
   - Large or long content alone is not a reason to enter Canvas.
2. Inline Artifact generation must become space-aware.
   - The model must be told the actual supported width range and generate a
     responsive embedded UI block rather than a full browser page.
   - The runtime must provide defensive containment and bounded overflow so a
     badly sized block cannot widen the transcript or disappear through silent
     clipping.
3. Canvas is a **routing shell**, not a universal Artifact editor.
   - It is used when the Artifact is an interaction/workspace rather than an
     illustration embedded in a message.
   - It renders the same raw HTML/SVG through the existing sandbox/CSP path.
   - It does not require Source/Preview tabs, independent persistence,
     multi-file state, React/TSX compilation, or project export.
4. Canvas must cover at least these semantic cases:
   - The page produces a result that should return to the Composer: technology
     selection, configuration values, requirement checklists, priority sorting,
     or generated continuation text.
   - The page is a multi-step/stateful flow: previous/next, a configuration
     wizard, questionnaire, staged filtering/confirmation, or local state that
     must survive several interactions.
   - The page is an **interactive prototype** whose primary deliverable is the
     UI experience: navigation, modal/dialog behavior, form validation, tabs,
     drag/drop, responsive transitions, or a realistic application/page flow.
     A static component mockup or simple visual example remains Inline.
   - The page is a workspace-like, detail-dense surface that benefits from
     staying visible beside the conversation: coordinated navigation/detail
     regions, cross-panel comparison, a topology/dashboard/diagram inspector,
     or another artifact where the user needs sustained inspection rather than
     a temporary glance.
   - The user explicitly asks for Canvas or a right-side interactive page.
5. All other cases use Inline Artifact.

---

## 2. Locked product decisions

### 2.1 Surface selection is semantic and explicit

Canonical fence syntax:

````markdown
```artifact-html title="Deployment configurator" surface="canvas"
<!-- self-contained HTML/CSS/JS body fragment -->
```
````

Supported values:

```ts
export type ArtifactSurface = 'inline' | 'canvas';
```

Rules:

- Missing `surface` means `inline`.
- Unknown values safely fall back to `inline`.
- Runtime measurements do **not** automatically promote an Inline Artifact to
  Canvas.
- Canvas fences render a compact launcher in the transcript and do not mount an
  inline iframe.
- Inline fences do not receive a generic "Open in Canvas" action. Expand is
  their temporary large-view affordance.
- Canvas does not auto-open while a response is streaming. Streaming remains
  source-only under ADR 0005.
- Completed Canvas launchers open the right panel only after user action. Model
  output must not unexpectedly rearrange the shell.

### 2.2 Canonical routing policy

The model-facing decision order is:

```text
if the user explicitly requests Canvas/right-side interaction:
  canvas
else if the UI must return a result to the Composer:
  canvas
else if the UI is multi-step or must retain local workflow state:
  canvas
else if the primary deliverable is an interactive application/page prototype:
  canvas
else if the UI is a persistent, coordinated, detail-inspection workspace:
  canvas
else:
  inline
```

The following are **not** Canvas criteria by themselves:

- many words;
- tall content;
- a wide chart or table;
- tabs, filtering, hover, animation, or a few buttons;
- visually rich output;
- content that becomes readable after Inline Expand.

### 2.3 Prototype boundary

Use Canvas when the user needs to evaluate or operate the prototype as a page
or workflow, for example:

- app/page navigation and route transitions;
- modal, drawer, menu, validation, and error-state behavior;
- form completion or product configuration;
- drag/drop, reordering, canvas manipulation, or coordinated panes;
- a realistic mobile/desktop flow where interaction sequence matters.

Keep prototypes Inline when they are only:

- one card/component state;
- a static landing-page section;
- a visual style sample;
- a small animation or isolated control demo;
- a read-only screenshot-like mockup.

### 2.4 Inline size and responsive contract

Current shell facts:

- Assistant Markdown is capped by `--chat-max`, currently 760 CSS px.
- The right-panel viewport clamp preserves a 360 px stage budget; after chat
  side padding, the practical Inline content floor is about **320 CSS px**.
- Inline Expand uses the wider chat stage, but the model must not assume that
  the user will expand it.
- Existing frame limits remain 900 px normal and 2200 px expanded.

Model generation requirements:

- Design for **320-760 CSS px** without horizontal page overflow.
- Root layout uses `width: 100%`, `max-width: 100%`, and `min-width: 0`.
- Use responsive grid/flex patterns; do not hard-code a desktop column count.
- Collapse to one column at narrow widths when necessary.
- Prefer container queries or natural wrapping over viewport assumptions.
- Treat Inline as an embedded component, not a full-page application.
- Target an initial readable block around **640 px or less** when practical.
- Long supporting sections should use tabs, details, pagination, or local
  scrolling rather than assuming an indefinitely tall chat card.
- Wide tables, code, timelines, and canvases use a local overflow wrapper; they
  must not widen the document root.
- Do not rely on `100vw`, `100vh`, fixed root widths, fixed root heights, or
  page-level scroll locks.

Runtime guarantees:

- Inline root becomes a size container (`container-type: inline-size`).
- Common direct children, media, form controls, grids, and flex descendants are
  prevented from widening the root where safe.
- Horizontal overflow falls back to iframe-local scrolling instead of widening
  the transcript or being silently clipped.
- Content taller than the parent frame limit remains reachable through
  iframe-local vertical scrolling.
- Expand/Collapse remains unchanged and continues to remeasure after width
  changes.
- Size diagnostics never change the declared surface.

### 2.5 Canvas shell behavior

- One Canvas tab and one active Canvas target at a time.
- Opening another Canvas replaces the current Canvas content.
- Canvas is session-scoped; switching sessions clears the active target so old
  session content cannot appear attached to the new conversation.
- The Canvas tab is hidden from the generic right-panel home and `+` picker; it
  is opened from a Canvas launcher or an explicit product command only.
- Canvas uses the current right-panel resize system. On desktop, opening Canvas
  ensures a useful minimum width (target 520-560 px, bounded by the existing
  viewport clamp); compact mode continues to use the 92vw overlay.
- The Canvas iframe fills the available panel body and owns its internal
  scrolling. It does not show Inline Expand/Collapse or the Inline raw-source
  disclosure.
- Existing Artifact security classification, iframe sandbox, CSP, theme
  injection, external-resource policy, ready timeout, and action validation
  remain mandatory.
- Canvas source remains the assistant message fence; no duplicate persistence
  record is created.

### 2.6 Composer proposal behavior

Canvas may expose one additional narrow capability:

```ts
window.piwinArtifact.postAction('composer/propose-text', {
  label: 'Use selected stack',
  text: 'Use React, pnpm, and PostgreSQL for this implementation.'
});
```

Security and UX rules:

- Canvas only; the same action from an Inline frame is ignored.
- Payload is plain text only, with an optional short label.
- Text is bounded to 8 KiB; label is bounded to 120 characters.
- Parent validates `event.source`, `channelId`, action name, and payload shape.
- The iframe cannot replace the draft, send a prompt, invoke the host, write a
  file, or execute a command.
- A proposal first appears in trusted parent UI inside the Canvas shell.
- Only after the user clicks **Insert into Composer** is text appended to the
  current Composer draft, separated by a newline when needed.
- Insertion never auto-sends and never silently destroys existing draft text.

---

## 3. Dependency and ownership boundaries

```text
packages/contracts
  ArtifactSurface + descriptor surface + concise model generation contract
        ↓
packages/artifact
  fence parsing + surface-specific srcdoc/layout + action protocol validation
        ↓
apps/desktop
  launcher + ephemeral Canvas selection + right-panel shell + Composer insert

packages/agent-host
  imports the contracts prompt constant and appends it through Pi ResourceLoader
```

Constraints:

- Desktop does not import Pi.
- `@piwin/artifact` remains portable: no React, DOM host, filesystem, process,
  or Tauri dependencies.
- `@piwin/ui-kit` remains pure and receives no Canvas host logic.
- `@piwin/agent-host` must not depend on `@piwin/artifact`; it consumes the
  prompt contract from `@piwin/contracts`.
- No new host IPC is required because the Canvas source already exists in the
  hydrated product transcript and Composer insertion is Desktop-local.
- No new persistence path under `~/.piwin` is introduced.
- No generic iframe-to-product command bridge is introduced.

---

## 4. Runtime flow

```text
Pi ResourceLoader
  appends Artifact generation + routing contract
        ↓
model emits artifact-html fence with optional surface="canvas"
        ↓
@piwin/artifact parser creates a descriptor with surface
        ↓
MarkdownView
  ├─ inline → current ArtifactFrame → optional Expand/Collapse
  └─ canvas → compact launcher → user clicks Open Canvas
                                    ↓
                              useArtifactCanvas
                                    ↓
                              RightPanel('canvas')
                                    ↓
                         ArtifactFrame presentation="canvas"
                                    ↓
                  composer/propose-text action (optional)
                                    ↓
                    trusted proposal review UI
                                    ↓
                       Insert into Composer
```

---

## 5. File map

| Path | Responsibility | Action |
|------|----------------|--------|
| `docs/adr/0029-artifact-surface-routing.md` | Locks Inline/Canvas semantics and security boundary | Create |
| `packages/contracts/src/artifact.ts` | `ArtifactSurface`, descriptor field, model generation contract | Modify |
| `packages/contracts/src/artifact.test.ts` | Contract invariants and concise prompt rules | Modify |
| `packages/agent-host/src/pi-resource-loader.ts` | Preserve base append prompts and add Artifact contract once | Modify |
| `packages/agent-host/src/pi-resource-loader.test.ts` | Prompt composition tests | Modify |
| `packages/artifact/src/types.ts` | Reuse contract surface; add render-surface/action payload types | Modify |
| `packages/artifact/src/parser.ts` | Parse `surface` fence attribute, default Inline | Modify |
| `packages/artifact/src/parser.test.ts` | Surface parsing cases | Modify |
| `packages/artifact/src/evaluate.ts` | Surface-aware layout/srcdoc evaluation | Modify |
| `packages/artifact/src/evaluate.test.ts` | Inline vs Canvas evaluation policy | Modify |
| `packages/artifact/src/srcdoc.ts` | Responsive Inline CSS, Canvas viewport CSS, bridge action exposure | Modify |
| `packages/artifact/src/srcdoc.test.ts` | Containment, container query, overflow, Canvas viewport tests | Modify |
| `packages/artifact/src/layout-contract.ts` | Keep full-page-height repair Inline-only | Modify |
| `packages/artifact/src/bridge-protocol.ts` | Parse bounded `composer/propose-text` | Modify |
| `packages/artifact/src/bridge-protocol-action.test.ts` | Action allow/reject golden cases | Modify |
| `packages/artifact/src/constants.ts` | Add action name and proposal limits | Modify |
| `packages/artifact/src/index.ts` | Intentional public exports | Modify |
| `apps/desktop/src/artifact-canvas-model.ts` | Desktop-local target/proposal types and pure helpers | Create |
| `apps/desktop/src/artifact-canvas-model.test.ts` | Stable identity and Composer append tests | Create |
| `apps/desktop/src/hooks/use-artifact-canvas.ts` | Ephemeral active target/proposal lifecycle | Create |
| `apps/desktop/src/artifact-canvas-launcher.tsx` | Transcript launcher for Canvas fences | Create |
| `apps/desktop/src/artifact-canvas-launcher.test.tsx` | Launcher/open behavior | Create |
| `apps/desktop/src/artifact-canvas-panel.tsx` | Right-side Canvas shell and proposal review | Create |
| `apps/desktop/src/artifact-canvas-panel.test.tsx` | Canvas rendering/action/insert tests | Create |
| `apps/desktop/src/canvas-panel.tsx` | Obsolete freehand drawing component | Delete |
| `apps/desktop/src/ArtifactFrame.tsx` | `inline | canvas` presentation behavior and action authorization | Modify |
| `apps/desktop/src/ArtifactFrame.test.tsx` | Preserve Expand; Canvas hides Inline controls | Modify |
| `apps/desktop/src/MarkdownView.tsx` | Route descriptor surface to frame or launcher | Modify |
| `apps/desktop/src/MarkdownView.test.tsx` | Routing and source-only streaming tests | Modify |
| `apps/desktop/src/chat-thread.tsx` | Thread stable message/session origin into Canvas callback | Modify |
| `apps/desktop/src/App.tsx` | Own hook wiring, open panel, append Composer text | Modify |
| `apps/desktop/src/right-panel-sections.tsx` | Register hidden Canvas section metadata | Modify |
| `apps/desktop/src/right-panel-memory.ts` | Restore Canvas tab safely during the same UI session | Modify |
| `apps/desktop/src/right-panel-memory.test.ts` | Canvas storage allowlist case | Modify |
| `apps/desktop/src/right-panel.test.tsx` | Hidden-but-programmatically-openable Canvas tab | Modify |
| `apps/desktop/src/styles/region-transcript.css` | Launcher and preserved Inline containment/Expand styles | Modify |
| `apps/desktop/src/styles/region-inspector.css` | Replace freehand styles with Canvas workspace shell | Modify |
| `apps/desktop/e2e/shell.spec.ts` | Critical open Canvas → propose → insert flow | Modify |
| `docs/guides/artifact-prompt.md` | Human-readable canonical model contract and examples | Modify |
| `docs/artifact-research.md` | Record surface split and runtime containment | Modify |
| `docs/todo-deferred.md` | Mark D-ART-09 complete at the implemented shell scope | Modify |

---

## 6. Implementation tasks

### Task 0: Lock the policy in ADR 0029

**Files:**

- Create `docs/adr/0029-artifact-surface-routing.md`
- Reference from `docs/architecture.md` only if the Artifact section has a
  suitable link location; avoid unrelated architecture rewriting.

- [ ] Record the original requirements from Section 1.
- [ ] Lock semantic explicit routing and default Inline behavior.
- [ ] Lock the prototype boundary and detail-workspace definition.
- [ ] Lock that dimensions never auto-promote to Canvas.
- [ ] Lock Inline 320-760 px responsive generation guidance and the existing
  Expand/Collapse behavior.
- [ ] Lock Canvas as message-backed ephemeral presentation, not a durable
  domain artifact.
- [ ] Lock the Composer proposal confirmation and no-auto-send rule.
- [ ] State intentional CLI degradation: CLI retains raw Markdown/fence source;
  it has no visual Canvas.

**Acceptance:** A reviewer can decide any ambiguous Artifact example from the
ADR without consulting implementation details.

---

### Task 1: Contracts and fence surface parsing

**Files:**

- Modify `packages/contracts/src/artifact.ts`
- Modify `packages/contracts/src/artifact.test.ts`
- Modify `packages/artifact/src/types.ts`
- Modify `packages/artifact/src/parser.ts`
- Modify `packages/artifact/src/parser.test.ts`
- Modify `packages/artifact/src/index.ts`

- [ ] Add failing contract tests for `ArtifactSurface` and descriptor surface.
- [ ] Add failing parser tests:
  - omitted surface → `inline`;
  - `surface="inline"` → `inline`;
  - `surface="canvas"` → `canvas`;
  - case/underscore-normalized attribute key still parses;
  - unknown/empty surface → `inline`;
  - HTML and SVG descriptors behave consistently.
- [ ] Define `ArtifactSurface = 'inline' | 'canvas'` in contracts.
- [ ] Add `surface: ArtifactSurface` to the contract descriptor base.
- [ ] Reuse the contract surface type from `@piwin/artifact`; do not introduce a
  second independent union.
- [ ] Parse the existing fence attribute map once and set surface on every
  descriptor constructor.
- [ ] Keep native HTML/SVG capability-off behavior unchanged.
- [ ] Export the type intentionally from package public indexes.

**Verification:**

```bash
pnpm --filter @piwin/contracts exec vitest run src/artifact.test.ts
pnpm --filter @piwin/artifact exec vitest run src/parser.test.ts
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/artifact typecheck
```

**Acceptance:** Every parsed Artifact has an explicit surface; old fences remain
Inline without source mutation.

---

### Task 2: Inject the generation and routing contract into live sessions

**Depends on:** Task 1.

**Files:**

- Modify `packages/contracts/src/artifact.ts`
- Modify `packages/contracts/src/artifact.test.ts`
- Modify `packages/agent-host/src/pi-resource-loader.ts`
- Modify `packages/agent-host/src/pi-resource-loader.test.ts`

- [ ] Add a short `HTML_ARTIFACT_GENERATION_CONTRACT` constant to contracts.
- [ ] Keep the injected text bounded and operational. It must state:
  - use `artifact-html` for self-contained UI;
  - default to Inline;
  - the exact Canvas semantic conditions from Section 2.2;
  - interactive prototypes versus static component mockups;
  - Inline supports 320-760 px and may be expanded, but must work before
    expansion;
  - required responsive/root/overflow rules;
  - Canvas uses `surface="canvas"`;
  - `composer/propose-text` is available only for Canvas results.
- [ ] Add a pure helper such as `appendArtifactGenerationContract(basePrompts)`
  that preserves order and adds the contract exactly once.
- [ ] Wire it to `DefaultResourceLoader` via `appendSystemPromptOverride` in
  `createPiResourceLoader`.
- [ ] Do not prepend the contract to user prompts and do not add an SDK-adapter
  special case.
- [ ] Verify the shared resource-loader path covers create/resume, direct SDK,
  subagent SDK sessions, and `PiRpcAdapter` SDK fallback.

**Verification:**

```bash
pnpm --filter @piwin/contracts exec vitest run src/artifact.test.ts
pnpm --filter @piwin/agent-host exec vitest run src/pi-resource-loader.test.ts
pnpm --filter @piwin/agent-host typecheck
```

**Acceptance:** A live Pi session receives the concise routing/size contract
once while preserving user, project, and Pi append-system prompts.

---

### Task 3: Add surface-specific Artifact layout without changing routing

**Depends on:** Task 1. May run in parallel with Task 2.

**Files:**

- Modify `packages/artifact/src/evaluate.ts`
- Modify `packages/artifact/src/evaluate.test.ts`
- Modify `packages/artifact/src/srcdoc.ts`
- Modify `packages/artifact/src/srcdoc.test.ts`
- Modify `packages/artifact/src/layout-contract.ts`
- Modify `packages/artifact/src/types.ts`
- Modify `apps/desktop/src/ArtifactFrame.tsx`
- Modify `apps/desktop/src/ArtifactFrame.test.tsx`
- Modify `apps/desktop/src/styles/region-transcript.css`

- [ ] Add failing tests for `surface: 'inline' | 'canvas'` evaluation and srcdoc
  output.
- [ ] Make Inline srcdoc establish a real responsive container:
  - root `container-type: inline-size`;
  - root/direct-child `width/max-width/min-width` containment;
  - media bounded to 100%;
  - local horizontal fallback scrolling;
  - vertical content remains reachable after frame clamping.
- [ ] Add a viewport meta tag to generated srcdoc.
- [ ] Preserve static HTML-first and theme variable behavior.
- [ ] Keep `applyArtifactLayoutContract` for Inline so `100vh` cannot trigger
  height feedback loops.
- [ ] For Canvas evaluation, skip the Inline full-page-height repair and build a
  viewport workspace document that may legitimately use `height: 100%`.
- [ ] Keep CSP and security classification identical across surfaces.
- [ ] Add `presentation="inline" | "canvas"` to `ArtifactFrame`:
  - Inline retains current dynamic height and Expand/Collapse behavior;
  - Canvas fills its parent, uses internal scrolling, and hides Expand and raw
    source disclosure;
  - both retain ready timeout, theme remount, init queue, and action validation.
- [ ] Do not use measurements to mutate descriptor surface or open Canvas.
- [ ] Add regression tests proving Inline Expand still toggles the same class
  and remains bounded by chat-stage CSS.

**Verification:**

```bash
pnpm --filter @piwin/artifact exec vitest run src/evaluate.test.ts src/srcdoc.test.ts src/layout-contract.test.ts
pnpm --filter @piwin/desktop exec vitest run src/ArtifactFrame.test.tsx
pnpm --filter @piwin/artifact typecheck
pnpm --filter @piwin/desktop typecheck
```

**Acceptance:** Inline UI reflows at the iframe's actual width and remains
reachable when oversized; Canvas receives a full-panel viewport; neither path
changes the declared surface or security policy.

---

### Task 4: Route Canvas fences into the existing right-panel shell

**Depends on:** Tasks 1 and 3.

**Files:**

- Create `apps/desktop/src/artifact-canvas-model.ts`
- Create `apps/desktop/src/artifact-canvas-model.test.ts`
- Create `apps/desktop/src/hooks/use-artifact-canvas.ts`
- Create `apps/desktop/src/artifact-canvas-launcher.tsx`
- Create `apps/desktop/src/artifact-canvas-launcher.test.tsx`
- Create `apps/desktop/src/artifact-canvas-panel.tsx`
- Create `apps/desktop/src/artifact-canvas-panel.test.tsx`
- Delete `apps/desktop/src/canvas-panel.tsx`
- Modify `apps/desktop/src/MarkdownView.tsx`
- Modify `apps/desktop/src/MarkdownView.test.tsx`
- Modify `apps/desktop/src/chat-thread.tsx`
- Modify `apps/desktop/src/App.tsx`
- Modify `apps/desktop/src/right-panel-sections.tsx`
- Modify `apps/desktop/src/right-panel-memory.ts`
- Modify `apps/desktop/src/right-panel-memory.test.ts`
- Modify `apps/desktop/src/right-panel.test.tsx`
- Modify `apps/desktop/src/styles/region-transcript.css`
- Modify `apps/desktop/src/styles/region-inspector.css`

- [ ] Define a Desktop-local `ArtifactCanvasTarget` containing only raw source
  and stable origin metadata:
  - active session ID;
  - assistant message ID;
  - fence index;
  - stable artifact/channel ID;
  - title, type, raw language, raw source.
- [ ] Build the stable ID from session + message + fence identity. Stop using
  global `fence-0` style IDs for interactive frames.
- [ ] Keep `srcdoc`, measured height, and theme output out of target state;
  reevaluate from raw source under the current theme/security policy.
- [ ] Implement `useArtifactCanvas` with:
  - `activeTarget`;
  - `openTarget(target)`;
  - `clearTarget()`;
  - automatic clear on active-session change.
- [ ] Route completed `surface="canvas"` descriptors to
  `ArtifactCanvasLauncher` instead of mounting `ArtifactFrame` inline.
- [ ] Launcher shows title, Canvas intent, Open Canvas, copy source, and an
  optional source disclosure; it does not duplicate a running iframe.
- [ ] Preserve source-only streaming behavior.
- [ ] Preserve global Artifact capability gating and blocked security states.
- [ ] Opening a launcher:
  - sets the active target;
  - selects `RightPanelTab = 'canvas'`;
  - opens the inspector;
  - ensures a useful desktop panel width without exceeding the existing
    viewport clamp.
- [ ] Register Canvas as a hidden/programmatic right-panel section. Include it
  in storage validation so panel collapse/reopen during the same UI session
  does not discard the tab.
- [ ] Replace the dormant freehand drawing panel and its styles; do not retain
  two unrelated product meanings under the name Canvas.
- [ ] Render the target in `ArtifactCanvasPanel` through
  `ArtifactFrame presentation="canvas"`.
- [ ] Show a clear empty state if the Canvas tab is restored without a target
  after a full reload.
- [ ] Opening a second Canvas replaces the first in the same tab.

**Verification:**

```bash
pnpm --filter @piwin/desktop exec vitest run \
  src/artifact-canvas-model.test.ts \
  src/artifact-canvas-launcher.test.tsx \
  src/artifact-canvas-panel.test.tsx \
  src/MarkdownView.test.tsx \
  src/right-panel-memory.test.ts \
  src/right-panel.test.tsx
pnpm --filter @piwin/desktop typecheck
```

**Acceptance:** Inline remains the default with Expand/Collapse; only declared
Canvas artifacts render launchers and open the existing right panel; no
separate host or persistence path exists.

---

### Task 5: Add the bounded Canvas-to-Composer proposal action

**Depends on:** Task 4.

**Files:**

- Modify `packages/artifact/src/constants.ts`
- Modify `packages/artifact/src/types.ts`
- Modify `packages/artifact/src/bridge-protocol.ts`
- Modify `packages/artifact/src/bridge-protocol-action.test.ts`
- Modify `packages/artifact/src/srcdoc.ts`
- Modify `apps/desktop/src/ArtifactFrame.tsx`
- Modify `apps/desktop/src/ArtifactFrame.test.tsx`
- Modify `apps/desktop/src/artifact-canvas-panel.tsx`
- Modify `apps/desktop/src/artifact-canvas-panel.test.tsx`
- Modify `apps/desktop/src/artifact-canvas-model.ts`
- Modify `apps/desktop/src/artifact-canvas-model.test.ts`
- Modify `apps/desktop/src/App.tsx`

- [ ] Add failing golden tests for valid, unknown, malformed, empty, and
  oversized `composer/propose-text` payloads.
- [ ] Add the action to the iframe bootstrap allowlist.
- [ ] Extend the typed action union with a dedicated proposal payload.
- [ ] Refactor `ArtifactFrame` action authorization by action kind:
  - flashcard actions retain card-source validation;
  - Composer proposals are accepted only for Canvas presentation;
  - Inline Composer proposals are ignored;
  - unknown actions remain ignored.
- [ ] Store a proposal in trusted Canvas panel state rather than immediately
  mutating the Composer.
- [ ] Render label/text preview plus **Insert into Composer** and Dismiss.
- [ ] Implement a pure append helper:
  - empty draft → proposal text;
  - non-empty draft → trim trailing whitespace, add one newline, append text;
  - never replace or send.
- [ ] Wire insertion to the existing `setComposer` from `useComposerMedia`.
- [ ] Keep Canvas open after insertion so the user can continue inspecting or
  revise selections; clear the accepted proposal only.

**Verification:**

```bash
pnpm --filter @piwin/artifact exec vitest run src/bridge-protocol-action.test.ts src/srcdoc.test.ts
pnpm --filter @piwin/desktop exec vitest run src/ArtifactFrame.test.tsx src/artifact-canvas-panel.test.tsx src/artifact-canvas-model.test.ts
pnpm --filter @piwin/artifact typecheck
pnpm --filter @piwin/desktop typecheck
```

**Acceptance:** An untrusted Canvas can only propose bounded text; trusted
parent UI requires a user click before appending it to the Composer; it cannot
auto-send or invoke any other product capability.

---

### Task 6: Documentation, critical-path e2e, and release verification

**Depends on:** Tasks 0-5.

**Files:**

- Modify `docs/guides/artifact-prompt.md`
- Modify `docs/artifact-research.md`
- Modify `docs/todo-deferred.md`
- Modify `apps/desktop/e2e/shell.spec.ts`

- [ ] Rewrite the guide around the two surfaces and include four canonical
  examples:
  1. small Inline status card;
  2. wide/read-only Inline artifact that supports Expand;
  3. Canvas interactive application prototype;
  4. Canvas configurator that proposes text to Composer.
- [ ] State the 320-760 px Inline contract and explain that Expand is optional,
  not the minimum design viewport.
- [ ] Document the exact semantic routing matrix and prototype boundary.
- [ ] Document that Canvas shares the heavy Artifact sandbox/CSP and remains
  message-backed/ephemeral.
- [ ] Mark D-ART-09 complete only for the side-panel shell delivered here;
  leave export, durable Canvas records, TSX runtime, and CLI preview deferred.
- [ ] Add one focused Playwright path:
  - load a completed Canvas fence fixture;
  - verify no inline iframe mounts;
  - open Canvas;
  - trigger a proposal;
  - confirm text appears in Composer only after Insert.
- [ ] Run manual Tauri smoke for desktop/compact widths, dark/light theme,
  panel resize, Expand/Collapse, session switch, and security-blocked content.

**Targeted verification:**

```bash
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/artifact test
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/desktop typecheck
pnpm --dir apps/desktop e2e --grep "artifact canvas"
```

**Final verification:**

```bash
pnpm typecheck
pnpm test
pnpm e2e:desktop
```

---

## 7. Required test matrix

### Contract/parser

- Legacy fences default Inline.
- `surface="canvas"` survives HTML/SVG parsing.
- Invalid surface cannot accidentally gain Canvas capability.
- Capability-off remains source-only.

### Inline layout

- 320 px root does not create transcript-level horizontal overflow.
- Grid/flex examples reflow without fixed-width assumptions.
- Wide local table/code content remains reachable through iframe-local scroll.
- Tall content remains reachable at the 900 px clamp.
- Expand still reaches chat-stage width only and collapses cleanly.
- Inline `100vh` is repaired as before.

### Canvas layout

- Canvas frame fills the panel body and has internal scroll.
- Canvas does not show Inline Expand/Collapse or raw-source details.
- Canvas may use full-height layout without Inline `100vh` repair.
- Theme switch remounts/rebuilds the Canvas srcdoc.
- Blocked external/oversized content cannot render in Canvas.

### Routing

- Inline fence mounts current preview behavior.
- Canvas fence mounts only a launcher in completed messages.
- Streaming Canvas fence remains source-only.
- Clicking launcher opens/selects one hidden Canvas right-panel tab.
- Opening another target replaces the current target.
- Session switch clears target.
- Full reload with a restored Canvas tab shows an empty state, not stale source.

### Composer proposal

- Valid proposal appears in parent review UI.
- Inline proposal is ignored.
- Unknown, malformed, oversized, or wrong-channel proposals are ignored.
- Existing flashcard action tests remain green.
- Insert appends without replacing existing draft.
- Dismiss changes nothing.
- No action auto-sends a prompt.

---

## 8. Manual acceptance scenarios

1. **Inline compact card:** generate a small status card; verify it works at
   normal chat width and Expand/Collapse remains available.
2. **Inline wide read-only visualization:** generate a wide table/diagram;
   verify it does not widen the transcript, local overflow remains usable, and
   Expand gives temporary additional width without opening Canvas.
3. **Static prototype:** generate one component mockup; verify it remains
   Inline.
4. **Interactive application prototype:** generate a multi-screen settings
   prototype with navigation and validation; verify the transcript shows a
   Canvas launcher and the page runs in the right panel.
5. **Configurator round-trip:** make technology/configuration selections;
   verify a proposal appears and inserts into, but does not send, the Composer.
6. **Complex detail workspace:** open a multi-region topology/dashboard
   inspector; verify it remains usable while the transcript stays visible.
7. **Session isolation:** open Canvas, switch sessions, and verify the old target
   clears.
8. **Security:** test external resource, oversized source, malformed action,
   and wrong-channel messages; all remain blocked/ignored.
9. **Compact shell:** verify Canvas uses the existing overlay drawer and the
   Composer proposal flow remains usable.
10. **Artifact disabled:** turn off Artifact preview and verify both Inline and
    Canvas fences remain source-only except existing documented exceptions.

---

## 9. Explicit non-goals

- A generic "Open every Artifact in Canvas" command.
- Automatic size/DOM-complexity classification into Canvas.
- Canvas source editor or Source/Preview tabs.
- Standalone Canvas creation outside assistant messages.
- Durable Canvas store, revisions, migration, or cross-device sync.
- Multiple simultaneous Canvas documents/tabs.
- React/TSX compilation, npm imports, hot reload, or language services.
- Project-file export or direct filesystem access.
- Generic iframe-to-host commands.
- Automatic Composer submission.
- CLI visual preview.

---

## 10. Completion criteria

The slice is complete when:

1. The model receives one authoritative surface/size contract in every live SDK
   and RPC-to-SDK-fallback session.
2. Legacy Artifacts remain Inline and preserve Expand/Collapse.
3. Inline UI is generated for and defensively contained within 320-760 px.
4. Only semantically declared Canvas Artifacts route to the right-side shell.
5. Interactive prototypes, multi-step workflows, Composer-return flows, and
   sustained detail workspaces are covered by the documented Canvas policy.
6. Canvas shares the existing Artifact security boundary and introduces no
   generic product capability bridge.
7. Canvas proposals require explicit trusted-parent insertion and never send.
8. Targeted tests, repository typecheck/tests, and the critical Desktop e2e are
   green.
9. ADR, prompt guide, research notes, and canonical backlog agree with shipped
   behavior.

