/**
 * PermissionBar — docked permission prompt that sits above the composer
 * (ADR 0024). Replaces the inline GateCard that used to render at the end of
 * the scrolling transcript.
 *
 * Design references: Claude Code, Cursor, and helmor all dock the approval
 * surface above the input box rather than in the chat stream. This keeps the
 * prompt visible while the user scrolls the transcript and makes the approval
 * feel like a composer-level interaction, not a chat message.
 *
 * Structure:
 *   .permission-bar
 *     .permission-bar-head   — warn icon + action label + expand chevron
 *     .permission-bar-detail — collapsible mono block (command / paths / etc.)
 *     .permission-bar-actions — Allow session / once / project / Deny
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import type { PermissionPromptUi } from './chat-reducer';
import { PermissionFacts, canRememberPermissionForProject } from './permission-request-card';
import { IconWarn } from './shell-icons';

export type PermissionBarProps = {
  prompt: PermissionPromptUi;
  /** Current project path; when absent, "allow for project" is hidden. */
  projectPath: string | null;
  /** Existing respond handler from use-session-actions (allow / deny / ask). */
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
};

export function PermissionBar(props: PermissionBarProps): ReactElement {
  const { prompt, projectPath } = props;
  const [expanded, setExpanded] = useState(false);
  const context = prompt.context ?? null;
  const canRemember =
    canRememberPermissionForProject(context, prompt.action) && Boolean(projectPath);
  const actionLabel = context?.summary ?? prompt.action;
  const isDestructive = context?.destructive === true || context?.secretRelated === true;

  return (
    <section
      className={`permission-bar${isDestructive ? ' is-danger' : ''}`}
      data-testid="permission-bar"
      data-kind={context?.kind ?? 'unknown'}
      aria-label="Permission required"
    >
      <div className="permission-bar-head" onClick={() => setExpanded((prev) => !prev)}>
        <IconWarn className="permission-bar-icon" />
        <span className="permission-bar-action">{actionLabel}</span>
        <button
          type="button"
          className="permission-bar-toggle"
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          data-testid="permission-bar-toggle"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
        >
          <span className={`permission-bar-chevron${expanded ? ' is-expanded' : ''}`} aria-hidden />
        </button>
      </div>

      {expanded ? (
        <div className="permission-bar-detail" data-testid="permission-bar-detail">
          <PermissionFacts action={prompt.action} detail={prompt.detail} context={context} />
        </div>
      ) : null}

      <div className="permission-bar-actions">
        <Button
          variant="primary"
          className="permission-bar-btn-allow-session"
          data-testid="permission-bar-allow-session"
          onClick={() => props.onPermission('allow', 'session')}
        >
          Allow for session
        </Button>
        <Button
          variant="secondary"
          className="permission-bar-btn-allow-once"
          data-testid="permission-bar-allow-once"
          onClick={() => props.onPermission('allow', 'once')}
        >
          Once
        </Button>
        {canRemember ? (
          <Button
            variant="secondary"
            className="permission-bar-btn-allow-project"
            data-testid="permission-bar-allow-project"
            title="Remember this allow for the current project"
            onClick={() => props.onPermission('allow', 'project')}
          >
            Always allow
          </Button>
        ) : null}
        <Button
          variant="secondary"
          className="permission-bar-btn-deny"
          data-testid="permission-bar-deny"
          onClick={() => props.onPermission('deny')}
        >
          Deny
        </Button>
      </div>
    </section>
  );
}
