/**
 * Settings → General cards for health data kept on the Host (ADR 0062 M2):
 * whether uploaded daily summaries are stored, and the scheduled digest that
 * reads them. Both are off until the user turns them on, and the digest
 * cannot be enabled without a model the user picked for it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  normalizeHealthConfig,
  type HealthConfig,
  type HealthDigestConfig,
  type HealthSummaryStatus,
  type ModelProviderConfig,
  type ModelRef,
  type PiwinConfig,
} from '@piwin/contracts';
import { Button, ConfirmDialog, Notice, Select, Switch, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context';
import { FieldRow } from './field-row';
import { PageTitle } from './page-title';
import { useSettings } from './settings-context';

const RETENTION_OPTIONS = [30, 90, 180, 365] as const;
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

type ModelOption = { key: string; ref: ModelRef; label: string; local: boolean; providerName: string };

function modelKey(ref: ModelRef): string {
  return `${ref.providerId}/${ref.modelId}`;
}

/** Same rule the Host uses when it tells the phone where health data will be processed. */
function isLocalProvider(provider: ModelProviderConfig): boolean {
  if (provider.id === 'ollama' || provider.id === 'lmstudio') {
    return true;
  }
  const baseUrl = 'baseUrl' in provider ? provider.baseUrl : undefined;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    return false;
  }
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function collectChatModels(config: PiwinConfig | null): ModelOption[] {
  const options: ModelOption[] = [];
  for (const provider of config?.providers ?? []) {
    if (!isProviderEnabled(provider)) continue;
    for (const model of provider.models) {
      if (!isModelEnabled(model) || !modelSupportsCapability(model, 'chat')) continue;
      const ref: ModelRef = { providerId: provider.id, modelId: model.id, protocol: provider.protocol };
      options.push({
        key: modelKey(ref),
        ref,
        label: `${model.label ?? model.id} · ${provider.name}`,
        local: isLocalProvider(provider),
        providerName: provider.name,
      });
    }
  }
  return options;
}

function formatWhen(iso: string | undefined, locale: string): string {
  if (iso === undefined) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale);
}

export function HostHealthSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const { config, saveConfig, setInfo, requestAutomation, remoteSettingsReadOnly } = useSettings();
  const [status, setStatus] = useState<HealthSummaryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const health = useMemo(() => normalizeHealthConfig(config?.health), [config]);
  const modelOptions = useMemo(() => collectChatModels(config), [config]);
  const selectedModel =
    health.digest.model === null
      ? undefined
      : modelOptions.find((option) => option.key === modelKey(health.digest.model as ModelRef));
  const readOnly = remoteSettingsReadOnly === true;

  const refreshStatus = useCallback(async (): Promise<void> => {
    const response = await requestAutomation({ type: 'health/status' });
    setStatus(response.success ? (response.data as HealthSummaryStatus) : null);
  }, [requestAutomation]);

  useEffect(() => {
    void refreshStatus().catch(() => setStatus(null));
  }, [refreshStatus, health.summaryStore.enabled]);

  if (!config) {
    return null;
  }

  async function save(next: HealthConfig): Promise<void> {
    if (!config) return;
    setError(undefined);
    // Normalizing here keeps the switch honest: a digest with no model or no
    // storage is written as off, and the control shows it as off.
    const saved = await saveConfig({ ...config, health: normalizeHealthConfig(next) }, { quiet: true });
    if (!saved) {
      setError(zh ? '保存失败：无法写入 Host 配置。' : 'Save failed: could not write the Host config.');
    }
  }

  function patchDigest(changes: Partial<HealthDigestConfig>): Promise<void> {
    return save({ ...health, digest: { ...health.digest, ...changes } });
  }

  async function runDigestNow(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await requestAutomation({ type: 'health/run-digest' });
      if (response.success) {
        setInfo(
          zh ? '已开始生成，完成后会出现在会话列表里。' : 'Started. The digest will appear in the session list.',
          'success',
        );
      } else {
        setError((zh ? '生成失败：' : 'Digest failed: ') + response.error);
      }
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll(): Promise<void> {
    setBusy(true);
    try {
      const response = await requestAutomation({ type: 'health/delete-summaries' });
      if (response.success) {
        setStatus(response.data as HealthSummaryStatus);
        setInfo(zh ? '已删除 Host 上保存的全部健康摘要。' : 'Deleted every health summary stored on this Host.', 'success');
      } else {
        setError(response.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const devices = status?.devices ?? [];
  const digestBlocker = !health.summaryStore.enabled
    ? zh
      ? '先打开上面的「保存健康摘要」。'
      : 'Turn on “Keep health summaries” above first.'
    : health.digest.model === null
      ? zh
        ? '先选择生成摘要的模型。'
        : 'Choose the model that writes the digest first.'
      : undefined;

  return (
    <>
      <div className="settings-section settings-section-card" data-testid="host-health-storage">
        <PageTitle
          title={zh ? '健康摘要存储' : 'Stored health summaries'}
          description={
            zh
              ? '让这台 Host 保存已配对 iPhone 在后台上传的每日健康摘要（加密保存，不含逐条原始记录）。打开后，手机离线时也能回答健康问题，并可生成定时摘要。'
              : 'Let this Host keep the daily health summaries a paired iPhone uploads in the background (encrypted; no raw samples). Health questions then work while the phone is offline, and a scheduled digest becomes possible.'
          }
        />
        <FieldRow
          label={zh ? '保存健康摘要' : 'Keep health summaries'}
          description={
            zh
              ? '还需要在 iPhone 的「设置 → Apple Health」里打开「后台同步」，手机才会上传。'
              : 'The iPhone also has to turn on “Background sync” under Settings → Apple Health before it uploads anything.'
          }
        >
          <Switch
            checked={health.summaryStore.enabled}
            disabled={readOnly}
            testId="host-health-storage-switch"
            aria-label={zh ? '保存健康摘要' : 'Keep health summaries'}
            onCheckedChange={(checked) =>
              void save({ ...health, summaryStore: { ...health.summaryStore, enabled: checked } })
            }
          />
        </FieldRow>
        {health.summaryStore.enabled ? (
          <FieldRow label={zh ? '保留时长' : 'Keep for'}>
            <Select
              value={String(health.summaryStore.retentionDays)}
              disabled={readOnly}
              aria-label={zh ? '保留时长' : 'Keep for'}
              data={RETENTION_OPTIONS.map((days) => ({
                value: String(days),
                label: zh ? `${days} 天` : `${days} days`,
              }))}
              onChange={(event) =>
                void save({
                  ...health,
                  summaryStore: { ...health.summaryStore, retentionDays: Number(event.currentTarget.value) },
                })
              }
              style={{ minWidth: 120 }}
            />
          </FieldRow>
        ) : null}
        <p className="host-target-shell-note" data-testid="host-health-devices">
          {devices.length === 0
            ? zh
              ? '还没有设备同步过。'
              : 'No device has synced yet.'
            : devices
                .map((device) =>
                  zh
                    ? `最近同步 ${formatWhen(device.lastSyncAt, locale)} · ${device.recordCount} 条每日记录（${device.oldestLocalDate ?? '—'} 至 ${device.newestLocalDate ?? '—'}）`
                    : `Last sync ${formatWhen(device.lastSyncAt, locale)} · ${device.recordCount} daily records (${device.oldestLocalDate ?? '—'} to ${device.newestLocalDate ?? '—'})`,
                )
                .join('\n')}
        </p>
        {devices.length > 0 ? (
          <div className="host-target-actions">
            <Button
              variant="secondary"
              disabled={busy || readOnly}
              onClick={() => setConfirmDelete(true)}
              data-testid="host-health-delete"
            >
              {zh ? '删除全部摘要' : 'Delete all summaries'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="settings-section settings-section-card" data-testid="host-health-digest">
        <PageTitle
          title={zh ? '定时健康摘要' : 'Scheduled health digest'}
          description={
            zh
              ? '到点后，Host 用你选的模型读取已保存的摘要，新建一个会话写出晨报或周报。不会唤醒手机，也不会改用别的模型。'
              : 'At the scheduled time the Host reads the stored summaries with the model you choose and writes a daily or weekly digest into a new session. It never wakes the phone and never substitutes another model.'
          }
        />
        <FieldRow
          label={zh ? '摘要模型' : 'Digest model'}
          description={
            selectedModel === undefined
              ? zh
                ? '必选。健康摘要会发送给这个模型。'
                : 'Required. The health summaries are sent to this model.'
              : selectedModel.local
                ? zh
                  ? '本地模型：数据不离开你的设备。'
                  : 'Local model: the data stays on your machines.'
                : zh
                  ? `外部服务：摘要会发送到 ${selectedModel.providerName}。`
                  : `External service: the summaries are sent to ${selectedModel.providerName}.`
          }
        >
          <Select
            value={selectedModel?.key ?? ''}
            disabled={readOnly}
            testId="host-health-digest-model"
            aria-label={zh ? '摘要模型' : 'Digest model'}
            data={[
              { value: '', label: zh ? '请选择…' : 'Select…' },
              ...modelOptions.map((option) => ({ value: option.key, label: option.label })),
            ]}
            onChange={(event) => {
              const found = modelOptions.find((option) => option.key === event.currentTarget.value);
              void patchDigest({ model: found?.ref ?? null });
            }}
            style={{ minWidth: 200 }}
          />
        </FieldRow>
        <FieldRow
          label={zh ? '启用定时摘要' : 'Enable scheduled digest'}
          {...(digestBlocker === undefined ? {} : { description: digestBlocker })}
        >
          <Switch
            checked={health.digest.enabled}
            disabled={readOnly || digestBlocker !== undefined}
            testId="host-health-digest-switch"
            aria-label={zh ? '启用定时摘要' : 'Enable scheduled digest'}
            onCheckedChange={(checked) => void patchDigest({ enabled: checked })}
          />
        </FieldRow>
        <FieldRow label={zh ? '频率' : 'Frequency'}>
          <Select
            value={health.digest.cadence}
            disabled={readOnly}
            aria-label={zh ? '频率' : 'Frequency'}
            data={[
              { value: 'daily', label: zh ? '每天（晨报）' : 'Daily' },
              { value: 'weekly', label: zh ? '每周（周报）' : 'Weekly' },
            ]}
            onChange={(event) =>
              void patchDigest({ cadence: event.currentTarget.value === 'weekly' ? 'weekly' : 'daily' })
            }
            style={{ minWidth: 140 }}
          />
        </FieldRow>
        {health.digest.cadence === 'weekly' ? (
          <FieldRow label={zh ? '星期' : 'Day'}>
            <Select
              value={String(health.digest.weekday)}
              disabled={readOnly}
              aria-label={zh ? '星期' : 'Day'}
              data={(zh ? WEEKDAYS_ZH : WEEKDAYS_EN).map((label, index) => ({ value: String(index), label }))}
              onChange={(event) => void patchDigest({ weekday: Number(event.currentTarget.value) })}
              style={{ minWidth: 140 }}
            />
          </FieldRow>
        ) : null}
        <FieldRow
          label={zh ? '时间' : 'Time'}
          description={
            zh
              ? '按 Host 所在时区。若手机当天还没同步，最多等 3 小时再生成。'
              : 'In the Host’s time zone. If the phone has not synced that day yet, the digest waits up to 3 hours.'
          }
        >
          <TextInput
            type="time"
            value={health.digest.time}
            disabled={readOnly}
            aria-label={zh ? '时间' : 'Time'}
            onChange={(event) => {
              if (/^\d{2}:\d{2}$/.test(event.currentTarget.value)) {
                void patchDigest({ time: event.currentTarget.value });
              }
            }}
            style={{ width: 120 }}
          />
        </FieldRow>
        <div className="host-target-actions">
          <Button
            variant="secondary"
            disabled={busy || digestBlocker !== undefined}
            onClick={() => void runDigestNow()}
            data-testid="host-health-digest-run"
          >
            {zh ? '立即生成一次' : 'Generate one now'}
          </Button>
        </div>
        {status?.digest.lastRunAt !== undefined ? (
          <p className="host-target-shell-note" data-testid="host-health-digest-last">
            {zh ? '上次运行：' : 'Last run: '}
            {formatWhen(status.digest.lastRunAt, locale)}
            {status.digest.lastStatus === 'ok'
              ? zh
                ? ' · 成功'
                : ' · ok'
              : ` · ${status.digest.lastMessage ?? status.digest.lastStatus ?? ''}`}
          </p>
        ) : null}
        {error !== undefined ? (
          <Notice tone="error" testId="host-health-error">
            {error}
          </Notice>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title={zh ? '删除全部健康摘要？' : 'Delete all health summaries?'}
        description={
          zh
            ? '会删除这台 Host 上保存的全部每日摘要。已有聊天里出现过的健康内容不受影响；手机下次后台同步会重新上传。'
            : 'This removes every daily summary stored on this Host. Health content already in chats is not affected, and the phone uploads again on its next background sync.'
        }
        confirmLabel={zh ? '删除' : 'Delete'}
        cancelLabel={zh ? '取消' : 'Cancel'}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteAll();
        }}
      />
    </>
  );
}
