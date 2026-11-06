# Integrating reference cost into usage statistics

Date: 2026-11-05
Status: Accepted and implemented, with Host-owned model filtering
Scope: Desktop usage presentation only; existing Host pricing remains authoritative

## Recommendation

Remove the standalone cost-breakdown section from the default usage page. Treat reference USD cost as a supporting attribute of usage instead of maintaining a second cost dashboard.

Reduce the overview from four cards to three: total tokens with reference cost, requests, and cache hit rate. Keep the compact annual heatmap and recent-call log. Do not replace the removed section with a permanently expanded or collapsed version of the same table.

## Why the current layout is still too heavy

The current presentation repeats the amount in the cost overview, single-day summary or multi-day chart, ranked breakdown and table total. A model/Key ranking primarily answers cost-attribution questions, while the page's frequent actions are reading total usage, seeing activity and checking recent requests. A large ranking and a separate cost chart dominate those common actions.

piwin's numbers are current-catalog reference estimates, not account debits. The supplied screenshot has 2,004 requests but only 834 priced requests; $9.18 represents those priced requests. Giving that amount an extensive billing-style presentation can imply more completeness and billing precision than the data provides.

## Evidence from comparable products

These are documented behaviors, not claims that all products have identical interfaces:

- Claude Code places token statistics and a locally computed list-price cost estimate in the same `/usage` Session block. Its documentation explains that the figure is an estimate and that subscription users should not read it as their bill. This supports cost as a subordinate usage metric in a coding shell.
  Source: https://code.claude.com/docs/en/costs#using-the-usage-command
- OpenCode's documented `stats` command reports token usage and cost together; per-model breakdown is hidden by default and requested with `--models`. This supports a compact default and optional attribution detail. The CLI documentation is evidence for information hierarchy, not proof of a particular graphical layout.
  Source: https://opencode.ai/docs/cli/#stats
- ccusage daily reports place tokens and USD cost in the same report. Per-model cost breakdown is enabled through `--breakdown`. This supports combining measurements in existing records instead of duplicating a full-page summary by metric.
  Source: https://ccusage.com/guide/daily-reports#model-breakdown
- Anthropic's organization usage/cost APIs serve additional accounting and attribution needs, such as reconciliation and allocation. Those needs explain why provider billing consoles have richer cost reporting; they are not sufficient justification for giving a private coding shell the same default hierarchy.
  Source: https://platform.claude.com/docs/en/manage-claude/usage-cost-api

The proposed graphical design is an inference from these patterns and piwin's own scope, not a copied industry standard.

## Proposed information layout

| Surface | Default presentation | Details |
| --- | --- | --- |
| Total usage card | Token total as the headline; reference USD amount as a secondary value | Pricing source, basis and coverage via one information action |
| Request card | Requests; sessions and active days as compact supporting values | Existing scope/time filters |
| Cache card | Prompt cache hit rate; read/write counts | Existing denominator explanation |
| Annual activity calendar | Existing Token/request modes, compact geometry | Add the day's reference amount and pricing coverage to its existing hover readout |
| Recent calls | Keep request identity and performance fields; put the reference amount beside/below the token total in the same cell | Existing cost reference and unknown state remain available |
| Model/Key cost ranking | Remove from the default page | Reintroduce only if a demonstrated attribution workflow warrants a deliberate secondary view |
| Standalone daily cost chart | Remove from the default page | Daily amounts are discoverable through the annual calendar without adding another chart |

The reference amount should remain legible as a monetary value, not shrink into an unexplained icon. Icons can label information/actions; they should not replace the amount, the estimate qualifier or an incomplete-coverage warning.

For the supplied partial-pricing example, the total usage card could read:

- Total usage: 245.2M tokens
- Priced portion: approximately $9.18
- 1,170 requests unpriced

The warning remains directly visible. Full pricing can use a shorter `reference estimate` qualifier; exact rates and calculations belong in the information view. Do not show a per-call average next to all requests without explaining that its denominator includes priced requests only.

## Heatmap and scope constraints

The calendar continues to describe the past year, independent of the toolbar range used by summary cards. Its hover amount is for that local calendar day, not the selected overview window. Do not replace annual activity colors with cost colors or add a third cost mode in this first simplification: tokens and price can diverge, and partial pricing can make expensive activity look artificially quiet.

No-call days may display zero. A day with calls and no priced entries must display unknown, not zero. A partially priced day must state that the amount covers only priced calls. Subscription/list-price estimates remain distinct from actual billed amounts.

## Feasibility in the current repository

- `usage-summary.tsx` already owns all overview cards, while `usage-cost-view.ts` normalizes unsupported, empty, complete, partial and unpriced states. Reuse that state handling when placing the amount in the total-usage card.
- `UsageBucket` already carries optional `estimatedCostUsd` and `pricedEntryCount`; the annual calendar retains each original bucket. Day-hover integration can reuse the existing yearly rollup without another request or a new Host contract.
- Recent calls already carry per-call cost and price-reference information. Combining the token/cost cell is a client presentation change, not a pricing change.
- Remove the standalone `UsageCostSection` mount and its default chart/ranking presentation. Avoid retaining unused page components solely to preserve the previous layout. Any retained diagnostic view must have a concrete user-facing entry point.
- Keep one scope and one selected time range for summaries and any on-demand aggregate information. Pricing totals continue to come from the Host, including the old-Host/unknown compatibility behavior.

## Suggested implementation order

1. Merge overview amount into total usage; preserve the visible partial-pricing warning.
2. Remove the standalone cost section and simplify the main hierarchy to summary, annual calendar and recent calls.
3. Combine recent-call token and cost fields; enrich the existing daily hover with amount/coverage.
4. Verify complete, partial, unpriced, explicitly free and unsupported states, plus scope changes and the calendar's independent year window.

The owner accepted this direction and requested filtered statistics. The implementation adds one exact-model filter composed with existing project/time controls, updates both Host read commands and CLI, and removes the standalone cost presentation. The current behavior is recorded in `docs/specs/usage-reference-cost.md`.
