/**
 * Inline permission gate (Inkstone Block 24 / proto-01).
 * Seal card rendered on the ink line while the run waits for approval.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import type { PermissionPromptUi } from './chat-reducer';
import { PermissionFacts, canRememberPermissionForProject } from './permission-request-card';

export type GateCardProps = {
  prompt: PermissionPromptUi;
  projectPath: string | null;
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
};

export function GateCard(props: GateCardProps): ReactElement {
  const { prompt, projectPath, onPermission } = props;
  const [stamping, setStamping] = useState(false);
  const context = prompt.context ?? null;
  const canRemember =
    canRememberPermissionForProject(context, prompt.action) && Boolean(projectPath);
  const actionLabel = context?.summary ?? prompt.action;

  useEffect(() => {
    setStamping(false);
    const handleKeyDown = (e: KeyboardEvent): void => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'textarea' || activeTag === 'input') return;

      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setStamping(true);
        window.setTimeout(() => onPermission('allow', 'once'), 160);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onPermission('deny');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPermission, prompt.requestId]);

  const handleAllowOnce = (): void => {
    setStamping(true);
    window.setTimeout(() => onPermission('allow', 'once'), 160);
  };

  return (
    <section
      className="tr-gate"
      data-testid="permission-gate"
      data-kind={context?.kind ?? 'unknown'}
      aria-label="Permission required"
    >
      <span className="node wait" />
      <div className="gate">
        <div className="gate-body">
          <div className="mic">需要你批准 · {actionLabel}</div>
          <div className="cmd gate-cmd">
            <PermissionFacts action={prompt.action} detail={prompt.detail} context={context} />
          </div>
          <div className="facts">
            {projectPath ? <span>工作目录 · {projectPath}</span> : null}
            {context?.destructive ? (
              <span className="dg">风险 · 破坏性操作</span>
            ) : null}
            <span>规则 · {prompt.defaultDecision}</span>
          </div>
        </div>

        <div className="seals gate-actions">
          <button
            type="button"
            className="seal ghost gate-btn-deny"
            data-testid="gate-deny"
            title="拒绝 (Esc)"
            onClick={() => onPermission('deny')}
          >
            否
          </button>
          <button
            type="button"
            className={`seal gate-btn-allow-once${stamping ? ' is-stamping' : ''}`}
            data-testid="gate-allow-once"
            title="允许一次 (Enter)"
            onClick={handleAllowOnce}
          >
            允
          </button>
        </div>

        <div className="gh">
          <span>Enter 盖印允许一次 · Esc 拒绝</span>
          {' · '}
          <u
            role="button"
            tabIndex={0}
            className="gate-btn-allow-session"
            data-testid="gate-allow-session"
            onClick={() => onPermission('allow', 'session')}
          >
            允 · 本会话
          </u>
          {canRemember ? (
            <>
              {' · '}
              <u
                role="button"
                tabIndex={0}
                className="gate-btn-allow-remember"
                data-testid="gate-allow-remember"
                onClick={() => onPermission('allow', 'project')}
              >
                允 · 项目
              </u>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
