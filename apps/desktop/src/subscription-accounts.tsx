import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  ActiveLoginStatus,
  AuthStatusData,
  HostCommand,
  SubscriptionAccount,
  SubscriptionAccountQuota,
  V1SubscriptionProviderId,
} from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey, V1_SUBSCRIPTION_PROVIDER_IDS } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import {
  AlertCircle,
  ChevronDown,
  Info,
  KeyRound,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { readDesktopClientPrincipalId } from './desktop-client-principal.js';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { ProviderIcon } from './provider-icons.js';
import { useSettings } from './settings/settings-context.js';
import { useConfirmDialog } from './use-confirm-dialog.js';
import { InlineAuthPromptForm, readAuthPromptOpenUrl, type ProviderCardMeta } from './auth-prompt-form.js';
import { SubscriptionQuotaDrawer } from './subscription-quota-drawer.js';
import { openExternalUrl } from './open-external-url.js';

const CARD_COPY: Record<V1SubscriptionProviderId, ProviderCardMeta> = {
  'kimi-coding': {
    title: 'Kimi Code',
    titleEn: 'Kimi Code',
    tagline: '月之暗面 Moonshot AI',
    taglineEn: 'Moonshot AI',
    login: '授权登录',
    loginEn: 'Connect',
  },
  'openai-codex': {
    title: 'ChatGPT Codex',
    titleEn: 'ChatGPT Codex',
    tagline: 'OpenAI 官方订阅',
    taglineEn: 'OpenAI Subscription',
    login: '授权登录',
    loginEn: 'Connect',
  },
  anthropic: {
    title: 'Claude',
    titleEn: 'Claude',
    tagline: 'Anthropic 官方会员',
    taglineEn: 'Anthropic Subscription',
    login: '授权登录',
    loginEn: 'Connect',
  },
  xai: {
    title: 'Grok',
    titleEn: 'Grok',
    tagline: 'xAI 官方订阅',
    taglineEn: 'xAI Subscription',
    login: '设备码登录',
    loginEn: 'Connect with Code',
  },
  'github-copilot': {
    title: 'GitHub Copilot',
    titleEn: 'GitHub Copilot',
    tagline: 'GitHub 订阅授权',
    taglineEn: 'GitHub Subscription',
    login: '授权登录',
    loginEn: 'Connect',
  },
};

const STATE_LABEL: Record<SubscriptionAccount['state'], { zh: string; en: string }> = {
  'logged-out': { zh: '未连接', en: 'Not connected' },
  'logging-in': { zh: '连接中...', en: 'Connecting...' },
  'logged-in': { zh: '已连接', en: 'Connected' },
  'needs-reauth': { zh: '需重新登录', en: 'Re-auth required' },
  'sync-error': { zh: '同步失败', en: 'Sync failed' },
};

export function SubscriptionAccountsPanel(): ReactElement {
  const { hostClient, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [accounts, setAccounts] = useState<SubscriptionAccount[]>([]);
  const [activeLogin, setActiveLogin] = useState<ActiveLoginStatus | undefined>();
  const [respondValue, setRespondValue] = useState('');
  const [quotas, setQuotas] = useState<Map<string, SubscriptionAccountQuota>>(new Map());
  const [expandedQuotaIds, setExpandedQuotaIds] = useState<Set<string>>(new Set());
  const [loadingQuotaIds, setLoadingQuotaIds] = useState<Set<string>>(new Set());
  const [resettingQuotaIds, setResettingQuotaIds] = useState<Set<string>>(new Set());
  const confirmDialog = useConfirmDialog();
  const ownerDeviceId = readDesktopClientPrincipalId();

  const fetchQuota = useCallback(
    async (providerId: string, forceRefresh = false) => {
      if (!hostClient?.request) return;
      setLoadingQuotaIds((prev) => new Set(prev).add(providerId));
      try {
        const response = await hostClient.request({
          type: 'auth/quota',
          input: { providerId, forceRefresh },
        });
        if (response.success && response.data && typeof response.data === 'object') {
          const data = response.data as { quota?: SubscriptionAccountQuota };
          if (data.quota) {
            setQuotas((prev) => new Map(prev).set(providerId, data.quota!));
          }
        } else if (!response.success && response.error) {
          setError?.(response.error);
        }
      } finally {
        setLoadingQuotaIds((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [hostClient, setError],
  );

  const triggerResetQuota = useCallback(
    async (providerId: string) => {
      if (!hostClient?.request) return;
      const ok = await confirmDialog.confirm({
        title: isChinese ? '重置额度' : 'Reset Quota',
        description: isChinese
          ? '确定立即消耗一次主动重置额度机会吗？'
          : 'Are you sure you want to consume an active reset token now?',
        confirmLabel: isChinese ? '确认重置' : 'Reset',
        cancelLabel: isChinese ? '取消' : 'Cancel',
      });
      if (!ok) return;

      setResettingQuotaIds((prev) => new Set(prev).add(providerId));
      try {
        const response = await hostClient.request({
          type: 'auth/reset-quota',
          input: { providerId },
        });
        if (response.success && response.data && typeof response.data === 'object') {
          const data = response.data as { quota?: SubscriptionAccountQuota; message?: string };
          if (data.quota) {
            setQuotas((prev) => new Map(prev).set(providerId, data.quota!));
          }
          setInfo?.(data.message ?? (isChinese ? '额度重置成功' : 'Quota reset successfully'));
        } else if (!response.success && response.error) {
          setError?.(response.error);
        }
      } finally {
        setResettingQuotaIds((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [confirmDialog, hostClient, isChinese, setError, setInfo],
  );

  const toggleQuotaDrawer = useCallback(
    (providerId: string) => {
      setExpandedQuotaIds((prev) => {
        const next = new Set(prev);
        if (next.has(providerId)) {
          next.delete(providerId);
        } else {
          next.add(providerId);
          void fetchQuota(providerId, false);
        }
        return next;
      });
    },
    [fetchQuota],
  );

  const refresh = useCallback(async () => {
    if (!hostClient?.request) {
      return;
    }
    const response = await hostClient.request({ type: 'auth/status' });
    if (!response.success || !response.data || typeof response.data !== 'object') {
      return;
    }
    const data = response.data as AuthStatusData;
    setAccounts(data.accounts.filter((account) => account.surface === 'v1'));
    setActiveLogin(data.activeLogin);
  }, [hostClient]);

  useEffect(() => {
    void refresh();
    return hostClient?.subscribe((message) => {
      if (message.type === 'auth/updated') {
        setAccounts(message.accounts.filter((account) => account.surface === 'v1'));
      }
      if (message.type === 'auth/quota-updated' && message.quota) {
        setQuotas((prev) => new Map(prev).set(message.quota.providerId, message.quota));
      }
      if (message.type === 'auth/prompt') {
        setActiveLogin((current) => {
          if (current && current.loginId !== message.prompt.loginId) {
            return current;
          }
          const preservedAuthUrl = message.prompt.kind === 'auth_url' ? message.prompt : current?.authUrl;
          const next: ActiveLoginStatus = {
            loginId: message.prompt.loginId,
            providerId: message.prompt.providerId,
            ownerDeviceId: current?.ownerDeviceId ?? ownerDeviceId,
            ownerConnected: true,
            startedAt: current?.startedAt ?? new Date().toISOString(),
            currentPrompt: message.prompt,
            ...(preservedAuthUrl ? { authUrl: preservedAuthUrl } : {}),
          };
          return next;
        });
      }
      if (message.type === 'auth/login-finished') {
        setActiveLogin(undefined);
        setRespondValue('');
        void refresh();
      }
    });
  }, [hostClient, ownerDeviceId, refresh]);

  const send = useCallback(
    async (command: HostCommand): Promise<boolean> => {
      if (!hostClient?.request) {
        return false;
      }
      const idempotencyKey = remoteCommandRequiresIdempotencyKey(command.type)
        ? createGestureIdempotencyKey()
        : undefined;
      const response = await hostClient.request(
        command,
        idempotencyKey ? { idempotencyKey } : undefined,
      );
      if (!response.success) {
        setError?.(response.error ?? 'OAuth operation failed');
        return false;
      }
      return true;
    },
    [hostClient, setError],
  );

  async function startLogin(providerId: V1SubscriptionProviderId, collidingChannelId?: string): Promise<void> {
    if (collidingChannelId) {
      const ok = await confirmDialog.confirm({
        title: isChinese ? '通道冲突' : 'Channel Conflict',
        description: isChinese
          ? `将重命名现有的「${collidingChannelId}」通道。是否继续？`
          : `This will rename the existing "${collidingChannelId}" channel. Continue?`,
        confirmLabel: isChinese ? '继续登录' : 'Continue',
        cancelLabel: isChinese ? '取消' : 'Cancel',
      });
      if (!ok) return;
    }
    const ok = await send({
      type: 'auth/login',
      input: {
        providerId,
        ownerDeviceId,
        preferLoopback: true,
        ...(collidingChannelId ? { relocateChannelId: collidingChannelId } : {}),
      },
    });
    if (ok) {
      setActiveLogin({
        loginId: '',
        providerId,
        ownerDeviceId,
        ownerConnected: true,
        startedAt: new Date().toISOString(),
      });
      await refresh();
    }
  }

  async function startLogout(providerId: V1SubscriptionProviderId): Promise<void> {
    const ok = await confirmDialog.confirm({
      title: isChinese ? '退出登录' : 'Sign out',
      description: isChinese
        ? '退出后该平台的模型将无法继续使用，确定退出吗？'
        : 'Models from this provider will be disabled. Sign out?',
      confirmLabel: isChinese ? '确定退出' : 'Sign out',
      cancelLabel: isChinese ? '取消' : 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    const success = await send({
      type: 'auth/logout',
      input: {
        providerId,
      },
    });
    if (success) {
      setInfo?.(isChinese ? '已退出登录' : 'Signed out');
      await refresh();
    }
  }

  const prompt = activeLogin?.currentPrompt;

  // Auto-open external auth URL only when an auth_url or device_code prompt first arrives.
  // Do NOT re-open on subsequent prompts (e.g. callback URL input) that inherit the stored authUrl.
  useEffect(() => {
    if (prompt?.kind !== 'auth_url' && prompt?.kind !== 'device_code') return;
    const targetUrl = readAuthPromptOpenUrl(prompt);
    if (targetUrl) {
      void openExternalUrl(targetUrl);
    }
  }, [prompt?.promptId]);

  return (
    <section className="oauth-accounts" data-testid="subscription-accounts">
      <div className="oauth-account-grid">
        {V1_SUBSCRIPTION_PROVIDER_IDS.map((providerId) => {
          const account = accounts.find((item) => item.providerId === providerId);
          const copy = CARD_COPY[providerId];
          const isLoggingIn = activeLogin?.providerId === providerId;
          const state: SubscriptionAccount['state'] = isLoggingIn
            ? 'logging-in'
            : (account?.state ?? 'logged-out');
          const isConnected = state === 'logged-in';
          const isExpanded = isLoggingIn;

          return (
            <article
              key={providerId}
              className={`oauth-account-card is-${state}${isExpanded ? ' is-expanded' : ''}`}
              data-testid={`subscription-account-${providerId}`}
            >
              <div className="oauth-card-top">
                <div className="oauth-card-header">
                  <div className="oauth-brand-wrapper">
                    <span className={`oauth-account-mark is-${providerId}`} aria-hidden="true">
                      <ProviderIcon id={providerId} name={copy.title} size={36} />
                    </span>
                    <div className="oauth-brand-meta">
                      <div className="oauth-brand-title-row">
                        <strong className="oauth-brand-title">{isChinese ? copy.title : copy.titleEn}</strong>
                      </div>
                      <span className="oauth-brand-tagline">{isChinese ? copy.tagline : copy.taglineEn}</span>
                    </div>
                  </div>

                  <span
                    className={`oauth-status-badge is-${state}`}
                    data-testid={`subscription-account-state-${providerId}`}
                  >
                    <span className={`oauth-status-dot${isConnected ? ' is-pulse' : ''}${isLoggingIn ? ' is-spinning' : ''}`} />
                    {isChinese ? STATE_LABEL[state].zh : STATE_LABEL[state].en}
                  </span>
                </div>

                {account?.collidingChannelId ? (
                  <div className="oauth-collision-notice">
                    <AlertCircle size={13} />
                    <span>
                      {isChinese
                        ? `通道 ID「${account.collidingChannelId}」已占用，登录时将自动改名为 API Key 通道。`
                        : `Channel ID "${account.collidingChannelId}" is taken and will be renamed.`}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="oauth-account-footer">
                <div className="oauth-account-actions">
                  {state === 'logged-out' || state === 'needs-reauth' ? (
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => void startLogin(providerId, account?.collidingChannelId)}
                    >
                      <KeyRound size={13} />
                      <span>{isChinese ? copy.login : copy.loginEn}</span>
                    </Button>
                  ) : isLoggingIn ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      onClick={() =>
                        activeLogin
                          ? void send({
                              type: 'auth/cancel',
                              loginId: activeLogin.loginId,
                              ownerDeviceId,
                            })
                          : undefined
                      }
                    >
                      {isChinese ? '取消连接' : 'Cancel'}
                    </Button>
                  ) : (
                    <>
                      {/* Active Reset Quota Action (if available) */}
                      {quotas.get(providerId)?.activeResets?.canTriggerReset && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => void triggerResetQuota(providerId)}
                          disabled={resettingQuotaIds.has(providerId) || loadingQuotaIds.has(providerId)}
                          data-testid={`subscription-quota-reset-${providerId}`}
                        >
                          <RefreshCw size={12} className={resettingQuotaIds.has(providerId) ? 'is-spinning' : ''} />
                          <span>{isChinese ? '重置额度' : 'Reset'}</span>
                        </Button>
                      )}

                      {/* Quota Drawer Toggle & Refresh Button */}
                      <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => toggleQuotaDrawer(providerId)}
                        disabled={loadingQuotaIds.has(providerId)}
                        data-testid={`subscription-quota-toggle-${providerId}`}
                        className="oauth-quota-toggle-btn"
                      >
                        <RefreshCw
                          size={12}
                          className={loadingQuotaIds.has(providerId) ? 'is-spinning' : ''}
                        />
                        <span>{isChinese ? '刷新额度' : 'Quota'}</span>
                        <ChevronDown
                          size={12}
                          className={`oauth-drawer-caret${expandedQuotaIds.has(providerId) ? ' is-open' : ''}`}
                        />
                      </Button>

                      <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => void startLogout(providerId)}
                      >
                        <LogOut size={13} />
                        <span>{isChinese ? '退出登录' : 'Sign out'}</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Expandable Quota Drawer for Connected Accounts */}
              {isConnected && expandedQuotaIds.has(providerId) && (
                <SubscriptionQuotaDrawer
                  quota={quotas.get(providerId)}
                  loading={loadingQuotaIds.has(providerId)}
                  isChinese={isChinese}
                  onRefresh={() => void fetchQuota(providerId, true)}
                  onReset={() => void triggerResetQuota(providerId)}
                  isResetting={resettingQuotaIds.has(providerId)}
                />
              )}

              {/* Inline Embedded Form when logging in (no modal popup!) */}
              {isLoggingIn && (
                <div className="oauth-account-inline-drawer" data-testid={`subscription-inline-drawer-${providerId}`}>
                  {prompt && prompt.kind !== 'prompt-cancelled' ? (
                    <InlineAuthPromptForm
                      prompt={prompt}
                      {...(activeLogin?.authUrl ? { authUrl: activeLogin.authUrl } : {})}
                      value={respondValue}
                      onChange={setRespondValue}
                      isChinese={isChinese}
                      onSubmit={(value) => {
                        void send({
                          type: 'auth/respond',
                          input: {
                            loginId: activeLogin?.loginId ?? prompt.loginId,
                            promptId: prompt.promptId,
                            value,
                            ownerDeviceId,
                          },
                        });
                        setRespondValue('');
                      }}
                      onCancel={() => {
                        if (activeLogin) {
                          void send({
                            type: 'auth/cancel',
                            loginId: activeLogin.loginId,
                            ownerDeviceId,
                          });
                        }
                      }}
                    />
                  ) : (
                    <div className="oauth-inline-loading">
                      <span className="oauth-status-dot is-spinning" />
                      <span>{isChinese ? '正在初始化授权流程...' : 'Initializing authorization...'}</span>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="oauth-accounts-notice">
        <Info size={14} className="oauth-notice-icon" />
        <p className="oauth-accounts-footnote">
          {isChinese
            ? '💡 提示：套餐凭证保存在 ~/.pi/agent/auth.json。登录后会在「模型配置」加入可操作的 Provider（参数、开关、默认模型）。图片/视频生成仍只用通道。'
            : '💡 Tip: Subscription credentials stay in ~/.pi/agent/auth.json. Login adds an operable Provider in Models (params, toggles, default). Image/video generation still uses channels.'}
        </p>
      </div>
      {confirmDialog.dialog}
    </section>
  );
}
