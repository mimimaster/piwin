# Usage reference cost (USD)

## Scope

Add reference USD costs to the existing Desktop usage statistics for comparing consumption of execution approaches, including auto orchestration and direct model execution. No balance query, billing system, automatic quality scoring or benchmark feature.

## Semantics

- Compute on read from the existing normalized usage ledger and the Host's current reference model catalog (models.dev snapshot, with the existing Pi bootstrap fallback). No per-request network lookup, new price service, or ledger migration.
- Historical and new records use current prices. Catalog synchronization may change estimates. Return catalog source/version/time and show the basis in the UI.
- Reuse existing catalog matching; disclose the matched catalog provider/model as the price reference. A configured Key is not necessarily the catalog provider or its actual billing price.
- Four separate categories at catalog base rates: uncached input, output, cache read, cache write; USD per million tokens. Reasoning is included in output, never charged again. This first slice does not model long-context tiers, cache TTLs, service tiers, tool charges or channel discounts. The UI explicitly calls this a base-rate reference.
- Missing prices, incomplete token breakdowns, negative/non-finite data and Host occupancy estimates are unpriced, not free. Preserve explicit zero prices in new models.dev snapshots separately from missing prices. Older snapshots cannot prove all-zero rates mean free.
- Aggregate priced cost and priced request count with existing measurement deduplication and scope/time filters. Unknown requests remain in token totals and are visible as unpriced coverage.
- Desktop shows three compact peer summaries: total tokens (including a supporting reference-cost amount), requests, and cache hit rate. There is no separate cost card, cost chart, model/Key ranking or cost subtotal section. Partial pricing remains visible beside the amount; unknown and unsupported values are never rendered as free.
- One pricing-information action in the total-usage card exposes source/date, coverage, exact amount, assumptions and model/catalog mappings. Recent calls combine tokens and reference amount in the same cell. The compact annual calendar fills the available card width, with the Token/request switch beside its title; its existing day tooltip also shows the day's estimate and unpriced count.
- Model filtering is an additive Host capability: `usage/get-rollup` and `usage/list-recent` accept an exact `modelId`, applied before aggregation, pricing and paging. `UsageRollup.availableModels` lists actual used model ids within the selected project/scope across all dates, independent of the active model/time filter. It is optional for older Hosts; Desktop disables the model selector when it is absent. CLI supports `piwin usage --model <id>` and retains its existing token-oriented output.
- Desktop combines project/global scope, date range and one model selector. Summaries use the selected date range; the heatmap remains a fixed past-year view, and recent calls remain a rolling hour. Both keep the same model/project filter. Clearing the model includes all models; changing it resets recent-call pagination. Late results from a previous model/time request cannot overwrite newer results.

- Subagent sessions continue to enter existing global/project ledger independently. No new parent/task grouping. Non-session work not already in the ledger is not claimed as included. CLI/other shells retain token output; additive Host contracts expose cost without Desktop-specific authority.

## Verification

Tests: pricing arithmetic including cache/reasoning; explicit free vs unknown; invalid/incomplete usage; historical re-estimation without ledger writes; scope/window/deduplication; coverage; recent backend detail; old Host compatibility; UI formatting/rendering. No paid API calls.

Verified in the feature worktree:

- `pnpm typecheck`: all 33 selected workspace projects pass (root command intentionally excludes mobile).
- `pnpm test:architecture`: Package boundaries OK.
- Full package tests: contracts 759; session 452; host-runtime 3,853; Desktop 5,566. The first combined command hit its 120-second harness limit; remaining suites were re-run as a managed Job and exited 0.
- After final defensive catalog guard, base-rate copy, and cost-column placement: contracts full suite and Host pricing/command plus Desktop usage focused tests re-run green; Playwright `e2e/usage-reference-cost.spec.ts` passes, including cost DOM assertions, pagination, range selection and refresh.
- Shared browser: mock usage summary / coverage / reference rows verified through DOM and delivered screenshots in both existing light and dark themes. Browser preview is deterministic mock data, not proof of a paid production API call.
- Independent read-only review found no blocking issue; final small changes were reverified locally.
- `git diff --check` passes. All touched production files are below 1,000 lines; the existing model-catalog contract is the largest at 670, and usage-panel is reduced from 597 to 360 lines.

## Integrated presentation and model-filter verification (2026-11-05)

- Full workspace `pnpm typecheck` passes; the final extracted Desktop request adapter also passes the Desktop typecheck.
- Usage UI, calendar, statistics, pricing-state and request-adapter tests pass. Coverage includes rapid model switching, old-Host compatibility, visible partial pricing and unknown daily amounts.
- Session usage tests cover filtering before cost/session/day aggregation and pagination, cross-Key totals, empty results and backend detail replacement. Host command tests verify forwarding and price projection; remote validation golden cases verify accepted/rejected model ids. CLI tests verify `--model` forwarding and missing values.
- Reference-cost browser tests pass in both light and dark modes. They select two models, verify different amounts/request totals, paginate filtered calls, clear the filter, inspect daily cost and pricing details, and check compact cards/heatmap at 960, 1280 and 1920 pixels.
- Mock screenshots were visually reviewed. Browser mock amounts use synthetic prices; Host/session tests cover the real aggregation path without paid model calls.
