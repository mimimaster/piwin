# Coding-Agent Chat Window Stabilization and UX Plan

| Field | Value |
|---|---|
| Status | **Implementation landed; P0 audit fixes in progress 2026-07-25** — native Tauri smoke evidence still pending |
| Date | 2026-07-25 |
| Scope | Stabilize the Desktop agent conversation, then make the run, tool, reasoning, typography, layout, Markdown, and Artifact behavior coherent |
| Related | `docs/prd.md`, `docs/architecture.md`, `docs/artifact-research.md`, `docs/adr/0005-artifact-and-media.md`, `docs/adr/0015-async-desktop-turn-transport.md`, `docs/plans/2026-07-25-general-workspace-sessions.md` |
| Constraints | `AGENTS.md`; contracts first for cross-layer data; Desktop consumes normalized host events only; UI never imports Pi packages or calls filesystem/process APIs |

## 0. Purpose

The current desktop transcript is a functional MVP, not yet a dependable
coding-agent work surface. It has real streaming, tools, permission state,
Markdown, and HTML Artifact support, but the presentation duplicates some run
status, infers tool semantics from names, and does not yet make one agent turn
read as a coherent piece of work.

This plan deliberately separates two jobs:

1. **Stabilize truth and interaction first.** A visible item must correspond
   to one host event or one persisted transcript record. No duplicate listeners,
   duplicate assistant bubbles, fake Git actions, or history reinjection.
2. **Improve the coding-agent work loop second.** A user should be able to
   scan the answer, expand work details when desired, inspect tools and files,
   intervene safely, and understand the final result without reading raw logs.

The plan is intentionally executable in small vertical slices. It does not
require a wholesale UI rewrite, a new state library, generated imagery, or a
fork of Pi.

## 1. Scope and non-goals

### In scope

1. Remove redundant and false chat completion UI.
2. Make repeated replies, empty assistant rows, duplicate transport listeners,
   and unsafe event ordering observable and testable.
3. Give each run a compact status plus a transcript-local work timeline.
4. Present tool calls as structured work records rather than mostly raw output.
5. Add user-controlled transcript/code typography and density preferences.
6. Establish a stable three-area desktop layout that adapts correctly for
   General and Project scopes.
7. Establish explicit Markdown and Artifact behavior for streaming, coding
   work, and final reports.
8. Add accessibility and native Tauri smoke coverage for the critical loop.

### Explicit non-goals

1. Replacing Pi's execution engine, provider protocol, or session tree model.
2. Exposing raw chain-of-thought as a product requirement. Any model-provided
   reasoning is optional diagnostic detail, not an authoritative explanation.
3. Building a full IDE, diff editor, terminal redesign, or Git staging UI.
4. Adding generated illustrations or downloaded decorative assets. Operational
   state should use existing icons, CSS animation, text, and status color.
5. Re-rendering every token as a rich Artifact or enabling arbitrary HTML in
   the parent document.
6. A breaking rewrite of the existing session transcript persistence format.

## 2. Current baseline and known defects

### Already implemented or partially implemented

| Area | Current state |
|---|---|
| General sessions | General scope can create and prompt without selecting a project. |
| Pi event mapping | Missing provider message IDs receive stable generated IDs. |
| Empty lifecycle rows | New empty assistant lifecycle messages are removed in reducer and recorder paths. |
| Duplicate connection race | `HostClient.connect()` has a single-flight connection guard. |
| Prompt history ownership | Product transcript history is injected only for reconstructed product-shell sessions. |
| Streaming | Assistant message deltas stream into one normalized message. |
| Markdown / Artifact | `MarkdownView` is available; Artifact rendering is sandboxed and security-classified. |
| Tool cards | Existing cards have running/done/error states, density, output expansion, and citations. |
| Run status | Global run strip uses ADR 0015 run phase and terminal events. |

### Defects and product gaps to address

| ID | Issue | User-visible effect |
|---|---|---|
| CW-01 | `RunOutcomeCard` repeats the completed state already in `RunStatusStrip`, uses hard-coded zero diff data, and exposes `Open Git` in General scope. | Duplicate, misleading completion card. |
| CW-02 | Event payloads do not carry a protocol event ID/sequence or snapshot-versus-delta semantics. | A reconnection or listener defect can append duplicate deltas. |
| CW-03 | Tool UI infers type from `toolName` and receives only name/output/status. | It cannot reliably show command, target, duration, exit code, or changed files. |
| CW-04 | Thinking and tools are separate blocks rather than a single run-local work record. | The work narrative is hard to scan. |
| CW-05 | Typography has a tool-card density setting but no coherent assistant/code font, font-size, or code-wrapping preferences. | Reading comfort and code inspection are not configurable. |
| CW-06 | The global run strip is not enough historical context after a later turn starts. | Completed work is not tied clearly to the assistant turn that produced it. |
| CW-07 | Artifact streaming policy can still be more eager than the intended coding workflow. | Interactive HTML can distract from ordinary code work. |
| CW-08 | ARIA live status includes elapsed time updates. | Screen readers may receive overly frequent announcements. |

## 3. Locked UX decisions

These decisions constrain every implementation slice. If one must change, add
or amend an ADR before changing behavior.

### 3.1 One run, one work record

Each submitted prompt has a `runId`. The UI treats its lifecycle as:

```text
Accepted
  -> Preparing / connecting / waiting-first-token
  -> Working: optional thinking, tools, permissions, processes
  -> Drafting: assistant text streaming
  -> Completed | cancelled | failed
```

- The **top status strip** reports only the current active run and recovery
  action (Stop, review permission, retry).
- The **assistant turn** owns the completed work record for its run.
- There is no generic post-transcript “Complete” card.
- A summary appears only if host data supports it; no fake file counts, Git
  actions, or placeholder metrics.

### 3.2 Work details are progressive disclosure

- While a run is active, the active tool or permission state remains visible.
- On completion, work details collapse by default unless a tool failed or the
  user selected an always-open preference.
- The default label is **Work details**, not an assertion that hidden content
  is complete model reasoning.
- Model thinking, if provided, is displayed as optional provider output with a
  clear “details may be incomplete” affordance. Product progress summaries,
  tools, permission waits, and process state are primary.

### 3.3 Rendering policy for coding work

| Content phase | Default presentation | Must not happen |
|---|---|---|
| Thinking / planning | Work-details text and plan/progress records | No Artifact iframe. |
| Tool execution | Structured cards, bounded output, changed-file/diff links | No raw unbounded log dump in the transcript. |
| Assistant text while streaming | Lightweight, safe Markdown text/code treatment; unfinished fences are source only | No interactive Artifact, Mermaid execution, or repeated full-document parsing. |
| Completed assistant report | Full supported Markdown, copyable code fences, links and citations | No unsafe HTML in parent document. |
| Explicit UI/HTML deliverable | Sandboxed Artifact below/beside its source only after completion and security classification | Artifact must not replace source or run automatically for normal code output. |

This narrows the current interpretation of ADR 0005 without changing its
security model: Markdown remains the default message format; an Artifact is a
deliberate interactive result, not a generic rich renderer for coding turns.
The implementation slice must amend ADR 0005 or add a focused ADR if this
behavior changes an already shipped product guarantee.

### 3.4 Typography and layout defaults

- Assistant prose: system UI font, 15 px base, 1.6 line height.
- Code and tool output: system monospace stack, 13 px base, 1.5 line height.
- User controls: assistant size (small/default/large), code size
  (small/default/large), code wrap, tool density, and work-details default
  expansion.
- The center transcript has a readable max width of roughly 760 px; wide
  screens use remaining space for an optional Inspector rather than stretching
  text indefinitely.
- General scope hides project-only Files, Review, Git, and Terminal actions;
  no control should imply that General is a project.

## 4. Delivery sequence

```text
C0 Baseline and deletion
  -> C1 Event correctness and duplicate-proof stream handling
  -> C2 Run-local timeline and work-details presentation
  -> C3 Structured tool contract and cards
  -> C4 Typography, preferences, and responsive layout
  -> C5 Markdown / Artifact policy enforcement
  -> C6 Accessibility, native smoke, and documentation
```

Each slice is independently reviewable. Do not begin C3 until C1 has a stable
event test boundary; do not begin C5 until C2 has clear ownership of a run and
assistant turn.

## 5. C0 — Remove the misleading completion card

**Objective:** eliminate the UI shown in the screenshot: a second “Complete”
card that duplicates the run strip and offers invalid General-scope Git actions.

**Owner:** `apps/desktop`

**Files**

| Action | File |
|---|---|
| Update | `apps/desktop/src/App.tsx` |
| Delete, if no remaining callers | `apps/desktop/src/run-outcome-card.tsx` |
| Update | related `App` or component tests |

**Steps**

1. Remove the `RunOutcomeCard` import, `outcomeDismissed` state, reset effect,
   and render branch from `App.tsx`.
2. Search all usages. Delete `run-outcome-card.tsx` only when no production or
   test caller remains; do not leave dead CSS/test IDs behind.
3. Retain `RunStatusStrip` as the sole global active-run status surface.
4. Confirm a completed General run has neither a `Complete` duplicate card nor
   an `Open Git` action.

**Acceptance criteria**

- One tool completion yields one status indication, not two.
- General scope never renders an invalid Git action in the transcript.
- No placeholder changed-file count is presented as real evidence.

**Verification**

- Focused Desktop component test for General completion.
- `pnpm --filter @piwin/desktop typecheck`
- `pnpm --filter @piwin/desktop test`

## 6. C1 — Make event delivery idempotent and observable

**Objective:** prevent duplicate visible output without incorrectly removing
legitimate repeated text tokens.

**Owners:** `packages/contracts`, `packages/agent-host`, `apps/desktop`

**Files**

| Action | File |
|---|---|
| Update | `packages/contracts/src/host.ts` |
| Update | `packages/contracts/src/ipc.ts` and schema tests |
| Update | `packages/agent-host/src/event-map.ts` |
| Update | SDK/RPC adapter event bridge files |
| Update | `apps/desktop/src/host-client.ts` |
| Update | `apps/desktop/src/chat-reducer.ts` |
| Add/update | mapper, transport, reducer fixture tests |

**Contract design**

Add an additive envelope to normalized events emitted at the host boundary:

```ts
type AgentEventEnvelope = {
  eventId: string;
  sequence: number;
  runId?: string;
};
```

For message content, distinguish append-only delta from a complete snapshot:

```ts
| { type: 'message/text_delta'; messageId: string; delta: string; ... }
| { type: 'message/text_snapshot'; messageId: string; text: string; ... }
```

The host, not Desktop, converts provider cumulative text into either a suffix
delta or an explicit snapshot. Desktop keeps a bounded per-run/event ID set and
last accepted sequence. It ignores stale or repeated event IDs but must never
deduplicate based on equal `delta` text, because adjacent identical tokens are
valid output.

**Steps**

1. Inventory every SDK, RPC, mock, sidecar, and persistence event producer.
2. Add envelopes compatibly; update all producers/consumers in the same change.
3. Give every host-generated event a stable ID; preserve upstream IDs where
   they are reliable and namespace them by session/run when needed.
4. Add a snapshot path and host-side suffix conversion for providers that emit
   cumulative message text.
5. Make reducer ordering rules explicit: reject prior sequences for the same
   run, tolerate absent legacy envelopes during migration, and retain empty
   assistant cleanup only after terminal/message-end conditions.
6. Keep the `HostClient.connect()` single-flight guard; add unmount/reconnect
   tests proving every listener is disposed exactly once.
7. Add a temporary developer-only diagnostics counter for received, ignored
   duplicate, stale, and rendered events. It must contain no prompt text,
   tokens, paths, or secrets.

**Acceptance criteria**

- Strict Mode/HMR concurrent connect creates only one message listener and one
  log listener.
- Replay of an event envelope does not append text twice.
- Two intentional identical text deltas still render twice.
- Cumulative provider snapshots render exactly once as the correct final text.
- A late event from an older run does not mutate the active transcript.

**Verification**

- Contract schema tests for both legacy and enveloped event forms.
- Fixture tests for SDK and RPC cumulative/delta mapping.
- Desktop reducer tests for replay, ordering, and legitimate equal deltas.
- Sidecar reconnection test and a manual Tauri Strict Mode/HMR check.

## 7. C2 — Attach a work timeline to each assistant turn

**Objective:** evolve the transcript from disconnected bubbles plus a global
status strip into a reliable per-run work record.

**Owners:** `apps/desktop`; `packages/contracts` only if C1 lacks the required
run linkage.

**Files**

| Action | File |
|---|---|
| Update | `apps/desktop/src/chat-reducer.ts` |
| Add | `apps/desktop/src/run-presentation.ts` |
| Add | `apps/desktop/src/turn-work-details.tsx` |
| Update | `apps/desktop/src/chat-thread.tsx` |
| Update | `apps/desktop/src/run-status-strip.tsx` |
| Update | transcript CSS and focused tests |

**Presentation model**

Keep the reducer as raw event state. Add a pure selector that projects one
assistant message/run into a `TurnPresentation`:

```ts
type TurnPresentation = {
  runId: string;
  phaseHistory: RunPhaseView[];
  startedAt?: number;
  endedAt?: number;
  outcome?: 'completed' | 'cancelled' | 'failed';
  workItems: WorkItemView[];
  hasFailure: boolean;
  permissionState?: PermissionView;
};
```

`TurnPresentation` belongs in Desktop until host data needs richer semantics;
do not prematurely persist a UI-only projection.

**Steps**

1. Associate all current run events, tools, permissions, compaction, and
   process records with `runId` in reducer state.
2. Link the assistant message started for a run to that run. Define fallback
   behavior for legacy messages with no run ID.
3. Create `TurnWorkDetails` with a concise summary row, optional phase history,
   model-provided thinking, tool group, permission status, and terminal
   outcome. Use accessible `<details>`/buttons with stable labels.
4. Render active work details directly before streaming assistant text; render
   completed work details collapsed by default except failures.
5. Reduce `RunStatusStrip` to live current-run state. It must not duplicate
   historical completed summaries or fake file metrics.
6. Split the ARIA status content: announce phase/permission/outcome changes
   only, while elapsed time remains non-live visual metadata.

**Acceptance criteria**

- A completed assistant turn remains understandable after another run begins.
- Active tool, permission wait, cancellation, and failure are attributable to
  the correct assistant turn.
- Successful completed work is compact; failed work is discoverable without
  hunting through raw tool output.
- Screen readers are not notified every second solely because elapsed time
  changes.

**Verification**

- Pure selector tests covering completed, failed, cancelled, permission, and
  legacy/no-run-ID turns.
- Component tests for default expansion behavior and ARIA state.
- Manual smoke: prompt -> tool -> permission -> allow/deny -> final answer;
  prompt -> Stop; prompt -> failure -> Retry.

## 8. C3 — Upgrade the normalized tool presentation contract

**Objective:** stop guessing tool semantics in React and give the transcript
truthful, compact, actionable tool records.

**Owners:** `packages/contracts`, `packages/agent-host`, `apps/desktop`

**Files**

| Action | File |
|---|---|
| Update | `packages/contracts/src/host.ts` and public exports |
| Update | Pi SDK/RPC event mappers in `packages/agent-host/src/` |
| Add | `packages/agent-host/src/tool-presentation.ts` |
| Update | `apps/desktop/src/chat-reducer.ts` |
| Update | `apps/desktop/src/tool-call-card.tsx` |
| Update | `apps/desktop/src/turn-tool-group.tsx` |
| Add/update | mapper fixtures, contract, reducer, and card tests |

**Contract design**

Add a normalized optional presentation payload to tool lifecycle events. The
host supplies it; UI must not parse raw model/tool names to invent semantics.

```ts
type ToolPresentation = {
  kind: 'filesystem' | 'shell' | 'git' | 'web' | 'mcp' | 'process' | 'other';
  title: string;
  summary?: string;
  inputPreview?: string;
  command?: string;
  targetPaths?: string[];
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  changedPaths?: string[];
  output: ToolOutputView;
  error?: ToolErrorView;
};
```

`ToolOutputView` must enforce bounded retained output and redaction at the
host boundary. UI gets display-safe structured content, not secrets or an
unbounded process log.

**Steps**

1. Record the data available from each Pi SDK and RPC tool shape using fixtures;
   do not invent fields unavailable from the provider.
2. Implement a pure mapper from raw tool event to `ToolPresentation`.
3. Classify known local tool types in the host. For unknown/MCP tools use
   `other` with an honest title rather than string heuristics in the UI.
4. Add per-kind cards:
   - filesystem: operation and target paths;
   - shell/process: command, duration, exit code, bounded output;
   - git: operation and changed paths;
   - web/MCP: source/server, citation/result summary;
   - failure: stable error category and retry/recovery guidance where valid.
5. Replace `toolKindIcon(toolName)` inference with presentation `kind`.
6. Add a shared changed-path click contract only after validating that Files or
   Review is available for the current Project scope. General remains text-only
   for paths unless a later General workspace browser is designed.

**Acceptance criteria**

- A shell tool shows its real command and exit status when host data exists.
- A file edit identifies changed paths when Pi reports them.
- An unknown tool is not mislabeled as shell/filesystem based on its name.
- Tool output is bounded and secrets are not displayed in new UI fields.
- General never exposes invalid project review/Git navigation.

**Verification**

- Golden mapper tests for filesystem, shell success/failure, Git, web, MCP,
  unknown, and redaction cases.
- Card tests for each kind and compact/comfortable/detailed density.
- Existing permission-policy tests plus a new secret-output regression test.

## 9. C4 — Typography preferences and resilient shell layout

**Objective:** make long coding sessions readable without introducing a theme
fork or fragmenting shell ownership.

**Owner:** `apps/desktop`; use `@piwin/contracts` only if preferences become
cross-app config rather than Desktop-local presentation settings.

**Files**

| Action | File |
|---|---|
| Update | `apps/desktop/src/ui-preferences.ts` |
| Update | `apps/desktop/src/SettingsPanel.tsx` |
| Update | `apps/desktop/src/App.tsx` preference wiring |
| Update | `apps/desktop/src/chat-thread.tsx`, `MarkdownView.tsx`, tool cards |
| Update | `apps/desktop/src/styles/tokens.css`, transcript, shell, and responsive styles |
| Add/update | preference and viewport tests |

**Steps**

1. Expand `ui-preferences.ts` from tool density into a validated desktop
   preference object with migration from the existing key:
   - assistant text size: `small | default | large`;
   - code text size: `small | default | large`;
   - code wrapping: `wrap | scroll`;
   - tool density;
   - work detail default: `auto | expanded | collapsed`.
2. Store these as Desktop-local presentation settings initially. Do not put
   them in a prompt, transcript, model config, or project permission record.
3. Map preferences to CSS custom properties on the app shell. Use one stable
   system font stack and one system monospace stack; a font-family picker is a
   later optional enhancement, not required for this slice.
4. Add an Appearance section in Settings with accessible segmented controls,
   immediate preview, reset-to-default, and persisted values.
5. Establish explicit layout invariants:
   - Navigator: sessions/scope only;
   - Stage: status, transcript, sticky composer;
   - Inspector: optional Activity, Files, Review;
   - Stage text column max width roughly 760 px;
   - at compact width, only one overlay panel opens at once and restores focus
     to its trigger;
   - General hides project-only inspector tabs/actions.
6. Remove conflicting shell media queries rather than layering new overrides.

**Acceptance criteria**

- Preferences survive reload and reject malformed storage values safely.
- Assistant and code size change without layout overflow.
- Wrap/scroll affects code fences and tool output consistently.
- A 1024 px desktop view and compact view retain an accessible composer,
  transcript, sessions control, and panel dismissal path.
- General scope does not contain a visually empty project inspector or Git CTA.

**Verification**

- Unit tests for preference parsing/migration/defaults.
- Component tests for applied shell data attributes/CSS classes.
- Existing viewport suite plus screenshots at 820, 1023, 1024, 1440 px.
- Keyboard tests for opening/closing navigator, inspector, and Settings.

## 10. C5 — Enforce the Markdown and Artifact delivery boundary

**Objective:** keep coding work fast and legible, while preserving a secure
explicit Artifact experience for real interactive deliverables.

**Owners:** `apps/desktop`, `packages/artifact`, docs

**Files**

| Action | File |
|---|---|
| Update | `apps/desktop/src/MarkdownView.tsx` |
| Update | `apps/desktop/src/chat-thread.tsx` |
| Update | `packages/artifact/src/streaming.ts` and tests if policy support is missing |
| Update | `packages/artifact/src/parser.ts` and security tests as needed |
| Update | `docs/adr/0005-artifact-and-media.md` or add a focused ADR |
| Update | `docs/artifact-research.md` and this plan status |

**Steps**

1. Add an explicit rendering phase prop from `ChatThread` to `MarkdownView`:
   `streaming`, `completed`, or `explicit-artifact-review`.
2. In `streaming`, render paragraphs, lists, and code source cheaply; incomplete
   code fences remain source. Disable ArtifactFrame initialization and Mermaid
   execution.
3. In `completed`, render normal Markdown and static code fences. Identify a
   candidate Artifact only when the complete fence is HTML/UI-like and passes
   existing security policy.
4. Require a clear user-visible “Preview artifact” action (or an explicit
   model artifact designation if a future contract makes intent trustworthy)
   before initializing the iframe. Always retain source and copy/download.
5. Preserve existing sandbox, CSP, size, external-resource, theme, and init
   queue protections. No HTML runs in the parent document.
6. Add code-block affordances: language label, copy, wrap/scroll preference,
   bounded long lines, and source-first behavior.
7. Document the final policy in ADR/research files so future model/tool work
   cannot silently turn normal code output into an iframe.

**Acceptance criteria**

- Streaming a partial HTML or Mermaid fence does not mount an iframe or execute
  Mermaid.
- A completed normal code response remains a readable Markdown/code transcript.
- A permitted HTML artifact is source-first, sandboxed, and explicitly opened.
- Block reasons (empty, too large, external resource) remain visible and
  actionable.

**Verification**

- Artifact parser/security/streaming unit tests.
- MarkdownView component tests for all three rendering phases.
- Manual Tauri test with a long stream, code block, Mermaid, valid artifact,
  blocked artifact, and dark/light appearance switch.

## 11. C6 — Accessibility, native evidence, and release documentation

**Objective:** verify the full interaction in the actual Tauri application,
not just browser/mock unit tests.

**Owners:** `apps/desktop`, `packages/agent-host`, docs

**Steps**

1. Audit transcript and work-details semantics:
   - transcript `role="log"` does not announce token-level changes;
   - phase/permission/outcome announcement is concise;
   - buttons describe their target tool/run;
   - collapsed work details and tool cards expose `aria-expanded`.
2. Verify focus order and restoration for permission dialog, Settings,
   navigator, inspector, Artifact preview, and dismissal with Escape.
3. Add a manual native macOS evidence recipe covering:
   - cold-start General prompt;
   - project prompt and tool run;
   - rapid double-send prevention;
   - streaming and Stop;
   - permission ask/allow/deny;
   - sidecar reconnect/restart;
   - one valid and one blocked artifact;
   - General versus Project panel boundaries;
   - 100+ historical messages and many completed tools.
4. Capture expected transport/backend/provider labels. Do not call the desktop
   production-ready merely because browser/mock and sidecar tests pass.
5. Update `docs/todo-deferred.md` with deliberately deferred work, including
   full GFM decision, arbitrary font-family selection, richer diff navigation,
   and any provider metadata unavailable to tool presentation.

**Acceptance criteria**

- Keyboard-only flow can prompt, Stop, inspect a failed tool, respond to a
  permission dialog, and return focus predictably.
- No native smoke run displays duplicate assistant text or invalid General Git
  controls.
- Documents state exactly what was tested in browser mock, live sidecar, and
  native Tauri; no layer is overstated.

## 12. Test and PR plan

Ship one concern per PR/commit grouping; do not mix large visual refactors with
event protocol changes.

| PR | Scope | Required checks |
|---|---|---|
| 1 | C0 redundant completion-card removal | Desktop typecheck + focused render test |
| 2 | C1 event envelope, idempotency, transport/reducer tests | contracts/host/desktop typecheck and focused test suites |
| 3 | C2 run-local work presentation | Desktop unit/component tests + manual mock smoke |
| 4 | C3 structured tool contract and cards | contracts/host/desktop tests; redaction golden cases |
| 5 | C4 preferences and shell layout | Desktop tests, viewport screenshots, keyboard checks |
| 6 | C5 Markdown/Artifact policy | artifact + desktop tests, security regression suite |
| 7 | C6 accessibility/native evidence/docs | full relevant suite + dated native smoke record |

Every PR must run, at minimum:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/desktop test
```

Run affected package tests as well (`@piwin/artifact`, session, and host), then
run the repository-level `pnpm typecheck` and `pnpm test` before integration.

## 13. Completion definition

The chat-window work is complete only when:

1. Normalized events have explicit replay/ordering semantics and regression
   tests prove that duplicate delivery cannot duplicate transcript output.
2. Every active or completed turn has one truthful run/work record, no generic
   duplicate completion card, and no fake project-only action in General.
3. Tool cards derive their semantics from host-provided structured data, redact
   sensitive output, and remain useful at compact density.
4. Users can change prose/code size, code wrapping, tool density, and
   work-detail expansion preference without corrupting other configuration.
5. Markdown is safe and readable throughout; Artifacts are explicit,
   source-preserving, sandboxed post-completion previews rather than a default
   coding-work renderer.
6. Desktop tests, package tests, accessibility checks, and a dated native
   Tauri smoke recipe pass with evidence appropriate to each layer.
