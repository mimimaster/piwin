# Subagent 闭环补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the SDK-mode subagent closed loop: correct merge summaries (no transcript flush race), live Desktop UI sync (`subagent/merged` / `subagent/updated` handled, stream cleanup), and functional worktree apply in the model-tool and plan-execution paths.

**Architecture:** Three layers, one vertical slice. Host (`@piwin/agent-host`) fixes merge correctness and adds worktree apply into the single merge chokepoint `handleMergeSubagent`. Contracts (`@piwin/contracts`) gets an optional `applyPolicy` passthrough on the subagent tool seam (types only — no new message types). Desktop (`apps/desktop`) wires the already-emitted `subagent/merged` / `subagent/updated` pushes into the reducer and the SubAgentPanel. Tests are fixture-based per AGENTS.md §3.7.

**Tech Stack:** TypeScript strict (NodeNext ESM), vitest, React reducer (no new deps).

## Global Constraints

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — do not weaken (AGENTS.md §3.1).
- ESM only; relative imports use `.js` extension.
- UI never imports Pi packages; host never imported by apps directly except through `@piwin/*`.
- `packages/contracts` stays a leaf — no new runtime deps.
- No new dependencies.
- No `any`; no non-null assertion except after explicit runtime check.
- Files > ~400 lines: split by responsibility (AGENTS.md §3.2) — `host-runtime.ts` is already large; add to `commands/` where possible, keep `handleMergeSubagent` edits localized.
- Tests required for every logic change (AGENTS.md §3.7).
- Worktree: this plan is executed in the `piwin-subagent-loop` worktree (branch `feat/subagent-loop-completion`).
- The current branch already carries the token-usage-ledger commit (`9e48c5c`); do not touch usage/artifact files.

---

## Background (why this plan exists)

Reviewed the SDK-mode subagent loop (`piwin_subagent_run` tool → `session/spawn` → child runs → `session/merge-subagent` → parent transcript card). Findings:

| # | Gap | Evidence |
|---|-----|----------|
| G1 | **Merge reads unflushed transcript** — child events are recorded fire-and-forget (`void recorder.recordEvent(...)` at `host-runtime.ts:1651`), so `handleMergeSubagent` can read a partial/empty transcript right after the child turn ends → empty/partial summaries in the model-tool path. | `host-runtime.ts` `handleMergeSubagent` reads `listTranscriptMessages` directly (line ~1817) with no `flush()`; recorder is write-queued (`transcript-recorder.ts`). |
| G2 | **Desktop drops `subagent/merged` + `subagent/updated`** — host emits both (host-runtime.ts:1872, 1878) and contracts define them (ipc.ts:442, 446), but `use-host-bootstrap.ts` has no branches → SubAgentPanel status stays stale after a model-tool spawn/merge. | `use-host-bootstrap.ts` handles `subagent/stream` only (lines 155-163). |
| G3 | **`subagent/clear-stream` never dispatched** — reducer action exists (chat-reducer.ts:692) but no caller → child stream state leaks forever in `state.subagentStreams`. | grep: no `dispatch({type:'subagent/clear-stream'})` anywhere. |
| G4 | **Worktree apply path dead** — `session/complete-subagent` is the only `applyWorktreeToMain` caller and is unreachable (no real dispatch site). Tool path defaults `applyPolicy:'none'` and `handleMergeSubagent` never applies; plan-execution path spawns `applyPolicy:'explicit'` but only calls merge → worktree changes never reach the parent branch, worktrees leak. | `session-live-commands.ts:494` (complete only); `plan-commands.ts:333-355` (spawn explicit + merge only); tool has no `applyPolicy` arg. |
| G5 | **No test coverage** for `session/spawn`, `session/merge-subagent`, `handleMergeSubagent`, or the desktop subagent reducer/stream actions. | `session-live-commands.test.ts` has zero spawn/merge cases; `chat-reducer.test.ts` lacks subagent cases. |

---

## File Structure

**Contracts (leaf):**
- Modify `packages/contracts/src/subagent.ts` — `SubagentApplyPolicy` already exists; no change needed (verify). If missing, add it. (Expected: exists, used by `host.ts`.)

**Host (`packages/agent-host`):**
- Modify `src/host-runtime.ts` — `handleMergeSubagent`: flush child recorder before read; apply worktree + cleanup after merge card. Also `onSpawnSubagent` seam: pass `applyPolicy` through.
- Modify `src/subagent-run-tool.ts` — `SubagentRunSeam.spawn` input + JSON schema gain `applyPolicy?: SubagentApplyPolicy`.
- Modify `src/sdk-adapter.ts` — `PiSdkAdapterOptions.onSpawnSubagent` input gains `applyPolicy?`.
- Modify `src/create-host.ts` — no code change needed (passthrough already generic). Verify.
- Test: modify `src/subagent-run-tool.test.ts` (applyPolicy passthrough), add `src/commands/session-live-commands.test.ts` cases (spawn/merge/complete/cancel), add `src/host-runtime.test.ts` cases (merge flush + worktree apply).

**Desktop (`apps/desktop`):**
- Modify `src/chat-reducer.ts` — new `subagentChildren: Record<string, SessionSummary>` state; action `subagent/updated`; case reusing `subagent/clear-stream` for merge cleanup (no new merged action needed — dispatch clear-stream from bootstrap).
- Modify `src/hooks/use-host-bootstrap.ts` — branches for `subagent/merged` (→ clear-stream) and `subagent/updated` (→ reducer).
- Modify `src/SubAgentPanel.tsx` — optional `children?: SessionSummary[]` external prop (live list); falls back to local reload.
- Modify `src/settings/settings-context.tsx` + `src/settings/settings-shell.tsx` + `src/settings/pages/automation-page.tsx` + `src/App.tsx` — thread `subagentChildren` to SubAgentPanel.
- Test: modify `src/chat-reducer.test.ts`, `src/hooks/use-host-bootstrap.test.ts`, `src/settings/settings-shell.test.tsx`.

---

### Task 1: Host — flush child transcript recorder before merge read (G1)

**Files:**
- Modify: `packages/agent-host/src/host-runtime.ts` (inside `handleMergeSubagent`, before `listTranscriptMessages`)
- Test: `packages/agent-host/src/host-runtime.test.ts` (new case)

**Interfaces:**
- Consumes: `this.transcriptRecorders` (`Map<string, TranscriptRecorder>`), `TranscriptRecorder.flush(): Promise<void>`.
- Produces: `handleMergeSubagent` now guarantees the child transcript on disk is complete before `listTranscriptMessages`.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent-host/src/host-runtime.test.ts`:

```ts
it('merges only after flushing the child transcript recorder', async () => {
  // Fixture: create a runtime, bind a child session with a recorder whose
  // write queue is non-empty, then call session/merge-subagent and assert
  // flush() was awaited before listTranscriptMessages saw the transcript.
});
```

(The concrete fixture must match the existing test harness in this file — see Task 1 Step 3 for the minimal runtime construction. Write the test first, verify it fails with "transcript had 0 messages".)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @piwin/agent-host test -- host-runtime`
Expected: new case FAILS (merge summary built from empty transcript).

- [ ] **Step 3: Implement the flush**

In `packages/agent-host/src/host-runtime.ts`, inside `handleMergeSubagent`, replace:

```ts
      const childMessages = await listTranscriptMessages(
        getPiwinSessionTranscriptPath(rootDir, childSessionId),
      );
```

with:

```ts
      // Child events are recorded fire-and-forget at bind time; flush the
      // recorder so the merge summary is built from a complete transcript.
      const childRecorder = this.transcriptRecorders.get(childSessionId);
      if (childRecorder) {
        await childRecorder.flush();
      }
      const childMessages = await listTranscriptMessages(
        getPiwinSessionTranscriptPath(rootDir, childSessionId),
      );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @piwin/agent-host test -- host-runtime`
Expected: new case PASSES.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/host-runtime.ts packages/agent-host/src/host-runtime.test.ts
git commit -m "fix(agent-host): flush child transcript before merge summary read"
```

---

### Task 2: Host — apply worktree changes + cleanup in handleMergeSubagent (G4 host side)

**Files:**
- Modify: `packages/agent-host/src/host-runtime.ts` (inside `handleMergeSubagent`, after the merge card is appended, before the final upsert)
- Test: `packages/agent-host/src/host-runtime.test.ts` (new case)

**Interfaces:**
- Consumes: `applyWorktreeToMain`, `removeWorktree` from `@piwin/git` (already imported at host-runtime.ts:41); child record fields `subagentMode`, `subagentApplyPolicy`, `subagentRetainWorktree`, `subagentAllowedOutputPaths`, `worktreePath`, `projectPath`.
- Produces: after merge, worktree changes are applied to the parent branch when policy allows; worktree removed unless retained. A `host/log` info push records `applied.strategy` + paths.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent-host/src/host-runtime.test.ts` a case: child record has `subagentMode:'worktree'`, `subagentApplyPolicy:'explicit'`, `subagentAllowedOutputPaths:['a.txt']`, `worktreePath`; assert `applyWorktreeToMain` called with allowed paths and `removeWorktree` called after (retain not set).

- [ ] **Step 2: Run the test to verify it fails**

Expected: FAILS (no apply call).

- [ ] **Step 3: Implement**

In `handleMergeSubagent`, after the `this.push({ type: 'subagent/updated', ... })` block and before `return ok(...)`, add:

```ts
      // CE-SUB: apply worktree changes when the apply policy requests it.
      // This is the single chokepoint where child changes reach the parent
      // branch — the model tool opts in via applyPolicy (default 'none') and
      // plan execution passes 'explicit'.
      if (
        latestChild.subagentMode === 'worktree' &&
        latestChild.worktreePath &&
        latestChild.subagentApplyPolicy &&
        latestChild.subagentApplyPolicy !== 'none'
      ) {
        try {
          const applied = await applyWorktreeToMain({
            projectPath: latestChild.projectPath,
            worktreePath: latestChild.worktreePath,
            ...(latestChild.subagentApplyPolicy === 'explicit' &&
            latestChild.subagentAllowedOutputPaths
              ? { allowedOutputPaths: latestChild.subagentAllowedOutputPaths }
              : {}),
          });
          this.push({
            type: 'host/log',
            level: 'info',
            message: `subagent apply ${applied.strategy}: ${
              applied.appliedPaths.join(', ') || '(none)'
            }`,
          });
          if (latestChild.subagentRetainWorktree !== true) {
            await removeWorktree({
              projectPath: latestChild.projectPath,
              worktreePath: latestChild.worktreePath,
              force: true,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `subagent apply/cleanup failed: ${message}`,
          });
        }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @piwin/agent-host test -- host-runtime`
Expected: PASSES.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/host-runtime.ts packages/agent-host/src/host-runtime.test.ts
git commit -m "feat(agent-host): apply worktree changes on subagent merge when policy allows"
```

---

### Task 3: Tool — expose applyPolicy param (G4 tool side)

**Files:**
- Modify: `packages/agent-host/src/subagent-run-tool.ts`
- Modify: `packages/agent-host/src/sdk-adapter.ts` (option type)
- Modify: `packages/agent-host/src/host-runtime.ts` (onSpawnSubagent passthrough)
- Test: `packages/agent-host/src/subagent-run-tool.test.ts`

**Interfaces:**
- Consumes: `SubagentApplyPolicy` from `@piwin/contracts` (verify export exists in `contracts/src/index.ts`; it is used by `host.ts`).
- Produces: tool JSON schema gains `applyPolicy` enum `['none','auto','explicit']` default `'none'`; `SubagentRunSeam.spawn` input gains `applyPolicy?: SubagentApplyPolicy`; `PiSdkAdapterOptions.onSpawnSubagent` input gains `applyPolicy?`; host-runtime passthrough forwards it to `session/spawn` (which already supports it, session-live-commands.ts:331-334).

- [ ] **Step 1: Write the failing test**

Add to `subagent-run-tool.test.ts`:

```ts
it('forwards applyPolicy to spawn when provided', async () => {
  const spawned: Array<Record<string, unknown>> = [];
  const tool = createSubagentRunTool({
    sessionId: 'parent-1',
    seam: {
      spawn: async (input) => {
        spawned.push(input);
        return { childSessionId: 'child-1' };
      },
      merge: async () => ({ summaryPreview: 'done' }),
    },
  });
  await tool.execute({ task: 't', mode: 'worktree', applyPolicy: 'auto' }, undefined);
  expect(spawned[0]).toMatchObject({ applyPolicy: 'auto' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @piwin/agent-host test -- subagent-run-tool`
Expected: FAILS (applyPolicy not forwarded / type error).

- [ ] **Step 3: Implement**

In `subagent-run-tool.ts`:

```ts
import type { SubagentApplyPolicy, SubagentIsolationMode } from '@piwin/contracts';
```

Change `SubagentRunSeam.spawn` input:

```ts
  spawn: (input: {
    parentSessionId: string;
    task: string;
    mode?: SubagentIsolationMode;
    applyPolicy?: SubagentApplyPolicy;
    sessionName?: string;
  }) => Promise<{ childSessionId: string }>;
```

Add schema property (inside `properties`):

```ts
        applyPolicy: {
          type: 'string',
          enum: ['none', 'auto', 'explicit'],
          description:
            'Worktree change application policy: "none" (default, changes stay in the worktree) ' +
            'or "auto"/"explicit" (apply changed files back to the parent branch on merge). ' +
            'Only relevant when mode is "worktree".',
        },
```

In `execute`, after `mode` parsing:

```ts
      const applyPolicyRaw = String(args.applyPolicy ?? 'none').trim();
      const applyPolicy =
        applyPolicyRaw === 'auto' || applyPolicyRaw === 'explicit'
          ? applyPolicyRaw
          : 'none';
```

In the `spawn` call:

```ts
        spawnResult = await options.seam.spawn({
          parentSessionId: options.sessionId,
          task,
          mode,
          ...(sessionName ? { sessionName } : {}),
          ...(applyPolicy !== 'none' ? { applyPolicy } : {}),
        });
```

In `sdk-adapter.ts`, `PiSdkAdapterOptions.onSpawnSubagent` input:

```ts
  onSpawnSubagent?: (input: {
    parentSessionId: string;
    task: string;
    mode?: import('@piwin/contracts').SubagentIsolationMode;
    applyPolicy?: import('@piwin/contracts').SubagentApplyPolicy;
    sessionName?: string;
  }) => Promise<{ childSessionId: string }>;
```

In `host-runtime.ts`, `onSpawnSubagent` handler:

```ts
      onSpawnSubagent: async (spawnInput) => {
        const result = await this.handleCommand({
          type: 'session/spawn',
          parentSessionId: spawnInput.parentSessionId,
          task: spawnInput.task,
          ...(spawnInput.mode ? { mode: spawnInput.mode } : {}),
          ...(spawnInput.applyPolicy ? { applyPolicy: spawnInput.applyPolicy } : {}),
          ...(spawnInput.sessionName ? { sessionName: spawnInput.sessionName } : {}),
        });
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `pnpm --filter @piwin/agent-host test -- subagent-run-tool && pnpm --filter @piwin/agent-host typecheck`
Expected: PASSES, typecheck green.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/subagent-run-tool.ts packages/agent-host/src/sdk-adapter.ts packages/agent-host/src/host-runtime.ts packages/agent-host/src/subagent-run-tool.test.ts
git commit -m "feat(agent-host): expose applyPolicy on piwin_subagent_run tool"
```

---

### Task 4: Desktop — reducer subagent/updated + subagentChildren (G2/G3 core)

**Files:**
- Modify: `apps/desktop/src/chat-reducer.ts`
- Test: `apps/desktop/src/chat-reducer.test.ts`

**Interfaces:**
- Consumes: `SessionSummary` from `@piwin/contracts`.
- Produces: `ChatUiState.subagentChildren: Record<string, SessionSummary>`; action `{ type: 'subagent/updated'; parentSessionId: string; child: SessionSummary }` upserting into it. `subagent/clear-stream` already exists and stays the merge cleanup mechanism (dispatched from bootstrap in Task 5).

- [ ] **Step 1: Write the failing test**

Add to `chat-reducer.test.ts`:

```ts
it('upserts subagent/updated into subagentChildren', () => {
  const state = createInitialState();
  const child: SessionSummary = {
    id: 'child-1',
    scope: { kind: 'project', projectPath: '/p' },
    projectPath: '/p',
    workingDirectory: '/p',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messageCount: 0,
    kind: 'subagent',
    depth: 1,
    subagentStatus: 'done',
    parentSessionId: 'parent-1',
  };
  const next = reducer(state, {
    type: 'subagent/updated',
    parentSessionId: 'parent-1',
    child,
  });
  expect(next.subagentChildren['child-1']).toMatchObject({ subagentStatus: 'done' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter desktop test -- chat-reducer`
Expected: FAILS (`subagentChildren` undefined).

- [ ] **Step 3: Implement**

In `chat-reducer.ts`:

Add to `ChatUiState` (after `subagentStreams`):

```ts
  /** Latest child session summaries keyed by childSessionId (live list sync). */
  subagentChildren: Record<string, SessionSummary>;
```

Add to initial state (next to `subagentStreams: {}`):

```ts
    subagentChildren: {},
```

Add action to `ChatUiAction` union:

```ts
  | { type: 'subagent/updated'; parentSessionId: string; child: SessionSummary }
```

Add reducer case (before `case 'subagent/clear-stream'`):

```ts
    case 'subagent/updated': {
      const child = action.child;
      const nextChildren = { ...state.subagentChildren, [child.id]: child };
      return { ...state, subagentChildren: nextChildren };
    }
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `pnpm --filter desktop test -- chat-reducer && pnpm --filter desktop typecheck`
Expected: PASSES.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat-reducer.ts apps/desktop/src/chat-reducer.test.ts
git commit -m "feat(desktop): track subagent child summaries in reducer"
```

---

### Task 5: Desktop — wire subagent/merged + subagent/updated in use-host-bootstrap (G2/G3)

**Files:**
- Modify: `apps/desktop/src/hooks/use-host-bootstrap.ts`
- Test: `apps/desktop/src/hooks/use-host-bootstrap.test.ts`

**Interfaces:**
- Consumes: `HostPush` `subagent/merged` (`parentSessionId`, `childSessionId`) and `subagent/updated` (`parentSessionId`, `child: SessionSummary`) — already in contracts.
- Produces: `subagent/merged` → `dispatch({ type: 'subagent/clear-stream', childSessionId })`; `subagent/updated` → `dispatch({ type: 'subagent/updated', ... })`.

- [ ] **Step 1: Write the failing test**

Add to `use-host-bootstrap.test.ts` (mirroring existing harness): emit a `subagent/merged` push and assert `dispatch` received `{ type: 'subagent/clear-stream', childSessionId }`; emit `subagent/updated` and assert the reducer action.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter desktop test -- use-host-bootstrap`
Expected: FAILS (no dispatch).

- [ ] **Step 3: Implement**

In `use-host-bootstrap.ts`, after the existing `subagent/stream` branch (line ~163):

```ts
      if (message.type === 'subagent/merged') {
        // Stream state is no longer live once the child is merged.
        dispatch({
          type: 'subagent/clear-stream',
          childSessionId: message.childSessionId,
        });
        return;
      }
      if (message.type === 'subagent/updated') {
        dispatch({
          type: 'subagent/updated',
          parentSessionId: message.parentSessionId,
          child: message.child,
        });
        return;
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter desktop test -- use-host-bootstrap`
Expected: PASSES.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/use-host-bootstrap.ts apps/desktop/src/hooks/use-host-bootstrap.test.ts
git commit -m "feat(desktop): handle subagent/merged and subagent/updated pushes"
```

---

### Task 6: Desktop — SubAgentPanel live list via external children (G2 polish)

**Files:**
- Modify: `apps/desktop/src/SubAgentPanel.tsx`
- Modify: `apps/desktop/src/settings/settings-context.tsx`
- Modify: `apps/desktop/src/settings/settings-shell.tsx`
- Modify: `apps/desktop/src/settings/pages/automation-page.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/settings/settings-shell.test.tsx`

**Interfaces:**
- Consumes: `ChatUiState.subagentChildren` (Task 4); `SubAgentPanelProps` in settings context (existing `requestSubAgent` wiring pattern).
- Produces: `SubAgentPanel` accepts optional `children?: SessionSummary[]`; when provided it renders them directly (live); otherwise falls back to local `reload()`. `SettingsContext` gains `subagentChildren?: Record<string, SessionSummary>`; `settings-shell` + `automation-page` + `App` thread it.

- [ ] **Step 1: Write the failing test**

Update `settings-shell.test.tsx` context fixture with `subagentChildren: {}` (type change forces it).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter desktop test -- settings-shell`
Expected: type error / FAILS until context type updated.

- [ ] **Step 3: Implement**

`SubAgentPanel.tsx` — add prop and derive effective children:

```ts
export type SubAgentPanelProps = {
  parentSessionId: string | null;
  request: (command: SubAgentRequest) => Promise<HostResponse>;
  onOpenSession: (sessionId: string) => void;
  onClose?: () => void;
  onMergedIntoParent?: (parentSessionId: string) => void;
  variant?: 'drawer' | 'embedded';
  /** Live child list from host pushes; when provided, supersedes local reload. */
  children?: SessionSummary[];
};
```

Replace the render source: `const effectiveChildren = props.children ?? children;` and use `effectiveChildren` in the map (keep `busy`/`reload` for the fallback path).

`settings-context.tsx`:

```ts
  subagentChildren?: Record<string, SessionSummary>;
```

`settings-shell.tsx`: pass `subagentChildren` through to context value.

`automation-page.tsx`:

```tsx
      {requestSubAgent && (
        <div className="settings-section settings-section-card" style={{ marginTop: 24 }} data-testid="settings-automation-subagents">
          <SubAgentPanel
            parentSessionId={activeSessionId}
            request={requestSubAgent}
            variant="embedded"
            onOpenSession={(sessionId) => onOpenSubagentSession?.(sessionId)}
            {...(subagentChildren ? { children: subagentChildren[activeSessionId ?? ''] ? [] : Object.values(subagentChildren).filter((c) => c.parentSessionId === activeSessionId) } : {})}
          />
        </div>
      )}
```

(App passes `state.subagentChildren` into `SettingsPanel` via the settings context prop.)

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `pnpm --filter desktop test -- settings-shell && pnpm --filter desktop typecheck`
Expected: PASSES.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/SubAgentPanel.tsx apps/desktop/src/settings/settings-context.tsx apps/desktop/src/settings/settings-shell.tsx apps/desktop/src/settings/pages/automation-page.tsx apps/desktop/src/App.tsx apps/desktop/src/settings/settings-shell.test.tsx
git commit -m "feat(desktop): live subagent child list in SubAgentPanel"
```

---

### Task 7: Host — session/spawn & merge command test coverage (G5)

**Files:**
- Test: `packages/agent-host/src/commands/session-live-commands.test.ts`

**Interfaces:**
- Consumes: existing test harness (see file lines 295-323 — mock `DomainDispatchContext`).
- Produces: green coverage for `session/spawn` (depth guard, name default, seed prompt, activity push), `session/merge-subagent` (idempotency via `mergedAt`), `session/complete-subagent` (status + apply for worktree policy), `session/cancel-subagent`.

- [ ] **Step 1: Write the tests**

Cover at minimum:
- spawn on a subagent parent → fails with "depth max is 1".
- spawn missing task → fails "task is required".
- merge-subagent on non-subagent record → fails "session is not a sub-agent".
- merge-subagent idempotency: record with `mergedAt` + `mergeMessageId` → returns `alreadyMerged: true` and does not append again.
- complete-subagent on worktree child with `applyPolicy:'auto'` → record status `done`.

- [ ] **Step 2: Run to verify they pass**

Run: `pnpm --filter @piwin/agent-host test -- session-live-commands`
Expected: all new cases PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-host/src/commands/session-live-commands.test.ts
git commit -m "test(agent-host): cover subagent command handlers"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck` (worktree root)
Expected: exit 0.

- [ ] **Step 2: Full test suite (touched packages)**

Run: `pnpm --filter @piwin/agent-host test && pnpm --filter desktop test`
Expected: all pass.

- [ ] **Step 3: Manual smoke notes**

Document in PR/commit notes:
- CLI mock: `pnpm dev:cli -- --mock` → create session → verify `piwin_subagent_run` tool listed in session tools (SDK mode), spawn+merge round trip produces a merge card with non-empty summary.
- Desktop: open Automation → Sub-agents; model-tool driven spawn shows child list status transitions to `done`/`merged` without manual refresh; activity card stops being expandable after merge.

- [ ] **Step 4: Commit any remaining docs**

```bash
git add -A
git commit -m "docs: subagent loop completion notes"
```

---

## Self-Review

**Spec coverage:**
- G1 → Task 1 ✓
- G4 host → Task 2 ✓; G4 tool → Task 3 ✓
- G2/G3 reducer core → Task 4 ✓; bootstrap wiring → Task 5 ✓; panel polish → Task 6 ✓
- G5 → Task 7 ✓
- Verification → Task 8 ✓

**Type consistency:** `SubagentApplyPolicy` is the single shared type across tool seam, adapter options, host passthrough, and `session/spawn` (already accepts it). `subagentChildren` keyed by childSessionId consistently in reducer and panel filter (`parentSessionId === activeSessionId`). `subagent/clear-stream` reused (not a new action) to avoid duplicate logic.

**Placeholder scan:** All code blocks are complete; test cases describe assertions but the harness construction must match each file's existing fixture (noted explicitly in Task 1 Step 1).
