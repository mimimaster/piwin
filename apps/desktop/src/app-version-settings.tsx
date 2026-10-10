/**
 * Settings → General card showing the installed Desktop version and, when the
 * release manifest lists a newer installer for this platform, a link to the
 * download page. Desktop app only: a browser tab has no installed version and
 * the mobile shell updates through its store.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import {
  DEVELOPMENT_BUILD_VERSION,
  DOWNLOAD_PAGE_URL,
  fetchAvailableUpdate,
  type AvailableUpdate,
} from './app-update.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { openExternalUrl } from './open-external-url.js';
import { PageTitle } from './settings/page-title.js';
import { isDesktopTauriRuntime } from './shell-runtime.js';

const COPY = {
  'zh-CN': {
    title: '版本',
    current: (version: string) => `当前版本 v${version}`,
    development: '开发构建（未发布版本）',
    updateAvailable: (version: string) => `有新版本 v${version}`,
    download: '前往下载',
    changelog: '查看更新日志',
  },
  en: {
    title: 'Version',
    current: (version: string) => `Installed version v${version}`,
    development: 'Development build (not a released version)',
    updateAvailable: (version: string) => `Version v${version} is available`,
    download: 'Download',
    changelog: 'View changelog',
  },
} as const;

export function AppVersionSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isDesktop = isDesktopTauriRuntime();
  const [version, setVersion] = useState<string>();
  const [update, setUpdate] = useState<AvailableUpdate>();

  useEffect(() => {
    if (!isDesktop) return undefined;
    const abort = new AbortController();
    void (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const installed = await getVersion();
        if (abort.signal.aborted) return;
        setVersion(installed);
        setUpdate(await fetchAvailableUpdate(installed, navigator.userAgent, abort.signal));
      } catch (error) {
        // Offline or the manifest is unreachable: the card still shows what
        // it knows; an update hint is not worth an error surface.
        if (!abort.signal.aborted) console.warn('[app-version] update check failed', error);
      }
    })();
    return () => abort.abort();
  }, [isDesktop]);

  if (!isDesktop || version === undefined) {
    return null;
  }
  const copy = COPY[locale];
  const description =
    version === DEVELOPMENT_BUILD_VERSION ? copy.development : copy.current(version);
  return (
    <div className="settings-section settings-section-card" data-testid="app-version-settings">
      <PageTitle
        title={copy.title}
        description={
          update ? `${description} · ${copy.updateAvailable(update.version)}` : description
        }
      />
      <div className="host-target-actions">
        <Button
          variant={update ? 'primary' : 'secondary'}
          onClick={() => void openExternalUrl(DOWNLOAD_PAGE_URL)}
          data-testid="app-version-open-download"
        >
          {update ? copy.download : copy.changelog}
        </Button>
      </div>
    </div>
  );
}
