# Desktop Responsiveness Recovery Execution Plan

| Field | Value |
|---|---|
| Status | Core implementation landed; evidence plan remains in progress. E0 is partially classified, E1 has automated test coverage, and E2/E4/E5/E6 lack the required evidence. |
| Date | 2026-07-24 |
| Scope | Make Desktop remain controllable during slow model, tool, MCP, PTY, and filesystem work |
| Primary owners | `@piwin/contracts`, `@piwin/agent-host`, `@piwin/mcp`, `apps/cli`, `apps/desktop` |
| Related | ADR 0006, ADR 0012, ADR 0013, ADR 0014, ADR 0015; `AGENTS.md` §§1, 3.4, 3.5, 3.7 |

**Evidence status (2026-07-24):** E0 is not complete: an isolated-port rerun reproduced a narrow-viewport timeout, while the remaining historical aggregate counts have not been revalidated with retained artifacts. E1 has a deterministic render-isolation test; E2, E4, E5, and E6 remain incomplete because their required native/manual or complete-matrix evidence is absent. `pnpm automated-prerequisite-gate` is an automated prerequisite command, **not** a release-candidate declaration. A separately reviewed, dated native macOS evidence manifest remains required before calling a release candidate.

### E0 browser E2E classification matrix

This is **Vite + in-browser HostClient mock renderer coverage** only. Each
command fixes its own Vite port so a local server cannot be reused accidentally.
Entries not listed as passed are open dispositions, not completed evidence.

| Exact test | Reproducible isolated-port command | Category | Cause / observed evidence | Owner | Disposition |
|---|---|---|---|---|---|
| `shell.spec.ts` -- `loads shell with host ready and mock transport` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "loads shell with host ready and mock transport" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `opens and closes Settings panel` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "opens and closes Settings panel" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `persists the Desktop language selection and uses locale-stable controls` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "persists the Desktop language selection and uses locale-stable controls" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `opens Extensions from Settings Advanced and toggles path-guard` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "opens Extensions from Settings Advanced and toggles path-guard" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `Models settings can add a provider preset` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "Models settings can add a provider preset" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `Models settings can add Google Gemini protocol preset` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "Models settings can add Google Gemini protocol preset" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `open project → session ready for chat` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "open project → session ready for chat" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `keeps the project picker compact after opening a project` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "keeps the project picker compact after opening a project" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `mock chat: send prompt and see assistant reply` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "mock chat: send prompt and see assistant reply" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `renderer stress keeps history, input, and Stop usable during bursty streaming` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "renderer stress keeps history, input, and Stop usable during bursty streaming" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `composer plus menu selects Plan mode` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "composer plus menu selects Plan mode" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `Inspector opens Activity Terminal without a competing bottom dock` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "Inspector opens Activity Terminal without a competing bottom dock" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `workspace panel toggle remains available to collapse the panel` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "workspace panel toggle remains available to collapse the panel" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `right toolkit opens files panel; tool cards still show in transcript` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "right toolkit opens files panel; tool cards still show in transcript" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `message copy action appears after assistant reply` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "message copy action appears after assistant reply" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `Signal Terminal panel has Activity and Terminal tabs` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "Signal Terminal panel has Activity and Terminal tabs" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `stop aborts mock stream without late text growth` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "stop aborts mock stream without late text growth" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `MCP registry draft appears in configured list` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "MCP registry draft appears in configured list" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `Settings Automation panel loads` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "Settings Automation panel loads" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `Skills Store and MCP Registry tabs` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "Skills Store and MCP Registry tabs" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `renames and archives a session from the context menu` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "renames and archives a session from the context menu" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `duplicates a session from the context menu` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "duplicates a session from the context menu" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `shows capability matrix without cluttering the navigator footer` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "shows capability matrix without cluttering the navigator footer" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `lists and revokes remembered permissions in Settings` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "lists and revokes remembered permissions in Settings" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `closes Settings with Escape and dismisses session menu` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "closes Settings with Escape and dismisses session menu" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `automation panel shows host-required honesty banner` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "automation panel shows host-required honesty banner" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `open workspace auto-trusts and creates session; subagent activity card appears` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "open workspace auto-trusts and creates session; subagent activity card appears" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `composer is typeable on cold start without a workspace` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "composer is typeable on cold start without a workspace" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `shell.spec.ts` -- `composer slash menu opens and /compact runs compaction` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/shell.spec.ts --grep "composer slash menu opens and /compact runs compaction" --reporter=list` | Pending revalidation | Passed in an earlier non-isolated run; no retained isolated-port artifact. | `apps/desktop/e2e` | Rerun and retain output. |
| `viewport-responsive.spec.ts` -- `1280x840 keeps sidebar and opens inspector` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "1280x840 keeps sidebar and opens inspector" --reporter=list` | Pending revalidation | Passed in an interrupted non-isolated run; no standalone artifact. | `apps/desktop/e2e` | Rerun independently. |
| `viewport-responsive.spec.ts` -- `desktop inspector uses a Cursor-style section list` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "desktop inspector uses a Cursor-style section list" --reporter=list` | Pending revalidation | Passed in an interrupted non-isolated run; no standalone artifact. | `apps/desktop/e2e` | Rerun independently. |
| `viewport-responsive.spec.ts` -- `1024x768 keeps primary chrome reachable` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "1024x768 keeps primary chrome reachable" --reporter=list` | Pending revalidation | Passed in an interrupted non-isolated run; no standalone artifact. | `apps/desktop/e2e` | Rerun independently. |
| `viewport-responsive.spec.ts` -- `boundary matrix records sidebar/inspector/scrim/keyboard` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "boundary matrix records sidebar/inspector/scrim/keyboard" --reporter=list` | Test/fixture isolation defect | 2026-07-24 isolated rerun timed out at `right-panel-files-btn`; visible `shell-overlay-scrim` intercepted pointer events at `viewport-responsive.spec.ts:106`. | `apps/desktop/e2e` | Fix or explicitly classify overlay interaction, then rerun viewport suite. |
| `viewport-responsive.spec.ts` -- `compact has close routes for sidebar and inspector` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "compact has close routes for sidebar and inspector" --reporter=list` | Pending revalidation | Exact test exists; no retained isolated result. | `apps/desktop/e2e` | Rerun after boundary-matrix disposition. |
| `viewport-responsive.spec.ts` -- `800x700 mutual overlays stay reachable` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "800x700 mutual overlays stay reachable" --reporter=list` | Pending revalidation | Exact test exists; no retained isolated result. | `apps/desktop/e2e` | Rerun after boundary-matrix disposition. |
| `viewport-responsive.spec.ts` -- `command palette opens from keyboard` | `PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop exec playwright test e2e/viewport-responsive.spec.ts --grep "command palette opens from keyboard" --reporter=list` | Pending revalidation | Exact test exists; no retained isolated result. | `apps/desktop/e2e` | Rerun after boundary-matrix disposition. |
| `visual-regression.spec.ts` -- `empty shell @1280` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "empty shell @1280" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |
| `visual-regression.spec.ts` -- `trusted empty workspace @1280` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "trusted empty workspace @1280" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |
| `visual-regression.spec.ts` -- `streaming reply @1280` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "streaming reply @1280" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |
| `visual-regression.spec.ts` -- `settings general @1280` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "settings general @1280" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |
| `visual-regression.spec.ts` -- `narrow shell @800` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "narrow shell @800" --reporter=list` | Passed | 2026-07-24 isolated rerun passed (1/1); mock renderer coverage only. | `apps/desktop/e2e` | Retain as one E0 row; rerun full file after open cases resolve. |
| `visual-regression.spec.ts` -- `compact inspector @820` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "compact inspector @820" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |
| `visual-regression.spec.ts` -- `compact settings @820` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "compact settings @820" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |
| `visual-regression.spec.ts` -- `session menu over inspector @1023` | `PIWIN_E2E_PORT=1441 pnpm --dir apps/desktop exec playwright test e2e/visual-regression.spec.ts --grep "session menu over inspector @1023" --reporter=list` | Pending revalidation | Earlier aggregate summary lacks this exact result. | `apps/desktop/e2e` | Rerun; retain snapshot artifact. |

Do not claim E0, Slice 6, or full browser E2E complete until every row has a
retained outcome and no unexplained failure remains. Neither this matrix nor
the focused renderer-stress test is native macOS evidence.

## 1. Goal and non-goals

### Goal

Eliminate the product failure mode where a slow API request makes the macOS
Desktop window display a spinning cursor, appear dead, or prevent the user
from stopping/recovering the active run. The completed architecture must:

1. acknowledge a submitted turn quickly;
2. keep Stop, steer, permission resolution, and relevant status controls
   usable while a turn is active;
3. never wait for model completion on a synchronous native UI command path;
4. cancel timed-out work rather than merely returning a timeout error;
5. bound stream, transcript, tool-output, and PTY rendering work; and
6. surface enough phase/timing information that a slow operation is visibly
   slow, not indistinguishable from a dead application.

### Non-goals

- Do not introduce Electron, raw Pi imports in apps, or a Node PTY path.
- Do not implement the future true RPC SDK worker from ADR 0012 in this work.
  The Desktop must state its effective SDK sidecar topology honestly.
- Do not change model provider protocols, Pi upgrades, MCP exposure policy, or
  unrelated Desktop visual redesigns.
- Do not turn an API timeout into a promise that a remote provider has stopped;
  report local cancellation request and terminal confirmation separately.
- Do not lose partial assistant output or transcript durability to improve
  responsiveness.

## 2. Architecture constraints and decisions

### 2.1 Non-negotiable constraints

```text
apps/desktop -> @piwin/contracts / public @piwin APIs only
@piwin/agent-host -> normalized AgentEvent only
@piwin/mcp -> no Desktop/UI/project-trust knowledge
Tauri owns OS process / PTY work; Node host owns Pi sessions and MCP runtime
```

- Cross-boundary protocol additions start in `packages/contracts`.
- The UI must never parse Pi-native events or invoke Pi directly.
- Long operations must have a real abort path. An ignored timeout is not an
  abort path.
- MCP remains lazy: project open, session create, and session resume must not
  begin MCP transport work (ADR 0014).
- Tauri PTY remains a Desktop capability under ADR 0013; it must not be routed
  through Node JSONL for byte streaming.
- All handler work that may block on child processes, filesystem I/O, stdio,
  synchronous channels, or a mutex must be off Tauri's native command/UI path.

### 2.2 Required ADR before implementation

Add **ADR 0015: asynchronous Desktop turn transport and cancellation** before
Slice 1 lands. It must supersede only the long-operation request/response part
of ADR 0006, while retaining JSONL as the development-sidecar framing.

It must lock these decisions:

1. `session/prompt` is a quick acceptance command, not a turn-completion RPC.
2. Acceptance returns a generated `runId`; progress and terminal state arrive
   through normalized host push events carrying the same `runId`.
3. One session permits at most one foreground run. A second prompt is rejected
   with a stable `run-active` error unless it is explicitly a steer/follow-up
   operation.
4. `session/abort`, `session/compact-abort`, `session/steer`,
   `session/follow_up`, `permission/resolve`, and `extension/ui_resolve` are a
   control lane, not queued behind a foreground run.
5. Tauri command completion is never used to wait for a model turn. The Rust
   bridge accepts/enqueues a sidecar command and host pushes carry later data.
6. Cancellation is best effort across provider/MCP boundaries, but local UI
   state reaches `cancelling` immediately and only reaches `cancelled` after a
   terminal normalized event.

### 2.3 Target transport and run flow

```text
Composer submits session/prompt
  -> HostClient sends HostCommand with request id
  -> Tauri enqueues JSONL write on background bridge worker
  -> sidecar accepts turn and returns { sessionId, runId, acceptedAt }
  -> HostRuntime registers ActiveRun, starts session.prompt() in background
  -> normalized run / message / tool / permission events push to UI

Stop submits session/abort(sessionId, runId)
  -> control lane reaches HostRuntime immediately
  -> ActiveRun cancellation signal aborts MCP work and session.abort() is called
  -> host emits run/cancelling, then session/aborted or error terminal event
```

The UI must reject events that belong to an older run after the session has
accepted a newer run. Late provider/MCP results must be logged at the host
boundary but must not mutate the active transcript/UI run.

### 2.4 Contract additions (Slice 1)

Add the smallest explicit product contracts, all exported through
`packages/contracts/src/index.ts`:

```ts
type SessionRunPhase =
  | 'accepted'
  | 'preparing'
  | 'connecting-model'
  | 'waiting-first-token'
  | 'streaming'
  | 'tool-running'
  | 'waiting-permission'
  | 'cancelling';

type SessionRunAcceptedData = {
  sessionId: string;
  runId: string;
  acceptedAt: string;
};

type SessionRunEvent = {
  type: 'run/phase';
  sessionId: string;
  runId: string;
  phase: SessionRunPhase;
  at: string;
  detail?: string;
};

type SessionRunTerminalEvent = {
  type: 'run/terminal';
  sessionId: string;
  runId: string;
  outcome: 'completed' | 'cancelled' | 'failed';
  at: string;
  code?: 'cancelled' | 'model-connect-timeout' | 'model-first-token-timeout'
    | 'model-turn-timeout' | 'mcp-timeout' | 'host-shutdown';
  message?: string;
};
```

Update `AgentEvent` and relevant `HostPush` shapes so each active-run event is
correlatable. Preserve legacy `message/*`, `tool/*`, `session/aborted`, and
`error` forms during migration, then make producer/consumer mappings complete
before deleting compatibility handling. `session/abort` accepts optional
`runId`; a mismatched run id returns a stable no-op/cancelled response rather
than aborting a newer run.

## 3. Definition of done and performance budgets

The product is not done merely because TypeScript compiles. All slices must
meet these observable outcomes on a local macOS development build:

| Scenario | Acceptance threshold |
|---|---|
| Prompt submit | Ack with `runId` within 250 ms with a controlled slow host fixture |
| Stop while model/MCP is hung | Host accepts the cancel control command within 250 ms; terminal cancellation within 1 s for a cancellable fixture |
| Native responsiveness | During a 30-second fake turn, window drag/resize and a UI control round-trip remain usable; no synchronous command waits for turn completion |
| Stream render cadence | Coalesce visual text/thinking updates to no more than one commit per animation frame; lifecycle/permission/error events remain immediate |
| Transcript persistence | No per-delta full-document rewrite; writes are bounded by the configured flush cadence plus structural/terminal flushes |
| Large output | A high-rate synthetic stream and a 10 MB tool/PTY-output fixture keep browser memory and retained output bounded, preserving final/terminal events |
| Cleanup | Closing the main window leaves no sidecar, MCP child, or PTY process and flushes pending transcript data within a bounded graceful shutdown |

Set the exact default deadline values only after fixture baselines. Initial
proposal: 10 s model connect, 20 s first token, configurable overall turn
limit disabled by default, MCP existing per-operation deadlines retained but
made abort-aware. A provider's valid long generation must not be confused with
a blocked transport acknowledgement.

## 4. Vertical execution slices

Each slice is independently typechecked and tested. Keep each commit limited to
the stated concern; do not combine UI polish, dependency upgrades, Pi changes,
or unrelated refactors.

### Slice 0 — Instrument baseline and lock the transport decision

**Status:** Done (2026-07-24)

**Objective:** capture a reproducible before/after baseline and lock the
protocol decision before changing behavior.

**Owners**

- `docs/adr`, `docs/plans`
- `apps/desktop`, `apps/cli`, `packages/agent-host` test seams only

**Changes**

1. Add ADR 0015 described in §2.2.
2. Add a controllable delayed/hanging host session fixture in
   `packages/agent-host` that can independently delay acceptance, first token,
   token stream, tool call, and cancellation acknowledgement. It must not need
   a real provider or API key.
3. Add lightweight monotonic timing hooks at the transport boundaries:
   Desktop request submitted/acknowledged, sidecar received/responded,
   run phase emitted, first token, cancellation requested/terminal. Keep
   records bounded and redact prompt/model secrets.
4. Document a macOS trace recipe using Tauri/Rust timing plus browser
   Performance recording and Node CPU/filesystem observation. Record cold/warm
   session creation separately from a model turn.

**Likely files**

- `docs/adr/0015-async-desktop-turn-transport.md` (new)
- `docs/architecture.md`
- `packages/agent-host/src/mock-session.ts`
- `packages/agent-host/src/host-runtime.test.ts`
- `packages/agent-host/src/session-chat-ops.test.ts`
- `apps/desktop/src/host-client.ts`
- `apps/desktop/src/HostLogPanel.tsx` or a new focused transport-timing module
- `docs/plans/2026-07-24-desktop-responsiveness-recovery-execution-plan.md`

**Tests / evidence**

- Unit fixture proves deterministic delay/cancel behavior without wall-clock
  races.
- Existing real-host smoke remains unchanged.
- Capture and attach a short baseline trace for: 30-second no-token turn,
  high-rate stream, and 10 MB tool output.

**Exit criteria**

- ADR is accepted.
- The team can reproduce the current blocked Stop behavior before Slice 1 and
  measure it after Slice 1.

---

### Slice 1 — Contracts and host-owned foreground run lifecycle

**Status:** Core done (2026-07-24) — prompt ack + ActiveRun + abort; desktop reducer handles run events. Deadlines deferred to follow-up within Slice 1 residual / Slice 2.

**Objective:** make prompt submission quick and establish a single source of
truth for run IDs, phases, deadlines, and cancellation.

**Owners**

- `@piwin/contracts`
- `@piwin/agent-host`

**Changes**

1. Add `SessionRunAcceptedData`, run phase/terminal normalized events, stable
   terminal codes, and optional `runId` to session control commands in
   `packages/contracts`.
2. Add an `ActiveRun` record in `HostRuntime`, keyed by session id:
   `runId`, start timestamps, abort controller, first-token marker, terminal
   guard, and a promise for the background session prompt.
3. Change `session/prompt` handling to:
   - validate session/run availability and persist the user message;
   - allocate `runId` and register `ActiveRun` before starting Pi work;
   - emit `run/phase: accepted` / `preparing`;
   - start the current prompt preparation and `liveSession.prompt()` as a
     tracked background task with explicit error-to-terminal mapping;
   - return `SessionRunAcceptedData` immediately.
4. Do not detach errors: every background promise must settle exactly one
   `run/terminal` event and remove its own `ActiveRun` only if its `runId`
   remains current.
5. Change `session/abort` to find the matching active run, emit `cancelling`,
   abort its controller, settle any pending permission request for that run as
   deny/cancelled, call `SessionHandle.abort()`, and return immediately.
6. Keep `session/steer` / `follow_up` semantics explicit: they address the
   active matching run and fail with `no-active-run` / `run-mismatch` where
   appropriate. Do not accidentally create a second foreground turn.
7. Bind phase transitions to normalized source events: first assistant delta
   sets `streaming`; tool start/end sets/restores `tool-running`; permission
   request enters `waiting-permission`; completion/abort/error writes the
   terminal event once.
8. Add host-owned deadlines with injected clock/timer seams. Expiry must use
   the same cancellation path as user Stop. Implement connect and first-token
   deadline first; make overall turn limit a later configurable policy unless a
   safe existing product setting already exists.

**Likely files**

- `packages/contracts/src/host.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/ipc.test.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/commands/session-live-commands.ts`
- `packages/agent-host/src/commands/resolve-commands.ts`
- `packages/agent-host/src/sdk-adapter.ts`
- `packages/agent-host/src/product-shell-session.ts`
- `packages/agent-host/src/host-runtime.test.ts`
- `packages/agent-host/src/session-chat-ops.test.ts`
- new focused `packages/agent-host/src/active-run.test.ts`

**Tests**

1. `session/prompt` returns `runId` before a delayed fixture emits first token.
2. A duplicate foreground prompt is rejected deterministically and does not
   alter the first run.
3. Abort reaches the fixture before the prompt promise resolves; exactly one
   `run/terminal(cancelled)` and one legacy terminal UI-compatible event emit.
4. A late token, late tool result, and late prompt rejection from a cancelled
   run cannot change the next run's terminal state or transcript.
5. First-token and connect deadline tests use fake timers/injected deadline
   controller; no 10-second test sleeps.
6. Abort while a permission is pending resolves that permission and leaves the
   next prompt usable.

**Exit criteria**

- `HostRuntime` has no request path that waits for model turn completion.
- Active-run cancellation, terminal state, and correlation are covered by
  focused tests.
- CLI and Desktop consume only contract types; neither parses host internals.

---

### Slice 2 — Sidecar scheduling and cancellation-aware JSONL transport

**Status:** Core done (2026-07-24) — control/concurrent/serialized lanes + JSONL writer with drain; abort no longer behind global FIFO.

**Objective:** remove global head-of-line blocking from `piwin host serve`
while keeping deterministic serialization for real shared mutations.

**Owners**

- `apps/cli`
- `@piwin/contracts` if command classification is public

**Changes**

1. Extract host-serve scheduling from the CLI entrypoint into a focused,
   testable module, for example `apps/cli/src/host-serve-dispatcher.ts`.
2. Classify commands explicitly:
   - **run start:** `session/prompt`, now quick acceptance;
   - **control lane:** abort, compact-abort, steer, follow-up, permission
     resolve, extension UI resolve, health/ping, and bounded terminal
     authorization;
   - **serialized durable mutation:** only operations requiring process-wide
     ordering (config writes, session-index mutations, install/uninstall);
   - **query:** concurrent, bounded, and independently cancelable.
3. Retain request IDs in every response and never make control commands wait
   behind a serialized mutation unrelated to their target session.
4. Replace the blanket 45-second race around every command. Use:
   - short acknowledgement timeout for transport/process health;
   - host run deadlines from Slice 1 for model lifecycle;
   - command-specific bounded timeouts for settings/project queries;
   - no timeout path that leaves an unknown detached operation untracked.
5. Make JSONL output a single bounded writer. Respect `stdout.write()`
   backpressure and await `drain`; preserve strict stdout JSON-only behavior
   and continue redirecting diagnostics to stderr.
6. If the sidecar dies, fail pending acknowledgements immediately, mark its
   generation unavailable, and do not auto-retry an unsafe state-mutating
   command merely because an error string matched `Unhandled command`.
   Replace that string heuristic with explicit protocol/version capability
   handshake in a later small follow-up only if required by hot-reload.

**Likely files**

- `apps/cli/src/index.ts`
- `apps/cli/src/host-serve-dispatcher.ts` (new)
- `apps/cli/src/host-serve-jsonl-writer.ts` (new)
- `apps/cli/src/host-serve-dispatcher.test.ts` (new)
- `apps/desktop/src/host-client.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ipc.test.ts`

**Tests**

1. Start a delayed prompt; send abort, status, and permission resolve. Assert
   all reach `HostRuntime` before prompt completion.
2. Assert a concurrent query does not reorder two explicitly serialized config
   writes.
3. Feed malformed sidecar input/output and verify protocol responses stay
   valid JSONL.
4. Simulate a writer whose first write returns false; assert no event is lost
   or reordered after `drain`.
5. Simulate sidecar exit with pending accepted/response commands; assert each
   caller fails once, without hanging or a duplicate retry.

**Exit criteria**

- Stop/steer/follow-up are no longer FIFO-blocked behind a model turn.
- The CLI retains current interactive JSONL compatibility.
- Only deliberate mutation categories serialize; classification is unit-tested.

---

### Slice 3 — Make the Tauri host bridge and PTY commands non-blocking

**Status:** Core done (2026-07-24) — async Tauri commands, background process/
PTY work, command-class deadlines, and deterministic close cleanup landed.
Automated Rust/TypeScript verification is green; native macOS responsiveness
and child-process cleanup traces remain part of Slice 7 validation.

**Objective:** remove synchronous native waits from Desktop command execution.

**Owners**

- `apps/desktop/src-tauri`
- `apps/desktop`

**Changes**

1. Refactor `HostBridgeState` so sidecar process state and pending response
   routing can be safely shared with background tasks (for example Arc-backed
   state plus async-compatible channels). Do not hold a bridge-state lock while
   spawning, writing, waiting, killing, or reaping child processes.
2. Replace the synchronous `host_request` `recv_timeout` loop with an async
   command whose blocking channel/stdin work is placed in
   `tauri::async_runtime::spawn_blocking`, or replace it with an async channel
   implementation. The command must not await a model-turn terminal response;
   Slice 1's quick acknowledgement makes the response bounded.
3. Make `host_start` / `host_stop` asynchronous. Move path canonicalization,
   process spawn, `child.wait`, and kill/reap work off the native command path.
4. Keep the stdout reader and stderr reader on dedicated background work;
   preserve immediate pending-request failure on stdout closure.
5. Make `pty_open`, `pty_write`, `pty_resize`, `pty_close`, and `pty_close_all`
   asynchronous or dispatch their blocking portions to background work. Keep
   the authoritative `project/authorize-terminal` check, but make it a short
   control-lane host call, never a queued model-turn request.
6. Add native lifecycle ownership: on window close/app exit, request graceful
   host shutdown, close all PTYs, bound the grace period, then terminate/reap
   remaining child processes outside the UI path. Host shutdown must trigger
   `HostRuntime.dispose()` so MCP/process/transcript cleanup runs before a
   forced kill whenever possible.
7. Replace the fixed 60-second `HostClient.request()` default for all commands
   with command-class deadlines. Prompt acknowledgement is short; terminal
   state is push-driven. Preserve an explicit upper bound for ordinary
   request-response operations.

**Likely files**

- `apps/desktop/src-tauri/src/host_bridge.rs`
- `apps/desktop/src-tauri/src/pty_host.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src/host-client.ts`
- `apps/desktop/src/tauri-pty.ts`
- `apps/desktop/src/xterm-surface.tsx`
- `apps/desktop/src/terminal-dock.tsx`
- new Rust modules/tests, for example
  `apps/desktop/src-tauri/src/host_bridge_tests.rs`

**Tests / manual evidence**

1. Rust unit tests cover pending-response registration/removal, stdout-close
   failure fan-out, and deadline cleanup without spawning a real UI.
2. An integration fixture delays sidecar acknowledgement while a separate
   host/status request and control-lane command complete.
3. During a 30-second fake turn, manually verify window drag/resize, Stop, and
   a permission dialog remain responsive. Capture an Instruments trace showing
   no synchronous `host_request` wait on the main thread.
4. Start a PTY and MCP fixture, close the main window during a stream, and
   verify all child PIDs exit and transcript final flush completes.

**Exit criteria**

- No Tauri command handler synchronously waits for model completion.
- No process/I/O/reap operation blocks the native UI command path.
- Desktop owns a deterministic graceful-shutdown/reap lifecycle.

---

### Slice 4 — Propagate cancellation through MCP and permission waits

**Status:** Core done (2026-07-24) — AbortSignal now reaches MCP connect,
tools/list, tools/call, official/handcrafted transports, and host permission
promises; aborted clients are discarded and late official connections are
closed. Automated fixtures pass; live MCP child-process trace remains part of
Slice 7 validation.

**Objective:** ensure Stop interrupts the selected live dependency instead of
waiting for MCP/permission deadlines.

**Owners**

- `@piwin/mcp`
- `@piwin/agent-host`

**Changes**

1. Add an abort-aware promise helper in `@piwin/mcp` that races operation
   completion, timeout, and `AbortSignal`, cleans listeners/timers, and
   preserves the first terminal reason.
2. Thread signal support through `ensureConnected`, discovery, `tools/list`,
   `callTool`, handcrafted MCP connection, and official MCP connection.
3. On abort/timeout during connection, list, or call, detach and bounded-close
   the affected client. Do not allow the late client/result to become current.
4. Fix official-to-handcrafted fallback ownership: if official connection
   finishes after fallback starts, close the losing client. Never orphan a
   transport/process.
5. Thread the foreground run's signal from `HostRuntime` through the Pi custom
   MCP tool bridge and gateway/direct tool definitions. Preserve the existing
   lazy-MCP invariant.
6. Associate pending permission promises with `sessionId` + `runId`; abort or
   terminal timeout resolves them as denied/cancelled. Keep the current
   request-id-safe UI clearing behavior.
7. Map MCP cancellation/timeout to stable run terminal code and user-facing
   activity detail without leaking secret arguments or internal stacks.

**Likely files**

- `packages/mcp/src/mcp-lifecycle-manager.ts`
- `packages/mcp/src/mcp-client.ts`
- `packages/mcp/src/mcp-client-official.ts`
- `packages/mcp/src/mcp-transport.ts`
- `packages/mcp/src/mcp-lifecycle-manager.test.ts`
- `packages/mcp/src/mcp-client.test.ts`
- `packages/agent-host/src/mcp-gateway-tool.ts`
- `packages/agent-host/src/mcp-cached-tool-definitions.ts`
- `packages/agent-host/src/mcp-session-bridge.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/agent-host/src/commands/resolve-commands.ts`
- `packages/agent-host/src/mcp-session-bridge.test.ts`

**Tests**

1. Fixtures independently hang connect, `tools/list`, and `tools/call`; abort
   each before its deadline and assert prompt rejection/terminal cancellation,
   client disposal, no late result, and healthy retry.
2. A delayed official client that succeeds after handcrafted fallback begins is
   closed exactly once.
3. Abort while permission modal is pending resolves the promise and does not
   leave a later prompt blocked.
4. `session/create`/resume tests continue proving zero MCP transport calls.

**Exit criteria**

- A hung selected MCP operation is cancelable before its normal deadline.
- No late connection/result can mutate a cancelled or newer run.
- Existing lazy and security behavior remains intact.

---

### Slice 5 — Coalesce stream persistence and bound host event flow

**Status:** Core done (2026-07-24) — transcript documents now stay in memory
between bounded flushes, snapshots use atomic same-directory rename, and the
sidecar coalesces only contiguous stream deltas while preserving lifecycle
ordering. Automated package tests pass; high-volume native trace evidence
remains part of Slice 7 validation.

**Objective:** remove per-token whole-transcript I/O and prevent JSONL event
pressure from starving host control work.

**Owners**

- `@piwin/session`
- `@piwin/agent-host`
- `apps/cli`

**Changes**

1. Redesign `TranscriptRecorder` around an in-memory per-session document and
   dirty state. It must not call `loadSessionTranscript()` for each delta.
2. Persist structural events immediately: user prompt, message start, tool
   start/end, message end, run terminal, and explicit flush. Coalesce text,
   thinking, and tool-update deltas by message/tool ID.
3. Add an injected flush scheduler (initially 250–500 ms) with one outstanding
   write per recorder. A slow write must collapse newer dirty state into the
   next snapshot, not queue every intermediate transcript version.
4. Use an atomic snapshot write strategy in `@piwin/session` (temporary file
   plus rename in the same directory) or a documented append journal plus
   snapshot. Preserve crash recovery semantics; do not write a partial JSON
   document.
5. `flush()` must drain the latest dirty snapshot and surface a bounded error;
   `HostRuntime.dispose()` uses this for graceful shutdown.
6. Add a host-side stream batcher before JSONL serialization for only
   `message/text_delta`, `message/thinking_delta`, and `tool/update`. Batch by
   session/run/message/tool every 16–50 ms; never batch/reorder start, end,
   permission, error, phase, or terminal events.
7. Define per-event byte limits. Large tool/process outputs must be truncated
   with a visible metadata marker and persisted/retrievable through an explicit
   bounded path, not silently dropped or injected whole into the transcript.
8. Record local bounded diagnostics: events received, batches written, buffered
   bytes, flush duration, maximum queue depth, and dropped/truncated bytes.
   Never log prompt text, provider secrets, or raw credential-bearing output.

**Likely files**

- `packages/agent-host/src/transcript-recorder.ts`
- `packages/agent-host/src/transcript-recorder.test.ts`
- `packages/agent-host/src/host-runtime.ts`
- `packages/session/src/message-store.ts`
- `packages/session/src/message-store.test.ts`
- new `packages/agent-host/src/stream-event-batcher.ts`
- new `packages/agent-host/src/stream-event-batcher.test.ts`
- `apps/cli/src/host-serve-jsonl-writer.ts`
- `apps/cli/src/host-serve-dispatcher.ts`

**Tests**

1. Feed 10,000 deltas into a recorder with fake scheduler/fs seam; assert final
   text is exact and write count is bounded by flush cadence plus terminal
   writes, not by delta count.
2. Simulate slow write and forced flush; assert latest text wins, writes do not
   overlap, and valid transcript JSON survives.
3. Batch 1,000 delta events/second; reconstruct exact text/tool output at the
   receiving end, while lifecycle ordering remains unchanged.
4. Verify oversize output produces an explicit truncation marker and bounded
   retained bytes.

**Exit criteria**

- Transcript persistence work is O(number of flushes), not O(number of
  deltas), for a single streamed message.
- stdout respects backpressure and control/lifecycle events are not delayed by
  bulk stream batches.

---

### Slice 6 — Isolate desktop stream rendering and make waiting legible

**Status:** Core implementation landed; evidence is incomplete. E0 remains
open until the classification matrix above has a retained isolated outcome for
every test. E1 has a deterministic render-isolation test in
`apps/desktop/src/chat-thread.test.tsx`. E2 is **not complete**: a trace recipe
is not a dated native WebView profiler record. The automated prerequisite gate
may run browser mock coverage, but it cannot close E0 or E2 and is not native
macOS evidence.

**Latest verification:** The focused browser-mock renderer-stress scenario
exists, but its prior aggregate suite counts are not used as completion
evidence. The isolated E0 matrix contains the only classifications established
by this review. Browser-mock tests and browser E2E are never native macOS
responsiveness evidence.

**Objective:** bound WebView main-thread work while preserving rich rendering
after a message completes.

**Owners**

- `apps/desktop`
- `@piwin/contracts` for phase event consumption only

**Changes**

1. Add run ID/phase/elapsed-time state to the chat reducer. Ignore a phase,
   token, tool, terminal, or error event whose run ID is not the active run for
   the active session.
2. Update `RunStatusStrip` to show concrete phases and elapsed time:
   preparing session, connecting model, waiting for first token, generating,
   running named tool, waiting for permission, and cancelling. Keep Stop
   enabled until terminal confirmation arrives.
3. Move high-frequency stream text into a narrow stream store or scoped
   provider (`useSyncExternalStore` is acceptable) so a token does not rerender
   global app chrome, session/sidebar data, settings, panels, or inactive tabs.
4. Coalesce renderer commits at `requestAnimationFrame` or an equivalent
   bounded 30–60 fps scheduler. Control/terminal events bypass the batch.
5. Split `ChatThread` into memoized historical rows plus a separately rendered
   active streaming row. Give stable callbacks/props to prevent completed
   messages from rerendering for the next token.
6. During streaming, use an intentionally cheap presentation for the changing
   tail. Defer full Markdown block splitting, KaTeX, artifact evaluation, and
   Mermaid rendering until a bounded cadence or message end. Completed static
   blocks may render richly; streaming incomplete artifact/mermaid fences stay
   source-only.
7. Virtualize/window large historical transcripts only after message-level
   memoization and measurements prove it necessary. Maintain scroll anchoring,
   jump-to-latest, accessibility, copy/edit/retry, attachments, and artifact
   behavior.
8. Bound Activity, managed-process, fallback shell, and PTY history by
   bytes/lines. Batch xterm writes and fallback log state updates; retain
   visible truncation status.

**Likely files**

- `apps/desktop/src/chat-reducer.ts`
- `apps/desktop/src/chat-reducer.test.ts`
- `apps/desktop/src/hooks/use-host-bootstrap.ts`
- new `apps/desktop/src/stream-event-buffer.ts`
- new `apps/desktop/src/stream-event-buffer.test.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/chat-thread.tsx`
- `apps/desktop/src/MarkdownView.tsx`
- `apps/desktop/src/MermaidBlock.tsx`
- `apps/desktop/src/transcript-viewport.tsx`
- `apps/desktop/src/use-transcript-scroll.ts`
- `apps/desktop/src/run-status.ts`
- `apps/desktop/src/run-status-strip.tsx`
- `apps/desktop/src/terminal-dock.tsx`
- `apps/desktop/src/xterm-surface.tsx`
- `apps/desktop/src/hooks/use-managed-processes.ts`
- relevant desktop tests and `apps/desktop/e2e/shell.spec.ts`

**Tests / evidence**

1. Reducer tests prove stale run events cannot overwrite an active newer run.
2. Stream buffer tests reconstruct exact deltas while limiting commits to the
   configured cadence; phase/permission/terminal events bypass batching.
3. Render-count/profiler test proves an inactive historical message and closed
   right-panel content do not rerender during an active assistant delta.
4. Playwright browser-mock stress test streams 500+ history messages plus a
   bursty response while typing and clicking Stop; assert input and controls
   remain usable. This is renderer coverage only, not native responsiveness
   evidence.
5. Manual WebView Performance capture for 100 KB and 1 MB Markdown/code
   replies confirms no repeated long markdown/KaTeX/Mermaid task per token.

**Exit criteria**

- Normal streaming stays within the measured frame budget at agreed history
  size; historical UI work no longer scales with every active delta.
- The status strip tells the user what is waiting and provides a trustworthy
  Stop state.

---

### Slice 7 — End-to-end hardening, cleanup, and release gate

**Status:** Core implementation landed; evidence plan is incomplete. E3 has a
JSONL harness implementation, but E4 is **not complete** until the required
live failure matrix has retained results. E5 is **not complete** without a
dated native macOS evidence manifest. E6 is **not complete**: the automated
command is now named `pnpm automated-prerequisite-gate` to avoid implying that
automation alone produces a release candidate. A release candidate additionally
requires the separately reviewed dated native macOS evidence manifest.

**Objective:** protect the new behavior across live sidecar, macOS native
Desktop, and future packaging without claiming unsupported isolation.

**Owners**

- root scripts/docs
- `apps/desktop`, `apps/cli`, `@piwin/agent-host`, `@piwin/mcp`

**Changes**

1. Add a live JSONL host-serve integration harness. It must exercise actual
   stdin/stdout framing and command priority, unlike current browser mock e2e.
2. Add a Tauri-native manual/automated smoke lane where feasible. Browser
   Playwright remains useful for renderer behavior but must be labelled mock;
   it cannot prove Rust main-thread responsiveness.
3. Add a documented macOS acceptance checklist:
   - slow first-token provider;
   - accepted-but-no-response provider;
   - hung MCP connect/list/call;
   - pending permission then Stop;
   - high-rate stream and noisy terminal/process;
   - project open on the external APFS volume used in development;
   - close window during active stream/MCP/PTY;
   - host crash/restart recovery.
4. Gate release candidate work on `pnpm typecheck`, `pnpm test`, focused live
   host integration tests, desktop e2e, Rust tests/cargo check, and recorded
   responsiveness evidence.
5. Update architecture capability honesty: Desktop stays SDK-sidecar preview
   until a packaged host and actual isolated worker exist. Track packaged host
   distribution as a separate release blocker; do not falsely advertise a
   source-checkout `pnpm tsx` host as production-ready.
6. Add a follow-up plan/issue for packaged host executable/resource resolution
   on clean macOS. This is necessary before broad distribution but deliberately
   outside the correctness patches above.

**Likely files**

- `scripts/e2e-host-smoke.mjs` or a new focused JSONL harness
- `apps/cli/src/host-serve-dispatcher.test.ts`
- `apps/desktop/e2e/shell.spec.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `docs/architecture.md`
- `docs/todo-deferred.md`
- `README.md`
- root `package.json`

**Exit criteria**

- The complete matrix in §3 has evidence, not only unit-test claims.
- Native macOS test evidence demonstrates the app remains responsive during a
  slow turn and all owned children are cleaned up on close.
- No UI claims true RPC isolation or production packaging readiness that the
  implementation does not provide.

## 5. Risks, sequencing rules, and explicit prohibitions

| Risk | Mitigation |
|---|---|
| Background prompt errors are lost | Every `ActiveRun` owns a terminal guard and reports exactly one terminal event. No floating promise without catch/terminal mapping. |
| A late result corrupts a later run | Require `runId` match at host and UI mutation boundaries; discard/log late events. |
| Async Rust refactor introduces lock races | Extract pending-response registry tests before changing command signatures; do not hold locks across await/blocking work. |
| Transcript batching loses crash durability | Immediate structural flushes, bounded cadence, atomic snapshots, final graceful flush, and recovery tests. |
| Event batching delays important actions | Only coalesce delta/update classes; phase, start/end, permission, error, and terminal bypass. |
| MCP cancellation leaves protocol state unknown | Detach and bounded-close the selected client on abort/timeout; never reuse it. |
| Performance fixes regress rich rendering | Restrict cheap renderer to changing streaming tail; retain full Markdown/artifact/Mermaid after terminal completion. |
| Scope creep into isolation/packaging | Track worker and packaged host separately; do not conflate them with this responsiveness repair. |

Do not:

- bypass the host boundary from Desktop to "fix" latency;
- make every command fully concurrent without an explicit state/ordering model;
- silently drop token/tool output to reduce load;
- disable transcript persistence during a stream;
- use arbitrary `setTimeout` delays as synchronization in product code/tests;
- reintroduce MCP transport calls on project open/session create;
- treat a browser Vite mock test as proof that native Tauri is responsive.

## 6. Recommended implementation and commit order

1. **Slice 0:** ADR, fixture, and timing baseline.
2. **Slice 1:** contracts + `ActiveRun` + prompt acknowledgement/cancellation.
3. **Slice 2:** sidecar control lane, command classification, JSONL writer.
4. **Slice 3:** asynchronous Tauri bridge/PTY work and owned shutdown.
5. **Slice 4:** abort-aware MCP and permission propagation.
6. **Slice 5:** transcript coalescing and host stream batching.
7. **Slice 6:** renderer isolation, cheap streaming tail, bounded output UI.
8. **Slice 7:** live transport/native validation, docs, and release gate.

Slices 1–3 are the P0 recovery path and should be implemented as the first
reviewable PR series. Slice 4 must land before claiming a hung MCP operation is
cancellable. Slices 5–6 are mandatory before treating long responses and large
tool output as production-quality. Slice 7 is the evidence gate, not optional
polish.

## 7. Final verification commands

After every slice, run the narrow package checks first, then the appropriate
broader gate:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/mcp typecheck
pnpm --filter @piwin/mcp test
pnpm --filter @piwin/cli typecheck
pnpm --filter @piwin/cli test
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test
pnpm --dir apps/desktop e2e
pnpm typecheck
pnpm test
```

For Tauri-changing slices also run the project-standard Rust check from
`apps/desktop/src-tauri` and record the manual macOS responsiveness checklist
results. Do not claim the beachball defect fixed until the native slow-turn
scenario in §3 passes with captured evidence.
