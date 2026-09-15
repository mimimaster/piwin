import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  ActiveLoginStatus,
  AuthStatusData,
  HostCommand,
  SubscriptionAccount,
  SubscriptionAccountQuota,
  SubscriptionOauthProviderId,
} from '@piwin/contracts';
import {
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  getSubscriptionBillingNotice,
  remoteCommandRequiresIdempotencyKey,
} from '@piwin/contracts';
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

const EXTENSION_PILL = '@gotgenes/pi-anthropic-auth';
const EXTENSION_ID = 'pi-anthropic-auth';

/** Official grid order: extension-path Claude sits directly under plain Claude. */
const OAUTH_DISPLAY_PROVIDER_IDS: readonly SubscriptionOauthProviderId[] = [
  'kimi-coding',
  'openai-codex',
  'anthropic',
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  'xai',
  'github-copilot',
];

type OauthCardId = (typeof OAUTH_DISPLAY_PROVIDER_IDS)[number];

const CARD_COPY: Record<OauthCardId, ProviderCardMeta> = {
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
    tagline: 'Pro/Max OAuth · 按 extra 计费',
    taglineEn: 'Pro/Max OAuth · extra usage',
    login: '授权登录',
    loginEn: 'Connect',
  },
  [CLAUDE_CODE_OAUTH_PROVIDER_ID]: {
    title: 'Claude',
    titleEn: 'Claude',
    tagline: 'Pro/Max OAuth · 走的套餐',
    taglineEn: 'Pro/Max OAuth · plan quota',
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

function isClaudeFamilyId(providerId: string): boolean {
  return providerId === 'anthropic' || providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID;
}

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
          const quota = data.quota;
          if (quota) {
            setQuotas((prev) => new Map(prev).set(providerId, quota));
            return;
          }
        }
        setQuotas((prev) =>
          new Map(prev).set(providerId, {
            providerId,
            groups: [],
            lastUpdated: new Date().toISOString(),
            error: !response.success
              ? (response.error ?? (isChinese ? '读取额度失败' : 'Failed to read quota'))
              : (isChinese ? '暂无可用额度数据' : 'No quota data available'),
          }),
        );
      } catch (error) {
        setQuotas((prev) =>
          new Map(prev).set(providerId, {
            providerId,
            groups: [],
            lastUpdated: new Date().toISOString(),
            error: error instanceof Error ? error.message : (isChinese ? '读取额度失败' : 'Failed to read quota'),
          }),
        );
      } finally {
        setLoadingQuotaIds((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [hostClient, isChinese],
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
        const alreadyOpen = prev.has(providerId);
        const next = new Set(prev);
        if (alreadyOpen) {
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
        if (message.result.ok) {
          if (message.result.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID) {
            setInfo?.(
              isChinese
                ? '已登录 Claude 扩展路径（套餐额度）。若曾登录 extra Claude，已自动退出。'
                : 'Signed in to Claude extension path (plan limits). Extra Claude was signed out if it was active.',
              'success',
            );
          } else if (message.result.providerId === 'anthropic') {
            const notice = getSubscriptionBillingNotice('anthropic', isChinese ? 'zh-CN' : 'en');
            setInfo?.(
              notice
                ? notice.afterLogin
                : isChinese
                  ? '已登录 Claude extra。若曾登录扩展路径，已自动退出。'
                  : 'Signed in to Claude extra. Extension-path Claude was signed out if it was active.',
              notice ? 'warning' : 'success',
            );
          } else {
            const notice = getSubscriptionBillingNotice(
              message.result.providerId,
              isChinese ? 'zh-CN' : 'en',
            );
            if (notice) {
              setInfo?.(notice.afterLogin, 'warning');
            }
          }
        }
        void refresh();
      }
    });
  }, [hostClient, isChinese, ownerDeviceId, refresh, setInfo]);

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

  async function startLogin(providerId: OauthCardId, collidingChannelId?: string): Promise<void> {
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
    // Two Claude cards are mutually exclusive — warn before Host kicks the sibling.
    if (isClaudeFamilyId(providerId)) {
      const siblingId =
        providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID ? 'anthropic' : CLAUDE_CODE_OAUTH_PROVIDER_ID;
      const sibling = accounts.find((item) => item.providerId === siblingId);
      if (sibling?.state === 'logged-in' || sibling?.state === 'needs-reauth' || sibling?.state === 'sync-error') {
        const ok = await confirmDialog.confirm({
          title: isChinese ? '切换 Claude 登录方式' : 'Switch Claude login mode',
          description: isChinese
            ? 'Claude extra 与扩展路径只能登录其中一个。继续将退出另一个 Claude 登录。'
            : 'Only one Claude mode can be signed in. Continue will sign out the other Claude card.',
          confirmLabel: isChinese ? '继续并顶掉另一个' : 'Continue and replace',
          cancelLabel: isChinese ? '取消' : 'Cancel',
          tone: 'danger',
        });
        if (!ok) return;
      }
    }
    if (providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID && hostClient?.request) {
      await hostClient.request({ type: 'extensions/ensure-bundled' });
      await hostClient.request({
        type: 'extensions/set_enabled',
        extensionId: EXTENSION_ID,
        enabled: true,
      });
    }
    const ok = await send({
      type: 'auth/login',
      input: {
        providerId,
        ownerDeviceId,
        preferLoopback: true,
        openAuthUrlOnHost: false,
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

  async function startLogout(providerId: OauthCardId): Promise<void> {
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

  const connectedCount = OAUTH_DISPLAY_PROVIDER_IDS.filter((id) => {
    const acc = accounts.find((item) => item.providerId === id);
    return acc?.state === 'logged-in';
  }).length;
  const displayCount = OAUTH_DISPLAY_PROVIDER_IDS.length;

  return (
    <section className="oauth-accounts" data-testid="subscription-accounts">
      <div className="oauth-accounts-header">
        <div className="oauth-accounts-header-left">
          <span className="oauth-accounts-header-title">
            {isChinese ? '官方订阅平台' : 'Official Subscription Providers'}
          </span>
          <span className="oauth-accounts-header-count">{displayCount}</span>
        </div>
        <div className="oauth-accounts-header-right">
          <span className="oauth-accounts-stat-badge">
            <span className={`oauth-status-dot ${connectedCount > 0 ? 'is-pulse' : ''}`} />
            <span>
              {isChinese
                ? `已连接 ${connectedCount} / ${displayCount}`
                : `${connectedCount} of ${displayCount} connected`}
            </span>
          </span>
        </div>
      </div>

      <div className="oauth-account-list oauth-account-grid">
        {OAUTH_DISPLAY_PROVIDER_IDS.map((providerId) => {
          const account = accounts.find((item) => item.providerId === providerId);
          const copy = CARD_COPY[providerId];
          const isExtensionClaude = providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID;
          const isLoggingIn = activeLogin?.providerId === providerId;
          const state: SubscriptionAccount['state'] = isLoggingIn
            ? 'logging-in'
            : (account?.state ?? 'logged-out');
          const isConnected = state === 'logged-in';
          const isExpanded = isLoggingIn;
          const isExpandedQuota = isConnected && expandedQuotaIds.has(providerId);
          const iconId = isExtensionClaude ? 'anthropic' : providerId;
          const markClass = isExtensionClaude ? 'anthropic' : providerId;

          return (
            <article
              key={providerId}
              className={`oauth-account-card oauth-account-row is-${state}${isExpanded ? ' is-expanded' : ''}${isExpandedQuota ? ' is-quota-open' : ''}`}
              data-testid={`subscription-account-${providerId}`}
            >
              <div className="oauth-card-top oauth-row-top">
                <div className="oauth-card-header oauth-row-header">
                  <div className="oauth-brand-wrapper">
                    <span className={`oauth-account-mark is-${markClass}`} aria-hidden="true">
                      <ProviderIcon id={iconId} name={copy.title} size={32} />
                    </span>
                    <div className="oauth-brand-meta">
                      <div className="oauth-brand-title-row">
                        <strong className="oauth-brand-title">{isChinese ? copy.title : copy.titleEn}</strong>
                        {isExtensionClaude ? (
                          <span
                            className="oauth-ext-pill"
                            data-testid="claude-extension-pill"
                            title={EXTENSION_PILL}
                          >
                            {EXTENSION_PILL}
                          </span>
                        ) : null}
                      </div>
                      <span className="oauth-brand-tagline">{isChinese ? copy.tagline : copy.taglineEn}</span>
                    </div>
                  </div>

                  <div className="oauth-row-controls">
                    <span
                      className={`oauth-status-badge is-${state}`}
                      data-testid={`subscription-account-state-${providerId}`}
                    >
                      <span className={`oauth-status-dot${isConnected ? ' is-pulse' : ''}${isLoggingIn ? ' is-spinning' : ''}`} />
                      {isChinese ? STATE_LABEL[state].zh : STATE_LABEL[state].en}
                    </span>

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

                          {/* Quota Drawer Toggle Button */}
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => toggleQuotaDrawer(providerId)}
                            disabled={loadingQuotaIds.has(providerId)}
                            data-testid={`subscription-quota-toggle-${providerId}`}
                            className={`oauth-quota-toggle-btn${isExpandedQuota ? ' is-open' : ''}`}
                          >
                            {loadingQuotaIds.has(providerId) ? (
                              <RefreshCw size={12} className="is-spinning" />
                            ) : null}
                            <span>{isChinese ? '额度详情' : 'Quota'}</span>
                            <ChevronDown
                              size={12}
                              className={`oauth-drawer-caret${isExpandedQuota ? ' is-open' : ''}`}
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

              {/* Expandable Quota Drawer for Connected Accounts */}
              {isExpandedQuota && (
                <SubscriptionQuotaDrawer
                  providerId={providerId}
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
        <Info size={13} className="oauth-notice-icon" />
        <p className="oauth-accounts-footnote">
          {isChinese
            ? '提示：套餐凭证均独立加密托管于本地 ~/.piwin/pi-agent/auth.json。图片及视频生成仍优先采用通道与独立 API 密钥。'
            : 'Tip: Subscription credentials are securely stored in ~/.piwin/pi-agent/auth.json. Image and video models continue to use dedicated channels.'}
        </p>
      </div>
      {confirmDialog.dialog}
    </section>
  );
}
