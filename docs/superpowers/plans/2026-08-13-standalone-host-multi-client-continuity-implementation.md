# Standalone Host multi-client connect + session continuity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One standalone `apps/host` process is the only Host. iOS, Mac Desktop, and Windows Desktop connect to it; a session started on one shell can be opened, watched, and continued on another.

**Architecture:** Do not turn Desktop’s JSONL sidecar into a listener. Run `@piwin/host-server` via `apps/host` on the Mac or a Linux box (same version). Shells are clients: mobile already uses `@piwin/host-client`; Desktop/Windows gain a remote WebSocket attach path that speaks the same protocol. Session continuity is Host-owned: logical `projectId` listing, hydration that includes the live Run, and `if-idle` / `replace-run` prompt admission.

**Tech Stack:** TypeScript / pnpm workspace, `@piwin/contracts`, `@piwin/host-runtime`, `@piwin/host-server`, `@piwin/host-client`, `@piwin/host-transport`, `apps/host`, `apps/desktop` (Mac + Windows), `apps/mobile` (iOS). Auth for this plan is the existing Host token. Device pairing / Keychain / Desktop sidecar listen are the next plan.

**Design:** [`2026-08-13-hybrid-host-mobile-continuity-design.md`](../specs/2026-08-13-hybrid-host-mobile-continuity-design.md) — this plan implements option 1 (many shells → one standalone Host) and the connect + basic continuity slice only.

## Global Constraints

- Many-to-one only: any number of shells, exactly one Host process / one `~/.piwin` data root. No multi-Host switcher.
- Host entry is `apps/host` (`pnpm dev:host`). Desktop sidecar does **not** open a WebSocket in this plan.
- Windows uses `apps/desktop`; there is no separate Windows package.
- Remote clients never send Host absolute paths. Session listing uses `SessionListScopeRef`.
- Remote `session/prompt` must send `foreground`. Local JSONL Desktop may omit it this slice; HostServer rejects a missing field.
- Normal Send is `{ kind: 'if-idle' }`. Only confirmed “中断并发送” uses `{ kind: 'replace-run', runId }`.
- `replace-run` acks the new `runId` immediately; old Run cancels in the background. Do not wait on provider abort.
- Idempotency is same-process only (listener/reconnect retry). Crash-durable reconcile is out of scope.
- Non-loopback `apps/host` still requires `PIWIN_HOST_TOKEN` (existing rule). Test Linux over Tailscale/WireGuard or a documented private bind, not a public `0.0.0.0` product profile.
- `apps/mobile` must not import `apps/desktop/src`. Only `packages/agent-host` may import Pi.
- Token auth is the supported connect method for this plan. Pairing + Keychain is the next plan.
- Update ADR 0015 in the same series as prompt admission. Do not leave `run-active` vs silent-supersede as two written truths.

## File map

| File | Role |
|------|------|
| `packages/contracts/src/host-problem.ts` | Structured `HostProblem` + `ForegroundRunMismatchProblem` |
| `packages/contracts/src/prompt-admission.ts` | `PromptForegroundAdmission` |
| `packages/contracts/src/session-list-scope.ts` | `SessionListScopeRef` |
| `packages/contracts/src/ipc.ts` | `session/prompt.foreground`, `session/list.scopeRef`, failed `problem` |
| `packages/contracts/src/remote-protocol.ts` | Capability flags |
| `packages/project/src/project-id.ts` | Stable `projectId` ↔ registered path |
| `packages/host-runtime/src/response-helpers.ts` | `fail(..., problem?)` |
| `packages/host-runtime/src/commands/session-live-commands.ts` | Admission table |
| `packages/host-runtime/src/commands/session-product-commands.ts` | List by `scopeRef` |
| `packages/host-server/src/remote-projection.ts` | Use shared `projectId`; project `projectId` on session summaries |
| `packages/host-server/src/host-server.ts` | Require `foreground`; attach `problem`; richer hydration |
| `apps/desktop/src/remote-host-session.ts` | Persist endpoint + token; build `@piwin/host-client` |
| `apps/desktop/src/host-client.ts` | `transport: 'remote'` adapter |
| `apps/desktop/src/host-target-settings.tsx` | Connect UI |
| `apps/desktop/src/composer` / prompt call sites | Send `foreground` when remote (and for continuity UX) |
| `apps/mobile/src/App.tsx` + `mobile-host-connection.ts` | Paged project/General list; hydrate; `if-idle` / confirm |

---

### Task 1: Contracts for admission, problems, and logical session scope

**Files:**
- Create: `packages/contracts/src/host-problem.ts`
- Create: `packages/contracts/src/host-problem.test.ts`
- Create: `packages/contracts/src/prompt-admission.ts`
- Create: `packages/contracts/src/session-list-scope.ts`
- Create: `packages/contracts/src/session-list-scope.test.ts`
- Modify: `packages/contracts/src/ipc.ts` (`session/list`, `session/prompt`, `HostResponse` fail arm)
- Modify: `packages/contracts/src/remote-protocol.ts` (`RemoteCapabilitySummary`)
- Modify: `packages/contracts/src/index.ts` (re-export new modules)

**Interfaces:**
- Consumes: existing `HostCommand`, `HostResponse`, `SessionScope`, `SessionRunPhase`
- Produces:

```ts
export type HostProblem = {
  code: string;
  retryable?: boolean;
  data?: unknown;
};

export type ForegroundRunMismatchReason =
  | 'active'
  | 'changed'
  | 'already-finished'
  | 'transitioning';

export type ForegroundRunMismatchProblem = {
  code: 'foreground-run-mismatch';
  data: {
    reason: ForegroundRunMismatchReason;
    actualRun?: {
      runId: string;
      status: 'queued' | 'running' | 'cancelling';
      phase?: SessionRunPhase;
    };
  };
};

export type PromptForegroundAdmission =
  | { kind: 'if-idle' }
  | { kind: 'replace-run'; runId: string };

export type SessionListScopeRef =
  | { kind: 'general' }
  | { kind: 'project'; projectId: string }
  | { kind: 'all-authorized' };
```

`session/prompt` gains optional `foreground?: PromptForegroundAdmission`.  
`session/list` gains optional `scopeRef?: SessionListScopeRef` (do not put paths on this field).  
Failed `HostResponse` gains optional `problem?: HostProblem`.  
`RemoteCapabilitySummary` gains `foregroundRunAdmission?: boolean`, `logicalProjectRefs?: boolean`, `activityHydration?: boolean`, `structuredProblems?: boolean`.

- [ ] **Step 1: Write contract tests**

```ts
// packages/contracts/src/host-problem.test.ts
import { describe, expect, it } from 'vitest';
import type { ForegroundRunMismatchProblem, HostResponse } from './index.js';

describe('HostProblem', () => {
  it('attaches a typed foreground mismatch without replacing error text', () => {
    const problem: ForegroundRunMismatchProblem = {
      code: 'foreground-run-mismatch',
      data: { reason: 'active', actualRun: { runId: 'run-a', status: 'running' } },
    };
    const response: HostResponse = {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'foreground-run-mismatch: session is busy',
      problem,
    };
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.problem?.code).toBe('foreground-run-mismatch');
    }
  });
});
```

```ts
// packages/contracts/src/session-list-scope.test.ts
import { describe, expect, it } from 'vitest';
import type { HostCommand, SessionListScopeRef } from './index.js';

describe('SessionListScopeRef', () => {
  it('lists a project by opaque id, not a path', () => {
    const scopeRef: SessionListScopeRef = { kind: 'project', projectId: 'project-abc' };
    const command: HostCommand = { type: 'session/list', scopeRef };
    expect(JSON.stringify(command)).not.toContain('/');
    expect('scope' in command && command.scope !== undefined).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @piwin/contracts test -- host-problem session-list-scope`

Expected: FAIL — modules / `problem` / `scopeRef` missing.

- [ ] **Step 3: Implement the types and wire them**

Add the three modules. Re-export from `index.ts`. Extend the two `HostCommand` variants and the fail `HostResponse` arm. Add the four optional capability flags.

Keep `session/list.scope` (path-owning `SessionScope`) for local/CLI. Remote clients use `scopeRef` only.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @piwin/contracts test && pnpm --filter @piwin/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/host-problem.ts packages/contracts/src/host-problem.test.ts \
  packages/contracts/src/prompt-admission.ts packages/contracts/src/session-list-scope.ts \
  packages/contracts/src/session-list-scope.test.ts packages/contracts/src/ipc.ts \
  packages/contracts/src/remote-protocol.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add prompt admission, HostProblem, and logical session scope"
```

---

### Task 2: HostRuntime prompt admission (`if-idle` / `replace-run`)

**Files:**
- Modify: `packages/host-runtime/src/response-helpers.ts`
- Modify: `packages/host-runtime/src/commands/session-live-commands.ts` (`session/prompt` block around the current silent supersede)
- Create: `packages/host-runtime/src/commands/session-prompt-admission.test.ts`
- Modify: `docs/adr/0015-async-desktop-turn-transport.md` (replace “second prompt is `run-active`” / document the table)

**Interfaces:**
- Consumes: `PromptForegroundAdmission`, `ForegroundRunMismatchProblem` from Task 1
- Produces: `fail(id, command, error, problem?)`; admission behavior:

| `foreground` | actual | result |
|---|---|---|
| omitted (local JSONL only) | any | keep today’s supersede (HostRuntime only; HostServer will not send omit) |
| `{ kind: 'if-idle' }` | no Run | accept |
| `{ kind: 'if-idle' }` | `run-A` | `foreground-run-mismatch` / `active` — do not mutate |
| `{ kind: 'replace-run', runId: 'run-A' }` | `run-A` | reserve, register new Run, ack, cancel `run-A` after ack |
| `{ kind: 'replace-run', runId: 'run-A' }` | `run-B` | mismatch / `changed` |
| `{ kind: 'replace-run', runId: 'run-A' }` | none | mismatch / `already-finished` — do not auto-send |

- [ ] **Step 1: Write the failing admission tests**

```ts
it('rejects if-idle while a foreground run is live and does not cancel it', async () => {
  const first = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text: 'first' },
    foreground: { kind: 'if-idle' },
  });
  expect(first.success).toBe(true);
  const busy = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text: 'second' },
    foreground: { kind: 'if-idle' },
  });
  expect(busy.success).toBe(false);
  if (!busy.success) {
    expect(busy.problem).toMatchObject({
      code: 'foreground-run-mismatch',
      data: { reason: 'active' },
    });
  }
});

it('replace-run acks a new runId without requiring the old run to finish first', async () => {
  const created = await runtime.handleCommand({
    type: 'session/create',
    input: { scope: { kind: 'general' }, sessionName: 'admission' },
  });
  expect(created.success).toBe(true);
  if (!created.success) throw new Error(created.error);
  const sessionId = (created.data as { sessionId: string }).sessionId;
  const first = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text: '__PIWIN_HANG__' },
    foreground: { kind: 'if-idle' },
  });
  expect(first.success).toBe(true);
  if (!first.success) throw new Error(first.error);
  const oldRunId = (first.data as { runId: string }).runId;
  const replaced = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text: 'take over' },
    foreground: { kind: 'replace-run', runId: oldRunId },
  });
  expect(replaced.success).toBe(true);
  if (!replaced.success) throw new Error(replaced.error);
  expect((replaced.data as { runId: string }).runId).not.toBe(oldRunId);
});
```

Bootstrap `HostRuntime` the same way `session-chat-ops.test.ts` does (mock mode). If `__PIWIN_HANG__` is not a fixture in this tree, use the existing delayed/hang session fixture from `delayed-session-fixture.ts` instead of inventing a new magic string.

- [ ] **Step 2: Run the new test file**

Run: `pnpm --filter @piwin/host-runtime test -- session-prompt-admission`

Expected: FAIL — `foreground` ignored; second prompt supersedes.

- [ ] **Step 3: Implement admission**

Extend `fail`:

```ts
export function fail(
  id: string | undefined,
  command: string,
  error: string,
  problem?: HostProblem,
): HostResponse {
  const base = { type: 'response' as const, command, success: false as const, error };
  const withProblem = problem === undefined ? base : { ...base, problem };
  return id === undefined ? withProblem : { ...withProblem, id };
}
```

In `session/prompt`, after pause-checkpoint checks and **before** cancelling any run:

1. Validate attachments / unknown session (existing pre-ack checks).
2. Read `command.foreground`.
3. If present, apply the table. Never cancel on `if-idle` miss.
4. On `replace-run` hit: reserve per session (one in-flight admission), create the new foreground Run, return `ok` with `{ sessionId, runId, acceptedAt }`, then request cancel of the named previous Run with `createSupersededByNewPromptAbortReason()`.
5. If omitted, keep the current supersede block so local Desktop JSONL does not break this slice.

Other prompts that see a reserved/cancelling transition return `reason: 'transitioning'`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @piwin/host-runtime test -- session-prompt-admission session-chat-ops`

Expected: PASS. Existing omit-path prompts still work.

- [ ] **Step 5: Update ADR 0015**

Replace “A second `session/prompt` is rejected with `run-active`” with the admission table and the ack-then-cancel rule.

- [ ] **Step 6: Commit**

```bash
git add packages/host-runtime/src/response-helpers.ts \
  packages/host-runtime/src/commands/session-live-commands.ts \
  packages/host-runtime/src/commands/session-prompt-admission.test.ts \
  docs/adr/0015-async-desktop-turn-transport.md
git commit -m "feat(host-runtime): admit prompts with if-idle and replace-run"
```

---

### Task 3: Stable projectId and session list by logical scope

**Files:**
- Create: `packages/project/src/project-id.ts`
- Create: `packages/project/src/project-id.test.ts`
- Modify: `packages/project/src/index.ts`
- Modify: `packages/host-runtime/src/commands/session-product-commands.ts`
- Create: `packages/host-runtime/src/commands/session-list-scope-ref.test.ts`
- Modify: `packages/host-server/src/remote-projection.ts` (delete local `createProjectId`; import the shared helper; add `projectId` on remote session summaries when scope is project)

**Interfaces:**
- Consumes: `SessionListScopeRef`; `loadProjectStore` / registered project paths
- Produces:

```ts
export function projectIdForPath(projectPath: string): string;
export function resolveProjectPathById(
  projects: readonly { path: string }[],
  projectId: string,
): string | undefined;
```

`projectIdForPath` must stay stable (`project-` + sha256 prefix, same as today’s remote projection) so existing projected ids do not churn.

When `session/list` has `scopeRef`:

- `general` → existing general filter
- `project` → resolve id → registered path → existing project filter; unknown id fails `not_found`
- `all-authorized` → no project path filter (Host later still applies the remote allowlist)

Do not accept a client-supplied path on `scopeRef`.

- [ ] **Step 1: Write project-id and list-scope tests**

```ts
it('round-trips a registered project path through projectId', () => {
  const path = '/Users/me/work/app';
  const id = projectIdForPath(path);
  expect(resolveProjectPathById([{ path }, { path: '/tmp/other' }], id)).toBe(path);
});

it('session/list with scopeRef project returns only that project and no host paths', async () => {
  // open two projects, create one session each, list by first projectId
  // assert one session; JSON of response must not include the project path
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @piwin/project test -- project-id && pnpm --filter @piwin/host-runtime test -- session-list-scope-ref`

- [ ] **Step 3: Implement resolver and list branch**

In `session/list`, if `scopeRef` is set, resolve it to the internal `scope`/`projectPath` filter **inside HostRuntime** after loading the project store. Then call the existing `projectSessionIndex` path.

In remote projection, set `projectId` on `RemoteSessionSummary` when the durable scope is a project (new optional field: add `projectId?: string` to `RemoteSessionSummary` in contracts if missing).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @piwin/project test -- project-id && pnpm --filter @piwin/host-runtime test -- session-list-scope-ref && pnpm --filter @piwin/host-server test -- remote-projection`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project/src/project-id.ts packages/project/src/project-id.test.ts \
  packages/project/src/index.ts \
  packages/host-runtime/src/commands/session-product-commands.ts \
  packages/host-runtime/src/commands/session-list-scope-ref.test.ts \
  packages/host-server/src/remote-projection.ts packages/contracts/src/remote-protocol.ts
git commit -m "feat(session): list sessions by Host-issued projectId"
```

---

### Task 4: HostServer — require admission, project problems, hydrate live Runs

**Files:**
- Modify: `packages/host-server/src/host-server.ts`
- Modify: `packages/host-server/src/remote-projection.ts` (`createRemoteCapabilities`)
- Create: `packages/host-server/src/host-server-continuity.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: remote hello capabilities include `foregroundRunAdmission`, `logicalProjectRefs`, `activityHydration`, `structuredProblems`. Remote `session/prompt` without `foreground` is `command-not-allowed` / structured problem. Hydration snapshot includes active foreground Run `{ runId, status, phase }` for subscribed sessions (and a bounded global active-Run summary).

- [ ] **Step 1: Write two-client continuity tests against `HostServer` + `HostRuntime` (mock mode)**

Drive both clients with `WebSocket` + `encodeHostWireMessage`, same helpers as `host-server.test.ts` (`waitForOpen`, `MessageInbox`).

```ts
it('rejects a remote if-idle prompt while the other client has a live run', async () => {
  // client A: session/create + session/prompt { foreground: { kind: 'if-idle' } }
  // client B: session/prompt same sessionId { foreground: { kind: 'if-idle' } }
  // expect B response.success === false
  // expect B response.problem.code === 'foreground-run-mismatch'
  // expect B response.problem.data.reason === 'active'
});

it('reconnect hydration includes the live runId', async () => {
  // client A starts a run; client B connects with capabilities.hydration: true
  // and subscriptions.sessionIds: [sessionId]
  // expect a host/hydration or snapshot frame whose session run list contains that runId
  // before client B sends any command
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @piwin/host-server test -- host-server-continuity`

- [ ] **Step 3: Implement server gates and hydration**

- `createRemoteCapabilities()`: set the four flags true.
- Before `runtime.handleCommand`, if command is `session/prompt` and `foreground` is missing, fail without calling runtime.
- Pass `problem` through `projectRemoteResponse` (redact `error`, keep `code` / `reason` / `runId` only).
- Extend the existing hydration builder to include active foreground Runs and pending permission request ids for subscribed sessions. If the current hydration helper cannot see Runs, add a narrow `HostRuntimePort` method such as `listForegroundRuns(): { sessionId: string; runId: string; phase?: string }[]` rather than leaking HostRuntime internals into the WebSocket file.

- [ ] **Step 4: Run**

Run: `pnpm --filter @piwin/host-server test -- host-server host-server-continuity remote-projection`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host-server/src/host-server.ts \
  packages/host-server/src/remote-projection.ts \
  packages/host-server/src/host-server-continuity.test.ts \
  packages/host-runtime/src/host-runtime.ts
git commit -m "feat(host-server): require prompt admission and hydrate live runs"
```

---

### Task 5: Desktop / Windows remote attach to standalone Host

**Files:**
- Create: `apps/desktop/src/remote-host-session.ts`
- Create: `apps/desktop/src/remote-host-session.test.ts`
- Create: `apps/desktop/src/host-target-settings.tsx`
- Modify: `apps/desktop/src/host-client.ts` (add `transport: 'remote'`)
- Modify: `apps/desktop/src/App.tsx` (construct client from saved target)
- Modify: `apps/desktop/src/runtime-target-chip.tsx` (enable Remote when a target is saved and connected)
- Modify: Desktop locale strings for the connect form

**Interfaces:**
- Consumes: `@piwin/host-client` `HostClient`, `@piwin/host-transport` `WebSocketHostTransport`
- Produces:

```ts
export type DesktopRemoteHostTarget = {
  endpoint: string; // ws:// or wss://
  authToken?: string;
};

export function loadDesktopRemoteHostTarget(): DesktopRemoteHostTarget | undefined;
export function saveDesktopRemoteHostTarget(target: DesktopRemoteHostTarget): void;
export function clearDesktopRemoteHostTarget(): void;
export function createDesktopRemoteHostClient(target: DesktopRemoteHostTarget): import('@piwin/host-client').HostClient;
```

Persist under `localStorage` key `piwin.desktop.remote-host-target` (same pattern as mobile). Empty endpoint means “use local sidecar”.

Desktop’s existing `HostClient` (`apps/desktop/src/host-client.ts`) keeps mock + live JSONL. Add:

```ts
transport?: boolean | 'auto' | 'mock' | 'live' | 'remote';
remoteTarget?: DesktopRemoteHostTarget;
```

When `remote`, `request` / `subscribe` delegate to `createDesktopRemoteHostClient`. Map `@piwin/host-client` pushes onto the existing `HostServerMessage` listener so `use-host-bootstrap` does not change.

This is D-CTX-01b for **one** saved Host, not a multi-Host switcher.

- [ ] **Step 1: Write target + adapter tests**

```ts
it('returns undefined when no remote target is saved', () => {
  localStorage.clear();
  expect(loadDesktopRemoteHostTarget()).toBeUndefined();
});

it('round-trips endpoint and token', () => {
  saveDesktopRemoteHostTarget({ endpoint: 'ws://127.0.0.1:8787', authToken: 'secret' });
  expect(loadDesktopRemoteHostTarget()).toEqual({
    endpoint: 'ws://127.0.0.1:8787',
    authToken: 'secret',
  });
});
```

For the adapter, mock `WebSocketHostTransport` or inject a fake `@piwin/host-client` if the Desktop test harness already fakes HostClient — keep this test on persistence and “remote mode does not spawn sidecar” (assert `transport === 'remote'` skips Tauri invoke). Look at `apps/desktop/src/host-client.test.ts` and add a case that remote connect never calls the JSONL bridge.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --dir apps/desktop test -- remote-host-session`

- [ ] **Step 3: Implement persist + remote transport + small Settings form**

Form fields: WebSocket URL, token (password), Connect / Use this Mac. Connect runs `host/status` and shows `hostInstanceId`. Disconnect clears the target and returns to sidecar on next launch (do not auto-restore listener; this is a client target).

`RuntimeTargetChip`: when remote target is connected, show 远程 Host as the active item (not the grey stub). Local remains available to switch back.

- [ ] **Step 4: Run Desktop unit tests + typecheck**

Run: `pnpm --dir apps/desktop test -- remote-host-session host-client runtime-target-chip && pnpm --dir apps/desktop typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/remote-host-session.ts apps/desktop/src/remote-host-session.test.ts \
  apps/desktop/src/host-target-settings.tsx apps/desktop/src/host-client.ts \
  apps/desktop/src/App.tsx apps/desktop/src/runtime-target-chip.tsx
git commit -m "feat(desktop): attach to a standalone Host over WebSocket"
```

---

### Task 6: Desktop composer uses `if-idle` / confirmed `replace-run` on the remote Host

**Files:**
- Modify: the Desktop `session/prompt` call sites in `apps/desktop/src/App.tsx`, `apps/desktop/src/hooks/use-composer-media.ts`, `apps/desktop/src/side-chat-panel.tsx`
- Modify: chat reducer / notice copy for `foreground-run-mismatch` and `superseded-by-new-prompt`
- Create: `apps/desktop/src/prompt-foreground.ts`
- Create: `apps/desktop/src/prompt-foreground.test.ts`

**Interfaces:**
- Consumes: `PromptForegroundAdmission`, `ForegroundRunMismatchProblem`
- Produces:

```ts
export function readForegroundProblem(
  response: HostResponse,
): ForegroundRunMismatchProblem | undefined;

export function nextPromptForeground(input: {
  confirmedReplaceRunId?: string;
}): PromptForegroundAdmission;
```

`nextPromptForeground` returns `{ kind: 'if-idle' }` unless the user just confirmed a specific `runId`.

When remote (or always, if the call site is cheap): every prompt includes `foreground`. On `foreground-run-mismatch` + `active` / `transitioning`, show “另一端正在处理这个会话，发送会中断当前任务” → 取消 / 中断并发送. Confirm retries **once** with `replace-run(actualRunId)` and a **new** idempotency key. On `already-finished` / `changed`, do not auto-replace; show state and leave Send as a new `if-idle`.

Side Chat keeps “run 中禁用普通 Send” — do not silently replace from Side Chat.

- [ ] **Step 1: Unit-test `nextPromptForeground` and problem parsing**
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Wire composer + notices**
- [ ] **Step 4: Run Desktop tests for composer / chat reducer**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): send if-idle and confirmed replace-run"
```

---

### Task 7: iOS cockpit — project list, hydrate, continue

**Files:**
- Modify: `apps/mobile/src/mobile-host-connection.ts`
- Modify: `apps/mobile/src/App.tsx`
- Create: `apps/mobile/src/mobile-session-continuity.ts`
- Create: `apps/mobile/src/mobile-session-continuity.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; existing `createMobileHostClient`
- Produces: helpers

```ts
export function sessionListCommand(scopeRef: SessionListScopeRef): HostCommand;
export function promptCommand(input: {
  sessionId: string;
  text: string;
  attachments?: PromptInput['attachments'];
  foreground: PromptForegroundAdmission;
}): HostCommand;
```

Behavior:

1. After `ready`, wait for hydration (or fetch `session/runtime-status` / `session/resume` until a live `runId` is known) before enabling Send / Stop / permission.
2. List with `scopeRef: { kind: 'all-authorized' }` and `maxItems` (e.g. 50), not `sessions.slice(0, 8)`.
3. Project drill-in: `{ kind: 'project', projectId }` from `project/list`.
4. Send uses `{ kind: 'if-idle' }`.
5. On `foreground-run-mismatch`, same confirm sheet as Desktop.
6. Stop sends `session/abort` with the **exact** hydrated `runId`.
7. Permission resolve stays `rememberScope: 'once'`.
8. If hello lacks `foregroundRunAdmission`, show “Host 版本过旧” and do not send prompts.

Token + URL remain the connect UI (pairing is the next plan). Persist last endpoint as today.

- [ ] **Step 1: Write helper tests for list/prompt command shapes and mismatch handling**
- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --dir apps/mobile test -- mobile-session-continuity`

- [ ] **Step 3: Implement list / hydrate / confirm in `App.tsx` without importing Desktop**
- [ ] **Step 4: Run**

Run: `pnpm --dir apps/mobile test && pnpm --dir apps/mobile typecheck`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): continue Host sessions with if-idle admission"
```

---

### Task 8: Manual two-Host-location smoke (Mac + Linux)

No product code. This is the user’s stated test.

**Setup (same commit SHA / same version on both machines):**

```bash
# on the Host machine (this Mac or Linux)
export PIWIN_HOST_TOKEN='<long random>'
export PIWIN_HOST_BIND='127.0.0.1'   # or the Tailscale IP, never a public wildcard as the product default
export PIWIN_HOST_PORT=8787
pnpm dev:host
# or: PIWIN_MOCK=1 pnpm dev:host   for a fixture Host
```

Advertise the phone/Desktop-reachable URL (`ws://100.x.x.x:8787` on Tailscale), not `127.0.0.1` unless the client is on the same host.

**Matrix**

| Host | Clients | Pass means |
|------|---------|------------|
| `apps/host` on this Mac | Desktop remote attach + iOS | both list the same sessions; open one |
| `apps/host` on Linux, same version | Desktop (Mac or Windows) + iOS | same |
| Host running a prompt from Desktop | iOS opens that session | iOS sees streaming / live `runId`; Send is `if-idle` rejected |
| iOS confirms 中断并发送 | Desktop | Desktop shows superseded terminal, not a stuck spinner |
| iOS sends after idle | Desktop | same transcript continues |

Windows: build/run `apps/desktop` on Windows, same remote URL + token. Do not add a second Windows codebase.

- [ ] **Step 1: Run Mac Host + Desktop + iOS walk-away once; write the three outcomes (connect / watch / continue) in the PR or a short note under `docs/notes/` only if something unexpected happens**
- [ ] **Step 2: Repeat against Linux Host**
- [ ] **Step 3: Commit only if you added a notes file**

---

## Out of this plan (do not implement here)

- Desktop sidecar `mobile-access/*` listener / QR from the running Desktop app
- One shell managing many Hosts
- Device pairing, Keychain, revoke UI
- Crash-durable idempotency
- Inbox / Markdown / upload ticket / APNs / remote PTY

Those stay on the design doc follow-ups. The protocol added here (`foreground`, `scopeRef`, `HostProblem`) is what they will reuse.

## Spec coverage

| Design item | Task |
|-------------|------|
| Many shells, one Host process | 4, 5, 8 |
| Standalone `apps/host` (Mac or Linux) | 5, 8 |
| No sidecar listen | Global + out-of-scope |
| Token connect (pairing later) | 5, 7, 8 |
| Logical `projectId` listing | 1, 3, 7 |
| Shared observation | 4, 7, 8 |
| `if-idle` / `replace-run` | 1, 2, 4, 6, 7 |
| Ack then cancel | 2 |
| Hydrate live Run | 4, 7 |
| Structured problems | 1, 2, 4 |
| Same-process idempotency only | 4 (existing cache); crash path not added |
| Desktop as remote client | 5, 6 |
| Windows = same Desktop app | 5, 8 |
| ADR 0015 truth | 2 |
