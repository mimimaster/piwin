# Live Wrong-Session Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Live voice-delegation from writing a new user row into the *bound* work session when the user is looking at a different or empty session — and stop `kind: 'work'` same-brief follow-ups from opening a second prompt on a completed task.

**Architecture:** Two Host gates, one Desktop reporter. (1) Canonical same-brief `work` reuses the completed task and never calls `session/prompt`. (2) Owner-reported `intendedSessionId` is compared to `slot.sessionId` *before* admission; empty or mismatch **holds** (no transcript row). Desktop syncs intended session on every focus change. The “query under the images” screenshot is a symptom of a second voice user row on the old session, not a transcript reorder bug — do not change `chat-thread` / `min-height`.

**Tech Stack:** TypeScript strict (NodeNext ESM), vitest, existing Live HostCommand / `LiveDelegationController` / Desktop `useLiveCall` stack. No new runtime dependencies.

## Global Constraints

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — do not weaken (AGENTS.md §3.1).
- ESM only; relative imports use `.js` extensions; `import type` for types.
- Apps never import `@earendil-works/pi-*`. Live admission stays in `packages/host-runtime` + `packages/contracts`.
- `packages/contracts` stays a leaf — types only, no `@piwin/*` runtime deps.
- No `any`; no non-null assertion except after a runtime check in the same block.
- No new npm dependencies.
- Tests required for every logic change (AGENTS.md §3.5).
- Do **not** abort an already-accepted Run on rebind or hold. In-flight admission stays on the session it was admitted to.
- Do **not** change `.chat-turn-group.is-current-response` min-height or reorder transcript rows. The visual bug is an extra user message, not CSS.
- Do **not** convert `kind: 'repeat'` into reuse when intended session **matches** the bound session — “再来一张” on the focused session must still `session/prompt`.
- Product override vs `docs/notes/2026-09-01-live-session-rebind-investigation.md` §5.1 **S-keep**: this plan **holds new work** when intended session is empty or mismatches the bound session. LiveBar “still bound to A” (L1 of that plan) may still show; it must not start a Run on A.
- File mutex with in-flight `fix/live-session-rebind` (L1–L5): do not edit `apps/desktop/src/live/use-live-call.ts`, `LiveBar.tsx`, `live-call-copy.ts`, `conversation-pane-layout.ts`, `packages/host-runtime/src/voice/live-call-coordinator.ts`, `apps/mobile/**`, or `docs/adr/0065-piwin-live-voice-work-session.md` in this plan. If those files are required, stop and report BLOCKED.
- Worktree: execute on a branch other than `fix/live-session-rebind` unless that branch has already merged; then stack on `main`.

## Dispatch (independent sub-agents)

| Task | `dependsOn` | `parallelGroup` | Exclusive files |
|------|-------------|-----------------|-----------------|
| 1 Canonical work reuse | none | `live-wrong-session` | `live-delegation-reuse.ts` (+ test), `live-delegation-controller.ts`, `live-call-types.ts` (held reason union only), `live-intent-admission.test.ts` |
| 2 Hold-delegate Host | none (uses Task 1’s held-reason strings; if Task 1 is not in the tree yet, copy the two reason literals — do not edit Task 1 files) | `live-wrong-session` | `live-intended-session-gate.ts` (+ test), `voice-delegation-admission.ts` (+ test), `compose-host-live.ts`, `voice-live-commands.ts` (+ test), `live-intended-session.ts` (contracts), `ipc-platform-commands.ts` (one union member), `index.ts` (one export), `live-remote-gate.ts` (+ test) |
| 3 Desktop intended sync | **Task 2** (needs `voice/live/set-intended-session` on `HostCommand`) | — | `live-intended-session-sync.ts` (+ test), `use-composer-dock-props.ts` (hook call only), `host-client-mock-live.ts` (+ test if present) |
| 4 Spec note | none | `live-wrong-session` | `docs/specs/2026-09-01-live-intended-session-hold.md` only |

Task 1 and Task 2 **must not both edit** `live-delegation-controller.ts`. Task 1 owns the controller. Task 2 holds inside **admission**, returning `status: 'rejected'` with the held reason strings. Task 1’s controller already maps those strings to speakable hold copy.

---

## Background (incident)

Test profile `~/.piwin-test`, session `session-mtieeuab-39a0190j`, call `live_176f3215-a4ad-4bf8-a3aa-41a0e474ec6c`:

| seq | t (UTC) | row |
|-----|---------|-----|
| 1 | 08:22:18 | user `随便生成一张图片` (`voice-delegation`) |
| 2–4 | 08:22:19–29 | assistants + generated images |
| 5 | 08:22:53 | **second** user, same text, same call, `parent` = last assistant, no reply |

Sibling session `session-mtieiifb-87z4rhfp` was created **08:24:27** — after seq 5. At the second utterance there was no other session to bind to. Live stayed on A. Reviewer `kind: 'repeat'` (or a second `work`) called `session/prompt` again. UI current-response min-height parked that new user bubble under the images.

`LiveDelegationController` only mechanical-reuses when `decision.kind === 'work'` and `task.brief === instruction`. `kind: 'repeat'` **always admits** (“explicit repeats are distinct”). That is correct when the user is still focused on A and wants another image. It is wrong when they have left A.

Existing rebind plan L1–L5 makes failed/empty rebind **visible** and keeps S-keep. It does **not** prevent seq 5.

---

## File structure

```text
packages/contracts/src/live-intended-session.ts          # Task 2: command input type
packages/contracts/src/ipc-platform-commands.ts          # Task 2: HostCommand member
packages/contracts/src/index.ts                          # Task 2: re-export

packages/host-runtime/src/voice/live-delegation-reuse.ts # Task 1
packages/host-runtime/src/voice/live-delegation-reuse.test.ts
packages/host-runtime/src/voice/live-delegation-controller.ts  # Task 1 only
packages/host-runtime/src/voice/live-call-types.ts       # Task 1: widen reject reason
packages/host-runtime/src/voice/live-intent-admission.test.ts  # Task 1

packages/host-runtime/src/voice/live-intended-session-gate.ts  # Task 2
packages/host-runtime/src/voice/live-intended-session-gate.test.ts
packages/host-runtime/src/voice/voice-delegation-admission.ts # Task 2
packages/host-runtime/src/voice/voice-delegation-admission.test.ts
packages/host-runtime/src/voice/compose-host-live.ts     # Task 2: inject gate
packages/host-runtime/src/commands/voice-live-commands.ts
packages/host-runtime/src/commands/voice-live-commands.test.ts
packages/host-server/src/live-remote-gate.ts             # Task 2: owner allowlist
packages/host-server/src/live-remote-gate.test.ts

apps/desktop/src/live/live-intended-session-sync.ts      # Task 3
apps/desktop/src/live/live-intended-session-sync.test.ts
apps/desktop/src/hooks/use-composer-dock-props.ts        # Task 3: one hook call
apps/desktop/src/host-client-mock-live.ts                # Task 3

docs/specs/2026-09-01-live-intended-session-hold.md      # Task 4
```

---

### Task 1: Canonical `work` same-brief reuse + hold speakable mapping

**Files:**
- Create: `packages/host-runtime/src/voice/live-delegation-reuse.ts`
- Create: `packages/host-runtime/src/voice/live-delegation-reuse.test.ts`
- Modify: `packages/host-runtime/src/voice/live-call-types.ts` (`LiveDelegationAdmissionResult` rejected `reason` union)
- Modify: `packages/host-runtime/src/voice/live-delegation-controller.ts` (`handleDelegation` same-brief block + `finishWithoutWork` reasons)
- Test: `packages/host-runtime/src/voice/live-delegation-reuse.test.ts`, `packages/host-runtime/src/voice/live-intent-admission.test.ts`

**Interfaces:**
- Consumes: `LiveDelegationDecision`, `LiveDelegationContext` from `@piwin/contracts`; `LiveDelegationAdmissionResult` from `live-call-types.ts`.
- Produces:
  - `canonicalLiveBrief(text: string): string`
  - `LIVE_HOLD_EMPTY_REASON = 'live-delegation-held-empty'` (const string)
  - `LIVE_HOLD_MISMATCH_REASON = 'live-delegation-held-mismatch'` (const string)
  - `resolveLiveWorkReuse(input: { kind: LiveDelegationDecision['kind']; brief?: string; tasks: readonly LiveDelegationContext[] }): { action: 'reuse'; delegationId: string } | { action: 'admit' }`
  - `liveHoldSpeakableReason(reason: string): 'hold-empty' | 'hold-mismatch' | null`
  - Controller `finishWithoutWork` accepts `'hold-empty' | 'hold-mismatch'` in addition to the existing `'conversation' | 'clarify' | 'unavailable'`.

- [ ] **Step 1: Write the failing reuse tests**

Create `packages/host-runtime/src/voice/live-delegation-reuse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  canonicalLiveBrief,
  liveHoldSpeakableReason,
  resolveLiveWorkReuse,
} from './live-delegation-reuse.js';

const done = {
  delegationId: 'item_first',
  brief: '随便生成一张图片',
  status: 'completed' as const,
  result: '已生成图片',
};

describe('canonicalLiveBrief', () => {
  it('collapses whitespace', () => {
    expect(canonicalLiveBrief('  随便生成一张图片 \n')).toBe('随便生成一张图片');
  });
});

describe('resolveLiveWorkReuse', () => {
  it('reuses completed work when kind is work and the brief matches canonically', () => {
    expect(
      resolveLiveWorkReuse({
        kind: 'work',
        brief: '随便生成一张图片',
        tasks: [done],
      }),
    ).toEqual({ action: 'reuse', delegationId: 'item_first' });
  });

  it('admits kind repeat even when the brief matches (explicit second image)', () => {
    expect(
      resolveLiveWorkReuse({
        kind: 'repeat',
        brief: '随便生成一张图片',
        tasks: [done],
      }),
    ).toEqual({ action: 'admit' });
  });

  it('admits work when the brief is a new task', () => {
    expect(
      resolveLiveWorkReuse({
        kind: 'work',
        brief: '再生成一张猫',
        tasks: [done],
      }),
    ).toEqual({ action: 'admit' });
  });
});

describe('liveHoldSpeakableReason', () => {
  it('maps hold reject reasons', () => {
    expect(liveHoldSpeakableReason('live-delegation-held-empty')).toBe('hold-empty');
    expect(liveHoldSpeakableReason('live-delegation-held-mismatch')).toBe('hold-mismatch');
    expect(liveHoldSpeakableReason('live-delegation-rejected')).toBeNull();
  });
});
```

Add to `packages/host-runtime/src/voice/live-intent-admission.test.ts` (same `setup()` helper already in that file):

```ts
it('does not session/prompt a second work decision with the same brief after completion (mtieeuab seq5)', async () => {
  const review = vi.fn<LiveDelegationReviewer>()
    .mockResolvedValueOnce({ kind: 'work', brief: '随便生成一张图片' })
    .mockResolvedValueOnce({ kind: 'work', brief: '随便生成一张图片' });
  const fixture = await setup(review);
  fixture.send('item_EJE2', '随便生成一张图片');
  await fixture.settled('item_EJE2');
  fixture.coordinator.notifyBoundSessionTurnEnded({
    sessionId: 's1',
    runId: 'run',
    kind: 'session-turn',
    status: 'completed',
    assistantText: 'Done — generated an image.',
  });
  fixture.send('item_EJE3', '随便生成一张图片');
  await fixture.settled('item_EJE3');
  expect(fixture.admit).toHaveBeenCalledTimes(1);
  const spoken = fixture.actions.filter((action) => action.action === 'append-context');
  expect(spoken.at(-1)?.content).toContain('generated an image');
  await fixture.coordinator.dispose();
});

it('still admits kind repeat on the same bound session after completion', async () => {
  const review = vi.fn<LiveDelegationReviewer>()
    .mockResolvedValueOnce({ kind: 'work', brief: '随便生成一张图片' })
    .mockResolvedValueOnce({ kind: 'repeat', brief: '随便生成一张图片' });
  const fixture = await setup(review);
  fixture.send('first', '随便生成一张图片');
  await fixture.settled('first');
  fixture.coordinator.notifyBoundSessionTurnEnded({
    sessionId: 's1',
    runId: 'run',
    kind: 'session-turn',
    status: 'completed',
    assistantText: '图好了',
  });
  fixture.send('second', '随便生成一张图片');
  await fixture.settled('second');
  expect(fixture.admit).toHaveBeenCalledTimes(2);
  await fixture.coordinator.dispose();
});

it('speaks hold-empty when admission rejects with live-delegation-held-empty', async () => {
  const actions: LiveOwnerActionPush[] = [];
  const coordinator = makeLiveCoordinator({
    review: async () => ({ kind: 'repeat', brief: '随便生成一张图片' }),
    admission: {
      admit: async () => ({
        status: 'rejected',
        reason: 'live-delegation-held-empty',
      }),
    },
    pushOwnerAction: (action) => actions.push(action),
  });
  const started = await coordinator.start({
    sessionId: 's1',
    providerId: 'openai-codex',
    settingsRevision: 1,
    idempotencyKey: 'hold',
    ownerDeviceId: 'owner',
    bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
    signal: new AbortController().signal,
  });
  if (!started.ok) throw new Error(started.errorCode);
  coordinator.reportOwnerEvent({
    callId: started.call.callId,
    ownerDeviceId: 'owner',
    event: {
      type: 'delegation',
      providerDelegationId: 'd-hold',
      instruction: '随便生成一张图片',
    },
  });
  await vi.waitFor(() =>
    expect(actions.some((action) => action.action === 'append-context')).toBe(true),
  );
  expect(actions.find((action) => action.action === 'append-context')?.content).toContain(
    'not in a work session',
  );
  await coordinator.dispose();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/voice/live-delegation-reuse.test.ts \
  src/voice/live-intent-admission.test.ts
```

Expected: FAIL — `./live-delegation-reuse.js` not found; new intent-admission cases fail (`admit` called twice on the mtieeuab work/work sequence, and/or hold speakable missing).

- [ ] **Step 3: Implement the helper**

`packages/host-runtime/src/voice/live-delegation-reuse.ts`:

```ts
import type { LiveDelegationContext, LiveDelegationDecision } from '@piwin/contracts';

export const LIVE_HOLD_EMPTY_REASON = 'live-delegation-held-empty';
export const LIVE_HOLD_MISMATCH_REASON = 'live-delegation-held-mismatch';

export function canonicalLiveBrief(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function resolveLiveWorkReuse(input: {
  kind: LiveDelegationDecision['kind'];
  brief?: string;
  tasks: readonly LiveDelegationContext[];
}): { action: 'reuse'; delegationId: string } | { action: 'admit' } {
  if (input.kind !== 'work') return { action: 'admit' };
  const brief = input.brief ? canonicalLiveBrief(input.brief) : '';
  if (!brief) return { action: 'admit' };
  const match = [...input.tasks].reverse().find(
    (task) => canonicalLiveBrief(task.brief) === brief,
  );
  if (!match) return { action: 'admit' };
  return { action: 'reuse', delegationId: match.delegationId };
}

export function liveHoldSpeakableReason(
  reason: string,
): 'hold-empty' | 'hold-mismatch' | null {
  if (reason === LIVE_HOLD_EMPTY_REASON) return 'hold-empty';
  if (reason === LIVE_HOLD_MISMATCH_REASON) return 'hold-mismatch';
  return null;
}
```

- [ ] **Step 4: Widen admission reject reasons**

In `packages/host-runtime/src/voice/live-call-types.ts`, change:

```ts
| { status: 'rejected'; reason: LiveCallErrorCode }
```

to:

```ts
| {
    status: 'rejected';
    reason:
      | LiveCallErrorCode
      | 'live-delegation-held-empty'
      | 'live-delegation-held-mismatch';
  }
```

- [ ] **Step 5: Wire controller**

In `packages/host-runtime/src/voice/live-delegation-controller.ts`:

1. Import `resolveLiveWorkReuse` and `liveHoldSpeakableReason`.
2. Replace the `decision.kind === 'work' ? ledger.find same brief` block with:

```ts
} else if (decision.kind === 'reuse') {
  this.reuseResult(slot, delegation, decision.delegationId);
} else {
  const instruction =
    decision.kind === 'stop' ? PIWIN_LIVE_STOP_INSTRUCTION : decision.brief;
  const follow =
    decision.kind === 'stop'
      ? ({ action: 'admit' } as const)
      : resolveLiveWorkReuse({
          kind: decision.kind,
          brief: decision.kind === 'work' || decision.kind === 'repeat' ? decision.brief : undefined,
          tasks: this.ledger.contextForSession(targetSessionId),
        });
  if (follow.action === 'reuse') {
    this.reuseResult(slot, delegation, follow.delegationId);
  } else {
    // existing capacity / stop-queue / admitAndRecord
  }
}
```

3. In `admitAndRecord`, when `result.status !== 'accepted'`:

```ts
const hold = liveHoldSpeakableReason(result.reason);
this.finishWithoutWork(
  slot,
  delegation,
  hold ?? 'unavailable',
);
```

4. Extend `finishWithoutWork` `reason` union with `'hold-empty' | 'hold-mismatch'` and speakable copy (English, same channel as `'unavailable'` — this text is for the Live model, not the user bubble):

- `hold-empty`: `'No work started. The user is not in a work session. Ask them to open or focus a session. Do not claim you started the task.'`
- `hold-mismatch`: `'No work started. The session the user is looking at is not the bound Live work session. Do not run the task in the previous session. Do not claim you started it.'`

Keep `'unavailable'` copy unchanged.

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/voice/live-delegation-reuse.test.ts \
  src/voice/live-intent-admission.test.ts \
  src/voice/live-delegation-controller.test.ts
pnpm --filter @piwin/host-runtime typecheck
```

Expected: PASS. Existing `'reuses the result under new event IDs even after completion, but allows explicit repeats and changes'` still expects `admit` **3** times (work + repeat + changed work). Do not change that expectation.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/host-runtime/src/voice/live-delegation-reuse.ts \
  packages/host-runtime/src/voice/live-delegation-reuse.test.ts \
  packages/host-runtime/src/voice/live-call-types.ts \
  packages/host-runtime/src/voice/live-delegation-controller.ts \
  packages/host-runtime/src/voice/live-intent-admission.test.ts
git commit -m "$(cat <<'EOF'
fix(host-runtime): reuse completed Live work briefs without a second prompt

Same-brief kind=work after a finished task must not session/prompt again.
kind=repeat on the focused session still admits (second image).
EOF
)"
```

---

### Task 2: Hold-delegate when intended session is empty or mismatched

**Files:**
- Create: `packages/contracts/src/live-intended-session.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from './live-intended-session.js';`)
- Modify: `packages/contracts/src/ipc-platform-commands.ts` (import type + one `PlatformHostCommand` member)
- Create: `packages/host-runtime/src/voice/live-intended-session-gate.ts`
- Create: `packages/host-runtime/src/voice/live-intended-session-gate.test.ts`
- Modify: `packages/host-runtime/src/voice/voice-delegation-admission.ts`
- Modify: `packages/host-runtime/src/voice/voice-delegation-admission.test.ts`
- Modify: `packages/host-runtime/src/voice/compose-host-live.ts`
- Modify: `packages/host-runtime/src/commands/voice-live-commands.ts`
- Modify: `packages/host-runtime/src/commands/voice-live-commands.test.ts`
- Modify: `packages/host-server/src/live-remote-gate.ts`
- Modify: `packages/host-server/src/live-remote-gate.test.ts`

**Do not modify** `live-delegation-controller.ts` or `live-call-coordinator.ts`.

**Interfaces:**
- Consumes: Task 1 reason literals `'live-delegation-held-empty'` and `'live-delegation-held-mismatch'` (copy the strings; do not import from Task 1 if that file is not in your tree — keep the literals identical).
- Produces:
  - `LiveSetIntendedSessionInput = { callId: string; intendedSessionId: string | null }`
  - HostCommand `{ type: 'voice/live/set-intended-session'; input: LiveSetIntendedSessionInput }`
  - `LiveIntendedSessionGate` with `set(callId: string, intendedSessionId: string | null): void` and `read(callId: string): string | null | undefined` (`undefined` = never set → legacy admit)
  - `createVoiceDelegationAdmission` gains optional `intended?: LiveIntendedSessionGate` and `boundSessionId` must be `request.sessionId`

Hold policy:

| `gate.read(callId)` | admit? |
|---------------------|--------|
| `undefined` (legacy / CLI tests / gate unset) | yes |
| `null` (Desktop reported empty focus) | no, reject `live-delegation-held-empty` |
| string !== `request.sessionId` | no, reject `live-delegation-held-mismatch` |
| string === `request.sessionId` | yes |

`STOP_CURRENT_RUN` / `isLiveStopInstruction` **bypasses hold** so the user can still abort the bound Run after leaving the session.

- [ ] **Step 1: Write failing contracts + gate + admission tests**

`packages/contracts/src/live-intended-session.ts` is created in Step 3; write Host-side tests first against the intended API.

`packages/host-runtime/src/voice/live-intended-session-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LiveIntendedSessionGate } from './live-intended-session-gate.js';

describe('LiveIntendedSessionGate', () => {
  it('starts unset (legacy admit)', () => {
    const gate = new LiveIntendedSessionGate();
    expect(gate.read('call-1')).toBeUndefined();
  });

  it('stores null as empty focus', () => {
    const gate = new LiveIntendedSessionGate();
    gate.set('call-1', null);
    expect(gate.read('call-1')).toBeNull();
  });

  it('stores a focused session id', () => {
    const gate = new LiveIntendedSessionGate();
    gate.set('call-1', 'session-b');
    expect(gate.read('call-1')).toBe('session-b');
  });

  it('does not leak across call ids', () => {
    const gate = new LiveIntendedSessionGate();
    gate.set('call-1', 'session-a');
    expect(gate.read('call-2')).toBeUndefined();
  });
});
```

Add to `packages/host-runtime/src/voice/voice-delegation-admission.test.ts`:

```ts
it('holds when intended session is empty', async () => {
  const prompt = { admitVoiceDelegation: vi.fn() };
  const gate = new LiveIntendedSessionGate();
  gate.set('c1', null);
  const port = createVoiceDelegationAdmission({
    busy: { isSessionBusy: () => false },
    prompt,
    intended: gate,
  });
  const result = await port.admit({
    callId: 'c1',
    sessionId: 'session-a',
    instruction: '随便生成一张图片',
    providerDelegationId: 'item_EJE3',
  });
  expect(result).toEqual({
    status: 'rejected',
    reason: 'live-delegation-held-empty',
  });
  expect(prompt.admitVoiceDelegation).not.toHaveBeenCalled();
});

it('holds when intended session mismatches the bound session', async () => {
  const prompt = { admitVoiceDelegation: vi.fn() };
  const gate = new LiveIntendedSessionGate();
  gate.set('c1', 'session-b');
  const port = createVoiceDelegationAdmission({
    busy: { isSessionBusy: () => false },
    prompt,
    intended: gate,
  });
  const result = await port.admit({
    callId: 'c1',
    sessionId: 'session-a',
    instruction: '随便生成一张图片',
    providerDelegationId: 'd2',
  });
  expect(result).toEqual({
    status: 'rejected',
    reason: 'live-delegation-held-mismatch',
  });
  expect(prompt.admitVoiceDelegation).not.toHaveBeenCalled();
});

it('still admits STOP_CURRENT_RUN while held', async () => {
  const prompt = {
    admitVoiceDelegation: vi.fn(async () => ({
      queued: false as const,
      runId: 'r-stop',
      messageId: 'm-stop',
    })),
  };
  const gate = new LiveIntendedSessionGate();
  gate.set('c1', null);
  const port = createVoiceDelegationAdmission({
    busy: { isSessionBusy: () => false },
    prompt,
    intended: gate,
  });
  const result = await port.admit({
    callId: 'c1',
    sessionId: 'session-a',
    instruction: 'STOP_CURRENT_RUN',
    providerDelegationId: 'stop-1',
  });
  expect(result.status).toBe('accepted');
  expect(prompt.admitVoiceDelegation).toHaveBeenCalledTimes(1);
});
```

Add to `packages/host-runtime/src/commands/voice-live-commands.test.ts` (use existing `makeContext()`):

```ts
it('set-intended-session empty holds a later repeat on the bound session', async () => {
  const context = makeContext();
  const started = await handleVoiceLiveCommand(
    {
      type: 'voice/live/start',
      input: {
        sessionId: 'session-a',
        providerId: 'openai-codex',
        settingsRevision: 1,
        idempotencyKey: 'k-hold',
        bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
      },
    },
    'req-start',
    context,
  );
  expect(started?.success).toBe(true);
  const callId = (started as { data: { call: { callId: string } } }).data.call.callId;

  const set = await handleVoiceLiveCommand(
    {
      type: 'voice/live/set-intended-session',
      input: { callId, intendedSessionId: null },
    },
    'req-set',
    context,
  );
  expect(set?.success).toBe(true);
});
```

(The start+set success test is the command surface. Admission hold is covered by the admission unit tests; do not reach into coordinator internals from this file.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @piwin/host-runtime exec vitest run \
  src/voice/live-intended-session-gate.test.ts \
  src/voice/voice-delegation-admission.test.ts \
  src/commands/voice-live-commands.test.ts
pnpm --filter @piwin/contracts typecheck
```

Expected: FAIL — missing module / missing command type / admission still accepts.

- [ ] **Step 3: Contracts**

Create `packages/contracts/src/live-intended-session.ts`:

```ts
export type LiveSetIntendedSessionInput = {
  callId: string;
  /**
   * Focused work session. `null` means the owner has no focused session
   * (empty pane, new-agent draft, project with no session).
   */
  intendedSessionId: string | null;
};
```

`packages/contracts/src/index.ts` — add:

```ts
export * from './live-intended-session.js';
```

`packages/contracts/src/ipc-platform-commands.ts`:

- Import `LiveSetIntendedSessionInput` from `./live-intended-session.js`.
- Add member next to `voice/live/rebind`:

```ts
| { id?: string; type: 'voice/live/set-intended-session'; input: LiveSetIntendedSessionInput }
```

Do **not** add error codes to `LiveCallErrorCode` / `voice-live.ts` (owned by the parallel rebind plan). Hold reasons stay admission-reject strings.

If `packages/contracts/src/ipc-commands-content.ts` still duplicates the live command list, add the same member there so the two lists do not drift. If that file is unused (no imports), skip it.

- [ ] **Step 4: Gate + admission**

`LiveIntendedSessionGate` — one Map `callId → string | null`. `set` overwrites. `read` returns `undefined` when the call id is missing.

`createVoiceDelegationAdmission` optional `intended?: { read(callId: string): string | null | undefined }`. After sanitizing instruction, before `prompt.admitVoiceDelegation`:

```ts
if (!isLiveStopInstruction(instruction) && input.intended) {
  const intendedSessionId = input.intended.read(request.callId);
  if (intendedSessionId === null) {
    const held = { status: 'rejected' as const, reason: 'live-delegation-held-empty' as const };
    ledger.set(key, held);
    return held;
  }
  if (intendedSessionId !== undefined && intendedSessionId !== request.sessionId) {
    const held = { status: 'rejected' as const, reason: 'live-delegation-held-mismatch' as const };
    ledger.set(key, held);
    return held;
  }
}
```

Import `isLiveStopInstruction` from `@piwin/contracts`.

- [ ] **Step 5: Command + compose + remote allowlist**

In `packages/host-runtime/src/commands/voice-live-commands.ts`:

- Add `'voice/live/set-intended-session'` to `TYPES`.
- Extend `VoiceLiveCommandContext` with `liveIntendedSession?: LiveIntendedSessionGate`.
- Handle:

```ts
if (command.type === 'voice/live/set-intended-session') {
  const callId = command.input.callId.trim();
  if (!callId) return fail(requestId, command.type, 'live-session-unavailable');
  context.liveIntendedSession?.set(callId, command.input.intendedSessionId);
  return ok(requestId, command.type, { accepted: true });
}
```

No-op success when the gate is missing (tests without a gate still typecheck). Command succeeds even if the call has ended — Desktop may sync on hangup.

`compose-host-live.ts`: construct one `LiveIntendedSessionGate`, pass it into `createVoiceDelegationAdmission({ ..., intended: gate })`, and assign `deps.liveIntendedSession = gate` if the kernel field exists. If `HostRuntimeKernel` has no such field, add `liveIntendedSession?: LiveIntendedSessionGate` on the kernel type in `packages/host-runtime/src/host-runtime-kernel.ts` **only if that file is not already a god-module choke**; otherwise hang the gate on `VoiceLiveCommandContext` via the same `composeHostLive` function by setting `deps.liveIntendedSession` through an existing bag. Prefer adding an optional field on `HostRuntimeKernel` next to `liveCallCoordinator`.

Find the live-command context assembly (grep `handleVoiceLiveCommand` / `liveCallCoordinator`) and pass `liveIntendedSession: deps.liveIntendedSession`.

`packages/host-server/src/live-remote-gate.ts` — add `'voice/live/set-intended-session'` to `LIVE_OWNER_COMMANDS`. Extend `live-remote-gate.test.ts` so `isLiveOwnerCommand('voice/live/set-intended-session')` is `true`.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/host-runtime exec vitest run \
  src/voice/live-intended-session-gate.test.ts \
  src/voice/voice-delegation-admission.test.ts \
  src/commands/voice-live-commands.test.ts
pnpm --filter @piwin/host-server exec vitest run src/live-remote-gate.test.ts
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/host-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/contracts/src/live-intended-session.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/ipc-platform-commands.ts \
  packages/host-runtime/src/voice/live-intended-session-gate.ts \
  packages/host-runtime/src/voice/live-intended-session-gate.test.ts \
  packages/host-runtime/src/voice/voice-delegation-admission.ts \
  packages/host-runtime/src/voice/voice-delegation-admission.test.ts \
  packages/host-runtime/src/voice/compose-host-live.ts \
  packages/host-runtime/src/commands/voice-live-commands.ts \
  packages/host-runtime/src/commands/voice-live-commands.test.ts \
  packages/host-server/src/live-remote-gate.ts \
  packages/host-server/src/live-remote-gate.test.ts
# plus kernel field file if added
git commit -m "$(cat <<'EOF'
fix(host-runtime): hold Live admission when focus is empty or mismatched

Owner-reported intendedSessionId=null or !== bound session rejects
voice-delegation before session/prompt. STOP_CURRENT_RUN still admits.
EOF
)"
```

---

### Task 3: Desktop reports intended session

**Files:**
- Create: `apps/desktop/src/live/live-intended-session-sync.ts`
- Create: `apps/desktop/src/live/live-intended-session-sync.test.ts`
- Modify: `apps/desktop/src/hooks/use-composer-dock-props.ts` (call the hook next to `useLiveCall`; do not grow this file beyond the call)
- Modify: `apps/desktop/src/host-client-mock-live.ts`

**Interfaces:**
- Consumes: `HostCommand` member `voice/live/set-intended-session` from Task 2; `HostClient.request`; `live.status?.call?.callId` from `useLiveCall` (already constructed in this file).
- Produces: `syncLiveIntendedSession(input: { hostClient: HostClient; callId: string | null | undefined; intendedSessionId: string | null }): Promise<void>`

- [ ] **Step 1: Write the failing unit test**

`apps/desktop/src/live/live-intended-session-sync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { syncLiveIntendedSession } from './live-intended-session-sync.js';

describe('syncLiveIntendedSession', () => {
  it('does nothing without a callId', async () => {
    const request = vi.fn();
    await syncLiveIntendedSession({
      hostClient: { request } as never,
      callId: null,
      intendedSessionId: 'session-b',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('sends null when focus is empty', async () => {
    const request = vi.fn(async () => ({ success: true }));
    await syncLiveIntendedSession({
      hostClient: { request } as never,
      callId: 'live_176f3215',
      intendedSessionId: null,
    });
    expect(request).toHaveBeenCalledWith({
      type: 'voice/live/set-intended-session',
      input: { callId: 'live_176f3215', intendedSessionId: null },
    });
  });

  it('sends the focused session id', async () => {
    const request = vi.fn(async () => ({ success: true }));
    await syncLiveIntendedSession({
      hostClient: { request } as never,
      callId: 'call-1',
      intendedSessionId: 'session-mtieiifb-87z4rhfp',
    });
    expect(request).toHaveBeenCalledWith({
      type: 'voice/live/set-intended-session',
      input: {
        callId: 'call-1',
        intendedSessionId: 'session-mtieiifb-87z4rhfp',
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @piwin/desktop exec vitest run src/live/live-intended-session-sync.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement sync + mock host**

`apps/desktop/src/live/live-intended-session-sync.ts`:

```ts
import { useEffect } from 'react';
import type { HostClient } from '../host-client.js';

export async function syncLiveIntendedSession(input: {
  hostClient: HostClient;
  callId: string | null | undefined;
  intendedSessionId: string | null;
}): Promise<void> {
  const callId = input.callId?.trim();
  if (!callId) return;
  await input.hostClient.request({
    type: 'voice/live/set-intended-session',
    input: { callId, intendedSessionId: input.intendedSessionId },
  });
}

export function useLiveIntendedSessionSync(input: {
  hostClient: HostClient;
  callId: string | null | undefined;
  intendedSessionId: string | null;
}): void {
  useEffect(() => {
    void syncLiveIntendedSession(input);
  }, [input.hostClient, input.callId, input.intendedSessionId]);
}
```

`useEffect` dependency: do not pass the whole `input` object. The hook above closes over `input`; rewrite so the effect deps are the three primitives:

```ts
export function useLiveIntendedSessionSync(input: {
  hostClient: HostClient;
  callId: string | null | undefined;
  intendedSessionId: string | null;
}): void {
  const { hostClient, callId, intendedSessionId } = input;
  useEffect(() => {
    void syncLiveIntendedSession({ hostClient, callId, intendedSessionId });
  }, [hostClient, callId, intendedSessionId]);
}
```

In `use-composer-dock-props.ts`, immediately after `const live = useLiveCall({...})`:

```ts
useLiveIntendedSessionSync({
  hostClient,
  callId: live.status?.call?.callId,
  intendedSessionId: liveSessionId,
});
```

Add the import from `../live/live-intended-session-sync.js`. Do not add other logic to this 610-line file.

`host-client-mock-live.ts`: add `command.type !== 'voice/live/set-intended-session'` to the early-return type check (include it in the handled set). On that type, `return { id, type: 'response', command: command.type, success: true, data: { accepted: true } };` without mutating the mock slot.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @piwin/desktop exec vitest run \
  src/live/live-intended-session-sync.test.ts \
  src/live/use-live-call.hook.test.tsx \
  src/live/LiveBar.test.tsx
pnpm --filter @piwin/desktop typecheck
```

Expected: PASS. If typecheck fails because `voice/live/set-intended-session` is not on `HostCommand`, Task 2 is missing — stop, do not `as HostCommand`.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/desktop/src/live/live-intended-session-sync.ts \
  apps/desktop/src/live/live-intended-session-sync.test.ts \
  apps/desktop/src/hooks/use-composer-dock-props.ts \
  apps/desktop/src/host-client-mock-live.ts
git commit -m "$(cat <<'EOF'
fix(desktop): report Live intended session on focus change

Empty or other-session focus is sent to Host so voice-delegation
cannot session/prompt the previously bound work session.
EOF
)"
```

---

### Task 4: Spec note (admission hold)

**Files:**
- Create: `docs/specs/2026-09-01-live-intended-session-hold.md`

**Do not edit** `docs/adr/0065-piwin-live-voice-work-session.md` or `docs/notes/2026-09-01-live-session-rebind-investigation.md` (owned by the parallel rebind plan). This spec is the product record for hold-delegate.

**Interfaces:** none.

- [ ] **Step 1: Write the spec**

The file must contain:

1. Incident pointer: `session-mtieeuab-39a0190j` seq 1–5, call `live_176f3215-…`, Test root `PIWIN_ROOT=~/.piwin-test`.
2. Product rule: **focused session is the only session that may receive new Live work**. Empty focus → hold. Focus ≠ bound → hold. Bound Run already accepted is not cancelled.
3. `kind: 'repeat'` on the **focused = bound** session still starts a new turn (second image).
4. `kind: 'work'` with the same canonical brief as a completed task on that session reuses; no second user row.
5. Speakable copy purpose: tell the Live model not to claim the task started; no user transcript row.
6. Relation to S-keep: LiveBar may still display the previous bind; **admission must not follow that bind** when intended is empty/mismatch.
7. Out of scope: transcript CSS, Mobile auto-rebind (rebind plan L4), aborting in-flight Runs.

- [ ] **Step 2: Commit**

```bash
git add docs/specs/2026-09-01-live-intended-session-hold.md
git commit -m "$(cat <<'EOF'
docs: specify Live hold when intended session is empty or mismatched
EOF
)"
```

---

## Self-review

**Spec coverage**

| Incident / rule | Task |
|-----------------|------|
| Second `voice-delegation` user after completed images (`kind: 'work'` same brief) | Task 1 |
| Second user from `kind: 'repeat'` while focus left A | Task 2 + 3 |
| Empty focus / new-agent / project with no session | Task 2 + 3 (`intendedSessionId: null`) |
| Focused other session with valid id | Task 3 sends B; Task 2 holds until rebind makes `slot.sessionId === B` (rebind itself is the other plan) |
| Same-session “再来一张” | Task 1 keeps `repeat` → admit when intended matches |
| Query-under-images CSS | explicitly out of scope (symptom) |
| STOP while held | Task 2 bypass |

**Placeholder scan:** no TBD / “add validation” / “similar to Task N” without code.

**Type consistency:** `LiveSetIntendedSessionInput.intendedSessionId: string | null`; command type `'voice/live/set-intended-session'`; hold reasons `'live-delegation-held-empty' | 'live-delegation-held-mismatch'` in admission reject + controller speakable map.

**Parallelism:** Task 1, 2, 4 share no exclusive files. Task 3 needs Task 2’s command on `HostCommand` — dispatch Task 3 after Task 2’s commit is on the branch.

---

## Manual smoke (after all tasks)

1. `PIWIN_ROOT=~/.piwin-test` Desktop, CCursor session, start Live, say “随便生成一张图片”, wait until images settle.
2. Switch to an empty new-agent / other project with no session. Say the same sentence.
3. Original session transcript must **not** gain a fifth user row. Live model should say it did not start work.
4. Focus a real second session (create one if needed), wait for rebind (other plan) or, if rebind has not landed, hold-mismatch still must not write the old session.
5. Stay on the original session and say “再生成一张” / reviewer `repeat` — a new user row **on that session** is required.
