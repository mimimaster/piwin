# Async subagent start/wait/cancel — review note (2026-09-13)

## Scope

- Branch: `feat/async-subagents`
- HEAD at review: `cb9b6b4a`
- Worktree: `/Users/yorickjue/Developer/piwin-async-subagents`
- Docs-only follow-up; no runtime changes in this pass

## What shipped

**Host**

- `piwin_subagent_start`, `piwin_subagent_wait`, `piwin_subagent_cancel` on the
  session tool surface; `piwin_subagent_run` unchanged as sync convenience.
- Control tools are not invocation topology nodes; scheme admission held for
  child lifetime.
- Missed-wait settlement: at most one Host-authored continuation; phase
  `waiting-subagents` with `joining-descendants` then `synthesizing-reports`.
- Parent fail/cancel/pause/replace cancels descendants and skips continuation.
- `ToolPresentation.subagentControl` for wait/cancel presentation.

**Desktop**

- Transcript: one `SubagentInvocation` card per start; wait/cancel lifecycle
  rows from `subagentControl`.
- Right panel **Tasks** tab: F1 orchestration overview (no auto-open).
- Composer **activity pill**: in-flight async subagents + live `process_start`
  jobs; popover reaches cards or Terminal job logs; Stop via
  `subagent/batch-cancel` and `job/stop` only.
- Terminal tab: zsh PTY + job-log switcher (not a second scheduler).

## Verified in unit tests (not Tauri smoke)

| Area | Tests |
|------|-------|
| Host async tools | `packages/host-runtime/src/subagent-async-tool.test.ts`, `subagent-tool-input.test.ts`, `subagent-orchestrator.test.ts` |
| Settlement / phase | `packages/host-runtime/src/subagent-parent-settlement.test.ts`, `run-registry.test.ts` |
| Presentation | `packages/agent-host/src/subagent-presentation.test.ts`, `packages/contracts/src/activity-summary.test.ts` |
| Desktop inline | `apps/desktop/src/subagent-invocation-block.test.tsx`, `subagent-control-row.test.tsx`, `subagent-orchestration-view.test.ts` |
| Tasks / waiting copy | `apps/desktop/src/SubAgentPanel.test.tsx`, `run-status.test.ts`, `run-activity-mappers.test.ts` |
| Activity pill / terminal | `apps/desktop/src/composer-activity-pill.test.tsx`, `composer-activity-model.test.ts`, `terminal-job-monitor.test.tsx` |
| Blueprint gating | `packages/host-runtime/src/blueprint-compiler.test.ts` (async tools on capable generations) |

## Not verified in this worktree

- No Tauri click-through or headed Desktop smoke.
- No live multi-subagent end-to-end run against a real model in this worktree.
- CLI transcript degradation for async control rows not re-smoked (CLI still
  ignores subagent push surfaces per ADR 0046).

## Concerns carried from implementation reviews

- B3 minors: durable running-without-active fail-closed wait; cancel
  already-terminal display maps to completed; `waitForCancel`-before-accept can
  false-reject.
- B4 minor: `session-turn-outcome` stub `terminateRun`; `inspectMerge` persists
  on missed wait.
