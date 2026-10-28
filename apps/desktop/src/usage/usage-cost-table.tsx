/**
 * 费用构成 table: amount and share sit next to the name, merged groups expand
 * in place, and unpriced rows form their own group under the ranking.
 */
import type { ReactElement } from 'react';
import { Button, IconButton, IconChevronRight } from '@piwin/ui-kit';
import { formatUsageCompact, formatUsageExact, formatUsagePercent } from './usage-panel-statistics';
import { formatUsageUsdAverage, formatUsageUsdSummary } from './usage-cost-view';
import {
  splitUsageModelRoute,
  UNKNOWN_KEY_LABEL,
  type UsageCostBreakdown,
  type UsageCostFigures,
  type UsageCostGrouping,
  type UsageCostGroupRow,
  type UsageCostSortKey,
} from './usage-cost-breakdown';

export type UsageCostTableProps = {
  breakdown: UsageCostBreakdown;
  grouping: UsageCostGrouping;
  sort: UsageCostSortKey;
  onSort: (sort: UsageCostSortKey) => void;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Rows shown until the reader asks for the rest. */
  collapsedCount: number;
  showAll: boolean;
  onShowAll: (showAll: boolean) => void;
  unpricedOpen: boolean;
  onUnpricedOpen: (open: boolean) => void;
  isZh: boolean;
};

const UNPRICED_GROUP_ID = 'usage-cost-unpriced';

export function UsageCostTable(props: UsageCostTableProps): ReactElement {
  const { breakdown, grouping, isZh, collapsedCount, showAll } = props;
  const rows = showAll ? breakdown.priced : breakdown.priced.slice(0, collapsedCount);
  const hiddenCount = breakdown.priced.length - rows.length;
  const nameHeader = grouping === 'key' ? 'Key' : grouping === 'model' ? (isZh ? '模型' : 'Model') : isZh ? '模型 · Key' : 'Model · Key';
  const sortHeader = (key: UsageCostSortKey, label: string, align: 'start' | 'end') => (
    <th
      className={align === 'end' ? 'usage-num' : undefined}
      aria-sort={props.sort === key ? 'descending' : 'none'}
    >
      <Button
        variant="ghost"
        size="compact"
        className="usage-cost-sort"
        data-active={props.sort === key ? 'true' : undefined}
        data-testid={`usage-cost-sort-${key}`}
        onClick={() => props.onSort(key)}
      >
        {label}
      </Button>
    </th>
  );
  return (
    <div className="usage-cost-table-scroll">
      <table className="usage-cost-table" data-testid="usage-cost-table">
        <colgroup>
          <col className="usage-cost-col-name" />
          <col className="usage-cost-col-cost" />
          <col className="usage-cost-col-num" />
          <col className="usage-cost-col-num" />
          <col className="usage-cost-col-num" />
          <col className="usage-cost-col-num" />
        </colgroup>
        <thead>
          <tr>
            <th>{nameHeader}</th>
            {sortHeader('cost', isZh ? '费用 · 占比' : 'Cost · share', 'start')}
            {sortHeader('calls', isZh ? '请求' : 'Calls', 'end')}
            {sortHeader('tokens', 'Token', 'end')}
            <th className="usage-num">{isZh ? '缓存命中' : 'Cache hit'}</th>
            <th className="usage-num">{isZh ? '每次均价' : 'Per call'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = props.expanded.has(row.id);
            return [
              <tr key={row.id} className="usage-cost-row" data-testid="usage-cost-row">
                <td>
                  <div className="usage-cost-name">
                    {row.children.length > 0 ? (
                      <ExpandButton open={open} label={displayName(row.label, row.kind, isZh)} isZh={isZh} onToggle={() => props.onToggle(row.id)} />
                    ) : <span className="usage-cost-expand-spacer" />}
                    <RowName label={row.label} kind={row.kind} isZh={isZh} {...(row.reference ? { reference: row.reference } : {})} />
                    <span className="usage-cost-chip">{secondaryLabel(row, isZh)}</span>
                  </div>
                </td>
                <CostCell figures={row} isZh={isZh} />
                <FigureCells figures={row} />
              </tr>,
              ...(open ? row.children.map((child) => (
                <tr key={`${row.id}/${child.id}`} className="usage-cost-row usage-cost-child" data-testid="usage-cost-child-row">
                  <td><div className="usage-cost-name usage-cost-child-name">{displayName(child.label, row.kind === 'key' ? 'model' : 'key', isZh)}</div></td>
                  <CostCell figures={child} isZh={isZh} />
                  <FigureCells figures={child} />
                </tr>
              )) : []),
            ];
          })}
          {breakdown.priced.length > collapsedCount ? (
            <tr className="usage-cost-more">
              <td colSpan={6}>
                <Button
                  variant="ghost"
                  size="compact"
                  aria-expanded={showAll}
                  data-testid="usage-cost-show-all"
                  onClick={() => props.onShowAll(!showAll)}
                >
                  {showAll
                    ? isZh ? `收起，只看前 ${collapsedCount} 项` : `Show top ${collapsedCount} only`
                    : isZh ? `显示其余 ${formatUsageExact(hiddenCount)} 项` : `Show ${formatUsageExact(hiddenCount)} more`}
                </Button>
              </td>
            </tr>
          ) : null}
          {breakdown.unpriced.length > 0 ? (
            <UnpricedGroup {...props} />
          ) : null}
        </tbody>
        <tfoot>
          <tr className="usage-cost-total" data-testid="usage-cost-total-row">
            <td><div className="usage-cost-name"><span className="usage-cost-expand-spacer" />{isZh ? '合计（已计价）' : 'Total (priced)'}</div></td>
            <td><span className="usage-cost-amount">{formatUsageUsdSummary(breakdown.pricedTotal.costUsd)}</span></td>
            <FigureCells figures={breakdown.pricedTotal} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function UnpricedGroup({ breakdown, unpricedOpen, onUnpricedOpen, isZh }: UsageCostTableProps): ReactElement {
  const total = breakdown.unpricedTotal;
  return (
    <>
      <tr className="usage-cost-row usage-cost-unpriced" data-testid="usage-cost-unpriced-row">
        <td>
          <div className="usage-cost-name">
            <ExpandButton open={unpricedOpen} label={isZh ? '未计价' : 'Unpriced'} isZh={isZh} onToggle={() => onUnpricedOpen(!unpricedOpen)} />
            <span className="usage-cost-unpriced-label">{isZh ? '未计价' : 'Unpriced'}</span>
            <span className="usage-cost-chip">
              {isZh ? `${breakdown.unpriced.length} 项` : `${breakdown.unpriced.length} rows`}
            </span>
          </div>
        </td>
        <td className="usage-cost-muted">{isZh ? '目录中无单价，不计入合计' : 'No catalog rate; not in total'}</td>
        <td className="usage-num">{formatUsageExact(total.calls)}</td>
        <td className="usage-num" title={formatUsageExact(total.tokens)}>{formatUsageCompact(total.tokens)}</td>
        <td className="usage-num">{formatUsagePercent(total.cacheHitRate)}</td>
        <td className="usage-num">—</td>
      </tr>
      {unpricedOpen ? breakdown.unpriced.map((entry) => (
        <tr key={`${UNPRICED_GROUP_ID}/${entry.id}`} className="usage-cost-row usage-cost-child" data-testid="usage-cost-unpriced-child">
          <td>
            <div className="usage-cost-name usage-cost-child-name">
              <span className="usage-cost-label" title={entry.label}>{entry.label}</span>
              <span className="usage-cost-chip">{displayName(entry.key, 'key', isZh)}</span>
            </div>
          </td>
          <td className="usage-cost-muted">—</td>
          <td className="usage-num">{formatUsageExact(entry.calls)}</td>
          <td className="usage-num" title={formatUsageExact(entry.tokens)}>{formatUsageCompact(entry.tokens)}</td>
          <td className="usage-num">{formatUsagePercent(entry.cacheHitRate)}</td>
          <td className="usage-num">—</td>
        </tr>
      )) : null}
    </>
  );
}

function ExpandButton({ open, label, isZh, onToggle }: {
  open: boolean;
  label: string;
  isZh: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <IconButton
      size={20}
      className="usage-cost-expand"
      label={open ? (isZh ? `收起 ${label}` : `Collapse ${label}`) : isZh ? `展开 ${label}` : `Expand ${label}`}
      aria-expanded={open}
      data-open={open ? 'true' : undefined}
      onClick={onToggle}
    >
      <IconChevronRight width={12} height={12} />
    </IconButton>
  );
}

function RowName({ label, kind, reference, isZh }: {
  label: string;
  kind: 'model' | 'key';
  reference?: string;
  isZh: boolean;
}): ReactElement {
  const title = reference ? `${label} → ${isZh ? '按' : 'priced as'} ${reference}` : displayName(label, kind, isZh);
  if (kind === 'key') {
    return <span className="usage-cost-label usage-cost-label-key" title={title}>{displayName(label, kind, isZh)}</span>;
  }
  const { route, name } = splitUsageModelRoute(label);
  return (
    <span className="usage-cost-label" title={title}>
      {route ? <span className="usage-cost-route">{route}</span> : null}
      <strong>{name}</strong>
    </span>
  );
}

function CostCell({ figures, isZh }: { figures: UsageCostFigures; isZh: boolean }): ReactElement {
  const note = figures.unpricedCalls > 0
    ? isZh ? `含 ${formatUsageExact(figures.unpricedCalls)} 次未计价` : `${formatUsageExact(figures.unpricedCalls)} calls unpriced`
    : undefined;
  return (
    <td>
      <div className="usage-cost-cell" data-testid="usage-cost-row-cost">
        <span className="usage-cost-amount" title={note}>
          {formatUsageUsdSummary(figures.costUsd)}
          {note ? <span className="usage-cost-partial" aria-label={note} /> : null}
        </span>
        <span className="usage-cost-bar" aria-hidden="true">
          <span style={{ width: `${(figures.barRatio * 100).toFixed(2)}%` }} />
        </span>
        <span className="usage-cost-share">{formatShare(figures.share)}</span>
      </div>
    </td>
  );
}

function FigureCells({ figures }: { figures: UsageCostFigures }): ReactElement {
  return (
    <>
      <td className="usage-num">{formatUsageExact(figures.calls)}</td>
      <td className="usage-num" title={formatUsageExact(figures.tokens)}>{formatUsageCompact(figures.tokens)}</td>
      <td className="usage-num">{formatUsagePercent(figures.cacheHitRate)}</td>
      <td className="usage-num">{formatUsageUsdAverage(figures.perCallUsd)}</td>
    </>
  );
}

function secondaryLabel(row: UsageCostGroupRow, isZh: boolean): string {
  const { kind, values } = row.secondary;
  const [only] = values;
  if (values.length === 1 && only !== undefined) return displayName(only, kind, isZh);
  if (kind === 'key') return isZh ? `${values.length} 个 Key` : `${values.length} Keys`;
  return isZh ? `${values.length} 个模型` : `${values.length} models`;
}

function displayName(label: string, kind: 'model' | 'key', isZh: boolean): string {
  if (kind === 'key' && label === UNKNOWN_KEY_LABEL) return isZh ? '未知 Key' : 'Unknown Key';
  return label;
}

function formatShare(share: number | undefined): string {
  if (share === undefined) return '';
  if (share > 0 && share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}
