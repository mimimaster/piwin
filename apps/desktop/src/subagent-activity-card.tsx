/**
 * Compact parent-transcript subagent launcher (PSR D5) for legacy sync-run
 * cards (`message.subagentActivity`), drawn as a lone Inkstone proto-13 row.
 *
 * Observation only — the row expands the inline read-only session panel in
 * place; it never spawns, merges, or navigates the workspace. Status reflects
 * the persisted transcript card (`activity.state`).
 */
import type { ReactElement } from 'react';
import type { SubagentActivityView } from '@piwin/contracts';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import { subagentCardAnchorId } from './subagent-activity-model';
import { useDesktopLocale } from './desktop-locale-context';
import { useSubagentInspectorToggle } from './subagent-inspector-context';
import { SubagentInlineSession } from './subagent-inline-session';
import { SubagentRow } from './subagent-invocation-block';
import { SubagentGroupCard } from './subagent-group-card';
import { deriveLegacySubagentRowView, deriveSubagentGroupSummary } from './subagent-card-view';

export type SubagentActivityCardProps = {
  activity: SubagentActivityView;
  /** Toggles the inline child-session panel anchored to this card. */
  onInspect?: (selection: SubagentInspectorSelection) => void;
  /** Whether the inline session panel is currently expanded below the card. */
  expanded?: boolean;
};

export function SubagentActivityCard(props: SubagentActivityCardProps): ReactElement {
  const { locale } = useDesktopLocale();
  const view = deriveLegacySubagentRowView({
    activity: props.activity,
    locale,
    canInspect: props.onInspect !== undefined,
    expanded: props.expanded === true,
  });
  return (
    <SubagentRow
      view={view}
      onInspect={props.onInspect}
      testId="subagent-activity-card"
      dataState={props.activity.state}
    />
  );
}

/**
 * Transcript slot for one persisted subagent card: the row is the accordion
 * header and the inline session panel expands directly beneath it when this
 * card's anchor owns the current inspector selection.
 */
export function SubagentActivitySlot(props: SubagentActivityCardProps): ReactElement {
  const toggle = useSubagentInspectorToggle();
  const { locale } = useDesktopLocale();
  const expanded =
    props.onInspect !== undefined &&
    toggle?.selection?.anchorId === subagentCardAnchorId(props.activity.childSessionId);
  const summary = deriveSubagentGroupSummary(
    [
      deriveLegacySubagentRowView({
        activity: props.activity,
        locale,
        canInspect: false,
        expanded,
      }),
    ],
    locale,
  );
  return (
    <SubagentGroupCard summary={summary} locale={locale} hasOpenRow={expanded}>
      <div className="subagent-embed subagent-embed-card" data-expanded={expanded}>
        <SubagentActivityCard {...props} expanded={expanded} />
        {expanded ? <SubagentInlineSession /> : null}
      </div>
    </SubagentGroupCard>
  );
}
