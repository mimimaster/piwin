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
import { classifyAgentFailure } from './turn-error-classification.js';

export type TurnErrorCardProps = {
  messageId: string;
  error?: string | null | undefined;
  failure?: AgentFailure | undefined;
  locale?: string | undefined;
  onRetry?: (() => void) | undefined;
  onSwitchModel?: (() => void) | undefined;
  onOpenSettings?: ((section?: string) => void) | undefined;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
};

export function TurnErrorCard(props: TurnErrorCardProps): ReactElement | null {
  const {
    error,
    failure,
    locale = 'zh-CN',
    onRetry,
    onSwitchModel,
    onOpenSettings,
    onFeedback,
  } = props;
  const [copied, setCopied] = useState(false);
  const contextMenu = useDesktopContextMenu();

  if (!error) {
    return null;
  }

  const isChinese = locale === 'zh-CN' || locale.startsWith('zh');
  const classification = classifyAgentFailure(failure);
  const title = isChinese ? classification.titleZh : classification.titleEn;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(error);
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
        detail: error,
        label: title,
      }
    : null;

  const cardContent = (
    <div
      className="turn-error-card"
      data-testid="turn-error-card"
      data-category={classification.category}
      role="alert"
    >
      <div className="turn-error-card-inner">
        <div className="turn-error-header">
          <div className="turn-error-icon-badge">
            <IconAlertCircle width={15} height={15} />
          </div>
          <div className="turn-error-header-text">
            <span className="turn-error-title">{title}</span>
            <span className="turn-error-category-tag">{classification.category}</span>
          </div>
        </div>

        <div className="turn-error-body">
          <div className="turn-error-message">{error}</div>
        </div>

        <div className="turn-error-actions">
          {onRetry ? (
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
          {classification.primaryAction === 'settings' && onOpenSettings ? (
            <Button
              variant="secondary"
              size="compact"
              className="turn-error-settings-btn"
              data-testid="turn-error-settings-btn"
              onClick={() => onOpenSettings('providers')}
            >
              {isChinese ? '配置密钥' : 'Configure Key'}
            </Button>
          ) : null}
          {classification.category === 'quota' && onSwitchModel ? (
            <Button
              variant="secondary"
              size="compact"
              className="turn-error-switch-model-btn"
              data-testid="turn-error-switch-model-btn"
              onClick={onSwitchModel}
            >
              {isChinese ? '切换模型' : 'Switch Model'}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="compact"
            className="turn-error-copy-btn"
            data-testid="turn-error-copy-btn"
            onClick={() => void handleCopy()}
          >
            {copied ? (isChinese ? '已复制' : 'Copied') : isChinese ? '复制报错' : 'Copy'}
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
