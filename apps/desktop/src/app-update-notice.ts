/**
 * Sidebar side of the in-app update (ADR 0097): while a newer version is
 * published, the sidebar notice area carries a resident card with
 * "Update now", download progress, the busy-session prompt and failures.
 * It goes away only once the app runs the new version (the check then
 * reports no update). Settings → General → Version shows the same store.
 */
import { DOWNLOAD_PAGE_URL, appUpdatePercent } from './app-update.js';
import { getAppUpdateStore, useAppUpdateState, type AppUpdateState } from './app-update-store.js';
import type { DesktopLocale } from './desktop-locale.js';
import { openExternalUrl } from './open-external-url.js';
import type { SidebarNotice } from './sidebar-notice.js';

export const APP_UPDATE_NOTICE_ID = 'app-update';

const COPY = {
  'zh-CN': {
    title: (version: string) => `piwin v${version} 可用`,
    available: '下载完成后会自动重启应用。',
    updateNow: '立即更新',
    preparing: '正在准备更新…',
    downloading: (percent: number | undefined) =>
      percent === undefined ? '正在下载更新…' : `正在下载更新 ${percent}%`,
    restarting: '更新已安装，正在重启…',
    busy: (count: number) => `有 ${count} 个会话正在运行，更新重启会中断它们。`,
    updateAnyway: '仍然更新',
    later: '稍后',
    failed: (error: string) => `更新失败：${error}`,
    retry: '重试',
    download: '前往下载',
  },
  en: {
    title: (version: string) => `piwin v${version} is available`,
    available: 'The app restarts by itself once the download finishes.',
    updateNow: 'Update now',
    preparing: 'Preparing the update…',
    downloading: (percent: number | undefined) =>
      percent === undefined ? 'Downloading the update…' : `Downloading the update ${percent}%`,
    restarting: 'Update installed, restarting…',
    busy: (count: number) =>
      `${count} session${count === 1 ? ' is' : 's are'} running; the restart will interrupt ${count === 1 ? 'it' : 'them'}.`,
    updateAnyway: 'Update anyway',
    later: 'Later',
    failed: (error: string) => `Update failed: ${error}`,
    retry: 'Retry',
    download: 'Download',
  },
} as const satisfies Record<DesktopLocale, unknown>;

export type AppUpdateNoticeHandlers = {
  install: (force: boolean) => void;
  dismissPrompt: () => void;
  openDownloadPage: () => void;
};

/** Pure mapping from the shared update state to the sidebar card. */
export function describeAppUpdateNotice(
  state: AppUpdateState,
  locale: DesktopLocale,
  handlers: AppUpdateNoticeHandlers,
): SidebarNotice | undefined {
  const update = state.update;
  if (!update) return undefined;
  const copy = COPY[locale];
  const base = { id: APP_UPDATE_NOTICE_ID, title: copy.title(update.version) };
  switch (state.status) {
    case 'preparing':
      return { ...base, tone: 'info', message: copy.preparing, progress: null };
    case 'downloading':
      return {
        ...base,
        tone: 'info',
        message: copy.downloading(appUpdatePercent(state.progress)),
        progress: appUpdatePercent(state.progress) ?? null,
      };
    case 'restarting':
      return { ...base, tone: 'info', message: copy.restarting, progress: 100 };
    case 'busy':
      return {
        ...base,
        tone: 'warning',
        message: copy.busy(state.busySessionCount ?? 0),
        primaryAction: { label: copy.updateAnyway, onSelect: () => handlers.install(true) },
        secondaryAction: { label: copy.later, onSelect: handlers.dismissPrompt },
      };
    case 'failed':
      return {
        ...base,
        tone: 'error',
        message: copy.failed(state.error ?? ''),
        primaryAction: { label: copy.retry, onSelect: () => handlers.install(false) },
        secondaryAction: { label: copy.download, onSelect: handlers.openDownloadPage },
      };
    default:
      return {
        ...base,
        tone: 'info',
        message: copy.available,
        primaryAction: { label: copy.updateNow, onSelect: () => handlers.install(false) },
      };
  }
}

export function useAppUpdateNotice(locale: DesktopLocale): SidebarNotice | undefined {
  const store = getAppUpdateStore();
  const state = useAppUpdateState(store);
  return describeAppUpdateNotice(state, locale, {
    install: (force) => void store.install({ force, origin: 'notice' }),
    dismissPrompt: () => store.dismissPrompt(),
    openDownloadPage: () => void openExternalUrl(DOWNLOAD_PAGE_URL),
  });
}
