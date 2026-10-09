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
- Desktop integrates cost into the existing usage page instead of a separate panel: 估算费用 is the first of four peer summary cards (cents, `<$0.01`, partial/unpriced/old-Host states never shown as free); exact amount, coverage, catalog source/date, basis and reference mappings sit in a keyboard-reachable 计价说明 popover; the model × Key breakdown is a collapsed 费用明细 table; recent calls gain a right-aligned 估算费用 column after 总计. The heatmap remains token-based and is labelled as a fixed past-year window. UI decisions: `docs/plans/usage-cost-ui-design.md` (local plans folder).
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
