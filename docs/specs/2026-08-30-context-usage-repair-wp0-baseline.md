# WP0 baseline — context-usage repair

Date: 2026-08-30  
Worktree: `/Users/yorickjue/Developer/piwin/.worktrees/context-usage-repair`  
Branch: `feat/context-usage-repair`  
HEAD SHA (at baseline): `8253db5198b1f7efe12eb34c903d5942581a4f42`

Unrelated main-checkout dirt is not present in this worktree (including `apps/desktop/src/styles/transcript-markdown.css`).

19 temporary audit probes were already deleted and are **not** re-added here.

Target T01–T32 assertions land in later WPs, not here. This record is characterization of current occupancy behavior.

## Baseline commands

### `pnpm --filter @piwin/agent-host exec vitest run src/usage-map.test.ts src/event-map.test.ts`

- Test files: 2 passed (2)
- Tests: 51 passed (51)
- Failures: none

### `pnpm --filter @piwin/contracts exec vitest run src/usage.test.ts src/model-context-budget.test.ts`

- Test files: 2 passed (2)
- Tests: 12 passed (12)
- Failures: none

### `pnpm --filter @piwin/session exec vitest run src/usage-ledger-store.test.ts`

- Test files: 1 passed (1)
- Tests: 8 passed (8)
- Failures: none

### `pnpm --filter @piwin/desktop exec vitest run src/context-usage-ring.test.tsx src/chat-reducer.test.ts src/conversation-usage-copy.test.ts src/stream-event-buffer.test.ts`

- Test files: 4 passed (4)
- Tests: 187 passed (187)
  - `src/conversation-usage-copy.test.ts` (3)
  - `src/stream-event-buffer.test.ts` (7)
  - `src/chat-reducer.test.ts` (153)
  - `src/context-usage-ring.test.tsx` (24)
- Failures: none

### `pnpm --filter @piwin/host-runtime exec vitest run src/commands/session-live-commands.test.ts`

- Test files: 1 failed (1)
- Tests: 1 failed | 42 passed (43)
- Failing test (pre-existing; not fixed in WP0):
  - `session live control commands > completes Plan mode only after a new durable SessionPlan revision exists`
  - Assertion: `expected false to be true` at `src/commands/session-live-commands.test.ts:1142`

`packages/host-runtime/src/commands/session-chat-ops.test.ts` is not present in this worktree (renamed/merged). The Host command file actually run is `src/commands/session-live-commands.test.ts`.

## Host / session file sizes (measure only)

WP0 does not edit these files (all already under the 1000-line cap):

| File | Lines |
| --- | ---: |
| `packages/host-runtime/src/session-agent-event-router.ts` | 209 |
| `packages/host-runtime/src/host-runtime-services.ts` | 548 |
| `packages/session/src/transcript-store.ts` | 729 |

## Desktop files this WP will split

Recorded before the structural split (behavior unchanged):

| File | Lines |
| --- | ---: |
| `apps/desktop/src/chat-reducer.ts` | 4405 |
| `apps/desktop/src/chat-reducer.test.ts` | 4646 |
| `apps/desktop/src/composer-dock.tsx` | 1358 |
| `apps/desktop/src/composer-dock.test.tsx` | 1275 |
