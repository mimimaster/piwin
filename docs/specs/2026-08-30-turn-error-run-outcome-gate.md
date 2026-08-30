# Turn error: run-outcome gate + settle hole + connection classification

Date: 2026-08-30
Status: done

## Problems

1. Desktop draws a terminal-looking `TurnErrorCard` from message error evidence while the Run is still live (Pi-owned retries). Session sidebar stays “running”.
2. `settleStreamingMessages` only closes `status = 'streaming'`. Failed assistants often land as `done` + `failure` with no `outcome`/`endedAt`, so hydrate cannot rebuild a failed run record.
3. OpenAI `APIConnectionError` collapses to prose `"Connection error."` → `unknown-agent-failure` / UNKNOWN in the card; provider/baseUrl context is dropped.

## Fix order

1. **UI gate** — `resolveTurnErrorMessage` only renders when `runOutcome === 'failed'` (last assistant in turn). Live evidence without a failed Run stays off-screen.
2. **Host settle** — for a concrete `runId`, also stamp assistant rows that are `done`/`error` and still missing `outcome` (not only `streaming`). Orphan settle (no `runId`) stays streaming-only.
3. **Connection classification** — map connection / `APIConnectionError` / `ECONNREFUSED` / `ENOTFOUND` / `fetch failed` to `provider-unavailable`; enrich display message with provider (and baseUrl when present on the Pi payload); Desktop titles the code as a reachability failure, not UNKNOWN.

## Out of scope

- Forking Pi / changing ADR 0059 retry ownership
- Host-side retry classifier
- Auto-starting local CPA / `:8317`
- Collapsing historical failure cards
