# Coding Agent Stage 4 Dogfood Evidence Manifest

| Field | Value |
|---|---|
| Started (UTC) | 2026-08-15T10:30:24Z |
| Baseline commit | `cdf96f2bbbb088bbc9e0bc9749507502b461159c` |
| Baseline branch | `main` |
| Node | `v24.11.1` |
| pnpm | `9.15.0` |
| Cargo | `1.97.1` |
| Review plan | [`../../plans/2026-08-15-coding-agent-long-run-dogfood-review.md`](../../plans/2026-08-15-coding-agent-long-run-dogfood-review.md) |
| Product target | Run Interventions Stage 4 — Host-owned queued turns + Replace Run |
| Current phase | DF-11 complete; DF-00–DF-10 implemented/verified in shared dirty worktree |

## Evidence boundary

- The shared working tree already contained substantial user-owned changes before this run.
- No existing change was committed, stashed, reset, deleted, or reformatted by the dogfood run.
- Browser mock, live JSONL, SDK/RPC, and native Tauri evidence are recorded separately.
- Logs and correlation records must remain content-free and secret-free.

## Artifact index

- [`baseline.md`](./baseline.md) — starting state and pre-existing failures
- [`command-results.md`](./command-results.md) — commands, exit codes, and evidence layer
- [`bug-register.md`](./bug-register.md) — product and agent-behavior defects
- [`scorecard.md`](./scorecard.md) — coding-agent usability score
- [`native-smoke.md`](./native-smoke.md) — native Tauri observations

## Execution boundary

- Full TypeScript typecheck and workspace tests pass after the Stage 4 fixes.
- Architecture, Host mock smoke, live JSONL sidecar, Desktop production build,
  and Rust check/tests pass.
- `pnpm format:check` remains blocked by the two baseline-invalid HTML
  prototypes and broad existing drift.
- `pnpm e2e:desktop` timed out after existing shell/theme selector and snapshot
  failures; no Native Tauri long-session or real-provider claim is made.
- `git diff --check` passes. No secrets, prompt bodies, media bytes, or user
  absolute paths were added to evidence.

## Closure

The Stage 4 dogfood review is complete. The scorecard is conditional rather
than an unrestricted-readiness claim because browser E2E and native live
provider/two-client/restart observations remain outside the verified boundary.

## Correlation ledger schema

Future live entries use only identifiers and lifecycle facts:

```text
timestamp, clientId, hostInstanceId, seq, eventId,
sessionId, runId, runtimeGenerationId,
queuedTurnId, replacementId, revision, status, terminalCode
```

Prompt text, tool output bodies, credentials, media bytes, and user absolute paths are excluded.
