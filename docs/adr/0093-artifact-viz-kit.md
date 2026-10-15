# ADR 0093: Artifact viz kit — step-through teaching figures

- **Status**: Accepted
- **Date**: 2026-10-15
- **Scope**: `@piwin/contracts`, `@piwin/artifact`, `crates/artifact-webview`, `apps/desktop` (e2e showcase)
- **Consults**: ADR 0088 (kit v1)
- **Spec**: `docs/specs/2026-10-15-artifact-viz-kit.md`

## Context

Explaining algorithms, memory layouts, protocols and scheduling (the CS
"408" syllabus is the acceptance set) needs pictures whose *state changes step
by step*. Markdown already renders static math and Mermaid, so artifacts only
earn their place here with stateful figures. Hand-written HTML/JS for these is
long, slow to stream and inconsistent. The product owner approved 20 sketches
(`docs/plans/artifact-408-viz-mock.html`).

## Decision

1. **Markup.** `<figure data-piwin-viz="KIND">` holding
   `<script type="application/json">` with a spec, plus a `<figcaption>`.
   Kinds: `array stack list tree graph hash bits grid gantt blocks seek topo
   seq window layers` (one renderer per drawing family, not per textbook topic).
2. **Steps.** A spec may carry `steps`: each step is shallow-merged over the
   top-level fields. The kit then adds a step bar (prev / play / next, note,
   counter). The figure rests on the **last** step, so a static reading
   (thumbnail, export, no-JS) still shows the finished picture.
3. **The kit only draws.** It never runs the algorithm; the model writes each
   step's state. States use the kit tone names (`warn accent ok risk info
   muted`), colors come only from `--piwin-artifact-*`.
4. **Separate on-demand script.** `viz.js` is its own file
   (`/lib/v1/viz-1.0.0.js`, compiled into the binary like `kit.js`), injected
   only when the source contains `data-piwin-viz` (and for v14 stream
   previews). Fences that use only charts/icons do not pay for it. Viz styles
   ride the always-inline kit CSS.
5. **Line chart annotations.** Kit v1 `line` gains `refs` (dashed threshold
   segments) and `marks` (labelled points), e.g. cwnd/ssthresh. Kit bumps to
   1.2.0 (new immutable path).
6. **Prompt.** The resident built-ins line names `data-piwin-viz` and its
   kinds only; the full spec reference is in `artifact_instructions`.
7. **Capability.** `ARTIFACT_KIT_VERSION` stays 1: every shell ships
   `@piwin/artifact` from the same build. An older shell shows the figcaption.

## Consequences

- Budgets: `kit.js` ≤ 32 KB, `viz.js` ≤ 32 KB raw (tests).
- Same sandbox rules as kit v1: no eval/fetch/parent; model strings are
  escaped; numbers coerced; icon markup is a trusted constant set.

## Follow-up: no preview count cap (2026-10-15)

A reply with several step-through figures hit the Desktop live-iframe cap
(`MAX_LIVE_ARTIFACT_IFRAMES = 3`) and showed "Load preview" on most of them.
The product owner removed the cap: every preview mounts, and only memory
pressure recycles them. At `critical` (WebContent ≥ 1536 MB or system
available ≤ 64 MB, `memory-pressure.ts`) every unpinned preview is evicted and
new unpinned previews start recycled until pressure leaves `critical`;
streaming previews and the open Canvas stay mounted. Nothing remounts by
itself; "Load preview" always mounts. Loading stays serialized by the init
queue (`MAX_CONCURRENT_ARTIFACT_INITS = 1`).
