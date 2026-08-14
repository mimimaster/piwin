/**
 * GoalDeliveryCard — delivery summary card shown when a goal is completed.
 * Renders outcomes, verification evidence, changed files, and follow-up actions.
 */
import { type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalDeliveryCardProps = {
  summary: string;
  verification?: string;
  artifacts?: string[];
  onOpenDiff?: () => void;
  onStartNextGoal?: () => void;
  onOpenFile?: (path: string) => void;
};

export function GoalDeliveryCard({
  summary,
  verification,
  artifacts = [],
  onOpenDiff,
  onStartNextGoal,
  onOpenFile,
}: GoalDeliveryCardProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  return (
    <div className="goal-delivery-card" data-testid="goal-delivery-card">
      <div className="goal-delivery-header">
        <div className="goal-delivery-badge">
          <span className="goal-delivery-icon">✅</span>
          <span className="goal-delivery-title">
            {isZh ? '目标达成交付报告' : 'Goal Accomplished & Delivered'}
          </span>
        </div>
      </div>

      <div className="goal-delivery-body">
        <div className="goal-delivery-section">
          <div className="goal-section-label">{isZh ? '成果总结' : 'Summary'}</div>
          <div className="goal-summary-text">{summary}</div>
        </div>

        {verification ? (
          <div className="goal-delivery-section">
            <div className="goal-section-label">{isZh ? '验收验证证据' : 'Verification Evidence'}</div>
            <pre className="goal-verification-pre">{verification}</pre>
          </div>
        ) : null}

        {artifacts.length > 0 ? (
          <div className="goal-delivery-section">
            <div className="goal-section-label">{isZh ? '涉及文件与产物' : 'Changed Artifacts'}</div>
            <ul className="goal-artifacts-list">
              {artifacts.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="goal-artifact-link"
                    onClick={() => onOpenFile?.(path)}
                    title={path}
                  >
                    📄 {path}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="goal-delivery-actions">
        {onOpenDiff ? (
          <Button size="compact" variant="primary" onClick={onOpenDiff}>
            {isZh ? '查看 Git 变更' : 'Review Changes'}
          </Button>
        ) : null}

        {onStartNextGoal ? (
          <Button size="compact" variant="secondary" onClick={onStartNextGoal}>
            {isZh ? '开始下一目标' : 'Start Next Goal'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
