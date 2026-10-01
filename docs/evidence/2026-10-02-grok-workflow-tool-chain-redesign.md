# Grok Deep Search / Workflow Tool Chain Redesign

Verified on 2026-10-02 against the current workspace and `@piwin/desktop`.

## Background & Objectives

The Grok `deep-research` workflow was previously rendered as an isolated floating card beneath the transcript. This did not align with the Inkstone design language, where model interactions, tool calls, and exploration batches live directly on the vertical ink timeline (`.thread.turn-tool-sequence`).

The user requested:
1. Move the workflow directly onto the tool call chain (`turn-tool-sequence`).
2. Add a dynamic UI indicator (`BreathMatrix` from `@piwin/ui-kit`) immediately preceding the workflow name (`deep-research`). All Grok workflows reuse this animation.
3. Keep the styling simple, restrained, and consistent with the Inkstone paper/ink tokens (`--lamp`, `--pine`, `--s1`~`--s4`, `--t1`~`--t4`, `--l1`~`--l3`).
4. Provide a click-to-expand drawer displaying the workflow objective, sub-phase progress list (`✓` completed, `●` running, `○` pending), live telemetry/query logs, and an on-demand report viewer with `MarkdownView`.

## Implementation Details

1. **`apps/desktop/src/backend-workflows.tsx`**:
   - Replaced `<section className="backend-workflows">` with `<div className="thread turn-tool-sequence backend-workflows-sequence" data-testid="backend-workflows-sequence">`.
   - Placed workflow items directly onto the ink spine timeline gutter (22px padding, spine line at 8px).

2. **`apps/desktop/src/backend-workflow-card.tsx`**:
   - Implemented timeline row `.tr.backend-workflow-chain-item` with spine status dot `.node` (`run`, `done`, `fail`, `wait`).
   - Integrated `BreathMatrix` (wrapped in `.backend-workflow-matrix-wrapper`) at 16×16px with scale adjustment, supporting warm amber `--lamp` breathing glow during flight and pine green `--pine` upon completion.
   - Trigger row displays `<b>{workflow.name}</b>`, truncated objective snippet, phase progress badge (`1/4 进度` / `已完成`), duration timer, and animated chevron.
   - Expandable drawer `.backend-workflow-details` contains:
     - Full objective text
     - Phase checklist with status marks (`✓`, `run`, `pending`)
     - Telemetry queries list with timestamps
     - Report action button (`查看完整研报 ↗`) fetching `agents/workflow-report`
     - Collapsible `MarkdownView` displaying the markdown research report.

3. **`apps/desktop/src/styles/backend-workflows.css` & `styles.css`**:
   - Styled using Inkstone tokens with zero external style dependencies.
   - Spine status node positioned at `top: 14px; left: -18px;` aligned with the 28px header baseline.
   - Included in `styles.css` cascade.

## Automated Verification

- `pnpm typecheck`: passed with exit code 0 across all 32 workspace packages.
- `apps/desktop/src/backend-workflow-card.test.tsx`: 3 tests passed.
- `apps/desktop/src/backend-workflows.test.tsx`: 2 tests passed.
- `apps/desktop/src/styles/inkstone/tool-timeline.test.ts`: 5 tests passed (zero regression on timeline spine and status colors).
- Production line counts:
  - `backend-workflow-card.tsx`: 241 lines (< 400 lines)
  - `backend-workflows.tsx`: 53 lines (< 400 lines)
  - `styles/backend-workflows.css`: 406 lines (< 1000 cap)
