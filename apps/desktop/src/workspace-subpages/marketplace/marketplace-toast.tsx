import type { ReactElement } from 'react';
import { Toast, ToastHost } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketplaceToast } from './marketplace-types.js';

export type MarketplaceToastViewProps = {
  toast: MarketplaceToast | null;
  locale?: DesktopLocale | undefined;
  onDismiss?: () => void;
  testId?: string | undefined;
};

/** Past this, `title · message` stops fitting on one line. */
const MULTILINE_THRESHOLD = 40;
/** Past this, the message is clamped and gets a show-more control. */
const EXPANDABLE_THRESHOLD = 100;

/**
 * Standard universal success message generator adhering to Inkstone design language.
 */
export function formatUniversalSuccessToast(
  extensionName: string,
  locale: DesktopLocale | undefined,
  detailMessage?: string,
): MarketplaceToast {
  const isZh = locale === 'zh-CN';
  return {
    type: 'success',
    title: isZh ? '扩展安装成功' : 'Extension Installed',
    text:
      detailMessage ??
      (isZh
        ? `[${extensionName}] 扩展安装成功，当前会话已就绪。`
        : `[${extensionName}] installed successfully.`),
  };
}

/**
 * Standard universal error message generator adhering to Inkstone design language.
 */
export function formatUniversalErrorToast(
  extensionName: string,
  errorMessage: string,
  locale: DesktopLocale | undefined,
): MarketplaceToast {
  const isZh = locale === 'zh-CN';
  const cleanError = errorMessage ? errorMessage.replace(/^Error:\s*/i, '') : '';
  return {
    type: 'error',
    title: isZh ? '扩展安装失败' : 'Installation Failed',
    text: cleanError
      ? `[${extensionName}] ${cleanError}`
      : isZh
        ? `[${extensionName}] 安装失败，请检查网络连接或依赖后重试。`
        : `[${extensionName}] installation failed. Please check network or dependencies and retry.`,
  };
}

/**
 * Marketplace feedback bubble. Presentation comes from the shared ui-kit
 * `Toast`; the workspace keeps the TTL and queueing policy. The host stays
 * in-tree rather than portalled so the bubble shares a stacking context with
 * the install dialogs it reports on.
 */
export function MarketplaceToastView({
  toast,
  locale,
  onDismiss,
  testId = 'marketplace-toast',
}: MarketplaceToastViewProps): ReactElement | null {
  if (!toast) return null;

  const isZh = locale === 'zh-CN';
  const multiline = toast.text.length > MULTILINE_THRESHOLD || toast.text.includes('\n');
  const expandable = multiline && toast.text.length > EXPANDABLE_THRESHOLD;

  return (
    <ToastHost portal={false} position="top-center" testId="marketplace-toast-host">
      <Toast
        tone={toast.type}
        multiline={multiline}
        testId={testId}
        dismissLabel={isZh ? '关闭通知' : 'Dismiss notification'}
        {...(toast.title ? { title: toast.title } : {})}
        {...(expandable
          ? {
              expandLabel: isZh ? '展开详情' : 'Show more',
              collapseLabel: isZh ? '收起详情' : 'Show less',
            }
          : {})}
        {...(onDismiss ? { onDismiss } : {})}
      >
        {toast.text}
      </Toast>
    </ToastHost>
  );
}
