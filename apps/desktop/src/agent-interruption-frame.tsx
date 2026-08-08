import type { ReactElement, ReactNode } from 'react';
import { StatusBadge, Surface } from '@piwin/ui-kit';
import type { BehaviorActivityAnimation, BehaviorActivityId } from './behavior-activity.js';

export type AgentInterruptionTone = 'question' | 'warning' | 'danger';

export type AgentInterruptionFrameProps = {
  tone: AgentInterruptionTone;
  statusLabel: string;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  testId: string;
  /** Optional call-chain identity used to bind the shared behavior motion. */
  activityId?: BehaviorActivityId;
  activityAnimation?: BehaviorActivityAnimation;
  activityStatus?: 'running' | 'done' | 'error' | 'idle';
};

/**
 * Shared composer-adjacent frame for an agent turn that needs a human action.
 * Callers retain ownership of response semantics: answering a model question
 * is deliberately distinct from granting a safety permission.
 */
export function AgentInterruptionFrame(props: AgentInterruptionFrameProps): ReactElement {
  const statusTone = props.tone === 'question' ? 'running' : props.tone;

  return (
    <Surface
      tone="raised"
      className={`agent-interruption agent-interruption--${props.tone}`}
      data-testid={props.testId}
      {...(props.activityId !== undefined ? { 'data-activity-id': props.activityId } : {})}
      {...(props.activityAnimation !== undefined
        ? { 'data-activity-animation': props.activityAnimation }
        : {})}
      {...(props.activityStatus !== undefined ? { 'data-tool-status': props.activityStatus } : {})}
      aria-label={props.statusLabel}
    >
      <header className="agent-interruption-header">
        <StatusBadge tone={statusTone} label={props.statusLabel} />
        <h2 className="agent-interruption-title">{props.title}</h2>
        {props.description ? (
          <p className="agent-interruption-description">{props.description}</p>
        ) : null}
      </header>
      <div className="agent-interruption-content">{props.children}</div>
    </Surface>
  );
}
