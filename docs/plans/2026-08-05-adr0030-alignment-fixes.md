# ADR 0030 Alignment Fix Plan

| Field | Value |
|---|---|
| Status | Ready for sequential implementation |
| Date | 2026-08-05 |
| Classification | Alignment fix plan (review-driven) |
| Governing design | [`runtime-refactor.md`](../specs/runtime-refactor.md), [ADR 0030](../adr/0030-safe-parallel-subagent-execution.md), [`2026-08-04-runtime-authority-completion.md`](./2026-08-04-runtime-authority-completion.md) |
| Scope | `contracts`, `host-runtime`, `agent-host`, `apps/cli` |
| Source | Code review 2026-08-05 (4-phase audit vs plan) |

## 1. Review conclusion

The Phase A–E implementation review found the security-critical boundaries
(port validation order, worker identity binding, narrow env injection,
generation registration timing) are correctly implemented. However three
functional gaps break the vertical slice:

1. **P0 — provider envelope is dropped** before `WorkerTaskRunner`, so every
   production worker-backed subagent task throws at dispatch.
2. **P1 — `customToolNames` is stale** relative to actual tool builders, so
   most composed host tools are filtered out of the model-visible manifest.
3. **P1 — trust is assumed, not resolved** (`trustResolver` is dead code), so
   the Phase A acceptance test "untrusted project cannot compile write/process
   capabilities" is unmet.

Plus lower-priority gaps (CLI response shape, two unwired lifetimes, Phase E
residuals). This plan fixes them in dependency order.

## 2. Non-negotiable invariants (unchanged from the completion plan)

1. `@piwin/host-runtime` is the only product composition root.
2. `@piwin/agent-host` remains Pi/backend-only.
3. `JobController` is the sole authority for non-interactive OS child
   processes.
4. The parent Host owns permissions, secrets, filesystem writes, process
   execution, MCP, browser, and every other side effect. Workers only request
   effects through `HostToolExecutionPort`.
5. Host tool descriptors are compiled from concrete executors, never guessed
   from tool names.
6. The parent validates `(sessionId, runtimeGenerationId, runId, toolName)` at
   the final execution boundary.

## 3. Phase F — Fix the provider envelope break (P0, blocking)

### Problem

`compileBlueprintForWorker` returns `providers: SerializableProviderRuntime[]`
(`blueprint-compiler.ts:47-50`), but:

- `PreparedSubagentTask` has no `providers` field (`subagent-orchestrator.ts:97-102`);
- `prepareSubagentTask` returns only `runtimeSnapshot`/`sessionBlueprint`/`preparedPrompt`
  (`host-runtime.ts:1741-1746`), discarding `compiled.providers`;
- `dispatchTask` builds `SubagentTaskRunInput` without `providers`
  (`subagent-orchestrator.ts:519-531`);
- `WorkerTaskRunner.runTask` throws on empty providers
  (`worker-task-runner.ts:67-76`).

Result: every production subagent task fails at dispatch. Tests are green
because the orchestrator test uses a fake runner.

### Steps

1. Add `providers: SubagentProviderEnvelope[]` to `PreparedSubagentTask`
   (`packages/host-runtime/src/subagent-orchestrator.ts`). `SubagentProviderEnvelope`
   (`contracts/src/subagent-orchestration.ts:23`) is the contracts-level mirror
   of `SerializableProviderRuntime` and is structurally compatible.
2. In `prepareSubagentTask` (`host-runtime.ts:1693-1758`), map
   `compiled.providers` to `SubagentProviderEnvelope[]` and include it in the
   returned `PreparedSubagentTask`. No secret values are serialized — the
   envelope carries `auth.kind: 'env' | 'inline' | 'none'` references only.
3. In `dispatchTask`, set `providers: prepared.providers` in `taskInput`.
4. Extend `SubagentTaskRunInput.providers` doc (`contracts`) to note the
   orchestrator always supplies the compiled envelope for provider-backed
   tasks; the runner keeps its empty-check as a fail-closed guard.
5. Add a test that runs the real path: a fake `prepareTask` returning a
   `providers` envelope, a spy task runner asserting it receives the envelope,
   and a negative test asserting `prepareTask`-without-providers fails closed.
   The existing `worker-task-runner.test.ts` already covers the runner side.

### Acceptance

- `dispatchTask` forwards the compiled provider envelope to `taskRunner.runTask`.
- A provider-backed task no longer throws the
  `providers: [] is forbidden` error.
- `subagent-orchestrator.test.ts` + `worker-task-runner.test.ts` pass with the
  new assertion.

## 4. Phase G — Align tool names and compose fs/bash (P1)

### Problem

`buildToolPolicy` (`blueprint-compiler.ts:343-396`) hardcodes `customToolNames`
that no longer match the actual tool builders composed in
`buildSessionHostTools` (`tools/build-session-host-tools.ts`). Verified name
table:

| Family | Policy names (stale) | Actual builder names | Result today |
|---|---|---|---|
| Browser | `browser_screenshot`, `browser_eval` | `browser_snapshot`, `browser_type`, `browser_fill_form` | only navigate/click survive |
| Planning | `plan_step`, `plan_create` | `piwin_plan_create`, `piwin_plan_set_step` | all filtered out |
| Notes | `notes_search`, `notes_create`, `notes_update` | `note_search`, `note_list`, `note_read`, `note_write`, `note_update` | all filtered out |
| Flashcards | `flashcards_review`, `flashcards_create` | `flashcard_create`, `flashcard_batch_create`, `flashcard_list`, `flashcard_delete` | all filtered out |
| Subagent | `subagent_run` | `piwin_subagent_run` | filtered out |
| MCP | (no entry) | `mcp_gateway` | filtered out |
| fs/bash | `bash`, `read_file`, `write_file`, `list_directory` | never composed | none exist |

`host-filesystem-tools.ts` is a 1-byte stub; `buildGatedBashToolDefinition`
and `buildGatedFileToolsDefinition` exist but have zero production callers.

### Steps

1. **Rename fix (contract-free):** update `customToolNames` in
   `buildToolPolicy` to the actual builder names from the table above
   (`blueprint-compiler.ts`). Add `mcp_gateway` when `config` enables MCP.
2. **Single source of truth:** rather than maintaining two name lists, have
   `buildToolPolicy` accept the composed tool names. Concretely: in
   `buildSessionHostToolsForSession` (`host-runtime.ts:1804`), pass
   `toolNames: tools.map(t => t.name)` through `compileBlueprintForWorker`
   into `buildToolPolicy`, and intersect `customToolNames` with those names.
   This makes the compiler derive names from actual executors (invariant 5).
3. **Compose fs/bash host tools:** implement `host-filesystem-tools.ts` —
   a `buildHostFilesystemTools(options)` returning `HostToolDefinition[]` for
   `read_file`, `write_file`, `list_directory`, and `bash`, each executing
   through the existing permission gates:
   - reuse `evaluateBashPermission`/`evaluateFileWritePermission` +
     `requestPermission` from `permission-policy.ts` / `session-tools.ts`;
   - call it in `buildSessionHostTools` when a permission gate is available;
   - delete the empty stub only after the real module exists.
   Note: `buildGatedBashToolDefinition`/`buildGatedFileToolsDefinition` are the
   Pi-native custom-tool path (SDK mode). Keep them exported but do not wire
   them into the worker manifest — the worker must use parent-owned Host tools
   via the port (invariant 4). Document this split in `host-filesystem-tools.ts`.
4. **Tests:** add a descriptor-parity test asserting the compiled blueprint's
   `hostTools` names equal the names produced by `buildSessionHostTools` for
   the same session, and that each family's expected tools appear
   (browser/planning/notes/flashcards/mcp/subagent/fs/bash).

### Acceptance

- The frozen blueprint advertises browser, planning, notes, flashcards,
  `mcp_gateway`, `piwin_subagent_run`, and fs/bash tools when their backing
  services are present.
- No tool appears in the manifest without a concrete executor.
- Descriptor-parity test passes: compiled names == composed names.

## 5. Phase H — Resolve trust from project authority (P1)

### Problem

`trustResolver` (`blueprint-compiler.ts:100`) is declared but never invoked.
Project scope always compiles `trusted: true as const` (`blueprint-compiler.ts:189`)
and the contract type only allows `trusted: true`
(`contracts/src/session-capability.ts:78`). No gate exists between
`session/create` and compilation, so untrusted projects compile write/process
capabilities. Phase A acceptance test unmet.

### Steps

1. **Widen the contract:** allow `trusted: false` in the project trust shape
   (`contracts/src/session-capability.ts`). Add an `untrusted` terminal to the
   `Trust` union or a `trusted: boolean` literal. Update implementers (the
   capability resolver, `projectBlueprintForWorker` scope projection, tests).
2. **Invoke the resolver:** in `compileBlueprintForWorker`, when scope is
   project and `options.trustResolver` is provided, `await` it and build the
   trust snapshot from the result instead of the constant.
3. **Wire the resolver in production:** in `ProductAgentHost.createSession`
   (`product-agent-host.ts:100`) and `prepareSubagentTask`
   (`host-runtime.ts:1729`), pass a `trustResolver` that reads the project
   store (`getProjectTrust`/`setProjectTrust` from `@piwin/project`).
4. **Gate capabilities on trust:** in `buildToolPolicy`, when the resolved
   trust is false, drop `filesystem-write`, `shell`, `process`, `delegate`,
   and their `customToolNames` entries (mirror the `readonly` handling).
5. **Tests:** add a golden test — an untrusted project compiles no write/
   process/`bash` tools; a trusted project keeps them. Update the Phase A
   deletion gate expectation (`rg "trusted: true" packages/host-runtime/src`
   may now legitimately match only the fixture files, or move the constant into
   a helper with an explicit allowlist entry in
   `scripts/check-package-boundaries.mjs`).

### Acceptance

- `compileBlueprintForWorker` resolves trust via the injected resolver.
- An untrusted project session cannot compile project write/process tools.
- `session-capability.ts` no longer forces `trusted: true`.

## 6. Phase I — CLI status shape + lifecycle wiring (P2)

### 6.1 CLI `subagent status` response mismatch

Host returns `{ runId, running, concurrency }` (`host-runtime.ts:922-926`);
CLI parses `{ status, results[] }` (`apps/cli/src/index.ts:2305-2315`). Either:

- (Preferred) make `subagent/batch-status` return a full projection
  `{ runId, status, results }` by adding a `getBatchProjection(runId)` to
  `SubagentOrchestrator` that reads scheduler status + `batchState.results`,
  or
- (Minimal) make the CLI render `running`/`concurrency` instead.

Choose the first — it matches the plan's "status is a projection" wording and
the CLI's existing rendering intent.

### 6.2 `session/archive` does not stop Jobs

`abortLiveSession` (`host-runtime.ts:2951`) only calls `live.abort()`. Add a
`stopProcessesForSession` call (mirroring `disposeLiveSession` at
`host-runtime.ts:2964+`) so archiving a live session stops its Jobs
(`stopBySession`).

### 6.3 `project/close` / `project/switch` stopByProject

**Resolved in ADR 0030 Unit B:** the unsupported `project` Job lifetime was
removed from the public contract (`JobLifetime` is now `run | session | host`,
`stopByProject` is gone, `project-closed` is gone). There is no real
project-close boundary in the product, so keeping a project-lifetime Job with
no automatic cleanup path was a false promise. `ownerProjectPath` remains as
attribution metadata for filtering; if a real `project/close` surface is added
later, a project-scoped cleanup can be reintroduced as an explicit command.

## 7. Phase J — Phase E residuals (P3, deferred by design)

These are documented deletions in the completion plan that remain because their
preconditions are not yet met. Do NOT force them in this pass:

1. `ActiveRunRegistry` — still the live foreground projection; coverage not yet
   moved into RunRegistry/session command tests. Needs a dedicated migration
   plan (delete `active-run.ts`, `terminalRunIdsBySession`, re-point
   `cancelAll`/`getActiveRun`/`noteAgentEvent`).
2. Process compat IPC (`process/*` commands + `ManagedProcessRecord` types) —
   Desktop and CLI still use `process/*`; delete only after they consume
   `job/*` exclusively.
3. `session/reload-runtime` full replacement transaction — only the lazy
   `planReload → detachGeneration → clearSessionToolPort` path exists;
   `after-current-run` form and the `rebuilding`/`failed` runtime states are
   unimplemented contract surface. Scope a separate plan if the full
   replacement transaction is required.
4. Stale bundles — `dist-host/host-serve.mjs` and
   `apps/desktop/src-tauri/target/debug/host/host-serve.mjs` still contain
   `createActiveRunRegistry` and a `PIWIN_RPC_STOCK` reference. Rebuild via
   `pnpm bundle:host` before claiming the Phase E gate is green.
5. `NOT_READY_SUBAGENT_ORCHESTRATION_MESSAGE` — mock-mode only, unreachable in
   production composition; leave.

## 8. Out of scope

- Full `session/reload-runtime` replacement transaction (`after-current-run`,
  `rebuilding` state machine).
- `ActiveRunRegistry` deletion and process-compat IPC removal.
- Desktop `SubAgentPanel` migration to `subagent/batch-*` and mock
  `subagent/batch-*` handlers (separate app-layer plan).
- `subagent-commands.ts` module extraction (currently inline in
  `host-runtime.ts` — structural, non-blocking).

## 9. Verification matrix

Run after each phase:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/host-runtime test -- --run src/subagent-orchestrator.test.ts src/blueprint-compiler.test.ts src/tools/session-host-tool-port.test.ts
pnpm test:architecture
```

Final:

```bash
pnpm typecheck
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/contracts test
pnpm e2e:host-jsonl
pnpm bundle:host
```

Manual smoke:

1. Start a batch with one readonly task and one worktree task; confirm both
   complete (provider envelope flows) and integration applies.
2. List a session's model-visible tools; confirm browser/planning/notes/
   flashcards/mcp/subagent appear (not just web/process/image_gen).
3. Open an untrusted project; confirm write/bash/process tools are absent from
   the compiled blueprint.
4. `piwin subagent status <runId>` renders a readable status.
5. Archive a session with a running Job; confirm the Job stops.
