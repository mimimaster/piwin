/**
 * GoalDeliveryCard — delivery report shown when the model declares the
 * objective met (`goal_complete`).
 *
 * Everything here comes from the structured signal the Host lifted onto
 * `ToolPresentation.goal`, so the evidence and artifact list are real fields
 * rather than a re-parse of the tool's text output.
 */
import { type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconCheckCircle, IconFile } from '../shell-icons';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalDeliveryCardProps = {
  summary: string;
  verification?: string;
  artifacts?: readonly string[];
  onOpenDiff?: () => void;
  onOpenFile?: (path: string) => void;
  /** Owning tool call; used by the Goal timeline to jump here. */
  toolCallId?: string;
};

export function GoalDeliveryCard({
  summary,
  verification,
  artifacts = [],
  onOpenDiff,
  onOpenFile,
  toolCallId,
}: GoalDeliveryCardProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  return (
    <div
      className="goal-delivery-card"
      data-testid="goal-delivery-card"
      {...(toolCallId !== undefined ? { 'data-tool-call-id': toolCallId } : {})}
    >
      <div className="goal-delivery-header">
        <span className="goal-delivery-badge">
          <IconCheckCircle className="goal-delivery-icon" />
          <span className="goal-delivery-title">
            {isZh ? '目标已达成' : 'Goal accomplished'}
          </span>
        </span>
      </div>

      <div className="goal-delivery-body">
        <div className="goal-delivery-section">
          <p className="goal-section-label">{isZh ? '成果' : 'Summary'}</p>
          <p className="goal-summary-text">{summary}</p>
        </div>

        {verification ? (
          <div className="goal-delivery-section">
            <p className="goal-section-label">{isZh ? '验收证据' : 'Verification'}</p>
            <pre className="goal-verification-pre" data-testid="goal-verification">
              {verification}
            </pre>
          </div>
        ) : null}

        {artifacts.length > 0 ? (
          <div className="goal-delivery-section">
            <p className="goal-section-label">{isZh ? '涉及文件' : 'Artifacts'}</p>
            <ul className="goal-artifacts-list" data-testid="goal-artifacts">
              {artifacts.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="goal-artifact-link"
                    onClick={() => onOpenFile?.(path)}
                    disabled={onOpenFile === undefined}
                    title={path}
                  >
                    <IconFile className="goal-artifact-icon" />
                    <span className="goal-artifact-path">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {onOpenDiff ? (
        <div className="goal-delivery-actions">
          <Button size="compact" variant="secondary" onClick={onOpenDiff}>
            {isZh ? '查看变更' : 'Review changes'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
