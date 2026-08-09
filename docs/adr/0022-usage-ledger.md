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
total input/output, cache read/write, per-model split, per-day trend, and
per-session breakdown. The user explicitly excluded cost estimation.

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
   `sessionProjects`, `providerId` from the active `ModelRef`, and `modelId`
   from the assistant usage message when Pi exposes it, falling back to
   `sessionModels` (the model used for the most recent prompt). A provider
   configuration owns one credential source, so `providerId` is the safe Key
   dimension; raw API keys and key fragments never enter the ledger.
   `cacheReadTokens` and `cacheWriteTokens` are carried through from Pi's
   normalized usage; host-estimate entries leave them absent rather than
   inventing cache behavior.
4. **Query command** `usage/get-rollup` returns a `UsageRollup` (totals,
   `byModel`, `byModelKey`, `byDay`, `bySession` top-N) with optional scope /
   project / window filters. Shared by Desktop panel and CLI. Prompt cache hit
   rate is defined as `cacheRead / (input + cacheRead + cacheWrite)`; output
   tokens are excluded and a zero denominator is reported as unknown.
5. **No cost estimation.** The pricing table is deliberately out of scope.

## Consequences

- Both Desktop and CLI consume the same `usage/get-rollup` command (AGENTS.md §5
  consistency).
- UI never touches FS; the ledger lives behind the host command boundary.
- Desktop surfaces the panel as a **Settings → Usage** section (`用量统计`), with
  project / global scope, time-range filter, three consolidated summaries, one
  token-composition trend, and one model × Key cache table. Separate heatmap,
  provider/model duplicate tables, and inferred performance metrics are not
  shown.
- The ledger grows append-only. No rollup/compaction policy yet; acceptable for
  a single-user product at this stage (ADR notes this as future work).
- Stock `pi --mode rpc` does not deliver usage events (existing residual); rpc
  default SDK-fallback path records usage normally.

## Future work

- Rollup compaction / monthly file rotation if the ledger grows large.
- Cache-aware cost display remains out of scope; the panel reports token counts
  only.
