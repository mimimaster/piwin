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
2. **Only billable per-request sources enter the ledger**:
   - `assistant-usage` from `usage/finalized` (stable `measurementId`;
     message_end, with agent_end filling a miss)
   - Historical `host-estimate` rows remain; new real requests do not append
     that fallback (`maybeEmitUsageOnMessageEnd` is a no-op)
   - Context occupancy lives in `session_context_state` (ADR 0067) and is
     **never summed** into the ledger
   - New rows with `measurementId` are idempotent on append; old rows without
     an id keep original semantics and are not guess-deduped
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
- Desktop does not render a per-turn metrics rail below the composer. Detailed
  usage remains available in **Settings → Usage**, while the composer keeps only
  controls needed for the current turn.
- The ledger grows append-only. No rollup/compaction policy yet; acceptable for
  a single-user product at this stage (ADR notes this as future work).
- Stock `pi --mode rpc` does not deliver usage events (existing residual); rpc
  default SDK-fallback path records usage normally.

## Future work

- Rollup compaction / monthly file rotation if the ledger grows large.
- Cache-aware cost display remains out of scope; the panel reports token counts
  only.

## Amendment: explicit scope, window-wide call summary, uncached prompt split (2026-10-15, accepted)

An audit of the live ledger against the Settings → Usage page found three
accounting defects.

1. **Scope was implicit.** Settings passed the open project into the panel, so
   the summary cards, the one-year heatmap and the recent-call log all counted
   only that project while nothing on the page said so (a one-project view read
   as "2 active days" against months of global history). The panel now starts
   across **all projects**; when a project is open, a `全部项目 / <project>`
   segmented control in the toolbar narrows every usage query together. With no
   project open the control is absent and the page is global. The heatmap note
   now names what it ignores: the *time* range, not the scope.
2. **The recent-call header mixed scopes.** It printed the window call count
   next to tokens and cache hits from the visible page only. `UsageCallLog` now
   carries an optional `windowSummary` (token totals and cached-call count over
   every call in the window); Desktop uses it for the whole header. An older
   Host without it falls back to page figures, labelled `本页` throughout.
3. **Cache-inclusive prompts from external agents.** Some backend plugins report
   OpenAI-style usage: `promptTokens` includes the cached part and
   `totalTokens = prompt + completion`. Pi's split, which the ledger assumes,
   is uncached `promptTokens` with `totalTokens = prompt + completion + cache`.
   Mixed rows inflated direct input, double-counted cache in the hit-rate
   denominator and could never be priced. `normalizeUsageTokenSplit`
   (`@piwin/contracts`) rewrites the inclusive form when it is unambiguous
   (cache present, total equals prompt + completion exactly, prompt ≥ cache);
   Pi-split rows never match. It runs at the plugin-session boundary for
   `usage/finalized`, on backend request usage, and on ledger / session-totals
   reads so rows already on disk are counted with today's split. The ledger
   file is not rewritten.
