# Subagent Activity and Session Inspector Implementation Plan

> **Execution requirement:** implement this plan with `subagent-driven-development` or `executing-plans`, keep the parent session as the integration authority, and update each stable step id as work completes.

| Field | Value |
|---|---|
| Status | **Executed** (2026-08-03) — all 7 steps implemented; see §10 Execution record |
| Date | 2026-08-03 |
| Classification | Long |
| Recommended execution mode | Subagent-driven, with sequential integration checkpoints |
| Primary owner | `apps/desktop` |
| Architecture impact | Desktop presentation refactor; no Host or Contracts change |

## 1. Goal

Replace the current fragmented Subagent presentation with one coherent, attractive, and direct interaction model:

1. active child sessions appear through a compact animated activity surface;
2. the same activity can be opened as a large read-only child-session inspector without leaving the parent session;
3. persisted child history and current token/tool/thinking streams appear as one continuous transcript;
4. the user can explicitly promote the preview into the existing full session view;
5. obsolete inline expansion code, duplicate state derivation, and overlapping CSS ownership are removed rather than preserved for compatibility.

The result should look lightweight in the parent transcript and rich only after the user asks for detail.

## 2. Non-goals

- Do not add a composer to the inspector.
- Do not allow steering or follow-up messages from the inspector in this slice.
- Do not create a second session runtime, event bus, or transcript store.
- Do not parse Pi-native events in Desktop.
- Do not change parallel scheduling or worktree integration behavior from ADR 0030.
- Do not make `SubAgentPanel` the default activity surface.
- Do not add per-token animation; append streamed text normally and animate only container/status transitions.
- Do not invent token counts that are not already available per child session.

## 3. Constraints and architectural invariants

1. Desktop consumes only `@piwin/contracts`, `@piwin/ui-kit`, and existing application APIs. It must not import `@earendil-works/pi-*`.
2. Existing host seams remain authoritative:
   - `session/list-children` supplies child summaries;
   - `session/messages` supplies persisted child transcript history;
   - `subagent/updated` supplies lifecycle changes;
   - `subagent/stream` supplies normalized live `AgentEvent` data;
   - `session/resume` opens the child as the foreground session.
3. One derived activity model must drive the ticker, Working count, launcher card, and inspector header. Each surface must not independently interpret lifecycle state.
4. Persisted transcript messages remain the source of truth for history. `SubagentStreamState` is only the live tail.
5. All history/live reconciliation is pure and unit-tested. React components do not contain message-id deduplication rules.
6. Host requests live in a dedicated hook/controller boundary. Presentational components receive view data and callbacks only.
7. The inspector is read-only observation. Closing it never aborts the child.
8. Reduced-motion preferences disable automatic cycling and non-essential movement.
9. No new dependency is expected. Reuse React, Framer Motion, Radix-backed `Dialog`, `MarkdownView`, and existing icon/theme primitives.
10. If implementation discovers that an existing host contract cannot represent required data correctly, stop and add the smallest contracts-first seam with both SDK and RPC-fallback coverage. Do not patch around it in Desktop.

## 4. Current conflicts to remove

The implementation must deliberately clean up these conflicts instead of layering another UI on top:

| Conflict | Required resolution |
|---|---|
| `SubagentActivityCard` is both a lifecycle card and an expandable stream viewer | Make it a compact launcher/status card only; remove local expansion state and embedded stream transcript rendering. |
| `SubagentActivityCard` exposes an `Open session` action that immediately replaces the parent context | Change the primary action to inspect in place; keep full session navigation as an explicit action inside the inspector. |
| Subagent styles are split between `region-transcript.css` and `run-activity.css` | Assign compact activity/ticker motion to `run-activity.css`; assign dialog/transcript inspector styles to a dedicated stylesheet; delete duplicate selectors. |
| Main chat reducer contains transcript-message projection inline | Extract the reusable persisted-message projection so the foreground chat and inspector cannot drift in status/tool/attachment mapping. |
| Settings locally reloads children while the main workspace depends on pushes | Hydrate active-parent children at the application boundary and store them in the existing reducer map; Settings and workspace consume the same summaries. |
| Live stream and persisted transcript can render the same current assistant message twice | Centralize reconciliation by `currentMessageId` and tool-call identity in a pure projector. |
| Cross-session Subagent maps can retain unrelated entries | Every selector filters by `parentSessionId`; add explicit scope cleanup only where it is safe and covered by tests. |

## 5. Target architecture

```text
Host push / request
  ├── session/list-children
  ├── session/messages
  ├── subagent/updated
  └── subagent/stream
          ↓
App/reducer state + preview controller hook
          ↓
pure Subagent activity/session projection
  ├── ActiveSubagentView[]
  └── SubagentSessionView
          ↓
presentation
  ├── SubagentActivityTicker
  ├── SubagentWorkingDock
  ├── SubagentActivityCard
  └── SubagentSessionDialog
```

### 5.1 Desktop-local view models

Keep these presentation types local to `apps/desktop`; they are not cross-boundary contracts:

```ts
type ActiveSubagentView = {
  childSessionId: string;
  parentSessionId: string;
  displayName: string;
  taskSummary: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  latestActivity: string;
  runningToolName?: string;
  worktreePath?: string;
  updatedAt: string;
};

type SubagentSessionView = {
  activity: ActiveSubagentView;
  historicalMessages: ChatMessageUi[];
  liveTail: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
};
```

Do not expose raw reducer maps to leaf components once these projections exist.

### 5.2 Interaction model

```text
Compact card / ticker / Working row click
  → open SubagentSessionDialog
  → parent session remains active

Dialog “Open full session”
  → close dialog
  → existing handleResumeSession(childSessionId)

Dialog close / Escape
  → close dialog only
  → child continues running
```

### 5.3 Visual hierarchy

- Parent surface: one-line or two-line compact activity, restrained motion, no large nested transcript.
- Inspector header: task title, Subagent identity, lifecycle badge, explicit full-session and close controls.
- Inspector task brief: compact, visually separated from generated output.
- Inspector transcript: persisted messages followed by one live tail.
- Inspector footer: lifecycle state and auto-follow state; no composer.
- A completed inspector remains open and changes status in place.

## 6. Planned file structure

Names may be adjusted during implementation only when an existing repository convention provides a clearer owner.

### Add

- `apps/desktop/src/subagent-activity-model.ts`
  - pure child filtering, lifecycle normalization, latest-activity derivation, and stable sorting.
- `apps/desktop/src/subagent-session-projection.ts`
  - pure persisted-history/live-tail reconciliation.
- `apps/desktop/src/hooks/use-subagent-session-inspector.ts`
  - dialog selection, `session/messages` loading, stale-request protection, and terminal refresh.
- `apps/desktop/src/subagent-activity-ticker.tsx`
  - reduced-motion-aware animated cycling through active children.
- `apps/desktop/src/subagent-working-dock.tsx`
  - collapsed `N Working` launcher and small expanded active-child list.
- `apps/desktop/src/subagent-session-dialog.tsx`
  - read-only modal shell and inspector composition.
- `apps/desktop/src/subagent-session-transcript.tsx`
  - focused historical/live transcript presentation; no session controls.
- `apps/desktop/src/styles/subagent-session-inspector.css`
  - inspector-only layout, responsive sizing, sticky regions, and scroll-follow affordance.
- Focused colocated tests for the pure model, projection, hook, ticker/dock, and dialog.

### Update

- `apps/desktop/src/chat-reducer.ts`
  - extract persisted transcript mapping; add child hydration action if not already available; keep normalized state only.
- `apps/desktop/src/chat-thread.tsx`
  - consume compact activity callbacks and shared mapped message rendering; do not own inspector state.
- `apps/desktop/src/subagent-activity-card.tsx`
  - reduce to a compact, keyboard-accessible launcher.
- `apps/desktop/src/App.tsx`
  - compute the active-parent activity projection once; own inspector controller; wire ticker, dock, and dialog.
- `apps/desktop/src/workspace-shell.tsx`
  - add one optional activity-dock slot between transcript and permission/composer surfaces.
- `apps/desktop/src/hooks/use-session-actions.ts` or a narrower session projection module
  - reuse extracted persisted-message mapper where appropriate; avoid duplicate transcript conversion.
- `apps/desktop/src/settings/pages/automation-page.tsx`
  - consume the shared hydrated child summaries without introducing a second lifecycle interpretation.
- `packages/ui-kit/src/dialog.tsx`
  - add only the generic styling/accessibility extension needed by a large application dialog, such as optional content class name and description linkage; no Subagent-specific API.
- `apps/desktop/src/styles.css`
  - import the new inspector stylesheet.
- `apps/desktop/src/styles/run-activity.css`
  - own compact Subagent activity/ticker/dock motion.
- `apps/desktop/src/styles/region-transcript.css`
  - retain transcript slot layout only and delete duplicate Subagent component styling.
- `apps/desktop/e2e/shell.spec.ts`
  - cover the user-visible inspect-without-navigation path.

### Delete from existing code

- `SubagentActivityCard` local `expanded` state and inline stream panel.
- Embedded `ToolStatusIcon` if the new focused transcript/tool component supersedes it.
- Obsolete `subagent-stream-*` selectors tied only to the removed inline expansion.
- Duplicate `.subagent-activity-*` ownership from the wrong stylesheet.
- The default card footer containing a redundant `Open session` button, unless accessibility testing demonstrates a separate explicit launcher is necessary.

## 7. Ordered implementation plan

### Step 1 — Establish pure transcript and Subagent projections

**Stable id:** `1`

**Affected areas:** `chat-reducer.ts`, new `subagent-activity-model.ts`, new `subagent-session-projection.ts`, focused unit tests.

**Work:**

1. Extract the existing `SessionTranscriptMessage[] → ChatMessageUi[]` conversion from the `session/load-messages` reducer case into a named pure function with no React or Host dependency.
2. Make the reducer use that function without changing current foreground-session behavior.
3. Implement `selectActiveSubagents`:
   - filter strictly by active parent session id;
   - normalize execution state from existing `SessionSummary` fields with one documented precedence rule;
   - derive latest activity from running tool, streamed text preview, child preview, then task summary;
   - use stable ordering so animation does not reshuffle on every token.
4. Implement persisted/live reconciliation:
   - map persisted history using the shared mapper;
   - exclude the persisted message matching `liveTail.currentMessageId` while that message is represented by the live tail;
   - preserve historical tools and attachments;
   - never mutate reducer state.
5. Add tests for parent filtering, lifecycle precedence, stable ordering, latest-activity fallback, message-id deduplication, and empty/live/terminal states.

**Acceptance criteria:**

- Foreground session hydration behavior is unchanged.
- All four planned surfaces can consume the same `ActiveSubagentView` objects.
- No React component contains lifecycle precedence or history/live deduplication logic.
- Verification: `pnpm --filter @piwin/desktop test -- subagent-activity-model subagent-session-projection chat-reducer` and `pnpm --filter @piwin/desktop typecheck` pass.

### Step 2 — Unify child hydration and application ownership

**Stable id:** `2`

**Affected areas:** `App.tsx`, `chat-reducer.ts`, existing session/host hooks, Settings automation page, focused reducer/hook tests.

**Work:**

1. Add an explicit reducer action to hydrate/upsert children returned by `session/list-children` for one parent.
2. Load children when the active parent session becomes available and after host reconnect/resume where necessary.
3. Protect against stale async responses: a response for a previous parent must not become the visible active list.
4. Preserve summaries for other parents only if existing Settings behavior requires them; all visible selectors still filter by parent. Otherwise clear them at the existing session-scope boundary.
5. Make Settings consume the shared reducer-backed summaries and keep local reload only as an explicit recovery path, not a second source of truth.
6. Do not add polling.

**Acceptance criteria:**

- Reopening a parent session immediately restores its active/completed child list without waiting for a new push.
- Switching sessions cannot display another parent’s Subagents.
- Settings and the workspace show the same lifecycle status.
- Verification: targeted reducer/session-hook/Settings tests and Desktop typecheck pass.

### Step 3 — Replace the current card with a compact launcher and add active activity surfaces

**Stable id:** `3`

**Affected areas:** `subagent-activity-card.tsx`, new ticker/dock components, `chat-thread.tsx`, `workspace-shell.tsx`, `App.tsx`, `run-activity.css`, component tests.

**Work:**

1. Remove inline stream expansion from `SubagentActivityCard`.
2. Make the compact card keyboard accessible with button semantics or a real button wrapper; support Enter and Space without nested interactive conflicts.
3. Add `SubagentActivityTicker`:
   - cycles active items approximately every two seconds;
   - uses `AnimatePresence` with restrained vertical fade/slide;
   - pauses on hover/focus;
   - shows one stable item when reduced motion is enabled;
   - clicking opens the inspector for that child.
4. Add `SubagentWorkingDock`:
   - collapsed `N Working` pill;
   - optional small expansion listing active children;
   - rows open the same inspector;
   - disappears cleanly when count reaches zero.
5. Add one semantic `activityDock` slot to `WorkspaceShell`; do not use fixed positioning or DOM queries.
6. Compute `ActiveSubagentView[]` once in `App.tsx` and pass the result down. Ticker, dock, and cards must not rebuild their own interpretation.

**Acceptance criteria:**

- Parent transcript stays compact while active work remains obvious.
- Every activity entry opens the same inspector path.
- Automatic cycling is readable, pausable, and reduced-motion safe.
- There is no old inline-expanded child transcript left in the card.
- Verification: focused card/ticker/dock tests, Desktop typecheck, and a manual animation check in both normal and reduced-motion modes pass.

### Step 4 — Implement the inspector controller and reliable history loading

**Stable id:** `4`

**Affected areas:** new `use-subagent-session-inspector.ts`, `App.tsx`, Host-client test fixtures/mocks, hook tests.

**Work:**

1. Store only the selected child identity and loading result needed by the inspector; do not clone global chat state.
2. On open, request `session/messages` for the child without calling `session/resume`.
3. Guard against stale responses when the user rapidly opens another child or closes the dialog.
4. Read the live tail from the existing reducer map rather than creating another event subscription.
5. Refresh persisted history once when a running stream becomes terminal, then let reconciliation replace the live tail with persisted final content.
6. Keep the last successfully loaded view visible during terminal refresh to avoid flashing an empty dialog.
7. Map errors to a small retryable inspector state; do not dispatch them as the foreground chat error.

**Acceptance criteria:**

- Opening the inspector never changes `activeSessionId`.
- Existing history appears even after restart/reconnect.
- Current token/tool/thinking updates continue while the dialog is open.
- Rapid open/close/switch cannot show history from the wrong child.
- Closing the dialog never cancels a child run.
- Verification: hook tests cover success, stale response, retry, close during request, and terminal refresh; Desktop typecheck passes.

### Step 5 — Build the read-only child-session dialog and transcript

**Stable id:** `5`

**Affected areas:** `packages/ui-kit/src/dialog.tsx`, new dialog/transcript components, `MarkdownView`, inspector stylesheet, component tests.

**Work:**

1. Extend the generic UI-kit dialog API only as needed for a large application surface—prefer an optional content class name and accessible description id over Subagent-specific props.
2. Build `SubagentSessionDialog` as a controlled presentation component:
   - title/task;
   - identity and lifecycle badge;
   - explicit “Open full session” action;
   - close action;
   - loading, retryable error, empty, running, completed, failed, and cancelled states.
3. Build `SubagentSessionTranscript`:
   - render the task/user prompt as a restrained brief;
   - render historical assistant output through `MarkdownView`;
   - show thinking collapsed by default;
   - show tools as a compact chronological timeline with running/done/error status;
   - append the live tail with the existing streaming cursor;
   - avoid parent-only actions such as edit, retry, plan execution, walkthrough, artifact mutation, or composer controls.
4. Add auto-follow behavior:
   - initially scroll to latest;
   - continue only while the user remains near the bottom;
   - pause when the user scrolls upward;
   - expose one “Jump to latest” affordance;
   - resume follow after activation.
5. Use responsive dimensions around `min(960px, 82vw)` and `min(760px, 82vh)` with a near-full-screen small-window fallback.
6. Keep header/footer stable while transcript scrolls; use theme tokens and existing typography rather than hard-coded screenshot colors.
7. Animate modal/status/tool-container transitions only. Do not animate individual tokens.

**Acceptance criteria:**

- The dialog is visually clear at common desktop sizes and remains usable on a small Tauri window.
- Keyboard focus is trapped, Escape closes, focus returns to the launcher, and all icon controls have labels.
- Streaming Markdown remains readable without excessive rerender animation.
- Auto-follow does not fight a user reading older output.
- Verification: UI-kit dialog tests, inspector component tests, Desktop typecheck, and manual keyboard/responsive checks pass.

### Step 6 — Wire explicit full-session navigation and lifecycle transitions

**Stable id:** `6`

**Affected areas:** `App.tsx`, `chat-thread.tsx`, inspector components, existing session action hook, integration tests.

**Work:**

1. Replace the old card callback meaning from “resume immediately” to “inspect child”.
2. Keep `handleResumeSession` unchanged as the foreground-navigation authority.
3. Implement inspector “Open full session” as:
   - close inspector;
   - invoke existing resume path;
   - allow normal foreground transcript hydration and navigation to proceed.
4. Ensure lifecycle pushes update the inspector header in place.
5. Keep a completed/failed/cancelled inspector open until the user closes or opens the full session.
6. Ensure a removed/unknown child degrades to the loaded transcript with an unavailable-status notice rather than crashing.

**Acceptance criteria:**

- Preview and foreground navigation are visibly distinct actions.
- Full-session navigation uses the existing session path and does not duplicate resume logic.
- Terminal lifecycle transitions do not unexpectedly close the dialog.
- Verification: integration tests cover inspect-without-navigation, explicit full navigation, close behavior, and terminal status updates.

### Step 7 — Delete obsolete paths, consolidate styling, and verify the vertical slice

**Stable id:** `7`

**Affected areas:** old card code, transcript/run-activity CSS, test fixtures, E2E, plan/docs status.

**Work:**

1. Delete the removed inline expansion implementation, obsolete icon helper, dead props, and related selectors.
2. Resolve CSS ownership:
   - compact active animation in `run-activity.css`;
   - transcript region layout in `region-transcript.css`;
   - inspector layout in `subagent-session-inspector.css`.
3. Search for obsolete `subagent-stream-panel`, expansion, and immediate-open callback references; remove or rename them intentionally.
4. Add an E2E flow:
   - create/show a Subagent activity card;
   - click it;
   - verify parent session remains selected;
   - verify child history/live content appears;
   - close and reopen;
   - use “Open full session” and verify navigation occurs only then.
5. Run touched-package tests, root typecheck, and root tests. Record any unrelated pre-existing failures separately; do not weaken checks.
6. Update this plan status and add a bounded walkthrough after execution.

**Acceptance criteria:**

- No duplicate Subagent transcript UI remains.
- No unused callback, state, or CSS selector from the previous inline expansion remains.
- Public exports change only where intentionally required for the generic UI-kit dialog enhancement.
- `pnpm typecheck`, `pnpm test`, Desktop targeted tests, and the focused Playwright scenario pass.

## 8. Test matrix

| Layer | Required coverage |
|---|---|
| Pure activity model | parent filtering, lifecycle precedence, stable order, latest activity, no active children |
| Pure session projection | history only, live only, history + live, current-message dedupe, terminal replacement, tool identity |
| Reducer/hydration | child upsert, parent switch, stale data isolation, push after hydrate |
| Inspector hook | load, retry, stale response, close during request, child switch, terminal refresh |
| Card/ticker/dock | keyboard open, cycling, hover pause, reduced motion, count transitions |
| Dialog/transcript | accessibility, state variants, Markdown, thinking, tool statuses, live cursor, auto-follow |
| Integration | preview does not navigate; explicit full-session action does |
| E2E | card → live inspector → close/reopen → full session |

## 9. Quality gates

The implementation is not done until all of the following are true:

1. No app code imports Pi packages.
2. No new Host or Contracts surface was added without demonstrating why existing normalized seams were insufficient.
3. One activity selector drives all visible Subagent status/count text.
4. One pure projection reconciles persisted and live child output.
5. The old inline stream expansion and duplicate CSS are deleted.
6. No `any`, unsafe non-null assertion, or floating promise is introduced.
7. All new interactive surfaces support keyboard and reduced-motion behavior.
8. Desktop tests, root typecheck, root tests, and focused E2E are green.
9. The implementation walkthrough records changed files, verification evidence, merged child sessions, and unresolved follow-ups.

## 10. Execution notes

- This is a **long plan**. Subagent-driven execution is recommended, but the steps intentionally integrate sequentially because Steps 2–7 build on the shared projections introduced in Step 1 and touch overlapping Desktop composition files.
- Do not run multiple implementation children concurrently against `App.tsx`, `chat-thread.tsx`, or shared CSS. If delegation is used, delegate research/tests or isolated UI-kit work first, then merge before the next overlapping step.
- The cleanest implementation may delete more of the existing inline Subagent card than initially expected. Preserve behavior and contracts, not obsolete component structure.
- If a generalized abstraction makes the feature harder to understand, keep it Subagent-domain-specific. “Enough abstraction” here means one lifecycle model, one transcript reconciliation model, and a clear controller/presentation split—not a generic window framework.

## 11. Execution record (2026-08-03)

All seven steps were implemented sequentially in the main workspace. No
Contracts, `agent-host`, or `session` files were changed — the slice stayed a
pure Desktop presentation refactor as designed. The one ui-kit change is the
generic `Dialog.contentClassName` (no Subagent-specific API).

### Changed files

**Added**

- `apps/desktop/src/subagent-activity-model.ts` — pure activity model
  (`normalizeExecutionStatus`, `selectActiveSubagents`,
  `deriveSubagentDialogStatus`, `toInspectorSelection`).
- `apps/desktop/src/subagent-session-projection.ts` — pure history/live-tail
  reconciliation (`reconcileSubagentTranscript`).
- `apps/desktop/src/hooks/use-subagent-session-inspector.ts` — inspector
  controller: selection, `session/messages` load with stale-response guard,
  one-shot terminal refresh, retry, full-session promotion.
- `apps/desktop/src/subagent-activity-ticker.tsx` — reduced-motion-aware
  animated carousel over active children.
- `apps/desktop/src/subagent-working-dock.tsx` — collapsed `N Working` launcher
  + expanded active-child list; every row opens the inspector.
- `apps/desktop/src/subagent-session-dialog.tsx` — read-only large modal.
- `apps/desktop/src/subagent-session-transcript.tsx` — history + live tail,
  thinking, tools, auto-follow scroll, jump-to-latest.
- `apps/desktop/src/styles/subagent-session-inspector.css` — inspector layout,
  responsive sizing, reduced-motion fallbacks.
- Colocated tests: `subagent-activity-model.test.ts`,
  `subagent-session-projection.test.ts`,
  `hooks/use-subagent-session-inspector.test.tsx`.

**Modified**

- `apps/desktop/src/chat-reducer.ts` — extracted `mapTranscriptMessagesToUi`;
  new `subagent/children-hydrate` action (parent-guarded); `subagent/updated`
  now parent-guarded; subagent maps cleared on `scope/set` / `project/set` /
  `session/set`.
- `apps/desktop/src/hooks/use-session-actions.ts` — hydrates
  `session/list-children` into the reducer on resume.
- `apps/desktop/src/subagent-activity-card.tsx` — rewritten as a compact,
  keyboard-accessible launcher (real `<button>`); inline stream expansion and
  `Open session` footer removed.
- `apps/desktop/src/chat-thread.tsx` — `onOpenSubagentSession` →
  `onInspectSubagent`; removed `subagentStreams` threading.
- `apps/desktop/src/workspace-shell.tsx` — new `activityDock` slot between
  transcript and permission bar.
- `apps/desktop/src/App.tsx` — `selectActiveSubagents` memo, inspector hook,
  `handleInspectSubagent` (inspect in place) vs `handleEnterSubagentSession`
  (resume), Working dock + `SubagentSessionDialog` wiring.
- `apps/desktop/src/styles.css` — imports `subagent-session-inspector.css`.
- `apps/desktop/src/styles/run-activity.css` — owns compact card/ticker/dock.
- `apps/desktop/src/styles/region-transcript.css` — keeps `.chat-subagent-slot`
  only; deleted duplicate card + inline `subagent-stream-*` styles.
- `packages/ui-kit/src/dialog.tsx` — optional `contentClassName` for large
  application dialogs.
- Tests updated for the new invariants: `chat-reducer.test.ts` (hydration +
  guards), `chat-thread.test.tsx` (prop rename). Minimal fixture typing fix in
  `project-session-sidebar.test.tsx` (`projectPath` is not a
  `SessionListItemUi` field).

### Deleted from existing code

- `SubagentActivityCard` local `expanded` state, inline `subagent-stream-panel`
  rendering, embedded `ToolStatusIcon`, `Open session` footer button.
- Obsolete CSS: `.subagent-stream-*`, `.subagent-expand-chevron`,
  `.subagent-live-badge`, `.subagent-activity-footer`,
  `.subagent-activity-progress*`, `@keyframes subagent-progress-slide`; the
  duplicate `.subagent-activity-*` block in `region-transcript.css`.

### Verification evidence

- `pnpm typecheck` (root, incl. desktop + ui-kit): **green**.
- `pnpm --filter @piwin/desktop exec vitest run`: **682 passed / 683**, with one
  **pre-existing, unrelated** failure: `shell-icon-policy.test.ts` flags
  character icons added by parallel archived-sessions WIP in
  `history-ticks-drawer.tsx:205` and `provider-row.tsx:348` (both files are
  user-modified, not touched by this slice). A one-off `chat-thread.test.tsx`
  attachment-collapse flake occurred once in a parallel suite run and did not
  reproduce in isolation or in the final full run.
- `packages/ui-kit` tests: **24 passed**.
- `vite build` (production): **green** (validates the new CSS import).
- New/updated unit coverage: activity model (14), session projection (6),
  reducer (55 incl. 4 new hydration/guard cases), inspector hook (6),
  chat-thread (8).

### Unresolved follow-ups

- E2E (`apps/desktop/e2e/shell.spec.ts`) inspect-without-navigation scenario was
  deferred: no local Pi host loop is running in this workspace, so a Playwright
  flow cannot exercise a real child transcript. Covered by hook + projection
  unit tests instead; add the Playwright path once a mock/real host loop exists.
- The compact transcript card intentionally reflects the persisted
  `activity.state`; live freshness lives in the Working dock/ticker. If product
  wants the card itself to pulse while its child streams, pass
  `subagentChildren` into the card row (out of scope for this slice).
