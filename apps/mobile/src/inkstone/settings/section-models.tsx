import type { ReactElement } from 'react';
import {
  THINKING_LEVEL_OPTIONS,
  type ConfiguredChatModel,
  type SubscriptionAccount,
  type SubscriptionAccountState,
  type ThinkingLevel,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Dot, ListRow, SectionLabel } from '../inkstone-ui.js';
import type { HostSettingsState } from './use-host-settings.js';
import { isObject, readArrayField, useHostQuery } from '../host/use-host-query.js';

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最大',
  ultra: 'Ultra',
};

export function ModelsSection({
  settings,
  models,
  onToast,
}: {
  settings: HostSettingsState;
  models: readonly ConfiguredChatModel[];
  onToast: (message: string) => void;
}): ReactElement {
  const config = settings.snapshot?.config;
  const defaultKey = `${config?.defaultProviderId ?? ''}:${config?.defaultModelId ?? ''}`;
  const thinking = config?.thinking;
  const levels = THINKING_LEVEL_OPTIONS.filter((level) => level !== 'ultra' || thinking?.ultraEnabled === true);

  const setDefault = async (model: ConfiguredChatModel): Promise<void> => {
    const providerError = await settings.apply('defaultProviderId', model.providerId);
    if (providerError !== undefined) {
      onToast(providerError);
      return;
    }
    const modelError = await settings.apply('defaultModelId', model.modelId);
    onToast(modelError ?? `默认模型 · ${model.label?.trim() || model.modelId}`);
  };

  return (
    <>
      <SectionLabel>默认模型 · 新会话使用</SectionLabel>
      {models.length === 0 ? <p className="muted">Host 还没有可用模型。</p> : null}
      {models.map((model) => {
        const key = `${model.providerId}:${model.modelId}`;
        const selected = key === defaultKey;
        return (
          <ListRow
            key={key}
            name="bulb"
            title={model.label?.trim() || model.modelId}
            subtitle={`${model.providerId}${model.source === 'subscription' ? ' · 订阅' : ''}`}
            selected={selected}
            trailing={selected ? <span className="seal-mini">默</span> : <span />}
            onClick={() => {
              if (!selected) void setDefault(model);
            }}
          />
        );
      })}
      {thinking !== undefined ? (
        <>
          <SectionLabel>默认思考强度</SectionLabel>
          <div className="chip-row">
            {levels.map((level) => (
              <button
                key={level}
                className="chip"
                type="button"
                aria-pressed={thinking.defaultLevel === level}
                disabled={settings.applying === 'thinking'}
                onClick={() => {
                  void settings
                    .apply('thinking', { ...thinking, defaultLevel: level })
                    .then((error) => onToast(error ?? `默认思考 · ${THINKING_LABELS[level]}`));
                }}
              >
                {THINKING_LABELS[level]}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="quote-note">新增供应商、API Key 与模型发现在桌面端完成；手机只切换 Host 已配置的模型。</p>
    </>
  );
}

const AUTH_COMMAND = { type: 'auth/status' } as const;

const AUTH_STATE: Record<SubscriptionAccountState, { label: string; dot: 'done' | 'waiting' | 'failed' | '' }> = {
  'logged-in': { label: '已登录', dot: 'done' },
  'logged-out': { label: '未登录', dot: '' },
  'logging-in': { label: '登录中', dot: 'waiting' },
  'needs-reauth': { label: '需要重新登录', dot: 'failed' },
  'sync-error': { label: '同步出错', dot: 'failed' },
};

export function AuthSection({ client }: { client: HostClient | undefined }): ReactElement {
  const { state } = useHostQuery(client, AUTH_COMMAND, readArrayField('accounts', isAccount));
  if (state.kind !== 'ready') {
    return (
      <p className="muted">
        {state.kind === 'error' ? state.message : state.kind === 'unsupported' ? '当前 Host 未开放订阅账号。' : '正在读取 Host 账号…'}
      </p>
    );
  }
  const accounts = state.data.filter((account) => account.surface === 'v1');
  return (
    <>
      {accounts.map((account) => {
        const view = AUTH_STATE[account.state];
        return (
          <ListRow
            key={account.providerId}
            name="key"
            title={account.providerId}
            subtitle={view.label}
            trailing={<Dot status={view.dot} />}
          />
        );
      })}
      <p className="quote-note">订阅凭据只保存在 Host。登录需要浏览器回调，请在桌面端完成；登录后手机立刻可用这些模型。</p>
    </>
  );
}

function isAccount(value: unknown): value is SubscriptionAccount {
  return isObject(value) && typeof value.providerId === 'string' && typeof value.state === 'string';
}
