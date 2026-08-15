# Baseline

## Repository state

Captured at `2026-08-15T10:30:24Z` before Stage 4 implementation:

- Commit: `cdf96f2bbbb088bbc9e0bc9749507502b461159c`
- Branch: `main`
- Tracked changes: 68 entries
- Untracked entries: 27
- Tracked diffstat: 68 files, 4,437 insertions, 842 deletions

The existing changes span Run Intervention Stages 1–3 and unrelated Desktop rendering/memory work. They are user-owned baseline state. Stage 4 edits must be attributed at file/hunk level and must not erase or reformat unrelated work.

## Baseline gate results

| Gate | Result | Notes |
|---|---|---|
| `pnpm typecheck` | PASS | 30 workspace projects completed |
| `pnpm test:architecture` | PASS | Package boundaries OK |
| `pnpm format:check` | FAIL (pre-existing) | Large repository-wide drift plus two historical HTML parse errors |
| `pnpm test` | FAIL (pre-existing) | Desktop `steer-queue.test.tsx` asserts stale copy; later packages were not reached |
| `pnpm e2e:smoke` | PASS | HostRuntime mock layer |
| `pnpm e2e:host-jsonl` | PASS | Live sidecar JSONL layer, 49 assertions |

## Pre-existing format blockers

Prettier cannot parse:

1. `docs/design/agent-workspace-prototypes.html` — unexpected closing `section` near line 210.
2. `docs/ui-prototype-variants.html` — unexpected closing `span` near line 459.

Many additional files differ from repository Prettier output. This dogfood slice will only check formatting on files it intentionally changes; it will not bulk-format the repository.

## Pre-existing test blocker

`apps/desktop/src/steer-queue.test.tsx` expects `Sent in order after this response`, while the current component renders `Sent in order after this run · ⌘↵ to adjust after the current step`. The focused suite failed identically after the full-suite failure, so the baseline mismatch is stable rather than flaky.

The first sandboxed full-test attempt also hit `listen EPERM` in `packages/agent-host/src/pi-model-runtime.test.ts`. The same focused test passed 12/12 when loopback was available, and the later full run passed Agent Host 248/248. It is classified as an execution-environment denial, not a product failure.

## Safety decision

The current working tree is not used for destructive or dirty-base fault injection. Those probes require disposable Git repositories and an isolated piwin root.
