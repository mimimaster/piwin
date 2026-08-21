import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconAlertCircle } from './shell-icons';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';
import { showErrorNotification, showSuccessNotification } from '@piwin/ui-kit';

export type MainErrorBannerProps = {
  message: string | null;
  locale?: string | undefined;
  onDismiss: () => void;
};

/**
 * Persistent main-workspace error feedback.
 *
 * Rendered in a clean, modern card with context menu (Add to Chat / Explain failure /
 * Fix this error / Copy / Side Chat) so the user can address issues directly.
 */
export function MainErrorBanner(props: MainErrorBannerProps): ReactElement | null {
  const { message, onDismiss, locale = 'zh-CN' } = props;
  const [copied, setCopied] = useState(false);
  const contextMenu = useDesktopContextMenu();

  if (!message) {
    return null;
  }

  const isChinese = locale === 'zh-CN' || locale.startsWith('zh');
  const title = isChinese ? '操作未完成' : 'Action failed';

  const errorTarget: ContextMenuTarget | null = contextMenu
    ? {
        surface: 'error',
        title,
        detail: message,
        label: title,
      }
    : null;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      showSuccessNotification(isChinese ? '报错信息已复制到剪贴板' : 'Error copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showErrorNotification(isChinese ? '复制失败' : 'Failed to copy');
    }
  };

  const banner = (
    <div
      className="main-error-banner"
      data-testid="main-error-banner"
      data-tone="error"
      aria-live="assertive"
    >
      <div className="main-error-banner-inner">
        <div className="main-error-icon-badge">
          <IconAlertCircle width={16} height={16} />
        </div>
        <div className="main-error-content">
          <div className="main-error-title">{title}</div>
          <div className="main-error-message">{message}</div>
        </div>
        <div className="main-error-actions">
          <Button
            variant="ghost"
            size="compact"
            className="main-error-copy-btn"
            data-testid="main-error-copy-btn"
            onClick={() => void handleCopy()}
          >
            {copied ? (isChinese ? '已复制' : 'Copied') : isChinese ? '复制' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            className="main-error-dismiss"
            data-testid="main-error-dismiss"
            onClick={onDismiss}
          >
            {isChinese ? '关闭' : 'Dismiss'}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!errorTarget || !contextMenu) {
    return banner;
  }
  return (
    <ContextMenuFromCatalog
      testId="error-context-menu"
      target={errorTarget}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {banner}
    </ContextMenuFromCatalog>
  );
}
