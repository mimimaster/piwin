# RH0 — Pi 0.80.10 compaction payload spike

Date: 2026-07-20  
Package: `@earendil-works/pi-coding-agent@0.80.10`

## Field inventory

### `CompactionResult` (`core/compaction/compaction.d.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `summary` | `string` | Model-facing compaction summary |
| `firstKeptEntryId` | `string` | Cut point in Pi session tree |
| `tokensBefore` | `number` | Tokens before compact |
| `estimatedTokensAfter` | `number?` | Heuristic estimate after |
| `details` | `T?` | Extension-specific; ignore in product |

### `AgentSessionEvent` `compaction_end`

| Field | Type |
|-------|------|
| `reason` | `"manual" \| "threshold" \| "overflow"` |
| `result` | `CompactionResult \| undefined` |
| `aborted` | `boolean` |
| `willRetry` | `boolean` |
| `errorMessage` | `string?` |

### `AgentSession.compact()`

Returns `Promise<CompactionResult>` (throws or aborts path via events).

## Decision: **full ship** (D-HOST-04b)

Map when present:

- `summary` → event/result `summary` (+ short `message` fallback)
- `tokensBefore` → `tokensBefore`
- `estimatedTokensAfter` → `tokensAfter` (honest: estimated)
- host `durationMs` always when host timed the call
- `aborted` / `errorMessage` → `ok: false` + `message`

**Do not invent** token counts when Pi omits them.

Fixtures: `packages/agent-host/src/fixtures/compaction-end-*.json`
