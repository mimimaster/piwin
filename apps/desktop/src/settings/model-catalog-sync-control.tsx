import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ModelCatalogStatus, ModelCatalogSyncResult } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context';
import { catalogSyncErrorCopy } from './model-catalog-sync-copy';
import { useSettings } from './settings-context';

function formatFetchedAt(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
}

function statusCopy(status: ModelCatalogStatus | null, isChinese: boolean, locale: string): string {
  if (!status) {
    return isChinese ? '正在读取模型目录…' : 'Loading model catalog…';
  }
  if (status.source === 'pi-bootstrap' || !status.fetchedAt) {
    return isChinese ? '尚未同步（使用内置目录）' : 'Not synced (using built-in catalog)';
  }
  const when = formatFetchedAt(status.fetchedAt, locale);
  return isChinese
    ? `已同步 ${when} · ${status.entryCount} 个模型`
    : `Synced ${when} · ${status.entryCount} models`;
}

export function ModelCatalogSyncControl(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { getModelCatalogStatus, syncModelCatalog, setError, setInfo } = useSettings();
  const [status, setStatus] = useState<ModelCatalogStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await getModelCatalogStatus();
      setStatus(next);
    } catch (error) {
      setError(catalogSyncErrorCopy(error instanceof Error ? error.message : String(error), isChinese));
    }
  }, [getModelCatalogStatus, isChinese, setError]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function onSync(): Promise<void> {
    setSyncing(true);
    try {
      const result: ModelCatalogSyncResult = await syncModelCatalog();
      setStatus(result);
      setInfo(
        isChinese
          ? `模型目录已同步，共 ${result.entryCount} 个模型。`
          : `Model catalog synced (${result.entryCount} models).`,
      );
    } catch (error) {
      setError(catalogSyncErrorCopy(error instanceof Error ? error.message : String(error), isChinese));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="model-catalog-sync" data-testid="model-catalog-sync">
      <p className="model-catalog-sync-status muted" data-testid="model-catalog-sync-status">
        {statusCopy(status, isChinese, locale)}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        disabled={syncing}
        onClick={() => {
          void onSync();
        }}
        data-testid="model-catalog-sync-button"
      >
        {syncing
          ? isChinese
            ? '正在同步…'
            : 'Syncing…'
          : isChinese
            ? '同步模型目录'
            : 'Sync model catalog'}
      </Button>
    </div>
  );
}
