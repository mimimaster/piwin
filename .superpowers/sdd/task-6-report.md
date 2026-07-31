# Task 6 Report — Desktop walkthrough chat state, host push, action, card, mock host

## What I implemented

### 1. `apps/desktop/src/chat-reducer.ts`
- Added `WalkthroughArtifact` to the `@piwin/contracts` type import.
- Added `walkthroughsByMessageId: Record<string, WalkthroughArtifact>` to `ChatUiState`.
- Initialized it as `{}` in `createInitialChatUiState()`.
- Added three action variants to `ChatUiAction`:
  - `walkthrough/hydrate` (artifacts: WalkthroughArtifact[])
  - `walkthrough/updated` (artifact: WalkthroughArtifact)
  - `walkthrough/remove` (messageId: string)
- Handlers: `hydrate` rebuilds the map keyed by messageId; `updated` upserts by messageId with a stale-guard (a terminal ready/error artifact is not overwritten by a later `generating` push); `remove` deletes by messageId.
- Cleared the map on session switch: `scope/set`, `project/set`, `project/clear`, `session/set`, `session/clear-active`, and `session/load-messages` (cleared so the separate `walkthrough/list` hydrate repopulates cleanly).

### 2. `apps/desktop/src/hooks/use-host-bootstrap.ts`
- Added `walkthrough/updated` push handling → `dispatch({ type: 'walkthrough/updated', artifact: message.artifact })`.
- **Deviation note:** The task asked to also add the `walkthrough/list` hydrate call "after session load" in this hook. Session loading (`session/load-messages`) actually happens in `use-session-actions.ts`, which is NOT in the allowed staging list. To stay within the allowed files, the `walkthrough/list` hydrate was implemented as a `useEffect` in `App.tsx` that fires when `state.activeSessionId` changes. This keeps the hydrate logic in a file that was already being modified and is in the staging list.

### 3. `apps/desktop/src/chat-thread.tsx`
- Added `WalkthroughArtifact` type import and `WalkthroughAction`/`isWalkthroughEligible` imports.
- Added to `ChatThreadProps`: `walkthroughsByMessageId`, `walkthroughEnabled`, `onGenerateWalkthrough`, `onCancelWalkthrough`.
- Added to `ChatMessageRowProps`: the above plus `walkthroughEligible` (pre-computed by parent).
- Eligibility is computed in the `ChatThread` map loop (where the full `messages` array is available) and passed down as a boolean, so `ChatMessageRow` stays memoizable without receiving the whole messages array.
- Renders `<WalkthroughAction>` for assistant messages when `onGenerateWalkthrough` is provided, passing the artifact from `walkthroughsByMessageId[message.id]`, the precomputed `eligible`, and the callbacks.
- Updated the memo comparator to include: `walkthroughsByMessageId`, `walkthroughEnabled`, `walkthroughEligible`, `onGenerateWalkthrough`, `onCancelWalkthrough`.

### 4. `apps/desktop/src/App.tsx`
- Added `WalkthroughArtifact` type import.
- Added `handleGenerateWalkthrough` and `handleCancelWalkthrough` callbacks using `hostClient.request` (`walkthrough/generate`, `walkthrough/cancel`).
- Added a `useEffect` that calls `walkthrough/list` after session load and dispatches `walkthrough/hydrate`.
- In `sessionDocuments`, added walkthrough doc items for ready artifacts (virtual path `walkthroughs/<message-id>.md`, icon `book`).
- Updated the sidebar `onSelectDocument` handler to resolve walkthrough markdown content from `state.walkthroughsByMessageId` when the path matches `walkthroughs/<id>.md`.
- Passed walkthrough props to `ChatThread` (`walkthroughsByMessageId`, `walkthroughEnabled` derived from `config?.walkthrough?.enabled !== false`, callbacks).

### 5. `apps/desktop/src/host-client-mock.ts`
- Added `WalkthroughArtifact` and `ModelRef` to the contracts import.
- `walkthrough/list`: returns a deterministic ready artifact for the first assistant transcript message.
- `walkthrough/generate`: returns `model-unavailable` error when no providers are configured; otherwise publishes a `generating` artifact via `emitPush` immediately, then a delayed `ready` artifact via `setTimeout(50ms)`. Returns the `generating` response with `generationId`. `force` is accepted (overwrites existing since the push replaces the map entry).
- `walkthrough/cancel`: publishes an `error` artifact with code `cancelled` and returns a `cancelled` response.
- No real network; all in-process.

### 6. `apps/desktop/src/walkthrough-action.test.tsx` (new)
- 13 tests using `createRoot` + `act` pattern (no `@testing-library`).
- `isWalkthroughEligible` pure function: streaming → false, completed final → true, middle assistant → false, disabled → false, failed → false, cancelled → false, empty text with tools → true.
- `WalkthroughAction` component: eligible shows generate button, click calls onGenerate, generating shows loading + disabled, ready shows view/regenerate, error shows message + retry, not-eligible-no-artifact renders nothing.

### 7. `apps/desktop/src/walkthrough-card.test.tsx` (new)
- 5 tests using the same pattern.
- Ready artifact renders markdown + status label, error artifact shows error message + retry, generating shows loading, View button calls onOpenDocument with path + content, Regenerate button calls onRegenerate.

### 8. `apps/desktop/src/chat-reducer.test.ts` (modified)
- Added 7 walkthrough tests: hydrate replaces map, updated upserts, updated drops stale generating after terminal, remove deletes, session/set clears, session/load-messages clears, scope/set clears.

## What I tested and results

- `pnpm --filter @piwin/desktop typecheck` → **PASS** (exit 0)
- `pnpm --filter @piwin/desktop test` → **75 files, 429 tests, all PASS**
  - `walkthrough-action.test.tsx`: 13 tests PASS
  - `walkthrough-card.test.tsx`: 5 tests PASS
  - `chat-reducer.test.ts`: 42 tests PASS (includes 7 new walkthrough tests)

## Files changed (committed)

- `apps/desktop/src/walkthrough-action.tsx` (existing, unchanged — already typecheck clean)
- `apps/desktop/src/walkthrough-card.tsx` (existing, unchanged — already typecheck clean)
- `apps/desktop/src/walkthrough-action.test.tsx` (new)
- `apps/desktop/src/walkthrough-card.test.tsx` (new)
- `apps/desktop/src/chat-reducer.ts` (modified)
- `apps/desktop/src/chat-reducer.test.ts` (modified)
- `apps/desktop/src/chat-thread.tsx` (modified)
- `apps/desktop/src/hooks/use-host-bootstrap.ts` (modified)
- `apps/desktop/src/App.tsx` (modified)
- `apps/desktop/src/host-client-mock.ts` (modified)

Commit: `574fcb2 feat(desktop): walkthrough chat state, host push, action, card, mock host`

## Self-review findings

- The `walkthrough/list` hydrate lives in `App.tsx` (useEffect on `activeSessionId`) rather than `use-host-bootstrap.ts` because session loading is in `use-session-actions.ts` (not in the allowed staging list). This is functionally equivalent and keeps the change within allowed files.
- The stale-guard in `walkthrough/updated` prevents a late `generating` push from clobbering a terminal `ready`/`error` artifact, matching spec §5.5 (old artifacts stay viewable).
- `walkthroughEnabled` defaults to `true` when config is absent (`config?.walkthrough?.enabled !== false`), matching `createDefaultWalkthroughConfig().enabled === true`.
- The mock `walkthrough/generate` uses `setTimeout` for the delayed ready push; this is deterministic enough for mock/e2e and avoids real network.
- Unrelated uncommitted changes (RunActivity*.tsx, PetSprite.tsx, run-activity.css, pet-state-store.ts, package.json) were NOT staged or touched.

## Concerns

- The `walkthrough/list` hydrate effect re-runs only on `activeSessionId` change (not on every message delta), which is correct but means if a session is loaded then more messages stream in, the list is not re-fetched. This matches the spec (artifacts are hydrated once per session and updated via push thereafter).
- The `walkthrough/generate` mock does not check `force` explicitly — it always overwrites because the push replaces the map entry. This is acceptable for a mock.

---

## Fix Report — Review findings (post-review fixes)

### Finding 1 (Important): walkthrough/list hydrate race condition

**File:** `apps/desktop/src/App.tsx`

**Problem:** The `useEffect` for `walkthrough/list` depended on `[state.activeSessionId, hostClient]` but guarded on `state.messages.length === 0`. When a session is selected, `session/set` fires first (clearing messages), so the effect ran, saw `messages.length === 0`, and returned early. When `session/load-messages` later populated messages, `activeSessionId` hadn't changed, so the effect didn't re-run. The hydrate call never fired.

**Fix:** Removed the `state.messages.length === 0` guard. The effect now calls `walkthrough/list` whenever `activeSessionId` changes (only guards on `!state.activeSessionId`). The response hydrates the walkthrough map; if there are no artifacts, the map is just empty.

### Finding 2 (Important): Duplicate View/Regenerate buttons when eligible + ready

**File:** `apps/desktop/src/walkthrough-action.tsx`

**Problem:** When `eligible` was true and `artifact.status === 'ready'`, `WalkthroughAction` rendered its own View + Regenerate buttons (testids `walkthrough-view-btn-*` and `walkthrough-regenerate-btn-*`), AND rendered `<WalkthroughCard>` which also renders View + Regenerate buttons (testids `walkthrough-doc-btn-*` and `walkthrough-regenerate-btn-*`). The `walkthrough-regenerate-btn-*` testid appeared twice.

**Fix:** When `artifact.status === 'ready'`, `WalkthroughAction` no longer renders its own button section — it delegates to `WalkthroughCard` which already has the View + Regenerate buttons. The action's button section now only shows the "Generate Walkthrough" button when there is no ready artifact (no artifact, or generating/error state). Added `showGenerateButton` computed flag: `eligible && !(artifact && artifact.status === 'ready')`.

### Finding 3 (Important): Hover/focus reveal not implemented (spec §15.6 case 5)

**Files:** `apps/desktop/src/styles/region-transcript.css`, `apps/desktop/src/chat-thread.tsx`

**Problem:** The spec says "Hover/focus reveals Generate Walkthrough button on eligible final assistant messages." The button was always visible when eligible.

**Fix:** Added `chat-message-row` class to the message row `<article>` element in `chat-thread.tsx` (alongside the existing `bubble`/`role-*` classes). Added CSS to `region-transcript.css` following the existing `.message-actions` hover/focus pattern:
- `.walkthrough-action-buttons { opacity: 0; pointer-events: none; transition: opacity 0.15s ease; }`
- `.chat-message-row:hover .walkthrough-action-buttons, .chat-message-row:focus-within .walkthrough-action-buttons { opacity: 1; pointer-events: auto; }`

**Test:** Added test in `walkthrough-action.test.tsx` verifying the `.walkthrough-action-buttons` class is present (hidden by default via CSS) and that the `.chat-message-row` wrapper is the correct ancestor for the reveal selector.

### Finding 4 (Important): Missing test coverage (cases 12, 13)

**Files:** `apps/desktop/src/walkthrough-card.test.tsx`, `apps/desktop/src/walkthrough-action.test.tsx`

**Case 12 (Walkthrough Markdown doesn't enable Artifact iframe):** Added test in `walkthrough-card.test.tsx` that renders a ready artifact whose markdown contains an ```html fence and verifies no `<iframe>` is rendered (instead the source-only `code-fence-source` block is shown), confirming `artifactPreviewEnabled={false}` is passed through.

**Case 13 (memo comparator doesn't block state updates):** Added test in `walkthrough-action.test.tsx` that renders with a `generating` artifact, then re-renders with a `ready` artifact and verifies the DOM updates (loading indicator disappears, status changes to "Ready", doc button appears).

**Case 14 (settings):** Skipped — Task 8's scope.

### Test results after fixes

- `pnpm --filter @piwin/desktop typecheck` → **PASS** (exit 0)
- `pnpm --filter @piwin/desktop test` → **75 files, 432 tests, all PASS**
  - `walkthrough-action.test.tsx`: 15 tests PASS (was 13, +2 new)
  - `walkthrough-card.test.tsx`: 6 tests PASS (was 5, +1 new)

### Files changed (this fix commit)

- `apps/desktop/src/App.tsx` (Finding 1)
- `apps/desktop/src/walkthrough-action.tsx` (Finding 2)
- `apps/desktop/src/walkthrough-action.test.tsx` (Finding 2 test update + Finding 3 + 4 tests)
- `apps/desktop/src/walkthrough-card.test.tsx` (Finding 4 case 12)
- `apps/desktop/src/chat-thread.tsx` (Finding 3 — added `chat-message-row` class)
- `apps/desktop/src/styles/region-transcript.css` (Finding 3 — hover/focus CSS)
