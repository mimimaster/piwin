/**
 * PermissionBar — docked permission prompt using the shared
 * AgentInterruptionFrame (ADR 0024). Sits above the composer so the approval
 * surface stays visible while the user scrolls the transcript.
 *
 * Structure:
 *   AgentInterruptionFrame (warning/danger tone)
 *     .permission-bar-subject   — one-line visible fact (command/path/host)
 *     .permission-bar-detail    — collapsible full facts (PermissionFacts)
 *     .permission-bar-actions   — Allow session / once / project / Deny
 */
import { useState, type ReactElement } from 'react';
import { Button, Collapse } from '@piwin/ui-kit';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import type { PermissionPromptUi } from './chat-reducer';
import { PermissionFacts, canRememberPermissionForProject } from './permission-request-card';
import { AgentInterruptionFrame, type AgentInterruptionTone } from './agent-interruption-frame';
import { useDesktopLocale } from './desktop-locale-context';
import { IconChevronDown } from './shell-icons';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export type PermissionBarProps = {
  prompt: PermissionPromptUi;
  /** Current project path; when absent, "allow for project" is hidden. */
  projectPath: string | null;
  /** Existing respond handler from use-session-actions (allow / deny / ask). */
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
};

/** Compact one-line subject shown before the details disclosure. */
function permissionSubject(
  prompt: PermissionPromptUi,
): string {
  const context = prompt.context;
  if (context?.summary) return context.summary;
  if (context?.command) return context.command;
  if (context?.host) return context.host;
  if (context?.paths && context.paths.length > 0) return context.paths[0]!;
  return prompt.action;
}

/** High-risk requests should start with details expanded. */
function shouldDefaultExpand(prompt: PermissionPromptUi): boolean {
  const context = prompt.context;
  if (!context) return false;
  return (
    context.destructive === true ||
    context.secretRelated === true ||
    context.kind === 'unknown'
  );
}

export function PermissionBar(props: PermissionBarProps): ReactElement {
  const { prompt, projectPath } = props;
  const { translator } = useDesktopLocale();
  const copy = translator.interruption;
  const [expanded, setExpanded] = useState(() => shouldDefaultExpand(prompt));
  const context = prompt.context ?? null;
  const canRemember =
    canRememberPermissionForProject(context, prompt.action) && Boolean(projectPath);
  const isDanger = context?.destructive === true || context?.secretRelated === true;
  const tone: AgentInterruptionTone = isDanger ? 'danger' : 'warning';
  const subject = permissionSubject(prompt);
  const detailId = `permission-detail-${prompt.requestId}`;

  return (
    <AgentInterruptionFrame
      tone={tone}
      statusLabel={copy.approvalRequired}
      title={subject}
      testId="permission-bar"
      activityId="permission"
      activityAnimation={getBehaviorActivitySpec('permission').animation}
      activityStatus="running"
    >
      <button
        type="button"
        className="permission-bar-disclosure"
        aria-expanded={expanded}
        aria-controls={detailId}
        data-testid="permission-bar-toggle"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="permission-bar-disclosure-label">
          {expanded ? copy.collapseDetails : copy.expandDetails}
        </span>
        <IconChevronDown
          className={`permission-bar-chevron${expanded ? ' is-expanded' : ''}`}
        />
      </button>

      <Collapse expanded={expanded} testId="permission-bar-detail">
        <div id={detailId} className="permission-bar-detail-inner">
          <PermissionFacts action={prompt.action} detail={prompt.detail} context={context} />
        </div>
      </Collapse>

      <div className="permission-bar-actions">
        <Button
          variant="primary"
          size="compact"
          className="permission-bar-btn-allow-session"
          data-testid="permission-bar-allow-session"
          onClick={() => props.onPermission('allow', 'session')}
        >
          <span className="agent-interruption-choice-badge">A</span>
          <span>{copy.allowForSession}</span>
        </Button>
        <Button
          variant="secondary"
          size="compact"
          className="permission-bar-btn-allow-once"
          data-testid="permission-bar-allow-once"
          onClick={() => props.onPermission('allow', 'once')}
        >
          <span className="agent-interruption-choice-badge">B</span>
          <span>{copy.allowOnce}</span>
        </Button>
        {canRemember ? (
          <Button
            variant="secondary"
            size="compact"
            className="permission-bar-btn-allow-project"
            data-testid="permission-bar-allow-project"
            title={copy.allowForProject}
            onClick={() => props.onPermission('allow', 'project')}
          >
            <span className="agent-interruption-choice-badge">C</span>
            <span>{copy.allowForProject}</span>
          </Button>
        ) : null}
        <Button
          variant="danger"
          size="compact"
          className="permission-bar-btn-deny"
          data-testid="permission-bar-deny"
          onClick={() => props.onPermission('deny')}
        >
          <span className="agent-interruption-choice-badge">{canRemember ? 'D' : 'C'}</span>
          <span>{copy.deny}</span>
        </Button>
      </div>
    </AgentInterruptionFrame>
  );
}
