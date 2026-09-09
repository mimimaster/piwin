import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconAlertCircle } from './shell-icons';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';
import { showErrorNotification, showSuccessNotification } from '@piwin/ui-kit';
import type { AgentFailure } from '@piwin/contracts';
import { presentTurnErrorCard } from './turn-error-presentation.js';

export type TurnErrorCardProps = {
  messageId: string;
  error?: string | null | undefined;
  failure?: AgentFailure | undefined;
  locale?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Keep the current path and ask the model to finish (work already landed). */
  onContinue?: (() => void) | undefined;
  /** Wipe the attempt and re-run the same user turn. */
  onRestart?: (() => void) | undefined;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
};

/**
 * Transcript error card — inkstone proto #20 structure, subtracted:
 * title + shaded detail + retry/copy. No auth/quota special-case actions.
 */
export function TurnErrorCard(props: TurnErrorCardProps): ReactElement | null {
  const { error, failure, locale = 'zh-CN', onRetry, onContinue, onRestart, onFeedback } = props;
  const [copied, setCopied] = useState(false);
  const contextMenu = useDesktopContextMenu();

  if (!error) {
    return null;
  }

  const isChinese = locale === 'zh-CN' || locale.startsWith('zh');
  const presentation = presentTurnErrorCard({ error, failure, locale });
  const { title, detail, category, showCategoryTag } = presentation;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      const msg = isChinese ? '报错详情已复制到剪贴板' : 'Error details copied to clipboard';
      if (onFeedback) {
        onFeedback(msg, 'success');
      } else {
        showSuccessNotification(msg);
      }
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const msg = isChinese ? '复制失败' : 'Failed to copy error details';
      if (onFeedback) {
        onFeedback(msg, 'error');
      } else {
        showErrorNotification(msg);
      }
    }
  };

  const errorTarget: ContextMenuTarget | null = contextMenu
    ? {
        surface: 'error',
        title,
        detail,
        label: title,
      }
    : null;

  const cardContent = (
    <div
      className="turn-error-card"
      data-testid="turn-error-card"
      data-category={category}
      role="alert"
    >
      <div className="turn-error-card-inner">
        <div className="turn-error-header">
          <div className="turn-error-icon-badge" aria-hidden>
            <IconAlertCircle width={14} height={14} />
          </div>
          <span className="turn-error-title">{title}</span>
          {showCategoryTag ? <span className="turn-error-category-tag">{category}</span> : null}
        </div>

        <div className="turn-error-detail" data-testid="turn-error-detail">
          {detail}
        </div>

        <div className="turn-error-actions">
          {onContinue ? (
            <Button
              variant="primary"
              size="compact"
              className="turn-error-retry-btn"
              data-testid="turn-error-continue-btn"
              onClick={onContinue}
            >
              {isChinese ? '继续' : 'Continue'}
            </Button>
          ) : onRetry ? (
            <Button
              variant="primary"
              size="compact"
              className="turn-error-retry-btn"
              data-testid="turn-error-retry-btn"
              onClick={onRetry}
            >
              {isChinese ? '重试' : 'Retry'}
            </Button>
          ) : null}
          {onRestart ? (
            <Button
              variant="secondary"
              size="compact"
              data-testid="turn-error-restart-btn"
              onClick={onRestart}
            >
              {isChinese ? '从头再来' : 'Start over'}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="compact"
            className="turn-error-copy-btn"
            data-testid="turn-error-copy-btn"
            onClick={() => void handleCopy()}
          >
            {copied ? (isChinese ? '已复制' : 'Copied') : isChinese ? '复制报错' : 'Copy error'}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!errorTarget || !contextMenu) {
    return cardContent;
  }

  return (
    <ContextMenuFromCatalog
      testId="turn-error-context-menu"
      target={errorTarget}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {cardContent}
    </ContextMenuFromCatalog>
  );
}
