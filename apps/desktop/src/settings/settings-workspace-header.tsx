/**
 * Shared header for multi-capability settings workspaces (Models, Knowledge):
 * one quiet readout line with page actions, then a single row of capability
 * tabs. Replaces the metric tiles + vertical nav column both pages used to
 * carry, so the workspace below gets the page's full width.
 *
 * Tabs are Radix triggers: render <WorkspaceTabStrip> inside a ui-kit <Tabs>.
 */

import type { ReactElement, ReactNode } from 'react';
import { StatusBadge, TabsList, TabsTrigger } from '@piwin/ui-kit';

export type WorkspaceReadout = { value: string; label: string };

export function WorkspaceSummary(props: {
  readouts: readonly WorkspaceReadout[];
  actions?: ReactNode;
  testId?: string;
}): ReactElement {
  return (
    <div className="settings-workspace-intro">
      <p className="settings-workspace-summary" data-testid={props.testId}>
        {props.readouts.map((readout) => (
          <span key={readout.label} className="settings-workspace-readout">
            <strong>{readout.value}</strong>
            {readout.label}
          </span>
        ))}
      </p>
      {props.actions ? <div className="settings-workspace-actions">{props.actions}</div> : null}
    </div>
  );
}

export function WorkspaceTabStrip(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <TabsList className="settings-workspace-tabs" label={props.label}>
      {props.children}
    </TabsList>
  );
}

/** ok = configured, warn = needs attention, off = not in use. */
export type WorkspaceTabTone = 'ok' | 'warn' | 'off';

export function WorkspaceTab(props: {
  value: string;
  icon: ReactNode;
  title: string;
  /** Tooltip: what the capability does and its current setting. */
  hint: string;
  /** A count (models) or a status dot (single-setting capabilities). */
  count?: number;
  tone?: WorkspaceTabTone;
  /** Something on this tab needs fixing; shown next to the count. */
  attention?: boolean;
  testId: string;
}): ReactElement {
  return (
    <TabsTrigger value={props.value} className="settings-workspace-tab" testId={props.testId}>
      <span className="settings-workspace-tab-inner" title={props.hint}>
        <span className="settings-workspace-tab-icon" aria-hidden="true">
          {props.icon}
        </span>
        <span className="settings-workspace-tab-title">{props.title}</span>
        {props.tone ? (
          <span className={`settings-workspace-tab-dot is-${props.tone}`} aria-hidden="true" />
        ) : props.count !== undefined && props.count > 0 ? (
          <span className="settings-workspace-tab-count">{props.count}</span>
        ) : null}
        {props.attention && props.tone === undefined ? (
          <span
            className="settings-workspace-tab-dot is-warn"
            data-testid={`${props.testId}-attention`}
            aria-hidden="true"
          />
        ) : null}
      </span>
    </TabsTrigger>
  );
}

export type WorkspaceIssueEntry = { label: string };

/**
 * Health readout for the page actions. When something needs attention it is a
 * button: the tooltip lists what, and a click jumps to the tab that fixes it.
 */
export function WorkspaceHealth(props: {
  issues: readonly WorkspaceIssueEntry[];
  readyLabel: string;
  pendingLabel: (count: number) => string;
  onOpen: () => void;
  testId: string;
}): ReactElement {
  if (props.issues.length === 0) {
    return <StatusBadge tone="success" label={props.readyLabel} testId={props.testId} />;
  }
  return (
    <button
      type="button"
      className="settings-workspace-attention"
      onClick={props.onOpen}
      title={props.issues.map((issue) => issue.label).join('\n')}
      data-testid={props.testId}
    >
      <span className="settings-workspace-tab-dot is-warn" aria-hidden="true" />
      {props.pendingLabel(props.issues.length)}
      <span className="settings-workspace-attention-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}
