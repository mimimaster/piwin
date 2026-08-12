# ADR 0029: Artifact Inline-vs-Canvas surface routing

## Status

Accepted (2026-08-03; amended 2026-08-11)

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

```ts
export type ArtifactSurface = 'inline' | 'canvas';
```

- Missing `surface` means `inline`. Unknown values safely fall back to `inline`.
- Runtime measurements do **not** automatically promote an Inline Artifact to
  Canvas.
- Canvas fences render a compact launcher in the transcript and do not mount
  an inline iframe.
- Inline fences do not receive a generic "Open in Canvas" action.
- Canvas does not auto-open while a response is streaming. Streaming remains
  source-only under ADR 0005.
- Completed Canvas launchers open the right panel only after user action.
  Model output must not unexpectedly rearrange the shell.

### 2. Inline is the default and flows with the transcript

Inline remains the default surface. Its iframe follows the measured component
height, while the transcript remains the only vertical scroll owner. Inline
does not create a nested 900px scrollport or require Expand/Collapse chrome.

Tall content alone is **not** a reason to enter Canvas. Width is still a
semantic generation decision rather than a runtime measurement: content that
can reflow remains Inline; a layout that fundamentally requires horizontal
scrolling or a wide workspace must declare Canvas. Dimensions never
auto-promote; the declared `surface` is the only routing input.

### 3. Canonical routing policy

The model-facing decision order is:

1. The user explicitly requests Canvas/right-side interaction → **canvas**.
2. The UI must return a result to the Composer → **canvas**.
3. The UI is multi-step or must retain local workflow state → **canvas**.
4. The primary deliverable is an interactive application/page prototype →
   **canvas**.
5. The UI is a persistent, coordinated, detail-inspection workspace →
   **canvas**.
6. Otherwise → **inline**.

The following are **not** Canvas criteria by themselves:

- many words;
- tall content;
- a chart or table that can responsively reflow without horizontal scrolling;
- tabs, filtering, hover, animation, or a few buttons;
- visually rich output;
- content that remains readable in the supported Inline width range.

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
- Inline uses the chat-stage width and grows to measured content height.
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

- The Inline root becomes a size container (`container-type: inline-size`).
- Common direct children, media, form controls, grids, and flex descendants
  are prevented from widening the root where safe.
- Inline html/body overflow is hidden; measured content height is applied to
  the iframe so the transcript owns vertical scrolling.
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
  right-panel home and `+` picker; it is opened from a Canvas launcher or an
  explicit product command only.
- **Uses the existing right-panel resize system**: on desktop, opening Canvas
  ensures a useful minimum width (target 520–560 px, bounded by the existing
  viewport clamp); compact mode continues to use the 92vw overlay.
- **Rendering**: the Canvas iframe fills the available panel body and owns its
  internal scrolling. It does not show Inline Expand/Collapse or the Inline
  raw-source disclosure.
- **Same security posture as Inline**: existing Artifact security
  classification, iframe sandbox, CSP, theme injection, external-resource
  policy, ready timeout, and action validation remain mandatory and identical.
- **Streaming stays source-only** (ADR 0005); Canvas mounts only after user
  action on a completed message.

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

- ADR 0005 (Artifact sandbox, streaming source-only, media/image policy)
- Plan: `docs/plans/2026-08-03-artifact-surface-routing-canvas-shell.md`
