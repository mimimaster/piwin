# Dirty-code cleanup plans

Advisor audit of the live worktree at `76bcd6dd` (2026-09-24).
Only these files may be created/updated by the advisor session: `plans/**`.

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Restore queued-turn leaf on starting rollback | P1 | S | — | DONE |
| 002 | Sanitize worktree refs and refuse walk-up checkouts | P1 | S | — | DONE |
| 003 | Split `desktop-locale.ts` catalogs from persistence | P2 | M | — | TODO |
| 004 | Split session product commands by index / lifecycle / derive | P2 | M | — | TODO |
| 005 | Split `host-server-support.ts` by admission concern | P2 | M | — | TODO |

Status: TODO | IN PROGRESS | DONE | BLOCKED (reason) | REJECTED (reason)

## How to run

Each plan is self-contained. Execute in priority order. 001 and 002 are independent
and can run in parallel worktrees. 003–005 are independent of each other.

Repo gates used as done criteria (from `package.json`):

```bash
pnpm --filter @piwin/session test
pnpm --filter @piwin/git test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/host-server test
pnpm --dir apps/desktop exec vitest run
pnpm --filter @piwin/session typecheck
pnpm --filter @piwin/git typecheck
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/host-server typecheck
pnpm --dir apps/desktop typecheck
```

The live worktree already has unrelated uncommitted Devin / writer-slot / settings
edits. Do not mix those into these diffs. Drift-check the in-scope paths first.

## Findings considered and rejected

- **HostRuntime 1058-line class** (`packages/host-runtime/src/host-runtime.ts`): already a
  one-line facade over `host-runtime-*.ts`. Further wrapping is API churn, not a
  responsibility split. Revisit only if a method grows real logic.
- **`packages/host-client` vs desktop `HostClient`**: not a duplicate. Package client is
  the wire protocol; desktop is the mock/live/remote multiplexer. Merging is an L/HIGH
  architecture change, not this cleanup.
- **`worker-session-runtime.ts` (~914)**: single worker dispatch concern, under the cap.
- **`primitives.css` (~1801)**: one public primitive contract; `empty-state.css` already
  extracted. Family-level CSS split is cosmetic.
- **`pi-deepseek-cache/index.ts` (~1016)**: vendored Pi extension. Do not re-chunk.
- **JSON `createTranscriptRecorder`**: `@deprecated`, tests-only. Production uses
  `createStoreTranscriptRecorder`. Leave until tests migrate.
- **Anthropic OAuth shaper duplicated** in `packages/agent-host/src/anthropic-oauth/` and
  `bundled-extensions/pi-anthropic-auth/`: real copy-paste, but the bundled copy is the
  Pi-installable extension surface. Dedup needs an explicit “host-only vs vendored”
  decision. Not this round.
- **`flashcards/study/goto` / Gemini tool-calling throws**: honest `not-implemented`
  contract refuses, not fake success.
- **Windows bash detection / writer-slot pool**: recent features, not leftover dirt.
- **Application → Pi import bans**: live tree is clean (no `apps/*` → `@earendil-works/pi-*`).

## Remaining dirt (no plan this round)

Keep on the next advisor pass. Do not expand 001–005 to cover these.

| File | Lines | Why deferred |
|------|------:|--------------|
| `apps/desktop/src/EnhancedMarkdownView.tsx` | 1662 | Two renderers + parser; L/MED, needs its own plan |
| `apps/desktop/src/host-request-adapters.ts` | 1066 | Panel switchboard; split after 003 so locale churn settles |
| `apps/desktop/src/host-client.ts` | 1074 | Transport mux; do not merge with `@piwin/host-client` here |
| `apps/desktop/src/hooks/use-active-document.ts` | 1057 | Planner already extracted; I/O branches remain |
| `apps/desktop/src/file-tree-panel.tsx` | 1045 | Preview + tree still colocated |
| `apps/desktop/src/composer-card.tsx` | 1013 | Toolbar/slash/at already extracted |
| `packages/mcp/src/mcp-lifecycle-manager.ts` | 1002 | Drain/close invariant; split risk MED |
| `packages/host-runtime/src/subscription-auth-service.ts` | 995 | Login FSM; under cap, one concern |
| `apps/desktop/e2e/shell.spec.ts` | — | Stale Automation e2e (clicks hidden nav + missing `cron-name-input`). Quick S fix: rewrite or delete the `Settings Automation panel loads` test against `automation-enabled-switch` / deep-link `agent`. Not a 1000-line problem. |

CSS over 1000 that is **generated font CSS** (`fonts-noto-serif-sc-*.css`) or already
region-split (`inkstone/tool-timeline.css`, `inkstone/sidebar.css`) is not a dump.
`apps/desktop/src/e2e/chain-showcase-fixture.ts` is test-only (cap exempt).
