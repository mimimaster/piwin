/**
 * 费用构成: one section holding the cost trend, the grouped breakdown and the
 * pricing basis. Always present when the Host prices usage; its height is
 * bounded by showing the top rows until the reader asks for the rest.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { Button, Collapse, SegmentedControl } from '@piwin/ui-kit';
import type { UsageRollup } from '@piwin/contracts';
import { IconChevronDown } from '../tool-cards/shell-icons.js';
import {
  buildUsageCostBreakdown,
  type UsageCostGrouping,
  type UsageCostSortKey,
} from './usage-cost-breakdown';
import type { UsageCostSeries } from './usage-cost-daily';
import { UsageCostNotes } from './usage-cost-notes';
import { UsageCostTable } from './usage-cost-table';
import { UsageCostTrend } from './usage-cost-trend';

/** Enough rows to cover most spend without pushing the rest of the page away. */
export const USAGE_COST_COLLAPSED_ROWS = 8;

export function UsageCostSection({ rollup, series, locale, isZh }: {
  rollup: UsageRollup;
  series: UsageCostSeries;
  locale: string;
  isZh: boolean;
}): ReactElement {
  const [grouping, setGrouping] = useState<UsageCostGrouping>('model');
  const [sort, setSort] = useState<UsageCostSortKey>('cost');
  // Money is detail, not the headline: the section opens folded so a quick
  // token check never scrolls past a trend, a table and pricing notes.
  const [collapsed, setCollapsed] = useState(true);
  const bodyId = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [unpricedOpen, setUnpricedOpen] = useState(false);
  const breakdown = useMemo(
    () => buildUsageCostBreakdown(rollup.byModelKey, grouping, sort),
    [rollup.byModelKey, grouping, sort],
  );

  const groupingOptions = [
    { value: 'model', label: isZh ? '按模型' : 'By model' },
    { value: 'key', label: isZh ? '按 Key' : 'By Key' },
    { value: 'model-key', label: isZh ? '模型 × Key' : 'Model × Key' },
  ];

  return (
    <section
      className="usage-card usage-cost-section"
      data-testid="usage-cost-section"
      data-collapsed={collapsed ? 'true' : undefined}
      aria-label={isZh ? '费用构成' : 'Cost breakdown'}
    >
      <header className="usage-cost-section-header">
        <div className="usage-cost-section-title">
          <h3>{isZh ? '费用构成' : 'Cost breakdown'}</h3>
          <span>{isZh ? 'USD · 模型参考价估算，非实际扣费' : 'USD · reference-rate estimate, not a charge'}</span>
        </div>
        <div className="usage-cost-section-actions">
          {collapsed ? null : (
            <SegmentedControl
              size="xs"
              className="usage-cost-grouping"
              testId="usage-cost-grouping"
              data={groupingOptions}
              value={grouping}
              onChange={(value) => {
                setGrouping(value as UsageCostGrouping);
                // Group ids differ per grouping; old open rows would never match.
                setExpanded(new Set());
              }}
            />
          )}
          <Button
            variant="ghost"
            size="compact"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => setCollapsed((value) => !value)}
            data-testid="usage-cost-toggle"
          >
            {collapsed ? (isZh ? '展开' : 'Show') : isZh ? '收起' : 'Hide'}
            <IconChevronDown
              className={`settings-collapsible-chevron${collapsed ? '' : ' open'}`}
              width={14}
              height={14}
            />
          </Button>
        </div>
      </header>
      <Collapse expanded={!collapsed} testId="usage-cost-body">
        <div id={bodyId} className="usage-cost-section-body">
          <UsageCostTrend series={series} locale={locale} isZh={isZh} />
          <UsageCostTable
            breakdown={breakdown}
            grouping={grouping}
            sort={sort}
            onSort={setSort}
            expanded={expanded}
            onToggle={(id) => setExpanded((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            collapsedCount={USAGE_COST_COLLAPSED_ROWS}
            showAll={showAll}
            onShowAll={setShowAll}
            unpricedOpen={unpricedOpen}
            onUnpricedOpen={setUnpricedOpen}
            isZh={isZh}
          />
          <UsageCostNotes rollup={rollup} isZh={isZh} />
        </div>
      </Collapse>
    </section>
  );
}
