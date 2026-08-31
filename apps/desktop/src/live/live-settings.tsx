import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  LiveProviderDescriptor,
  LiveSettingsView,
  PiwinConfig,
} from '@piwin/contracts';
import {
  Button,
  Field,
  IconBrain,
  IconCheckCircle,
  IconMic,
  IconServer,
  IconShield,
  IconSliders,
  IconSpark,
  PasswordInput,
  Select,
  StatusBadge,
} from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';

export type LiveSettingsHostRequest = (command: HostCommand) => Promise<HostResponse>;

export type LiveSettingsProps = {
  config: PiwinConfig;
  saving: boolean;
  onSave: (next: PiwinConfig) => Promise<boolean>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  hostRequest?: LiveSettingsHostRequest;
};

export function LiveSettings(props: LiveSettingsProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [view, setView] = useState<LiveSettingsView | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSchema = useCallback(async () => {
    if (!props.hostRequest) return;
    const response = await props.hostRequest({ type: 'voice/live/settings-schema' });
    if (!response.success || !response.data || typeof response.data !== 'object') return;
    setView(response.data as LiveSettingsView);
  }, [props.hostRequest]);

  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  const selected = view?.providers.find((item) => item.providerId === view.selectedProviderId);

  const isReady =
    selected?.auth.kind === 'api-key'
      ? selected.auth.keyConfigured
      : selected?.auth.kind === 'subscription-oauth'
        ? selected.auth.ready
        : true;

  const statusLabel = isReady
    ? isChinese
      ? '已就绪'
      : 'Ready'
    : selected?.auth.kind === 'subscription-oauth'
      ? isChinese
        ? '需登录'
        : 'Login required'
      : isChinese
        ? '需配置密钥'
        : 'Key required';

  async function applyProvider(providerId: string, values: Record<string, string>): Promise<void> {
    if (!props.hostRequest || !view) return;
    setBusy(true);
    try {
      const response = await props.hostRequest({
        type: 'voice/live/apply-settings',
        input: { expectedRevision: view.revision, providerId, values },
      });
      if (!response.success) {
        props.onError(response.error ?? 'live-conflict');
        return;
      }
      setView(response.data as LiveSettingsView);
    } finally {
      setBusy(false);
    }
  }

  async function submitKey(operation: 'set' | 'clear'): Promise<void> {
    if (!props.hostRequest || !selected || selected.auth.kind !== 'api-key') return;
    setBusy(true);
    try {
      const response = await props.hostRequest({
        type: 'voice/live/set-provider-key',
        input: {
          providerId: selected.providerId,
          operation,
          ...(operation === 'set' ? { key: keyDraft } : {}),
        },
      });
      if (!response.success) {
        props.onError(response.error ?? 'live-provider-auth');
        return;
      }
      setKeyDraft('');
      props.onInfo(
        operation === 'clear'
          ? isChinese
            ? '已清除 Gemini 密钥'
            : 'Gemini key cleared'
          : isChinese
            ? '已保存 Gemini 密钥'
            : 'Gemini key saved',
      );
      await loadSchema();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="speech-live-panel" data-testid="settings-live-card">
      <div className="speech-live-header">
        <div className="speech-live-title-group">
          <span className="speech-live-icon" aria-hidden="true">
            <IconMic size={18} />
          </span>
          <div className="speech-live-title-copy">
            <div className="speech-live-title-row">
              <h3>piwin Live</h3>
              <span className="speech-live-hint-badge">
                <IconSpark size={12} />
                <span>{isChinese ? '从输入栏开始 Live' : 'Start Live from composer'}</span>
              </span>
            </div>
          </div>
        </div>
        <StatusBadge
          tone={isReady ? 'success' : 'warning'}
          label={statusLabel}
          testId="settings-live-status-badge"
        />
      </div>

      <div className="speech-live-body">
        {view && selected ? (
          <LiveSettingsForm
            view={view}
            selected={selected}
            busy={busy || props.saving}
            isChinese={isChinese}
            keyDraft={keyDraft}
            onKeyDraft={setKeyDraft}
            onProvider={(providerId) => {
              const next = view.providers.find((item) => item.providerId === providerId);
              const values = Object.fromEntries(
                (next?.settings ?? []).map((field) => [field.key, field.defaultValue]),
              );
              void applyProvider(providerId, values);
            }}
            onField={(key, value) => {
              const values = Object.fromEntries(
                selected.settings.map((field) => [field.key, field.defaultValue]),
              );
              void applyProvider(view.selectedProviderId, { ...values, [key]: value });
            }}
            onSubmitKey={submitKey}
          />
        ) : null}
      </div>
    </article>
  );
}

function getFieldIcon(key: string): ReactElement {
  if (key === 'model' || key === 'intelligence' || key === 'thinkingLevel') {
    return <IconBrain size={14} />;
  }
  if (key === 'voice') return <IconMic size={14} />;
  return <IconSliders size={14} />;
}

function LiveSettingsForm(input: {
  view: LiveSettingsView;
  selected: LiveProviderDescriptor;
  busy: boolean;
  isChinese: boolean;
  keyDraft: string;
  onKeyDraft: (value: string) => void;
  onProvider: (providerId: string) => void;
  onField: (key: string, value: string) => void;
  onSubmitKey: (operation: 'set' | 'clear') => Promise<void>;
}): ReactElement {
  const keyReady = input.selected.auth.kind === 'api-key' && input.selected.auth.keyConfigured;
  const oauthReady = input.selected.auth.kind === 'subscription-oauth' && input.selected.auth.ready;

  return (
    <div className="speech-live-form" data-testid="settings-live-schema">
      <div className="speech-live-grid">
        <Field
          label={
            <span className="speech-field-label-content">
              <IconServer size={14} />
              <span>{input.isChinese ? '渠道' : 'Channel'}</span>
            </span>
          }
        >
          <Select
            testId="settings-live-provider"
            disabled={input.busy}
            value={input.view.selectedProviderId}
            data={input.view.providers.map((item) => ({
              value: item.providerId,
              label: item.title,
            }))}
            onChange={(event) => input.onProvider(event.currentTarget.value)}
          />
        </Field>

        {input.selected.settings.map((field) => (
          <Field
            key={field.key}
            label={
              <span className="speech-field-label-content">
                {getFieldIcon(field.key)}
                <span>{field.label}</span>
              </span>
            }
          >
            <Select
              testId={`settings-live-field-${field.key}`}
              disabled={input.busy}
              value={field.defaultValue}
              data={field.options.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(event) => input.onField(field.key, event.currentTarget.value)}
            />
          </Field>
        ))}
      </div>

      <div className="speech-live-auth-section">
        {input.selected.auth.kind === 'subscription-oauth' ? (
          <div className="speech-live-status-card" data-testid="settings-live-oauth-status">
            <div className="speech-live-status-info">
              <span className="speech-live-status-icon">
                <IconShield size={16} />
              </span>
              <span className="speech-live-status-text">
                {oauthReady
                  ? input.isChinese
                    ? 'Codex 账户已登录'
                    : 'Codex account signed in'
                  : input.isChinese
                    ? 'Codex 尚未登录 · 请在账户页登录'
                    : 'Codex not signed in · Sign in on Accounts page'}
              </span>
            </div>
            <StatusBadge
              tone={oauthReady ? 'success' : 'warning'}
              label={oauthReady ? (input.isChinese ? '已连接' : 'Connected') : (input.isChinese ? '未连接' : 'Disconnected')}
            />
          </div>
        ) : input.selected.providerId === 'openai-realtime' ? (
          <div className="speech-live-status-card" data-testid="settings-live-openai-realtime-status">
            <div className="speech-live-status-info">
              <span className="speech-live-status-icon">
                <IconCheckCircle size={16} />
              </span>
              <span className="speech-live-status-text">
                {keyReady
                  ? input.isChinese
                    ? 'Provider 密钥已就绪'
                    : 'Provider key ready'
                  : input.isChinese
                    ? '未配置密钥 · 请在模型配置中给该 Provider 保存密钥'
                    : 'Key required · Save secret key in Models'}
              </span>
            </div>
            <StatusBadge
              tone={keyReady ? 'success' : 'warning'}
              label={keyReady ? (input.isChinese ? '已就绪' : 'Ready') : (input.isChinese ? '未配置' : 'Not configured')}
            />
          </div>
        ) : (
          <div className="speech-live-key-card" data-testid="settings-live-key">
            <div className="speech-live-key-header">
              <div className="speech-live-key-title">
                <IconShield size={14} />
                <span>{input.isChinese ? 'Gemini API Key' : 'Gemini API Key'}</span>
              </div>
              <span className={`speech-key-status ${keyReady ? 'is-ready' : 'is-empty'}`}>
                {keyReady
                  ? input.isChinese
                    ? '已保存 · 不会回显'
                    : 'Saved · never shown'
                  : input.isChinese
                    ? '未设置 · 不会回显'
                    : 'Not set · never shown'}
              </span>
            </div>
            <div className="speech-live-key-input-row">
              <div className="speech-live-key-field">
                <PasswordInput
                  testId="settings-live-key-input"
                  value={input.keyDraft}
                  disabled={input.busy}
                  placeholder={
                    keyReady
                      ? '••••••••••••••••'
                      : input.isChinese
                        ? '输入 Gemini API Key'
                        : 'Enter Gemini API key'
                  }
                  autoComplete="off"
                  onChange={(event) => input.onKeyDraft(event.currentTarget.value)}
                />
              </div>
              <div className="speech-live-key-actions">
                <Button
                  data-testid="settings-live-key-save"
                  size="compact"
                  variant="primary"
                  disabled={input.busy || input.keyDraft.trim().length === 0}
                  onClick={() => void input.onSubmitKey('set')}
                >
                  {keyReady
                    ? input.isChinese
                      ? '更换密钥'
                      : 'Replace key'
                    : input.isChinese
                      ? '保存密钥'
                      : 'Save key'}
                </Button>
                {keyReady ? (
                  <Button
                    data-testid="settings-live-key-clear"
                    size="compact"
                    disabled={input.busy}
                    variant="ghost"
                    onClick={() => void input.onSubmitKey('clear')}
                  >
                    {input.isChinese ? '清除' : 'Clear'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
