# Browser takeover repair — complete fix plan

> Binding for implementers. This repairs ADR 0057 after it shipped without a
> compose-time catalog check. Do not treat “add `browser:lock` to the list”
> as the whole job.

| Field | Value |
|-------|-------|
| Date | 2026-08-19 |
| Status | Implemented (2026-08-19) |
| Amends | [ADR 0057](../adr/0057-browser-takeover-workbench.md), [plan 2026-08-19-browser-takeover-workbench](./2026-08-19-browser-takeover-workbench.md) |
| Symptom | Desktop `Action failed` / `unknown permission action: browser_lock/browser:lock` on **any** real `session/prompt` |

---

## 0. Why the last proposal was incomplete

The red banner is one fail-closed throw. The **class** of bug is: a new Host
tool was registered with a new `permissionSpec.action` without going through
the pipeline-v2 contract (catalog + evaluator + compose test). The original
0057 plan’s Task 1 listed IPC / `ToolResultErrorCode` / push policy and
**omitted** `HOST_TOOL_PERMISSION_ACTIONS`.

A one-line catalog patch unblocks chat. It does **not**:

1. keep typecheck / admission coverage green (evaluator switch is exhaustive);
2. stop the next new `browser:*` action from shipping the same way;
3. fix lock lifetime (any Run terminal currently releases the shared Chromium);
4. close the test hole that let schema-golden pass while production compose dies.

This plan covers that whole surface. It does **not** reopen workbench UX
(IME, Interact vs Pick, screencast fps) unless a defect is required to keep
the lock/compose invariants true.

---

## 1. Review inventory (complete)

### P0 — production is down

| ID | Finding | Evidence | Why it matters |
|----|---------|----------|----------------|
| P0-1 | `browser:lock` is not in `HOST_TOOL_PERMISSION_ACTIONS` | `packages/contracts/src/tool-registration.ts` vs `permissionSpec('browser:lock')` in `browser-tools.ts` | `toolFamilyIndex` throws; Desktop shows `Action failed` |
| P0-2 | Every real session composes browser tools | `HostRuntime.createSession` → `ensureBrowserSession()`; `buildSessionHostTools` appends tools whenever the session object exists | Knowledge/RAG/CLI prompts die even if the panel was never opened. Chromium is **not** launched; the **registration** is enough |
| P0-3 | Schema golden never composes | `browser-tools.test.ts` asserts 12 names including `browser_lock` but never calls `toolFamilyIndex` | CI green, real Host red. Mock Host skips `ensureBrowserSession` |

### P1 — will bite the moment P0 is fixed

| ID | Finding | Evidence | Why it matters |
|----|---------|----------|----------------|
| P1-1 | Evaluator has no `browser:lock` case | `evaluateHostToolDomainPolicy` switch is exhaustive on `HostToolPermissionAction` | Adding only the catalog constant fails `pnpm typecheck`, or if forced, admission has no domain case |
| P1-2 | Admission catalog loop must stay true | `tool-admission.test.ts` “classifies every catalog action” | New action must allow under `bypass` like other browser writes (`ask-all` → ask, else allow) |
| P1-3 | Spec catalog copy is stale | `docs/specs/tool-execution-pipeline-v2.md` lists browser actions through `browser:wait` only | Next implementer copies the spec and repeats the miss |
| P1-4 | `onRunTerminal` releases the **shared** browser unconditionally | `host-runtime.ts` `void this.browserSession?.releaseAgentControl()` | One Host Chromium. Foreground / plan / subagent / **other session** terminals all fire this. Parent mid-click + child done → idle. User Take-over + child done → `agentWantsLock` cleared, Give back goes idle instead of back to the still-running parent |
| P1-5 | Agent writes do not stamp a holder run | `HostToolExecutor` already receives `context.runId`; browser executors ignore the third argument | There is no way to implement “release only the run that holds the lock” until writes bind `runId` |

### P2 — repair while touching the files, do not expand scope

| ID | Finding | Evidence | Fix |
|----|---------|----------|-----|
| P2-1 | Screencast start failure is a silent `catch {}` | `browser-session.ts` `startMirrorFrames` | Fallback stays (panel must not go blank). Log once at the session boundary (`console.warn` is Host-side Node). Test that fallback starts `frameLoop` |
| P2-2 | `close()` does not reset the controller | Plan T3 required `releaseAgentControl` on close; `close()` only tears down Playwright | Reset controller on `close()` so a later recreate cannot inherit `user`/`agent` |
| P2-3 | Host does not cap `insertText` | Desktop caps at 8 KiB; `dispatchInput` does not | Cap in `@piwin/browser` (same budget). Command path then inherits it |
| P2-4 | `browser-session.ts` is ~852 lines | Hard cap 1000; plan said do not append | Lock `runId` lives in `controller.ts`. Tools pass `context` in `browser-tools.ts`. Do not grow the session file except a one-line close reset + warn |
| P2-5 | `ask-all` permission copy treats every `browser:*` as navigation | `permission-context.ts`: prefix `browser:` → reason “Browser navigation requires review” | After lock is in the catalog, `ask-all` will prompt lock/click with navigate wording. Map `browser:navigate` to that copy; other `browser:*` → “Browser interaction requires review” (or action-specific). Keep `kind: 'network'` unless a dedicated kind already exists |
| P2-6 | Stale tool-name fixtures | `backend-conformance.test.ts` lists `browser_eval` (does not exist). `blueprint-compiler.test.ts` descriptor-parity omits `browser_wait` / `browser_lock` | Replace with the real 12-name set. These tests do not catch P0 today; leaving them stale invites the next miss |
| P2-7 | `browser_lock` execute paths undertested | `browser-tools.test.ts` covers lock-acquire and click user-control only | Add unlock; lock while user owns → `browser-user-has-control`; admission after catalog fix |
| P2-8 | Desktop mock unlock ignores `agentWantsLock` | `host-client-mock.ts`: user unlock always emits `owner: agent`; user lock always sets `agentWantsLock: true` | Match controller: Give back → agent only if claim is set, else idle; Take over must not invent a claim |
| P2-9 | `browser/start` cannot create the session | Command context only `getBrowserSession()`. Object is created in `createSession` | Opening the panel before the first Pi session fails with “browser session is not available”. `browser/start` (and other browser commands) must `ensureBrowserSession()` |

### Explicitly out of scope (and why)

| Item | Decision |
|------|----------|
| Add `browser/input\|lock\|unlock` to HostServer `DEFAULT_ALLOWED_COMMANDS` | **No.** Workbench is local Desktop → Tauri IPC. Remote driving of Host Chromium is a new product/security decision (ADR 0047). Absence is intentional, not a miss. Note: `isSafeRemoteCommand` **defaults to `true`**. If a later ADR enables remote browser, listing the types is not enough — add explicit cases that cap `events.length` (≤64), finite coordinates, and `insertText` bytes. Do not enable in this repair |
| 15 fps JPEG data-URL memory | Already recorded in ADR 0057. Later HTTP/WebSocket frames. Do not touch in this repair |
| Knowledge/chat still receiving `browser_*` via toolbox | Pre-existing ADR 0020 / progressive catalog. Not introduced by takeover |
| Hover-only moves skip the browser-bus mutex | Normative in the 0057 plan. Leave it |
| IME / Interact / Pick / console drawer | Current panel matches ADR (IME `insertText`, `pointer-events: none`, Take over / Give back / Release, `streaming` is not the lock). No UX rewrite |
| Remote visual panel / CLI visual panel | Intentional degradation |

---

## 2. Design decisions (do not re-litigate in the PR)

### D1 — Catalog rule (unchanged, now enforced)

New production `permissionSpec.action` = **same PR**:

1. `HOST_TOOL_PERMISSION_ACTIONS`
2. `evaluateHostToolDomainPolicy` case (or explicit `readOnly` / `trusted` short-circuit)
3. a test that would have failed today

`browser:lock` is a write to the lock, same policy family as `browser:click`:

- `ask-all` → `ask`
- otherwise → `allow`
- `rememberable: false`
- `subjectBuilder` → `{ kind: 'tool', action: 'browser:lock' }` (already true)

### D2 — Agent lock is owned by the first writer run

Host has **one** Chromium. Runs form a tree. “Run terminal releases agent”
in ADR 0057 was underspecified and implemented as “any Run terminal”.

Normative replacement:

```text
idle  -- agent write (run R) / browser_lock lock (run R) -->  agent, holder = R
agent -- later write from run S                            -->  agent, holder stays R
agent -- takeOver                                          -->  user, holder stays R, agentWantsLock stays
R terminals -- owner agent                                 -->  idle, holder cleared
R terminals -- owner user                                  -->  user, agentWantsLock=false, holder cleared
S terminals (S ≠ holder)                                   -->  no-op
explicit browser_lock unlock / releaseAgentControl()       -->  current controller semantics
```

Rules:

1. Stamp `holderRunId` only on **idle → agent** (first writer wins).
2. Child writes while parent holds do **not** steal the holder.
3. `onRunTerminal(run)` calls `releaseAgentControlIfHeldBy(run.runId)` only.
4. Tools **must** pass `context.runId` into `session.click/navigate/…` / `lock`.
5. `browser/lock owner:agent` from IPC (rare; panel does not send it) may omit
   `runId`. Then holder stays unset and **no** run-terminal will auto-release
   that acquire — only explicit unlock. That is fail-closed and acceptable.
6. Amend ADR 0057 §2 one sentence: *the run that first acquired `agent` is the
   one whose terminal releases it.*

Do **not** use “foreground-only / no `parentRunId`” as a shortcut. A second
session’s foreground turn would still steal the first session’s lock.

### D3 — Regression net (this class never ships again)

One test, not twelve comments:

```ts
expect(() => toolFamilyIndex(createBrowserToolDefinitions(session))).not.toThrow();
```

Plus a production inventory: every registration from `createBrowserToolDefinitions`
has `isHostToolPermissionAction(permissionSpec.action) === true`.

Optional follow (same PR if cheap): `buildSessionHostTools({ getBrowserSession })`
then `toolFamilyIndex(tools)` so composition, not just the factory, is covered.

---

## 3. Tasks

### Task 1 — Unblock compose (P0 + P1-1/2/3/5-test)

**Why first:** restores `session/prompt` on Desktop and CLI.

- [x] **1.1** Add `'browser:lock'` to `HOST_TOOL_PERMISSION_ACTIONS` (after
      `browser:wait`). Update `docs/specs/tool-execution-pipeline-v2.md` copy
      of the same table.
- [x] **1.2** `evaluateHostToolDomainPolicy`: add `browser:lock` to the existing
      `browser:click | type | fill-form | scroll | back | forward` group.
- [x] **1.3** `tool-registration.test.ts`: `isHostToolPermissionAction('browser:lock')`
      is true; keep rejecting `browser:interact`.
- [x] **1.4** `browser-tools.test.ts`: after the 12-name golden,

      ```ts
      expect(() => toolFamilyIndex(tools)).not.toThrow();
      expect(tools.every((t) => isHostToolPermissionAction(t.permissionSpec.action))).toBe(true);
      ```

- [x] **1.5** Confirm `tool-admission.test.ts` catalog loop still passes (bypass
      allow for `browser:lock` via the new domain case).
- [x] **1.6** `browser-tools.test.ts` execute: `unlock`; `lock` while user owns
      → `browser-user-has-control` / `retryable: false`.
- [x] **1.7** Fixture names: drop `browser_eval` from
      `backend-conformance.test.ts`; add `browser_wait` + `browser_lock` to
      `blueprint-compiler.test.ts` descriptor-parity list.

Verify:

```bash
pnpm --dir packages/contracts typecheck && pnpm --dir packages/contracts test
pnpm --dir packages/host-runtime typecheck
pnpm --dir packages/host-runtime test -- src/tools/tool-family-index.test.ts src/tools/tool-admission.test.ts src/tools/tool-policy-evaluator.test.ts src/browser-tools.test.ts
```

Manual: send the same RAG prompt that showed the red banner. It must run.

### Task 2 — Bind lock to the holder run (P1-4 / P1-5)

**Why second:** chat works after T1; lock is still wrong under subagents / multi-session.

- [ ] **2.1** `controller.ts`: extend internal state with `holderRunId?: string`.
      Do **not** add this field to `BrowserControllerPush` (Desktop does not need it).
      - `acquire('agent', runId?)`: on idle→agent, set holder if `runId` is a
        non-empty string; if already agent, leave holder unchanged.
      - `releaseAgentControl()` (no id): current semantics + clear holder.
      - `releaseAgentControlIfHeldBy(runId)`: no-op unless `holderRunId === runId`;
        otherwise same as `releaseAgentControl()`.
      - `takeOver` / `giveBack` / user acquire do not change holder except that
        `releaseAgentControl*` still clears it when they run.
- [ ] **2.2** `controller.test.ts`: parent holder + child-shaped other id does
      not release; matching id does; takeOver then matching release keeps
      `owner=user` and clears `agentWantsLock`.
- [ ] **2.3** `BrowserOpOptions` + `lock('agent')` accept `runId?: string`.
      `assertActor('agent', …)` forwards it. `releaseAgentControlIfHeldBy` on
      the session API.
- [ ] **2.4** `browser-tools.ts`: every write executor and `browser_lock` uses
      the third `context` argument: `{ signal, actor: 'agent', runId: context.runId }`.
      Read tools stay run-id-free.
- [ ] **2.5** `host-runtime.ts` `onRunTerminal`:

      ```ts
      void this.browserSession?.releaseAgentControlIfHeldBy(run.runId);
      ```

      Do not keep the unconditional `releaseAgentControl()`.
- [ ] **2.6** Session/command tests: a write with `runId: 'parent'` then
      `releaseAgentControlIfHeldBy('child')` leaves owner `agent`;
      `releaseAgentControlIfHeldBy('parent')` → idle.

Verify:

```bash
pnpm --dir packages/browser test -- src/controller.test.ts src/browser-session.test.ts
pnpm --dir packages/host-runtime test -- src/browser-tools.test.ts src/commands/browser-commands.test.ts
```

### Task 3 — Small hygiene on already-open files (P2)

- [ ] **3.1** `startMirrorFrames`: on screencast failure, `console.warn` once
      with the error; still start `frameLoop`. Add a test that a rejected
      `startScreencast` leaves screenshot mode.
- [ ] **3.2** `close()`: `controller.releaseAgentControl()` (or equivalent reset)
      before tearing down. Test: write → close → new session object starts idle
      (existing factory test is enough if close is on the same object: snapshot
      after close is idle).
- [ ] **3.3** Cap `insertText` in `dispatchBrowserInput` at 8 KiB (reuse the
      desktop budget constant or a contracts/browser shared cap if one already
      exists — do not invent a third number). Unit test truncation.
- [ ] **3.4** `wc -l` the touched files. Reject ≥ 1000. Prefer adding lines to
      `controller.ts` / `browser-tools.ts`, not `browser-session.ts`.
- [ ] **3.5** `permission-context.ts`: only `browser:navigate` uses the
      navigation reason string; other `browser:*` use interaction copy. Add a
      unit case for `browser:lock` under `ask-all`.
- [ ] **3.6** `host-client-mock.ts` lock/unlock: Take over does not set
      `agentWantsLock` unless it was already set; user unlock → `agent` only
      when the mock has a claim, else `idle`.
- [ ] **3.7** Host command context: expose `ensureBrowserSession` (or have
      `getBrowserSession` create lazily). `browser/start` must succeed before
      the first `session/create`. Test: handler with no pre-created session
      still acquires a lease.

### Task 4 — Docs + Done

- [ ] **4.1** Amend ADR 0057 §2: run-terminal release is **holder-run** scoped.
      Architecture.md §8 already says “Run terminal releases agent control” —
      add “of the run that first acquired agent”.
- [ ] **4.2** Point the original workbench plan’s DoD at this repair for the
      catalog + holder-run items (do not rewrite that whole plan).
- [ ] **4.3** Root `pnpm typecheck`.

---

## 4. Definition of Done

1. Real Host `session/prompt` no longer throws `unknown permission action`.
2. `toolFamilyIndex(createBrowserToolDefinitions(session))` is a required
   golden, not an optional thought.
3. `browser:lock` is in the catalog, evaluator, spec table, and admission loop.
4. Subagent / other-session / other-run terminals do not drop a live agent lock.
5. The run that first acquired `agent` still releases to idle (or clears
   `agentWantsLock` if the user is holding) when **that** run terminals.
6. No file ≥ 1000 lines. No remote allowlist change. No workbench UX rewrite.
7. `ask-all` copy for `browser:lock` is not “navigation”. Mock Give back / Release
   matches the controller. Panel can start before the first Pi session.
8. Manual smoke below is green.

---

## 5. Manual smoke (Desktop, after T1+T2)

1. Send a non-browser prompt (the RAG question). No `Action failed`. Reply streams.
2. Open Browser panel, click a page, type Chinese. Interact still works.
3. Prompt the agent to click something: banner + Take over. Next agent write
   shows `browser-user-has-control` on the tool card.
4. Give back while the same run is live: agent can click again.
5. While the agent holds the page, finish or cancel a **subagent** (or a second
   session turn). Banner must stay “Agent is using the browser”. Give back
   still returns to that agent.
6. Let the **holding** run finish: banner clears; panel is interactive again
   (`idle`).
7. Coding-only turn (no browser tools): panel stays interactive the whole stream.

---

## 6. Stop / do not

- Do not “fix” compose by omitting `browser_lock` or skipping `ensureBrowserSession`.
- Do not add `browser:lock` without the evaluator case.
- Do not restore unconditional `releaseAgentControl()` on every run terminal.
- Do not put `holderRunId` on `browser/controller` pushes.
- Do not add browser input/lock commands to the remote Host allowlist.
- Do not treat `state.streaming` as the lock again.
- Do not grow `host-runtime.ts` beyond the one-line `onRunTerminal` swap.
