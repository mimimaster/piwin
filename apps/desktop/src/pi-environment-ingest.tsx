import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { PiEnvironmentPreviewData } from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { useSettings } from './settings/settings-context.js';
import { useConfirmDialog } from './use-confirm-dialog.js';

export function PiEnvironmentIngestCard(): ReactElement | null {
  const { hostClient, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const confirmDialog = useConfirmDialog();
  const [preview, setPreview] = useState<PiEnvironmentPreviewData | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!hostClient?.request) {
      return;
    }
    const detected = await hostClient.request({ type: 'pi-environment/detect' });
    if (!detected.success || !detected.data || typeof detected.data !== 'object') {
      setPreview(null);
      return;
    }
    const available = (detected.data as { available?: boolean }).available === true;
    if (!available) {
      setPreview(null);
      return;
    }
    const previewResponse = await hostClient.request({ type: 'pi-environment/preview' });
    if (!previewResponse.success || !previewResponse.data || typeof previewResponse.data !== 'object') {
      setPreview(null);
      return;
    }
    const data = previewResponse.data as PiEnvironmentPreviewData;
    setPreview(data.available ? data : null);
  }, [hostClient]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  if (!preview) {
    return null;
  }

  async function handleImport(): Promise<void> {
    if (!hostClient?.request || !preview) {
      return;
    }
    const providers = preview.missingProviderIds;
    const description = isChinese
      ? providers.length > 0
        ? `将拷贝 Host 还没有的套餐账号：${providers.join('、')}。扩展和技能已经在跟随本机 Pi 清单，不会再拷一份。`
        : '本机 Pi 家目录可用。Host 已有对应套餐账号时不会覆盖。扩展和技能已经在跟随清单。'
      : providers.length > 0
        ? `Copy subscription accounts the Host does not have yet: ${providers.join(', ')}. Followed extensions and skills are already visible; this does not copy them.`
        : 'A local Pi home was found. Existing Host accounts are kept. Followed extensions and skills are already listed.';
    const confirmed = await confirmDialog.confirm({
      title: isChinese ? '接入本机 Pi 配置' : 'Import local Pi configuration',
      description,
      confirmLabel: isChinese ? '接入' : 'Import',
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const applyCommand = { type: 'pi-environment/apply' as const };
      const response = await hostClient.request(
        applyCommand,
        remoteCommandRequiresIdempotencyKey(applyCommand.type)
          ? { idempotencyKey: createGestureIdempotencyKey() }
          : undefined,
      );
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { skipped?: boolean; copiedProviderIds?: string[] } | undefined;
      if (data?.skipped) {
        setInfo(
          isChinese
            ? '当前 Host 不是默认产品根，未接入本机 Pi。'
            : 'This Host is not the default product root, so local Pi config was not imported.',
        );
        return;
      }
      const copied = data?.copiedProviderIds ?? [];
      setInfo(
        isChinese
          ? copied.length > 0
            ? `已接入套餐：${copied.join('、')}`
            : '本机 Pi 配置已核对，没有需要拷贝的账号。'
          : copied.length > 0
            ? `Imported accounts: ${copied.join(', ')}`
            : 'Local Pi configuration was checked; no missing accounts to copy.',
      );
      await hostClient.request({ type: 'auth/status' });
      await loadPreview();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="oauth-pi-environment" data-testid="pi-environment-ingest">
      <div>
        <strong>{isChinese ? '检测到本机 Pi' : 'Local Pi detected'}</strong>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: '12.5px' }}>
          {isChinese
            ? '推荐接入套餐账号。扩展 / 技能已在跟随清单里，点接入不会再拷一份。'
            : 'Import subscription accounts. Extensions and skills are already followed; ingest does not copy them.'}
        </p>
      </div>
      <Button
        size="compact"
        disabled={busy}
        onClick={() => void handleImport()}
        data-testid="pi-environment-ingest-button"
      >
        {isChinese ? '接入本机 Pi 配置' : 'Import local Pi configuration'}
      </Button>
      {confirmDialog.dialog}
    </div>
  );
}
