# ADR 0022: Token usage ledger (CE-OBS)

## Status

Accepted (2026-08-01)

## Context

The host already maps Pi `contextUsage` / assistant usage into `usage/update`
`AgentEvent`s and the desktop keeps only the latest snapshot per session
(`chat-reducer.contextUsage`). There is no aggregated or persisted token usage,
so a usage statistics panel cannot answer "how many tokens did I spend on this
project / this model / today".

Market panels (Cursor, Claude Code `ccusage`, TokenLens, etc.) commonly show:
total input/output, per-model split, per-day trend, and per-session breakdown.
The user explicitly excluded cost estimation.

## Decision

1. **Append-only JSONL ledger** at `~/.piwin/usage/ledger.jsonl`, owned by
   `@piwin/session` (`usage-ledger-store.ts`). One `UsageRecord` per billable
   turn; rollups are computed on read, so the write path is a single cheap
   append that never rewrites history.
2. **Only billable per-turn sources enter the ledger**:
   - `assistant-usage` (mapped from Pi `agent_end`)
   - `host-estimate` (the existing `maybeEmitUsageOnMessageEnd` fallback)
   - `pi-contextUsage` is cumulative context occupancy and is **never summed**
     into the ledger.
   - Dedup relies on the existing age-guard in `maybeEmitUsageOnMessageEnd`
     (skip host-estimate if a real usage was recorded within 2s).
3. **Attribution** is applied at the `HostRuntime` event boundary (not in the
   pure mapper): authoritative `sessionId`, `projectPath` from
   `sessionProjects`, and `modelId` from `sessionModels` (the model used for the
   most recent prompt).
4. **Query command** `usage/get-rollup` returns a `UsageRollup` (totals,
   `byModel`, `byDay`, `bySession` top-N) with optional scope / project /
   window filters. Shared by Desktop panel and CLI.
5. **No cost estimation.** The pricing table is deliberately out of scope.

## Consequences

- Both Desktop and CLI consume the same `usage/get-rollup` command (AGENTS.md §5
  consistency).
- UI never touches FS; the ledger lives behind the host command boundary.
- Desktop surfaces the panel as a **Settings → Usage** section (`用量统计`), with
  project / global scope, time-range filter (today / 7d / 30d / all), per-model,
  per-provider (derived from model id prefix), per-day, and per-session views.
- The ledger grows append-only. No rollup/compaction policy yet; acceptable for
  a single-user product at this stage (ADR notes this as future work).
- Stock `pi --mode rpc` does not deliver usage events (existing residual); rpc
  default SDK-fallback path records usage normally.

## Future work

- Rollup compaction / monthly file rotation if the ledger grows large.
- More precise per-turn model attribution if Pi ever exposes the model on
  `agent_end`.
