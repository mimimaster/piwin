/**
 * Group card for one consecutive run of delegations (Inkstone proto-13 ①②④).
 *
 * Two or more delegations draw as a fan-out (proto-14): main node, wires,
 * rows — with no header bar; the main node itself folds the group. A folded
 * group is a single capsule: spinner while any child runs (a pine dot once
 * settled), "N 个子代理", per-phase counts, usage and wall time. A settled
 * group folds unless a result still needs the user; a click always wins.
 * A lone delegation (③) renders its row without either. The open child's
 * dense preview sits at the bottom of the card, never between rows.
 *
 * The header is memoized on scalars and each row is memoized on its snapshot
 * (subagent-invocation-block.tsx), so a child's stream delta repaints only
 * the row whose snapshot changed.
 */
import { memo, useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { IconChevronDown } from '../tool-cards/shell-icons';
import {
  resolveSubagentGroupExpanded,
  subagentGroupTitle,
  type SubagentGroupSummary,
  type SubagentLocale,
} from './subagent-card-view';
import { SubagentElapsed, SubagentSpinner } from './subagent-card-parts';
import { SubagentFanout, type SubagentFanoutNode } from './subagent-fanout';

type SubagentGroupHeaderProps = {
  title: string;
  countsLabel: string;
  usageLabel?: string | undefined;
  active: boolean;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  expanded: boolean;
  onToggle: () => void;
};

const SubagentGroupHeader = memo(function SubagentGroupHeader(
  props: SubagentGroupHeaderProps,
): ReactElement {
  return (
    <button
      type="button"
      className="subagent-group-head"
      data-testid="subagent-group-header"
      aria-expanded={props.expanded}
      onClick={props.onToggle}
    >
      {props.active ? <SubagentSpinner /> : <span className="subagent-group-dot" aria-hidden="true" />}
      <span className="subagent-group-title">{props.title}</span>
      {props.countsLabel ? (
        <span className="subagent-group-counts" data-testid="subagent-group-counts">
          {props.countsLabel}
        </span>
      ) : null}
      <span className="subagent-group-time">
        {props.usageLabel ? (
          <span className="subagent-group-usage" data-testid="subagent-group-usage">
            {props.usageLabel}
          </span>
        ) : null}
        <SubagentElapsed
          startedAt={props.startedAt}
          endedAt={props.endedAt}
          active={props.active}
          className="subagent-group-elapsed"
          testId="subagent-group-elapsed"
        />
      </span>
      <IconChevronDown className="subagent-group-chev" width={14} height={14} aria-hidden="true" />
    </button>
  );
});

export type SubagentGroupCardProps = {
  summary: SubagentGroupSummary;
  locale: SubagentLocale;
  /** A row's preview is open — keep the group open around it. */
  hasOpenRow: boolean;
  /** One node per row, in row order; drawn as a fan-out when there are ≥ 2. */
  fanout?: readonly SubagentFanoutNode[];
  /** Dense preview of the open row, below all rows. */
  preview?: ReactNode;
  children: ReactNode;
};

export function SubagentGroupCard(props: SubagentGroupCardProps): ReactElement {
  const { summary } = props;
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const expanded = resolveSubagentGroupExpanded({
    userChoice,
    summary,
    hasOpenRow: props.hasOpenRow,
  });
  const onToggle = useCallback(() => setUserChoice(!expanded), [expanded]);
  const single = summary.count <= 1;
  const title = subagentGroupTitle(summary.count, props.locale);
  const hasFanout = !single && props.fanout !== undefined && props.fanout.length > 1;
  // The fan-out's main node folds an open group; without it the capsule
  // stays as the only toggle.
  const showHeader = !single && (!expanded || !hasFanout);
  // One element shape for every count: the header slot is null for a lone
  // delegation, so a second delegation arriving never remounts the rows.
  return (
    <div
      className={single ? 'subagent-group is-single' : 'subagent-group'}
      data-testid="subagent-group"
      data-count={summary.count}
      data-active={summary.active}
      data-expanded={single || expanded}
      role="group"
      aria-label={title}
    >
      {!showHeader ? null : (
        <SubagentGroupHeader
          title={title}
          countsLabel={summary.countsLabel}
          usageLabel={summary.usageLabel}
          active={summary.active}
          startedAt={summary.startedAt}
          endedAt={summary.endedAt}
          expanded={expanded}
          onToggle={onToggle}
        />
      )}
      <div className="subagent-group-rows" hidden={!single && !expanded}>
        {hasFanout && props.fanout !== undefined ? (
          <SubagentFanout nodes={props.fanout} locale={props.locale} title={title} onCollapse={onToggle}>
            {props.children}
          </SubagentFanout>
        ) : (
          props.children
        )}
        {props.preview}
      </div>
    </div>
  );
}
