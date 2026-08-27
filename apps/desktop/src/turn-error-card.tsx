import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconAlertCircle } from './shell-icons';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';
import { showErrorNotification, showSuccessNotification } from '@piwin/ui-kit';

export type TurnErrorCardProps = {
  messageId: string;
  error?: string | null | undefined;
  locale?: string | undefined;
  onRetry?: (() => void) | undefined;
  onSwitchModel?: (() => void) | undefined;
  onOpenSettings?: ((section?: string) => void) | undefined;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
};

type ErrorClassification = {
  category: 'provider' | 'quota' | 'context' | 'stream' | 'network' | 'execution' | 'unknown';
  titleZh: string;
  titleEn: string;
  isKeyError?: boolean;
};

function classifyError(errorMessage: string): ErrorClassification {
  const lower = errorMessage.toLowerCase();

  if (
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('401') ||
    lower.includes('invalid_api_key')
  ) {
    return {
      category: 'provider',
      titleZh: '模型认证或 API Key 错误',
      titleEn: 'Authentication or API Key Error',
      isKeyError: true,
    };
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('insufficient_quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('credit')
  ) {
    return {
      category: 'quota',
      titleZh: '模型调用受限或配额不足',
      titleEn: 'Rate Limit or Quota Exceeded',
    };
  }

  if (
    lower.includes('context length') ||
    lower.includes('maximum context') ||
    lower.includes('token limit') ||
    lower.includes('too many tokens') ||
    lower.includes('context_window')
  ) {
    return {
      category: 'context',
      titleZh: '上下文长度超限',
      titleEn: 'Context Window Exceeded',
    };
  }

  // A parsed model stream can stall while the proxy keeps the socket alive.
  // This must beat the generic `timeout` → network rule because connectivity
  // is not the failure being reported.
  if (
    lower.includes('stream idle') ||
    lower.includes('idle timeout') ||
    lower.includes('stream stalled') ||
    lower.includes('tokens stopped arriving') ||
    lower.includes('no model progress was received')
  ) {
    return {
      category: 'stream',
      titleZh: '模型输出中断',
      titleEn: 'Model stream stalled',
    };
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed')
  ) {
    return {
      category: 'network',
      titleZh: '网络请求或连接超时',
      titleEn: 'Network Timeout or Connection Refused',
    };
  }

  return {
    category: 'execution',
    titleZh: '生成失败',
    titleEn: 'Generation Failed',
  };
}

export function TurnErrorCard(props: TurnErrorCardProps): ReactElement | null {
  const { error, locale = 'zh-CN', onRetry, onSwitchModel, onOpenSettings, onFeedback } = props;
  const [copied, setCopied] = useState(false);
  const contextMenu = useDesktopContextMenu();

  if (!error) {
    return null;
  }

  const isChinese = locale === 'zh-CN' || locale.startsWith('zh');
  const classification = classifyError(error);
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
          {classification.isKeyError && onOpenSettings ? (
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
