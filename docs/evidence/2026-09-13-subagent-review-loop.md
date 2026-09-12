# Subagent reviewed-delivery loop — delivery evidence (2026-09-13)

| Field | Value |
| --- | --- |
| Branch | `codex/subagent-review-loop` |
| Base | `0e5727cd` (`feat/async-subagents@0e5727cd3a766767c08adacca6ae623229ff8ab8`) |
| Parent before V1 | `0f37a524` |
| Test commit | `24dce426` `test(subagents): cover end-to-end reviewed delivery` |
| Docs commit | this file's commit (`docs(subagents): record review loop delivery evidence`) |
| Worktree | `/Users/yorickjue/Developer/piwin-async-subagents` |
| Plan | `docs/plans/2026-09-13-model-facing-subagent-review-loop.md` |

Plan status is **Implementation complete — verification incomplete**. Manual §11 Desktop / real-model smoke did not run here. Do not mark the plan Complete from this record.

## Commands actually run

```bash
pnpm --filter @piwin/host-runtime test -- subagent-review-loop
pnpm --filter @piwin/desktop test -- subagent-review-loop-view subagent-review-summary
pnpm --filter @piwin/contracts test -- orchestration-scheme subagent-review
git diff --check
```

Results in this worktree:

| Command | Result |
| --- | --- |
| Host `subagent-review-loop` | 4 passed (`subagent-review-loop.integration.test.ts`) |
| Desktop `subagent-review-loop-view` + `subagent-review-summary` | 24 passed (17 view + 1 §9.1 fixture + 6 summary) |
| Contracts `orchestration-scheme` + `subagent-review` | 36 passed (29 + 7) |
| `git diff --check` | clean |

Did **not** run the entire monorepo `pnpm test`. Did **not** run Tauri or a real-model Desktop smoke.

## What the Host integration test proves

File: `packages/host-runtime/src/subagent-review-loop.integration.test.ts`

In-process Host pieces (orchestrator, real git worktree, freeze, result/review/verification services, start/wait/continue/apply/verify tools). Fake child runners. No second scheduler. `piwin_subagent_run` wait/merge untouched.

This harness does **not** drive `piwin_subagent_result_read` or Desktop `subagent/worktree-action`. Apply/verify go through the model tools (`piwin_subagent_result_apply` / `piwin_subagent_verification_submit`) which call `applyReviewedSubagentResult` and persist reviews on `SubagentRunStore`. It is not a production `session/prompt` turn and not a UI apply.

**§9.1** — worker candidate v1 → wait refs → reviewer A `changes-requested` (one high finding after reading two files) → continue same child → v2 with predecessor → reviewer B `approved` → apply v2 (parent `login.js` is v2, not v1) → `piwin_subagent_verification_submit` `passed`.

Asserted: one worktree path, two worker Runs / one child session, two reviewer children, two frozen results, predecessor link, one apply, one verification, no v1 write into the parent, delivered only after the passed record.

**§9.2** — approve v1, replacement `changes-requested`, authorized continue to v2. Apply v1 with the v1 approval fails with `candidate-superseded`. Apply v2 with the v1 approval fails with `stale-review`. Both fail before write. Parent file stays seed.

**§9.3** — reviewer completes with prose only. Wait is `completed` with no `reviewRef` / `reviewDecision`. Apply is `review-missing`. Parent unchanged.

**§9.6** — apply succeeds, then verification submit `failed`. Result stays `applied`, verification is `failed` (not delivered), parent file is not undone.

Desktop fixture: `apps/desktop/src/subagent-review-loop-view.fixture.test.ts` feeds the §9.1 fact set to F1. One connected loop; v1 stale / superseded; v2 head; approved / applied / verified phases stay distinct.

## Known limits

- HostRuntime `mock: true` skips `subagentResultService` / turn-change / orchestrator composition. This harness is in-process Host services + fake runners, not a mock `session/prompt` turn.
- No SDK-vs-worker duplicate suite. No timing sleeps.
- Restart, Stop races, and integration-conflict (§9.4 / §9.5 / §9.6 conflict bullet) stay on earlier unit tests; V1 does not re-run that matrix.
- Delivered is a durable verification `status === 'passed'`, not a wait observation and not an approved review.

## Not run in this worktree

- No Tauri click-through or headed Desktop smoke.
- No real-model Desktop smoke with distinct worker/reviewer models.
- No §11 disposable-repo cases (clean first pass, Stop while repairing, reload rehydrate, parent-file conflict).
- CLI transcript degradation for the review loop was not re-smoked.

## Leftover minors (SDD ledger)

- Settings reset still ultra-code-only.
- Host verify push is ref-only (Desktop hydrates from task-updated / subagentLoop).
- F2 useMemo-after-early-return.
- No review hydrate on session resume.
- `workbench-app.tsx` ~971 lines.
