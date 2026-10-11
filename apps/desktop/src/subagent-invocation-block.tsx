/**
 * One delegation row of the transcript subagent card (Inkstone proto-13).
 *
 * Running: two lines — title + identity/elapsed, then "what it is doing now".
 * Finished: one line. Failed keeps its error line. Attention badges
 * (代码待处理 / 冲突) take the state column. Clicking toggles the inline
 * child-session panel; the row itself never spawns or merges anything.
 *
 * `SubagentInvocationBlock` derives the pure snapshot on every parent render;
 * `SubagentRow` is memoized on that snapshot's value, so a sibling child's
 * stream delta does not repaint this row.
 */
import { memo, type ReactElement } from 'react';
import { StatusBadge } from '@piwin/ui-kit';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import {
  areSubagentRowViewsEqual,
  deriveSubagentRowView,
  type SubagentRowInput,
  type SubagentRowView,
} from './subagent-card-view';
import { SubagentElapsed, SubagentSeal, SubagentSpinner } from './subagent-card-parts';

export { resolveSubagentSealChar } from './subagent-card-view';

export type SubagentInvocationBlockProps = Omit<SubagentRowInput, 'canInspect'> & {
  /** Toggles the inline session panel anchored to this block. */
  onInspect?: (selection: SubagentInspectorSelection) => void;
};

export type SubagentRowProps = {
  view: SubagentRowView;
  onInspect?: ((selection: SubagentInspectorSelection) => void) | undefined;
  /** Legacy persisted cards keep their own test id. */
  testId?: string;
  /** Legacy persisted cards keep their transcript `state` on the DOM. */
  dataState?: string;
};

function rowPropsEqual(prev: SubagentRowProps, next: SubagentRowProps): boolean {
  return (
    prev.onInspect === next.onInspect &&
    prev.testId === next.testId &&
    prev.dataState === next.dataState &&
    areSubagentRowViewsEqual(prev.view, next.view)
  );
}

function RowMeta({ view }: { view: SubagentRowView }): ReactElement {
  return (
    <span className="subagent-row-meta">
      {view.role ? (
        <span className="subagent-row-role" data-testid="subagent-role-chip">
          {view.role}
        </span>
      ) : null}
      {view.modelLabel ? (
        <span className="subagent-row-model" data-testid="subagent-model-chip" title={view.modelTitle}>
          {view.modelLabel}
        </span>
      ) : null}
      {view.phase === 'queued' ? null : (
        <SubagentElapsed
          startedAt={view.startedAt}
          endedAt={view.endedAt}
          active={view.phase === 'running'}
          className="subagent-row-elapsed"
        />
      )}
    </span>
  );
}

function RowState({ view }: { view: SubagentRowView }): ReactElement {
  if (view.badges.length > 0) {
    return (
      <span className="subagent-row-state has-badges">
        {view.badges.map((badge) => (
          <StatusBadge
            key={badge.testId}
            tone={badge.tone}
            label={badge.label}
            testId={badge.testId}
            showDot={false}
          />
        ))}
      </span>
    );
  }
  return (
    <span className="subagent-row-state" data-testid="subagent-execution-badge">
      {view.stateLabel}
    </span>
  );
}

export const SubagentRow = memo(function SubagentRow(props: SubagentRowProps): ReactElement {
  const { view, onInspect } = props;
  const canInspect = view.canInspect && onInspect !== undefined;
  const toggle = (): void => {
    if (!canInspect || view.childSessionId === undefined) return;
    onInspect({
      childSessionId: view.childSessionId,
      displayName: view.title,
      taskSummary: view.taskSummary,
      anchorId: view.anchorId,
    });
  };
  return (
    <button
      type="button"
      className="subagent-row"
      data-testid={props.testId ?? 'subagent-invocation-block'}
      data-status={view.status}
      data-phase={view.phase}
      {...(props.dataState !== undefined ? { 'data-state': props.dataState } : {})}
      data-child-session-id={view.childSessionId}
      data-tool-call-id={view.toolCallId}
      {...(view.invocationId !== undefined ? { 'data-invocation-id': view.invocationId } : {})}
      data-activity-id={view.behaviorId}
      data-activity-animation={getBehaviorActivitySpec(view.behaviorId).animation}
      data-tool-status={
        view.phase === 'running' || view.phase === 'queued'
          ? 'running'
          : view.phase === 'failed'
            ? 'error'
            : 'done'
      }
      data-expanded={view.expanded}
      disabled={!canInspect}
      onClick={toggle}
      aria-expanded={view.expanded}
      aria-label={`${view.title}: ${view.activity}`}
    >
      <SubagentSeal glyph={view.seal} status={view.status} />
      <span className="subagent-row-main">
        <span className="subagent-row-title">{view.title}</span>
        {view.reviewLoopLabel !== undefined ? (
          <span
            className="subagent-review-loop-attach"
            data-testid="subagent-review-loop-attach"
            data-row-kind={view.reviewLoopKind}
            {...(view.reviewLoopGeneration !== undefined
              ? { 'data-candidate-generation': String(view.reviewLoopGeneration) }
              : {})}
          >
            {view.reviewLoopLabel}
          </span>
        ) : null}
        <RowMeta view={view} />
      </span>
      <RowState view={view} />
      {view.showActivity && view.activity ? (
        <span
          className="subagent-row-activity subagent-invocation-activity"
          role="status"
          aria-live="polite"
        >
          {view.phase === 'running' ? <SubagentSpinner /> : null}
          <span className="subagent-activity-text">{view.activity}</span>
        </span>
      ) : null}
    </button>
  );
}, rowPropsEqual);

export function SubagentInvocationBlock(props: SubagentInvocationBlockProps): ReactElement {
  const { onInspect, ...input } = props;
  const view = deriveSubagentRowView({ ...input, canInspect: onInspect !== undefined });
  return <SubagentRow view={view} onInspect={onInspect} />;
}
