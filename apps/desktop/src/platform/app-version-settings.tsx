/**
 * Settings → General card: the installed Desktop version and, when a newer
 * signed bundle is published, one-click update with download progress
 * (ADR 0097). Desktop app only: a browser tab has no installed version and
 * the mobile shell updates through its store.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button, ConfirmDialog, ProgressBar } from '@piwin/ui-kit';
import {
  APP_UPDATE_STALLED_ERROR,
  appUpdatePercent,
  DEVELOPMENT_BUILD_VERSION,
  DOWNLOAD_PAGE_URL,
} from './app-update.js';
import { getAppUpdateStore, useAppUpdateState, type AppUpdateState } from './app-update-store.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import { openExternalUrl } from './open-external-url.js';
import { PageTitle } from '../settings/page-title.js';
import { isDesktopTauriRuntime } from '../tool-cards/shell-runtime.js';

const COPY = {
  'zh-CN': {
    title: '版本',
    current: (version: string) => `当前版本 v${version}`,
    development: '开发构建（未发布版本）',
    updateAvailable: (version: string) => `有新版本 v${version}`,
    updateNow: '立即更新',
    preparing: '正在准备更新…',
    downloading: (percent: number | undefined) =>
      percent === undefined ? '正在下载更新…' : `正在下载更新 ${percent}%`,
    restarting: '更新已安装，正在重启…',
    failed: (error: string) => `更新失败：${error}`,
    stalled: '下载 60 秒没有收到数据，已中断。',
    download: '前往下载',
    changelog: '查看更新日志',
    busyTitle: '有会话正在运行',
    busyDescription: (count: number) =>
      `有 ${count} 个会话正在运行。更新会重启应用和本地 Host，正在进行的回复会被中断。`,
    updateAnyway: '仍然更新',
    later: '稍后',
    progressLabel: '更新下载进度',
  },
  en: {
    title: 'Version',
    current: (version: string) => `Installed version v${version}`,
    development: 'Development build (not a released version)',
    updateAvailable: (version: string) => `Version v${version} is available`,
    updateNow: 'Update now',
    preparing: 'Preparing the update…',
    downloading: (percent: number | undefined) =>
      percent === undefined ? 'Downloading the update…' : `Downloading the update ${percent}%`,
    restarting: 'Update installed, restarting…',
    failed: (error: string) => `Update failed: ${error}`,
    stalled: 'The download received no data for 60 seconds and was stopped.',
    download: 'Download',
    changelog: 'View changelog',
    busyTitle: 'Sessions are running',
    busyDescription: (count: number) =>
      `${count} session${count === 1 ? ' is' : 's are'} running. Updating restarts the app and the local Host and interrupts replies in progress.`,
    updateAnyway: 'Update anyway',
    later: 'Later',
    progressLabel: 'Update download progress',
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

function describeUpdate(copy: Copy, installed: string, state: AppUpdateState): string {
  const base =
    installed === DEVELOPMENT_BUILD_VERSION ? copy.development : copy.current(installed);
  const update = state.update;
  if (!update) return base;
  switch (state.status) {
    case 'preparing':
      return `${base} · ${copy.preparing}`;
    case 'downloading':
      return `${base} · ${copy.downloading(appUpdatePercent(state.progress))}`;
    case 'restarting':
      return `${base} · ${copy.restarting}`;
    case 'failed':
      return `${base} · ${
        state.error === APP_UPDATE_STALLED_ERROR ? copy.stalled : copy.failed(state.error ?? '')
      }`;
    default:
      return `${base} · ${copy.updateAvailable(update.version)}`;
  }
}

export function AppVersionSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isDesktop = isDesktopTauriRuntime();
  const [version, setVersion] = useState<string>();
  const store = getAppUpdateStore();
  const state = useAppUpdateState(store);

  useEffect(() => {
    if (!isDesktop) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const installed = await getVersion();
        if (cancelled) return;
        setVersion(installed);
        // Opening the card re-checks; Rust skips the network for 0.0.0 builds.
        await store.refresh();
      } catch (error) {
        // Offline or the manifest is unreachable: the card still shows what
        // it knows; an update hint is not worth an error surface.
        if (!cancelled) console.warn('[app-version] update check failed', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop, store]);

  if (!isDesktop || version === undefined) {
    return null;
  }
  const copy = COPY[locale];
  const update = state.update;
  const inFlight =
    state.status === 'preparing' || state.status === 'downloading' || state.status === 'restarting';
  const showProgress = state.status === 'downloading' || state.status === 'restarting';
  return (
    <div className="settings-section settings-section-card" data-testid="app-version-settings">
      <PageTitle title={copy.title} description={describeUpdate(copy, version, state)} />
      {showProgress ? (
        <ProgressBar
          value={state.status === 'restarting' ? 100 : appUpdatePercent(state.progress)}
          label={copy.progressLabel}
          testId="app-version-update-progress"
        />
      ) : null}
      <div className="host-target-actions">
        {update && state.status !== 'failed' ? (
          <Button
            variant="primary"
            disabled={inFlight}
            onClick={() => void store.install({ force: false, origin: 'settings' })}
            data-testid="app-version-update-now"
          >
            {copy.updateNow}
          </Button>
        ) : (
          <Button
            variant={update ? 'primary' : 'secondary'}
            onClick={() => void openExternalUrl(DOWNLOAD_PAGE_URL)}
            data-testid="app-version-open-download"
          >
            {update ? copy.download : copy.changelog}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={state.status === 'busy' && state.origin === 'settings'}
        onOpenChange={(open) => {
          if (!open) store.dismissPrompt();
        }}
        title={copy.busyTitle}
        description={copy.busyDescription(state.busySessionCount ?? 0)}
        confirmLabel={copy.updateAnyway}
        cancelLabel={copy.later}
        tone="danger"
        onConfirm={() => void store.install({ force: true, origin: 'settings' })}
        testId="app-version-busy-confirm"
      />
    </div>
  );
}
