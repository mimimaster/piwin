/**
 * Startup side of the in-app update (ADR 0097): one non-blocking notice per
 * new version with an "Update now" action. The notice also answers its own
 * busy-session prompt and install failure; Settings → General → Version
 * remains the place to see progress and retry.
 */
import { hideUiNotification, showUiNotification } from '@piwin/ui-kit';
import { DOWNLOAD_PAGE_URL } from './app-update.js';
import type { AppUpdateState, AppUpdateStore } from './app-update-store.js';
import { loadDesktopLocale, type DesktopLocale } from './desktop-locale.js';
import { openExternalUrl } from './open-external-url.js';

const NOTIFIED_VERSION_KEY = 'piwin.appUpdate.notifiedVersion';
const NOTICE_ID = 'app-update-available';

const COPY = {
  'zh-CN': {
    availableTitle: (version: string) => `piwin v${version} 可用`,
    availableMessage: '更新会在下载完成后自动重启应用。',
    updateNow: '立即更新',
    downloading: '正在下载更新，完成后自动重启…',
    busy: (count: number) => `有 ${count} 个会话正在运行，更新重启会中断它们。`,
    updateAnyway: '仍然更新',
    failed: (error: string) => `更新失败：${error}`,
    download: '前往下载',
  },
  en: {
    availableTitle: (version: string) => `piwin v${version} is available`,
    availableMessage: 'The app restarts by itself once the download finishes.',
    updateNow: 'Update now',
    downloading: 'Downloading the update; the app restarts when it is done…',
    busy: (count: number) =>
      `${count} session${count === 1 ? ' is' : 's are'} running; the restart will interrupt ${count === 1 ? 'it' : 'them'}.`,
    updateAnyway: 'Update anyway',
    failed: (error: string) => `Update failed: ${error}`,
    download: 'Download',
  },
} as const satisfies Record<DesktopLocale, unknown>;

function readNotifiedVersion(): string | undefined {
  try {
    return localStorage.getItem(NOTIFIED_VERSION_KEY) ?? undefined;
  } catch {
    // Storage can be unavailable; the notice may then repeat once per launch.
    return undefined;
  }
}

function saveNotifiedVersion(version: string): void {
  try {
    localStorage.setItem(NOTIFIED_VERSION_KEY, version);
  } catch {
    // See readNotifiedVersion.
  }
}

/**
 * Reacts to store transitions. Returns the unsubscribe; the store's own
 * event watch is started by the caller so tests can drive the store directly.
 */
export function connectAppUpdateNotice(store: AppUpdateStore): () => void {
  let previous: AppUpdateState = store.getState();
  let promptId: string | undefined;

  const onChange = (): void => {
    const state = store.getState();
    const copy = COPY[loadDesktopLocale()];
    const update = state.update;
    if (update && update.version !== previous.update?.version && state.status === 'idle') {
      if (readNotifiedVersion() !== update.version) {
        saveNotifiedVersion(update.version);
        showUiNotification({
          id: NOTICE_ID,
          tone: 'info',
          title: copy.availableTitle(update.version),
          message: copy.availableMessage,
          autoClose: false,
          action: {
            label: copy.updateNow,
            onClick: () => void store.install({ force: false, origin: 'notice' }),
          },
        });
      }
    }
    if (state.status !== previous.status && state.origin === 'notice') {
      if (promptId) hideUiNotification(promptId);
      promptId = `app-update-${state.status}`;
      if (state.status === 'downloading') {
        showUiNotification({
          id: promptId,
          tone: 'info',
          message: copy.downloading,
          autoClose: false,
        });
      } else if (state.status === 'busy') {
        showUiNotification({
          id: promptId,
          tone: 'warning',
          message: copy.busy(state.busySessionCount ?? 0),
          autoClose: false,
          onClose: () => store.dismissPrompt(),
          action: {
            label: copy.updateAnyway,
            onClick: () => void store.install({ force: true, origin: 'notice' }),
          },
        });
      } else if (state.status === 'failed') {
        showUiNotification({
          id: promptId,
          tone: 'error',
          message: copy.failed(state.error ?? ''),
          autoClose: false,
          onClose: () => store.dismissPrompt(),
          action: { label: copy.download, onClick: () => void openExternalUrl(DOWNLOAD_PAGE_URL) },
        });
      }
    }
    previous = state;
  };

  return store.subscribe(onChange);
}
