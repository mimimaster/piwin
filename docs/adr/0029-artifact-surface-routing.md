# ADR 0029: Artifact Inline-vs-Canvas surface routing

## Status

Accepted (2026-08-03; amended 2026-08-24; amended 2026-08-26; amended 2026-08-27; amended 2026-08-31; amended 2026-09-08; amended 2026-09-21)

## Context

Inline HTML/SVG Artifacts render inside the chat column. Some model-generated UIs are
interaction/workspace-like and either overflow the chat width or need to feed
results back to the Composer. There is no semantic rule for when content
belongs in a right-side Canvas, and the model has no authoritative statement
of the available Inline space — so it generates full-page layouts that do not
fit an embedded chat block.

This ADR locks the product policy for the Inline-vs-Canvas split: when a
fence is Canvas, what never promotes to Canvas, how Inline must be generated
to fit its real container, what the Canvas shell may and may not do, and the
one narrow Composer capability Canvas frames get.

## Decision

### 0. The full Artifact contract is loaded on demand

An Artifact-enabled generation keeps only a compact routing hint in its system
prompt. Before emitting HTML or SVG, the model calls the read-only
`artifact_instructions` Host tool, which returns the configured decision policy
and the canonical runtime contract together. The tool is advertised only when
its concrete executor is present in the compiled generation surface.

The full contract is returned at most once for each Runtime generation and Run.
A repeated call in the same Run succeeds with only a compact reminder to reuse
the previously loaded result, preventing duplicate policy text from polluting
the model context. A later Run may load the contract again.

This preserves the exact policy at the point where it matters without charging
every ordinary Markdown turn for the full Artifact protocol. Custom decision
prompts are also returned by the tool rather than copied into every generation.

### 1. Surface selection is semantic and explicit

Canonical fence syntax:

````markdown
```artifact-html title="Deployment configurator" surface="canvas"
<!-- self-contained HTML/CSS/JS body fragment -->
```
````

The model-facing runtime contract (`formatArtifactProtocol`, v8) shows this
block shape. Opening fence at column 0 of its own line; `title` and `surface`
stay on that opening line. Inline uses the chat-column flow constraints
(transparent root, no `100vh`, no nested page scroll, no horizontal scroll).
Canvas fills the inspector iframe (`width: 100%` / `height: 100%` / `100dvh`).

```ts
export type ArtifactSurface = 'inline' | 'canvas';
```

- Missing `surface` means `inline`. Unknown values safely fall back to `inline`.
- Runtime measurements do **not** automatically promote an Inline Artifact to
  Canvas.
- Canvas fences render a compact launcher in the transcript and do not mount
  an inline iframe.
- Inline fences do not receive a generic "Open in Canvas" action.
- A live explicit `surface="canvas"` fence auto-opens the Canvas tab as soon
  as the opening fence is parseable. The transcript stays source while
  streaming; the right panel stream-previews the same growing source in one
  sandbox iframe (ADR 0005). Completion commits that iframe to interactive.
- Hydrated history and session switches do not rearrange the shell.
  Subsequent tokens on the same target id update source only and do not steal
  the inspector tab. Code-first is Inline-only and does not suppress Canvas
  reveal. The transcript launcher reopens the same stable target id without
  stealing keyboard focus.

### 2. Inline is the default and flows with the transcript

Inline remains the default surface. Completed inert HTML/SVG renders in a
sanitized Shadow DOM and follows parent-document flow. Content that requires
JavaScript, an embedded browsing context, an external reference, or the
unfinished streaming lifecycle stays in a sandbox iframe whose one observed
height stream follows the component. The transcript remains the only vertical
scroll owner. Inline does not create a nested 900px scrollport or require
Expand/Collapse chrome.

Tall content alone is **not** a reason to enter Canvas. Width is still a
semantic generation decision rather than a runtime measurement: content that
can reflow remains Inline; a layout that fundamentally requires horizontal
scrolling or a wide workspace must declare Canvas. Dimensions never
auto-promote; the declared `surface` is the only routing input.

### 3. Canonical routing policy

The model-facing decision order is:

1. The user explicitly requests Canvas/right-side interaction → **canvas**.
2. The primary deliverable is a standalone analytical artifact the user will
   read beside the conversation (architecture / plan / design / code-base
   review, audit, delivery report, findings, quantitative breakdown, large
   comparison table) → **canvas**. Trigger is user intent, not length. A
   Markdown wall or large Markdown table as the answer is the wrong surface.
3. The UI must return a result to the Composer → **canvas**.
4. The UI is multi-step or must retain local workflow state → **canvas**.
5. The primary deliverable is an interactive application/page prototype →
   **canvas**.
6. The UI is a persistent, coordinated, detail-inspection workspace →
   **canvas**.
7. Otherwise → **inline**.

The following are **not** Canvas criteria by themselves:

- many words;
- tall content;
- a small table inside a short answer (a large table *as the deliverable* is
  Canvas);
- tabs, filtering, hover, animation, or a few buttons;
- visually rich output that is still a component in the transcript (a
  standalone report *is* Canvas — richness alone is not);
- content that remains readable in the supported Inline width range.
- a code fix, patch, PR, or targeted debug of a specific snippet — the code
  is the deliverable.

### 4. Interactive-prototype boundary

Use Canvas when the user needs to evaluate or operate the prototype as a page
or workflow:

| Canvas (evaluate/operate as a page) | Inline (component/visual sample) |
|-------------------------------------|----------------------------------|
| app/page navigation and route transitions | one card/component state |
| modal, drawer, menu, validation, and error-state behavior | a static landing-page section |
| form completion or product configuration | a visual style sample |
| drag/drop, reordering, canvas manipulation, or coordinated panes | a small animation or isolated control demo |
| a realistic mobile/desktop flow where interaction sequence matters | a read-only screenshot-like mockup |

### 5. Inline size and responsive contract

Shell facts the model must design against:

- Assistant Markdown is capped by `--chat-max`, currently 760 CSS px.
- The right-panel viewport clamp preserves a 360 px stage budget; after chat
  side padding, the practical Inline content floor is about **320 CSS px**.
- Inline uses the chat-stage width. Static content grows naturally; sandboxed
  content grows to its observed content height.
- A **16384 px defensive ceiling** limits forged or runaway iframe resize
  messages; it is a security/resource guard, not a normal layout scrollport.

Model generation requirements (Inline targets **320–760 CSS px**):

- Treat Inline as an embedded component, not a full-page application.
- Root layout uses `width: 100%`, `max-width: 100%`, and `min-width: 0`;
  never `100vw`, `100vh`, fixed root widths/heights, or page-level scroll
  locks.
- Use responsive grid/flex; do not hard-code a desktop column count; collapse
  to one column at narrow widths.
- Prefer container queries or natural wrapping over viewport assumptions.
- Target an initial readable block around **640 px or less** when practical.
- Long content may continue vertically; do not create nested vertical scroll
  regions merely to keep the component short.
- Wide tables, code, timelines, and canvases must responsively wrap/reflow. If
  preserving their utility requires horizontal scrolling, route the Artifact
  to Canvas instead.

Runtime guarantees:

- Host-owned Inline viewport/overflow chrome follows window and conversation
  pane resizes. Once an Inline flow enters overflow recovery, later smaller
  content measurements keep that bounded viewport; they cannot expand the
  outer iframe back into a multi-thousand-pixel scroll region.

- The Inline root becomes a size container (`container-type: inline-size`).
- Common direct children, media, form controls, grids, and flex descendants
  are prevented from widening the root where safe.
- Static Inline content is sanitized into a CSS-isolated Shadow DOM and needs
  no measurement. Sandboxed Inline html/body overflow is hidden; observed
  content height is applied to the iframe so the transcript owns vertical
  scrolling.
- Inline has no document-level horizontal scrollbar. Canvas retains its own
  horizontal and vertical scrollport.
- Size diagnostics never change the declared surface.

### 6. Canvas is a routing shell, not an Artifact editor

- **Ephemeral and message-backed**: the Canvas presents the assistant-message
  fence. No durable store, no duplicate persistence record, no Source/Preview
  editor, no TSX compiler, no export.
- **Single active target**: one Canvas tab and one active Canvas target at a
  time; opening another Canvas replaces the current content.
- **Session-scoped**: switching sessions clears the active target so old
  session content cannot appear attached to the new conversation.
- **Opened deliberately only**: the Canvas tab is hidden from the generic
  right-panel home and `+` picker. It is opened from a Canvas launcher, an
  explicit product command, or one-shot auto-reveal of a live explicit
  `surface="canvas"` fence.
- **Uses the existing right-panel resize system**: on desktop, opening Canvas
  ensures a useful minimum width (target 520–560 px, bounded by the existing
  viewport clamp); compact mode continues to use the 92vw overlay.
- **Rendering**: the Canvas iframe fills the available panel body and owns its
  internal scrolling. Host CSS treats that iframe as the design viewport — no
  phone-card matting, 16px stage padding, or vertical centering. Undersized
  stages scale up to contain; letterboxed portrait posters expand to the panel
  so fluid layouts reflow. It does not show Inline Expand/Collapse or the Inline
  raw-source disclosure.
- **Same security posture as Inline**: existing Artifact security
  classification, iframe sandbox, CSP, theme injection, external-resource
  policy, and action validation remain mandatory and identical. Canvas does not
  participate in Inline sizing or its bounded load-fallback lifecycle.
- **Canvas opens live.** A parseable live explicit Canvas fence auto-opens
  the right panel immediately and stream-previews until the message completes;
  hydrated history does not. Code-first is Inline-only and does not suppress
  that auto-reveal. Transcript Canvas fences stay source while streaming.

### 7. Composer proposal capability

Canvas frames may expose one additional narrow action:

```ts
window.piwinArtifact.postAction('composer/propose-text', {
  label: 'Use selected stack',
  text: 'Use React, pnpm, and PostgreSQL for this implementation.'
});
```

Rules:

- **Canvas only**; the same action from an Inline frame is ignored.
- Payload is **plain text only** with an optional short label. Text is bounded
  to 8 KiB; label is bounded to 120 characters.
- Parent validates `event.source`, `channelId`, action name, and payload shape.
- The iframe cannot replace the draft, send a prompt, invoke the host, write a
  file, or execute a command.
- A proposal first appears in trusted parent UI inside the Canvas shell; it
  surfaces only after the user clicks **Insert into Composer**, when the text
  is appended to the current Composer draft (separated by a newline when
  needed).
- Insertion never auto-sends and never silently destroys existing draft text.

### 8. Native source, Inline viewport, and Canvas (2026-08-24 amendment)

The declared `surface` remains authoritative for explicit Artifact fences.
`layout: viewport` is an Inline presentation (`inline-viewport`): Host
`clamp(360px, 72vh, 760px)` chrome and a unique iframe document scrollport.
Canvas is only for explicit `surface="canvas"`. Runtime measurements, full
documents, `100vh`, and four-edge fixed shells do **not** auto-promote Inline
to Canvas.

Native `html`/`htm`/`svg` fences retain their `declaration: native` provenance,
yet compatible content uses the same default Inline path as explicit Artifact
fences when the capability is enabled. `artifactCodeFirst` is the Inline
source-first preference. Native fences never auto-open Canvas; explicit
`surface="canvas"` auto-opens the live Canvas panel as soon as the opening
fence is parseable. An explicit
`surface="inline"` fence that needs a page viewport uses `inline-viewport`
rather than a Canvas reroute. The runtime does not mutate the descriptor or
silently change `surface`.

Inline compatibility is conservative and deterministic. Full documents,
viewport-height CSS units, JavaScript that reads viewport height, and fixed page
shells mount `inline-viewport` instead of using parent-driven flow height. The
runtime no longer repairs `100vh`/`min-height` declarations or guesses whether a
canvas/video is a viewport-filling scene. Those mechanisms fed parent iframe
height back into child viewport layout and could ratchet a single response into
a large blank region before later Markdown.

Canvas preserves full document structure and owns both axes of scrolling. It
does not install or emit the Inline size stream. Compatible sandboxed Inline
flow fragments emit one revisioned root-box size stream; `inline-viewport` and
`inline-overflow` use the Host clamp and a unique iframe scrollport. Height
above the 16384px ceiling enters `inline-overflow`; the runtime does not
silently crop.

The Inline flow size stream is recoverable. Desktop subscribes to native size
events by exact Artifact channel, caches an early size for that channel, and
requests an unchanged height to be re-emitted after iframe load and native
listener readiness. Completed and streaming frames share the same timeout. A
timeout temporarily uses a 360px internally scrollable recovery viewport; it is
not marked complete, and any later valid revision restores exact flow height.

`config.artifact.enabled` is the master switch; the per-scope Inline/Canvas
switches below it are resolved by `resolveArtifactCapability` (see the
2026-09-21 amendment). Surface routing is `indexArtifactFences` →
`analyzeArtifactFence` → `RenderIntent`
(`layout: flow | viewport | canvas`). Desktop MarkdownView, Canvas auto-reveal,
and Mobile collectors share that path. There is no second parser
(`evaluateCodeFence` / `splitMarkdownBlocks` are deleted).

### Historical plans superseded (2026-08-24)

Do not amend the following; the convergence plan is current:

- `docs/plans/2026-08-22-artifact-height-chain-v2.md`
- `docs/plans/2026-08-24-inline-artifact-fixed-overlay-height.md`
- `docs/plans/2026-08-24-inline-artifact-first-token-streaming.md`
- `docs/plans/2026-08-24-artifact-canvas-active-reveal.md`

Canonical plan: `docs/plans/2026-08-24-artifact-rendering-convergence-execution-plan.md`.

## Consequences

- Inline UI is generated space-aware and participates in transcript flow;
  nested iframe scrolling is no longer the fallback for poor sizing.
- A new narrow action in the Artifact bridge (`composer/propose-text`); it is
  added deliberately and the whitelist discipline of the iframe action
  protocol is preserved — no generic iframe-to-product command bridge.
- Intentional CLI degradation: the CLI keeps raw Markdown/fence source; it has
  no visual Canvas.
- Canvas scope does **not** create a durable artifact domain yet: export,
  durable records, and a TSX runtime remain deferred.
- The model generation contract is injected via the Pi DefaultResourceLoader
  system-prompt seam, applying equally to SDK and RPC→SDK-fallback sessions.

## References

### Send-time Inline layout reference (2026-09-10)

Desktop composer prompts may carry `PromptInput.inlineArtifactWidthPx`, measured
from the sending session's mounted transcript column in CSS pixels. Host accepts
only finite positive widths up to 16384, rounds the reference, and prepends a
model-facing layout block when Artifact is enabled. Original user text stays
unchanged in the transcript; the assembly ledger records this contribution.
The numeric field is removed before backend execution. SDK and RPC share this
Host preparation path.

The width is advisory: fluid roots, wrapping table cells, container queries,
360px readability and adaptation below that remain required. Dense wide tables
use Canvas. The hint never requests generation or overrides explicit-only mode.
Resizing does not request another generation; the next composer send remeasures.
Duplicate visible views of a session use the narrowest measured column.

CLI, Mobile, side-chat's separate send path, drafts sent without a mounted main
transcript, and other callers without geometry retain the generic responsive
contract. No guessed viewport size or persisted global/session layout setting
is used. Queued prompts retain their advisory send-time snapshot. Runtime CSS
and surface routing are unchanged. Automatic overflow repair is deferred.

- ADR 0005 (Artifact sandbox, streaming preview, media/image policy)
- Plan: `docs/plans/2026-08-24-artifact-rendering-convergence-execution-plan.md`
- Earlier Canvas-shell notes: `docs/plans/2026-08-03-artifact-surface-routing-canvas-shell.md`

## Amendment (2026-09-08): Canvas/Inline bind vault media at materialize time

Inline and Canvas share one bind: `data-piwin-media` → session-scoped `blob:`
at `materializeArtifact`. The sandbox CSP stays `img-src data: blob:`. The
iframe does not fetch `file:` or Host HTTP. Unknown ids render as placeholders
without a network src.

## Amendment (2026-09-21): per-scope Inline/Canvas capability

The master switch alone was too coarse: a Conversation answer and a project
Agent run want different surfaces, and the product already classifies sessions
by `SessionScope.kind`. Capability now resolves as **master → session class →
surface**.

### Config

```ts
artifact: {
  enabled: boolean,                                  // master, unchanged
  scopes?: {
    general: { inline: boolean; canvas: boolean },   // 通用会话 (Conversation chat)
    project: { inline: boolean; canvas: boolean },   // 项目会话 (Agent chat, incl. No Repo)
  },
  …
}
```

Shipped default (`createDefaultArtifactScopes()`): Conversation chat has both
surfaces **on**; Agent chat has both surfaces **off** — the coding agent answers
in Markdown/source unless the user opts a surface back in.

`scopes` is optional, and a missing scope *or surface* follows that shipped
default rather than "on". A `config.json` written before `scopes` existed (or an
older Desktop that never sent the key) therefore adopts the shipped default, and
an explicit `true` is what opts a surface back in. `normalizeArtifactConfig`
fills the key on every load/save, so the stored document and the resolved
capability always agree.

### One resolver, three call sites

`resolveArtifactCapability(config, scopeKey)` lives in `@piwin/contracts` and
returns `{ enabled, inline, canvas }` (all false when the master switch is off
or the scope has no surface left). Missing scope/surface entries fall back per
surface to `createDefaultArtifactScopes()`. The scope key mirrors
`SessionScope.kind`,
and every caller derives it from an existing authority:

| Caller | Scope source |
|--------|--------------|
| Host `compileConversationPlan` / `compileAgentCapabilityPlan` | the compile-time `isConversationChatSession` split |
| Host tool composition | `artifactScopeKeyForIndexRecord` on the durable session record (children are Agent class) |
| Host per-turn advisory hint (`inlineArtifactWidthPx`, host theme) | the same durable record; a disabled or unresolvable class drops the block instead of describing a surface the session lacks |
| Desktop workbench, pane stages, Canvas auto-reveal | `state.activeScope` |
| Subagent inspector | Agent class, matching how the Host compiles children |

Compile time, prompt time, and tool composition therefore cannot disagree about
which surfaces a generation has.

### Model-facing contract

`formatArtifactInstructions(config, capability)` keeps the shared decision
policy and runtime protocol **byte-identical** and prefixes a surface
constraint — `ARTIFACT_INLINE_ONLY_HINT` or `ARTIFACT_CANVAS_ONLY_HINT` — the
same mechanism `triggerMode: 'explicit-only'` already used. The prefix is a
product constraint, not part of the editable decision prompt, and the protocol
is not rewritten per surface. With `enabled: false` the instructions are `''`,
the resident prompt is not injected, and `artifact_instructions` is not
registered.

### Desktop rendering

- `artifactPreviewEnabled` is renamed to `artifactInlineEnabled`; the second
  switch is `artifactCanvasEnabled`. At every hop the omitted Canvas value
  follows Inline, so isolated single-switch embedders (Doc Cards, Flashcards,
  Walkthrough, side chat) keep rendering source-only.
- **Inline off**: no iframe, no Preview affordance, no native `html`/`svg`
  promotion; fences stay source. Canvas fences still fold to their launcher.
- **Canvas off**: no transcript launcher, no auto-open, and the Canvas fence
  degrades to source. Inline preview is unaffected.
- **Both off** is the previous capability-off behavior.
- The send-time `inlineArtifactWidthPx` hint is Inline-only: Host drops the
  layout line when the session has no Inline surface (Canvas-only sessions still
  get the theme line), and drops the whole block when the class has no surface at
  all or cannot be resolved. The pane composer also stops sending the width.

### Settings apply timing

Removing a surface is classified `new-runtime` for the `artifact` domain: the
resident prompt and the `artifact_instructions` result are baked into a runtime
generation, so the narrowing only becomes real for the replacement generation
(`when: 'after-current-run'`). Adding a surface back stays `immediate`, because
the generation being drained was never narrower than the config. Desktop
rendering changes immediately in both directions.

### Known limitation

Multi-pane mirrors inherit the primary pane's resolved pair. Resolving per pane
needs that pane's resumed scope; it is deferred rather than guessed.

### Consequences

- The Artifact settings page shows the hierarchy: master switch → General chat /
  Project chat → Inline / Canvas. Turning the master switch off hides the tree
  but preserves the saved choices, so one toggle is reversible.
- Agent chat ships without the Artifact contract: no resident decision policy,
  no `artifact_instructions` tool, no `artifact` tool family, and no advisory
  rendering hint. `triggerMode: 'explicit-only'` remains available for users who
  want opt-in generation rather than per-surface switches.
- Trigger mode, decision policy, security blocks, and the byte cap stay
  global; they are not duplicated per scope.
- `docs/guides/artifact-prompt.md` keeps describing the unchanged protocol; the
  surface prefix is the only addition to the model-facing text.
