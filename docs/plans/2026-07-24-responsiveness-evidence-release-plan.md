# Responsiveness Evidence and Release-Gate Execution Plan

| Field | Value |
|---|---|
| Status | In progress -- E0 is partially classified; E1 and E3 have automated coverage; E2/E5/E6 lack required evidence; E4 is only partially evidenced. |
| Date | 2026-07-24 |
| Scope | Close remaining Slice 6 evidence gaps, execute Slice 7 live/native validation, and install truthful automated prerequisites plus a separately required native evidence artifact |
| Depends on | `docs/plans/2026-07-24-desktop-responsiveness-recovery-execution-plan.md`, ADR 0015 |
| Out of scope | Packaged host distribution, bundled Node runtime, and ADR 0012 true RPC worker isolation |

## 1. Purpose

The core responsiveness implementation is present: quick prompt acceptance,
run ownership, control-lane scheduling, asynchronous Tauri bridge work,
cancellation propagation, bounded stream persistence/output, renderer batching,
and graceful cleanup mechanics. It is not yet valid to claim the macOS
beachball issue is closed because the remaining proof is incomplete.

This plan completes only the outstanding work:

1. classify the complete browser E2E baseline;
2. prove renderer isolation with deterministic render counts;
3. exercise the real CLI JSONL sidecar rather than a direct `HostRuntime` or
   browser-only mock;
4. make shutdown/PID evidence reproducible;
5. capture native macOS responsiveness evidence; and
6. create an automated prerequisite gate that accurately distinguishes
   automated mock coverage from native Tauri evidence; native evidence remains
   a separately required artifact.

## 2. Starting facts and constraints

### 2.1 Current automated evidence

The following are passing at the start of this plan:

```text
contracts typecheck        passed
agent-host typecheck       passed
agent-host tests           40 files / 170 tests
CLI typecheck              passed
CLI tests                  3 files / 11 tests
Desktop typecheck          passed
Desktop tests              28 files / 104 tests
Tauri cargo fmt/check/test passed, 5 Rust tests
focused renderer stress    passed (Vite + browser mock)
```

The renderer stress scenario covers 500 historical messages, a burst stream,
composer input, and Stop cancellation. It does **not** exercise the native
Tauri bridge, actual CLI JSONL framing, sidecar cleanup, PTY cleanup, or macOS
main-thread behavior.

### 2.2 Non-negotiable constraints

- Do not treat browser Playwright as native Tauri evidence.
- Do not start the native evidence matrix before the live JSONL harness exists.
- Do not update visual snapshots merely to make a failing baseline green.
- Do not add virtualized transcript rendering before render-count and profiler
  evidence demonstrate that memoization/batching is insufficient.
- Keep test-only delayed/hanging host seams explicitly gated; production
  Desktop must not depend on test transport shortcuts.
- UI must continue consuming contracts/public host APIs only; it must never
  import Pi packages or spawn `piwin` directly.
- Preserve `~/.piwin` state and never log prompt text, API keys, raw headers,
  or secret-bearing tool output in diagnostics.

## 3. Completion definition

This plan is complete only when all of the following are true:

1. Every full browser E2E failure is fixed or classified with a reproducible
   cause and an explicit owner; no unexplained failures remain.
2. A deterministic render-isolation test proves inactive historical rows and
   closed right-panel content do not rerender for streaming deltas.
3. A spawned `piwin host serve` integration test proves JSONL framing,
   quick acknowledgement, control-lane priority, bounded shutdown, and strict
   stdout behavior.
4. The live failure matrix covers slow/hung model work, MCP connect/list/call,
   pending permission cancellation, and high-rate output.
5. A dated native macOS evidence manifest demonstrates UI responsiveness, no synchronous
   `host_request` wait on the native main thread, and bounded owned-child
   cleanup during window close.
6. The automated prerequisite command and docs label browser/mock and native
   evidence accurately, and require the separate dated native evidence manifest
   before a release candidate can be declared.

## 4. Dependency order

```text
E0 browser baseline classification
  ├─ E1 render-count isolation proof
  │    └─ E2 WebView performance capture
  └─ E3 live JSONL harness
       └─ E4 live failure fixtures and shutdown/PID observability
            └─ E5 native macOS matrix
                 └─ E6 release gate and docs
```

E0 and E3 may run in parallel. E2 requires E1. E4 requires E3. E5 requires
E2 and E4. E6 is last.

---

## E0 -- Classify the complete browser E2E baseline

**Objective:** establish an honest renderer/mock regression baseline before
using E2E results as Slice 6 evidence.

**Owners**

- `apps/desktop/e2e`
- owning Desktop component/test for any verified regression

**Likely files**

- `apps/desktop/e2e/shell.spec.ts`
- `apps/desktop/e2e/viewport-responsive.spec.ts`
- `apps/desktop/e2e/visual-regression.spec.ts`
- `apps/desktop/playwright.config.ts`
- only the owning component/test if a failure is a real regression
- `docs/plans/2026-07-24-desktop-responsiveness-recovery-execution-plan.md`

**Procedure**

1. Run the complete suite on an isolated port and retain Playwright artifacts.

   ```bash
   PIWIN_E2E_PORT=1440 pnpm --dir apps/desktop e2e -- --reporter=list
   ```

2. For each failure, rerun only that test on the same isolated port.
3. Assign exactly one classification:
   - product regression;
   - test/fixture isolation defect;
   - environment prerequisite or timing problem;
   - intended visual change requiring reviewed baseline update.
4. Fix product/test defects in their owning slice. Do not fold unrelated visual
   changes into responsiveness commits.
5. Record the exact suite summary and classifications in the main
   responsiveness execution plan.

**Acceptance criteria**

- No unexplained E2E failure remains.
- A snapshot update has a written visual rationale and a reviewed artifact.
- Results are labelled "Vite + in-browser mock renderer coverage".
- The E0 conclusion does not claim native responsiveness.

---

## E1 -- Add deterministic renderer-isolation evidence

**Objective:** close the Slice 6 requirement that static UI is insulated from
active streaming commits.

**Owners**

- `apps/desktop`

**Likely files**

- new `apps/desktop/src/chat-thread.test.tsx`, or a focused transcript viewport
  test if that is the narrower mount point
- `apps/desktop/src/chat-thread.tsx`
- `apps/desktop/src/right-panel.tsx`
- `apps/desktop/src/stream-event-buffer.ts`
- `apps/desktop/src/stream-event-buffer.test.ts`

**Implementation**

1. Mount a representative chat tree containing:
   - 500 completed message rows;
   - one streaming assistant row;
   - a closed right panel.
2. Use React `Profiler` or test-local render probes. Do not add production
   counters purely for testing.
3. Push multiple text deltas through the real frame-scheduler seam and flush a
   single synthetic animation frame.
4. Assert all of the following:
   - exact final streaming text is preserved;
   - the streaming row commits no more than once for that frame batch;
   - selected historical row render count does not increase;
   - closed right-panel body does not mount/rerender;
   - terminal/lifecycle events still bypass the frame queue immediately.

**Verification**

```bash
pnpm --dir apps/desktop test -- chat-thread
pnpm --dir apps/desktop test -- stream-event-buffer
pnpm --dir apps/desktop typecheck
```

**Acceptance criteria**

- The test fails if a static historical row or closed panel rerenders for a
  streaming delta.
- The test fails if multiple same-frame deltas yield multiple active-stream
  commits.
- Existing renderer stress coverage remains passing.

---

## E2 -- Capture WebView performance evidence

**Objective:** measure real WebView work after E1 proves the intended render
boundary.

**Owners**

- Desktop maintainer on macOS

**Likely files**

- `docs/plans/2026-07-24-responsiveness-trace-recipe.md`
- new dated evidence note under `docs/notes/`
- `apps/desktop/src/host-client-mock.ts` only if a deterministic 1 MB stress
  input is needed

**Procedure**

1. Run the native dev application:

   ```bash
   pnpm dev:tauri
   ```

2. Open the native WebView inspector and capture three traces:
   - 100 KB Markdown/code streaming response;
   - 1 MB Markdown/code streaming response;
   - existing `__PIWIN_RENDER_STRESS__` response plus Stop.
3. For each trace record:
   - long tasks greater than 50 ms;
   - heap at start, peak, and 10 seconds after terminal;
   - composer input and Stop behavior;
   - whether Markdown, KaTeX, Mermaid, or artifact work repeats per delta.
4. Store only trace metadata and sanitized summaries in the repository; retain
   raw profiler files outside git if they are large.

**Acceptance criteria**

- No repeated rich-render parse chain is attributable to each text delta.
- Composer stays usable during all scenarios.
- Stop receives interaction while streaming and resolves visibly.
- Any long task is either below the agreed budget or has an identified,
  non-repeating source and follow-up owner.
- Evidence note contains revision, machine/macOS version, transport mode,
  scenario size, and trace location.

---

## E3 -- Build a real host-serve JSONL integration harness

**Objective:** prove the actual spawned CLI sidecar's stdin/stdout protocol and
control-lane priority. Direct `HostRuntime` smoke and browser mocks are not
sufficient.

**Owners**

- `apps/cli`
- `packages/agent-host` fixture seam

**Likely files**

- new `scripts/e2e-host-jsonl.mjs`
- root `package.json`
- `apps/cli/src/index.ts`
- `apps/cli/src/host-serve-dispatcher.ts`
- `apps/cli/src/host-serve-jsonl-writer.ts`
- `apps/cli/src/host-serve-stream-batcher.ts`
- `packages/agent-host/src/delayed-session-fixture.ts`

**Implementation**

1. Add `pnpm e2e:host-jsonl` to spawn the same command topology used by Tauri:

   ```bash
   pnpm --filter @piwin/cli exec tsx src/index.ts host serve --mode sdk --mock
   ```

2. Make the harness own the child lifecycle with a hard cleanup `finally` path.
3. Parse stdout strictly one JSON object per line; fail on non-JSON stdout.
4. Exercise this command sequence:
   - wait for `host/status`;
   - `project/open`, `project/trust`, `session/create`;
   - delayed/hanging `session/prompt`;
   - assert acknowledgement carries `sessionId`, `runId`, `acceptedAt` within
     250 ms;
   - before terminal, send `session/abort` plus `host/status`;
   - assert both responses preserve request IDs and arrive before terminal;
   - assert exactly one terminal event for the run;
   - close stdin and assert bounded clean exit.
5. Add malformed JSON input coverage and assert exactly one valid JSON error
   response rather than a crash.

**Verification**

```bash
pnpm e2e:host-jsonl
pnpm --filter @piwin/cli test
pnpm --filter @piwin/cli typecheck
```

**Acceptance criteria**

- stdout contains JSONL only.
- Prompt ack meets the 250 ms controlled-fixture budget.
- Abort/status control responses arrive before the delayed prompt terminal.
- One run produces exactly one terminal event.
- EOF triggers dispatcher drain, stream flush, and `HostRuntime.dispose()`.
- The harness terminates the child if any assertion fails.

**Automated evidence recorded 2026-07-24**

`pnpm e2e:host-jsonl` passed with 48 assertions against an actual spawned
`piwin host serve` process. The test-only `hang-until-abort` fixture is
accepted only with `NODE_ENV=test`; it verifies prompt acknowledgement,
abort/status control responses before the one cancelled terminal event, strict
JSONL stdout, malformed-input handling, EOF shutdown, and bounded child
cleanup. A separate `high-rate-tool-output` fixture emits 10 MiB through the
normal `SessionHandle -> HostRuntime -> transcript` route and verifies that the
retained tool output has the truncation marker, remains at or below 256 KiB,
and reaches the completed lifecycle state.

---

## E4 -- Expand the live failure matrix and shutdown observability

**Objective:** exercise cancellation and cleanup through live transport, then
make native PID validation reproducible.

**Owners**

- `@piwin/mcp`
- `@piwin/agent-host`
- `apps/cli`
- `apps/desktop/src-tauri`

**Dependencies:** E3.

**Likely files**

- `packages/mcp/src/fixtures/fixture-mcp-server-official.mjs`
- new focused MCP connect-hang fixture if the existing list/call fixtures do
  not support a controlled connect hang
- `packages/mcp/src/mcp-lifecycle-manager.test.ts`
- `packages/agent-host/src/delayed-session-fixture.ts`
- `packages/agent-host/src/active-run.integration.test.ts`
- `apps/desktop/src-tauri/src/host_bridge.rs`
- `apps/desktop/src-tauri/src/pty_host.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `docs/plans/2026-07-24-responsiveness-trace-recipe.md`

**Implementation**

1. Ensure controlled fixtures independently produce:
   - accepted-but-no-response model turn;
   - slow first token;
   - MCP connect hang;
   - MCP `tools/list` hang;
   - MCP `tools/call` hang;
   - pending permission during Stop;
   - high-rate/10 MB retained-output pressure.
2. Drive each host scenario via E3's actual JSONL child-process harness.
3. For window-close evidence, add bounded, non-secret lifecycle data sufficient
   to record:
   - sidecar PID;
   - shutdown disposition (`graceful`, `abnormal`, `forced`);
   - shutdown duration;
   - known MCP child PIDs;
   - PTY identifiers/process-group leader where supported;
   - transcript flush outcome.
4. Do not expose command arguments, environment variables, prompt text, or
   credential-bearing output in this observability record.
5. Add fixture tests proving late MCP/provider results cannot mutate a newer
   run, transcript, permission modal, or tool card.

**Verification**

```bash
pnpm --filter @piwin/mcp test
pnpm --filter @piwin/agent-host test
pnpm e2e:host-jsonl
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

**Acceptance criteria**

| Fixture | Required result |
|---|---|
| accepted/no-response model | ack <=250 ms; controllable cancellation terminal <=1 s |
| slow first token | waiting phase visible; Stop works before text |
| MCP connect/list/call hang | selected client is cancelled/disposed; no late state mutation; retry healthy |
| permission then Stop | request resolves deny/cancelled; subsequent prompt is usable |
| high-rate/10 MB output | retained data has truncation marker; lifecycle/terminal preserved |
| EOF shutdown | host drain/dispose completes within bound |

**Current evidence boundary (2026-07-24)**

The spawned JSONL harness now covers accepted/no-response cancellation and
10 MiB retained-output pressure. Package-level MCP lifecycle tests cover
connect-hang and late-result isolation, while Rust unit tests cover truthful
shutdown report states and available PTY identifiers. This is not the complete
E4 matrix: live JSONL coverage for MCP list/call hangs and pending-permission
Stop remains outstanding, and native PID cleanup evidence belongs to E5.

---

## E5 -- Execute native macOS / Tauri validation matrix

**Objective:** provide the only evidence that can close the reported macOS
beachball/responsiveness defect.

**Owners**

- Desktop maintainer on macOS

**Dependencies:** E2 and E4.

**Likely files**

- `docs/plans/2026-07-24-responsiveness-trace-recipe.md`
- new dated evidence note under `docs/notes/`
- main execution plan status/evidence section

**Procedure**

1. Run preflight first:

   ```bash
   pnpm check
   pnpm --dir apps/desktop e2e
   pnpm e2e:host-jsonl
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
   ```

2. Launch native Desktop:

   ```bash
   pnpm dev:tauri
   ```

3. Capture each scenario using real Tauri, with Instruments Time Profiler for
   slow/hung model and high-rate stream cases:
   - slow first token;
   - accepted/no-response turn;
   - MCP connect/list/call hangs;
   - permission modal then Stop;
   - high-rate stream;
   - noisy/10 MB output;
   - external APFS project open;
   - close during stream + MCP + PTY;
   - host crash/restart without automatic unsafe replay.
4. For the close scenario, record PIDs then verify ownership cleanup:

   ```bash
   ps -p <pid> -o pid=,ppid=,state=,command=
   kill -0 <pid>
   ```

   `kill -0` must fail after the agreed shutdown bound for every recorded
   owned PID.

**Acceptance criteria**

- Native window drag/resize and a UI control round trip remain usable during a
  30-second controlled turn.
- Instruments shows no synchronous `host_request` wait on the native main
  thread for the model turn.
- No spinning wait cursor is observed in the controlled slow/hung scenarios.
- Stop acknowledgement meets <=250 ms; controllable fixture terminal reaches
  cancelled <=1 s.
- Native close flushes transcript data and cleans sidecar/MCP/PTY owned PIDs.
- Every result has revision, hardware/macOS version, transport mode, timings,
  screenshot/trace reference, and pass/fail determination.

**Known platform limitation to document**

PTY process-group termination is best effort. A descendant that deliberately
calls `setsid()` may escape the original Unix process group; Windows currently
guarantees direct-child kill/wait but has no portable process-tree primitive.
This limitation must remain visible in the evidence note rather than being
silently claimed away.

---

## E6 -- Install automated prerequisite gate and finalize docs

**Objective:** make future release claims reproducible and truthful without
representing automated checks as native macOS validation.

**Owners**

- root scripts/docs
- Desktop and CLI maintainers

**Dependencies:** E0-E5.

**Likely files**

- root `package.json`
- `README.md`
- `docs/architecture.md`
- `docs/todo-deferred.md`
- `docs/plans/2026-07-24-desktop-responsiveness-recovery-execution-plan.md`
- `docs/plans/2026-07-24-responsiveness-trace-recipe.md`
- dated native evidence note from E5

**Implementation**

1. Define a non-interactive automated gate:

   ```bash
   pnpm check
   pnpm e2e:desktop
   pnpm e2e:host-jsonl
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
   cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
   ```

2. Name the root script `automated-prerequisite-gate`, not
   `release-candidate`. It must run only non-interactive checks.
3. Require a separately reviewed, dated native macOS evidence manifest before
   declaring a release candidate. The manifest must include the E5 revision,
   hardware/macOS version, transport mode, each scenario result/timing, and
   sanitized trace/screenshot and PID-cleanup references.
4. Update docs to distinguish:
   - browser mock renderer coverage;
   - live JSONL sidecar coverage;
   - native macOS evidence;
   - developer-preview source-checkout sidecar topology;
   - not-yet-complete bundled host distribution and RPC worker isolation.
5. Mark Slice 6 complete only after E0-E2 evidence passes.
6. Mark Slice 7 complete only after E3-E6 evidence passes.

**Acceptance criteria**

- One documented automated prerequisite sequence executes all automated gates.
- A dated native evidence manifest is separately required, not optional prose.
- Neither the script nor the docs may label automated-only results a release
  candidate.
- No product doc implies installed-app packaging, bundled Node, or true RPC
  worker isolation before those separate projects are implemented.

---

## 5. Separate follow-up: host distribution and true isolation

The following remain deliberately outside this plan and must not block the
correctness evidence above:

1. **Packaged host distribution:** current Tauri development topology starts a
   workspace `pnpm`/`tsx` host from the source checkout. A clean installed app
   requires a separate plan for a bundled executable or Node runtime,
   resource resolution, signing/notarization, and clean-machine verification.
2. **ADR 0012 true RPC worker isolation:** SDK fallback remains compatible but
   is not process isolation. The worker strategy needs separate contracts,
   lifecycle design, and failure semantics.
3. **Follow-up turn lifecycle:** `session/follow_up` now validates run
   ownership, but a distinct foreground lifecycle is not introduced here.
   Decide in a separate ADR/plan whether it appends to an existing run or
   starts a new run with its own `runId` and terminal event.

These items must stay visibly deferred in architecture/release documentation.

## 6. Final checklist

- [ ] E0 full browser E2E classified
- [ ] E1 render-count isolation test passing
- [ ] E2 WebView profiler evidence recorded
- [ ] E3 spawned JSONL harness passing
- [ ] E4 live failure matrix and shutdown observability passing
- [ ] E5 native macOS matrix evidence recorded
- [ ] E6 release commands/docs finalized
- [ ] Slice 6 status updated only with evidence
- [ ] Slice 7 status updated only with evidence
- [ ] Separate packaged-host/RPC/follow-up lifecycle work remains explicitly deferred
