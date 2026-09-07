/**
 * Host-authoritative browser runtime status for the Desktop panel.
 * Ownership banners stay on BrowserSessionPanel; this is connection health.
 */
import type { BrowserLifecycle, BrowserMirrorMode } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';

export type BrowserRuntimeStatusCopy = {
  starting: string;
  recovering: string;
  degraded: string;
  failed: string;
  restart: string;
};

export type BrowserRuntimeStatusInput = {
  lifecycle: BrowserLifecycle | undefined;
  mirror: BrowserMirrorMode | undefined;
  mirrorError: string | null;
};

export type BrowserRuntimeStatusView = {
  showBanner: boolean;
  interactEnabled: boolean;
  message: string | null;
  restartLabel: string;
};

export function browserRuntimeStatusCopy(locale: DesktopLocale): BrowserRuntimeStatusCopy {
  if (locale === 'zh-CN') {
    return {
      starting: '正在启动浏览器…',
      recovering: '正在恢复浏览器会话…',
      degraded: '浏览器镜像已降级。',
      failed: '浏览器会话失败。',
      restart: '重启',
    };
  }
  return {
    starting: 'Starting the browser…',
    recovering: 'Recovering the browser session…',
    degraded: 'Browser mirror is degraded.',
    failed: 'Browser session failed.',
    restart: 'Restart',
  };
}

export function isBrowserInteractEnabled(input: BrowserRuntimeStatusInput): boolean {
  if (input.lifecycle !== undefined && input.lifecycle !== 'ready') return false;
  if (input.mirror === 'degraded') return false;
  if ((input.mirror === 'off' || input.mirror === undefined) && Boolean(input.mirrorError)) {
    return false;
  }
  return true;
}

export function shouldShowBrowserRuntimeBanner(input: BrowserRuntimeStatusInput): boolean {
  if (
    input.lifecycle === 'starting' ||
    input.lifecycle === 'recovering' ||
    input.lifecycle === 'failed' ||
    input.lifecycle === 'disposed'
  ) {
    return true;
  }
  if (input.mirror === 'degraded') return true;
  return Boolean(input.mirrorError);
}

export function browserRuntimeBannerMessage(
  copy: BrowserRuntimeStatusCopy,
  input: BrowserRuntimeStatusInput,
): string | null {
  if (input.lifecycle === 'failed' || input.lifecycle === 'disposed') return copy.failed;
  if (input.lifecycle === 'recovering') return copy.recovering;
  if (input.lifecycle === 'starting') return copy.starting;
  if (input.mirror === 'degraded') return copy.degraded;
  if (input.mirrorError) return input.mirrorError;
  return null;
}

export function resolveBrowserRuntimeStatus(
  locale: DesktopLocale,
  input: BrowserRuntimeStatusInput,
): BrowserRuntimeStatusView {
  const copy = browserRuntimeStatusCopy(locale);
  const interactEnabled = isBrowserInteractEnabled(input);
  const showBanner = shouldShowBrowserRuntimeBanner(input);
  return {
    showBanner,
    interactEnabled,
    message: showBanner ? browserRuntimeBannerMessage(copy, input) : null,
    restartLabel: copy.restart,
  };
}
