/**
 * Inline permission gate (Task 12). Replaces the modal permission dialog with a
 * non-modal card rendered at the end of the chat stream while the run waits.
 *
 * Structure mirrors the v7 prototype (ui-prototype-v7.html:279-300):
 *   .gate (warn-line border)
 *     gate-head  — warn icon + "需要审批 · {action}"
 *     gate-cmd   — sunken mono block reusing PermissionFacts per-kind rendering
 *     gate-actions — warn-solid "允许一次" / outlined "总是允许" / outlined "拒绝"
 *                    + hint "权限: {mode}"
 *
 * The three buttons map onto the existing permission respond handler
 * (allow-once / allow-remember-project / deny). The permission logic itself is
 * unchanged — only the presentation moves from modal to inline.
 */
import type { ReactElement } from 'react';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import type { PermissionPromptUi } from './chat-reducer';
import { PermissionFacts, canRememberPermissionForProject } from './permission-request-card';
import { IconWarn } from './shell-icons';

export type GateCardProps = {
  prompt: PermissionPromptUi;
  /** Current project path; when absent, "always allow" (project remember) is hidden. */
  projectPath: string | null;
  /** Existing respond handler from use-session-actions (allow / deny / ask). */
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
};

export function GateCard(props: GateCardProps): ReactElement {
  const { prompt, projectPath } = props;
  const context = prompt.context ?? null;
  const canRemember =
    canRememberPermissionForProject(context, prompt.action) && Boolean(projectPath);
  const actionLabel = context?.summary ?? prompt.action;

  return (
    <section
      className="gate"
      data-testid="permission-gate"
      data-kind={context?.kind ?? 'unknown'}
      aria-label="Permission required"
    >
      <div className="gate-head">
        <IconWarn className="gate-head-icon" />
        <span>需要审批 · {actionLabel}</span>
      </div>
      <div className="gate-cmd">
        <PermissionFacts action={prompt.action} detail={prompt.detail} context={context} />
      </div>
      <div className="gate-actions">
        <Button
          variant="primary"
          className="gate-btn-allow-once"
          data-testid="gate-allow-once"
          onClick={() => props.onPermission('allow', 'once')}
        >
          允许一次
        </Button>
        {canRemember ? (
          <Button
            variant="secondary"
            className="gate-btn-allow-remember"
            data-testid="gate-allow-remember"
            title="Remember this allow for the current project"
            onClick={() => props.onPermission('allow', 'project')}
          >
            总是允许
          </Button>
        ) : null}
        <Button
          variant="secondary"
          className="gate-btn-deny"
          data-testid="gate-deny"
          onClick={() => props.onPermission('deny')}
        >
          拒绝
        </Button>
        <span className="gate-hint">权限: {prompt.defaultDecision}</span>
      </div>
    </section>
  );
}
