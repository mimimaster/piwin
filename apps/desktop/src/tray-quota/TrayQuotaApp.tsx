/**
 * macOS menu-bar OAuth quota popover UI.
 *
 * Displays connected OAuth subscription accounts, live quota progress bars,
 * reset countdowns, active reset credits, and extra usage. Clicking a card
 * or the footer actions raises and focuses the main `piwin` window.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { QuotaWindow, SubscriptionAccount, SubscriptionAccountQuota } from '@piwin/contracts';
import { ProviderIcon } from '@piwin/ui-kit';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Settings2,
  Sparkles,
  Zap,
} from 'lucide-react';
import { quotaBarFillPercent } from '../models/subscription-quota-drawer.js';
import {
  filterConnectedOauthAccounts,
  hideTrayQuotaPopover,
  listenTrayQuotaOpened,
  listenTrayQuotaState,
  openPiwinFromTray,
  requestTrayQuotaState,
  resizeTrayQuotaPopover,
  resolveTrayProviderMeta,
  type TrayQuotaStatePayload,
} from './tray-quota-state-bridge.js';

const INITIAL_STATE: TrayQuotaStatePayload = {
  accounts: [],
  quotas: {},
  loadingProviderIds: [],
  locale: 'zh-CN',
  themeMode: 'dark',
};

function resolveWindowTone(window: QuotaWindow, fillPercent: number): 'mint' | 'amber' | 'coral' {
  if (window.colorTone === 'coral' || fillPercent <= 15) {
    return 'coral';
  }
  if (window.colorTone === 'amber' || fillPercent <= 40) {
    return 'amber';
  }
  return 'mint';
}

export type TrayQuotaViewProps = {
  state: TrayQuotaStatePayload;
  onRefreshAll: () => void;
  onRefreshProvider: (providerId: string) => void;
  onOpenPiwinWorkspace: () => void;
  onOpenOauthSettings: (providerId?: string) => void;
};

export function TrayQuotaView({
  state,
  onRefreshAll,
  onRefreshProvider,
  onOpenPiwinWorkspace,
  onOpenOauthSettings,
}: TrayQuotaViewProps): ReactElement {
  const isZh = state.locale === 'zh-CN';
  const connectedAccounts = useMemo(
    () => filterConnectedOauthAccounts(state.accounts),
    [state.accounts],
  );
  const loadingSet = useMemo(
    () => new Set(state.loadingProviderIds),
    [state.loadingProviderIds],
  );
  const anyLoading = loadingSet.size > 0;

  const latestSyncTime = useMemo(() => {
    let latestMs = 0;
    for (const account of connectedAccounts) {
      const quota = state.quotas[account.providerId];
      if (quota?.lastUpdated) {
        const parsed = Date.parse(quota.lastUpdated);
        if (!Number.isNaN(parsed) && parsed > latestMs) {
          latestMs = parsed;
        }
      }
    }
    if (latestMs === 0) return null;
    return new Date(latestMs).toLocaleTimeString(isZh ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [connectedAccounts, isZh, state.quotas]);

  return (
    <div
      className={`tray-quota-popover is-${state.themeMode}`}
      data-testid="tray-quota-popover"
      data-theme={state.themeMode}
    >
      {/* Top Bar */}
      <header className="tray-quota-header">
        <div className="tray-quota-brand">
          <span className="tray-quota-brand-mark" aria-hidden="true">
            <img src="/ui/alpaca-mark-white.png" alt="" className="tray-quota-brand-img" />
          </span>
          <div className="tray-quota-brand-text">
            <span className="tray-quota-brand-title">piwin</span>
            <span className="tray-quota-connected-pill" data-testid="tray-quota-connected-count">
              <span className="tray-quota-dot is-pulse" />
              <span>
                {isZh
                  ? `${connectedAccounts.length} 个套餐已连接`
                  : `${connectedAccounts.length} Active`}
              </span>
            </span>
          </div>
        </div>

        <div className="tray-quota-header-actions">
          <button
            type="button"
            className="tray-quota-icon-btn"
            onClick={onRefreshAll}
            disabled={anyLoading}
            title={isZh ? '刷新全部套餐额度' : 'Refresh all quotas'}
            data-testid="tray-quota-refresh-all"
          >
            <RefreshCw size={13} className={anyLoading ? 'is-spinning' : ''} />
          </button>
          <button
            type="button"
            className="tray-quota-open-chip"
            onClick={onOpenPiwinWorkspace}
            title={isZh ? '打开 piwin 主窗口' : 'Open piwin window'}
            data-testid="tray-quota-open-main-top"
          >
            <span>{isZh ? '打开 piwin' : 'Open piwin'}</span>
            <ArrowUpRight size={12} />
          </button>
        </div>
      </header>

      {/* Provider Cards */}
      <div className="tray-quota-list" role="list">
        {connectedAccounts.map((account) => (
          <TrayProviderQuotaCard
            key={account.providerId}
            account={account}
            quota={state.quotas[account.providerId]}
            loading={loadingSet.has(account.providerId)}
            isZh={isZh}
            onRefresh={() => onRefreshProvider(account.providerId)}
            onSelect={() => onOpenOauthSettings(account.providerId)}
          />
        ))}
      </div>

      {/* Footer Actions */}
      <footer className="tray-quota-footer">
        <div className="tray-quota-sync-meta">
          <CheckCircle2 size={12} className="tray-quota-sync-icon" />
          <span>
            {latestSyncTime
              ? isZh
                ? `更新于 ${latestSyncTime}`
                : `Synced ${latestSyncTime}`
              : isZh
                ? '实时额度监控'
                : 'Live Quota Monitor'}
          </span>
        </div>

        <div className="tray-quota-footer-btns">
          <button
            type="button"
            className="tray-quota-footer-btn is-secondary"
            onClick={() => onOpenOauthSettings()}
            data-testid="tray-quota-manage-oauth"
          >
            <Settings2 size={12} />
            <span>{isZh ? '套餐设置' : 'Settings'}</span>
          </button>
          <button
            type="button"
            className="tray-quota-footer-btn is-primary"
            onClick={onOpenPiwinWorkspace}
            data-testid="tray-quota-open-piwin"
          >
            <span>{isZh ? '进入工作台' : 'Open Workbench'}</span>
            <ArrowUpRight size={12} />
          </button>
        </div>
      </footer>
    </div>
  );
}

type TrayProviderQuotaCardProps = {
  account: SubscriptionAccount;
  quota: SubscriptionAccountQuota | undefined;
  loading: boolean;
  isZh: boolean;
  onRefresh: () => void;
  onSelect: () => void;
};

function TrayProviderQuotaCard({
  account,
  quota,
  loading,
  isZh,
  onRefresh,
  onSelect,
}: TrayProviderQuotaCardProps): ReactElement {
  const meta = resolveTrayProviderMeta(account.providerId, account.extension?.displayName);
  const meterWindows = useMemo(() => {
    if (!quota) return [];
    const list: Array<{ groupTitle?: string; window: QuotaWindow }> = [];
    for (const group of quota.groups) {
      for (const win of group.windows) {
        const hasMeter =
          win.percentage !== undefined ||
          (win.valueText !== undefined && win.valueText !== '已用 --' && win.valueText !== '--');
        if (hasMeter) {
          list.push({
            ...(group.title ? { groupTitle: group.title } : {}),
            window: win,
          });
        }
      }
    }
    return list;
  }, [quota]);

  const featureTags = useMemo(() => {
    if (!quota) return [];
    const tags: string[] = [];
    for (const group of quota.groups) {
      for (const win of group.windows) {
        if (
          win.percentage === undefined &&
          (win.valueText === '已用 --' || win.valueText === '--')
        ) {
          tags.push(win.label);
        }
      }
    }
    return tags.slice(0, 4);
  }, [quota]);

  return (
    <article
      className="tray-provider-card"
      role="listitem"
      data-testid={`tray-provider-card-${account.providerId}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
    >
      {/* Card Header */}
      <div className="tray-provider-header">
        <div className="tray-provider-identity">
          <span className={`tray-provider-icon is-${meta.markClass}`} aria-hidden="true">
            <ProviderIcon id={meta.iconId} name={meta.title} size={22} />
          </span>
          <div className="tray-provider-titles">
            <div className="tray-provider-title-row">
              <strong className="tray-provider-name">{isZh ? meta.title : meta.titleEn}</strong>
              {meta.badgeText ? (
                <span className="tray-provider-mode-badge">{meta.badgeText}</span>
              ) : null}
              {quota?.planType ? (
                <span className="tray-provider-plan-badge">
                  <Sparkles size={10} />
                  <span>{quota.planType}</span>
                </span>
              ) : null}
            </div>
            <span className="tray-provider-subtitle">
              {quota?.accountEmailOrId ?? (isZh ? meta.tagline : meta.taglineEn)}
            </span>
          </div>
        </div>

        <div className="tray-provider-right">
          {meta.supportsLiveQuota ? (
            <button
              type="button"
              className="tray-provider-refresh-btn"
              onClick={(event) => {
                event.stopPropagation();
                onRefresh();
              }}
              disabled={loading}
              title={isZh ? '刷新该套餐额度' : 'Refresh provider quota'}
              data-testid={`tray-provider-refresh-${account.providerId}`}
            >
              <RefreshCw size={11} className={loading ? 'is-spinning' : ''} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Quota Meters Body */}
      {loading && meterWindows.length === 0 ? (
        <div className="tray-provider-loading" data-testid={`tray-provider-loading-${account.providerId}`}>
          <RefreshCw size={12} className="is-spinning" />
          <span>{isZh ? '正在同步套餐额度…' : 'Syncing plan quota…'}</span>
        </div>
      ) : meterWindows.length > 0 ? (
        <div className="tray-provider-meters">
          {meterWindows.map(({ groupTitle, window: win }, idx) => {
            const fillPercent = quotaBarFillPercent(win);
            const tone = resolveWindowTone(win, fillPercent);
            const isDisabled = win.type === 'disabled';
            const displayLabel = groupTitle ? `${groupTitle} · ${win.label}` : win.label;
            const valueDisplay =
              win.valueText ??
              (win.percentage !== undefined
                ? win.type === 'used'
                  ? isZh
                    ? `已用 ${win.percentage}%`
                    : `${win.percentage}% used`
                  : isZh
                    ? `剩余 ${win.percentage}%`
                    : `${win.percentage}% left`
                : '--');

            return (
              <div
                key={win.id ?? `${displayLabel}-${idx}`}
                className={`tray-meter-row is-${tone}${isDisabled ? ' is-disabled' : ''}`}
              >
                <div className="tray-meter-top">
                  <span className="tray-meter-label" title={displayLabel}>
                    {displayLabel}
                  </span>
                  <div className="tray-meter-values">
                    {win.resetTimeText ? (
                      <span className="tray-meter-reset">
                        <Clock size={10} />
                        <span>{win.resetTimeText}</span>
                      </span>
                    ) : null}
                    <span className={`tray-meter-val is-${tone}`}>{valueDisplay}</span>
                  </div>
                </div>
                {win.percentage !== undefined && !isDisabled ? (
                  <div className="tray-meter-track">
                    <div
                      className={`tray-meter-fill is-${tone}`}
                      style={{ width: `${fillPercent}%` }}
                      data-testid={`tray-meter-fill-${account.providerId}-${idx}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : featureTags.length > 0 ? (
        <div className="tray-provider-tags">
          {featureTags.map((tag) => (
            <span key={tag} className="tray-provider-tag">
              <CheckCircle2 size={10} className="tray-tag-icon" />
              <span>{tag}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="tray-provider-empty">
          <AlertCircle size={12} />
          <span>
            {quota?.error ??
              (isZh ? '点击进入 piwin 查看套餐详情' : 'Click to view plan details in piwin')}
          </span>
        </div>
      )}

      {/* Extra pills: Active Resets / PAYG / Renewal */}
      {(quota?.activeResets && quota.activeResets.count > 0) ||
      quota?.payg?.enabled ||
      quota?.renewalInfo ? (
        <div className="tray-provider-extras">
          {quota?.activeResets && quota.activeResets.count > 0 ? (
            <span className="tray-extra-pill is-amber">
              <Zap size={10} />
              <span>
                {isZh
                  ? `可主动重置 ${quota.activeResets.count} 次`
                  : `${quota.activeResets.count} resets left`}
              </span>
            </span>
          ) : null}
          {quota?.payg?.enabled ? (
            <span className="tray-extra-pill is-neutral">
              <span>
                {isZh ? '额外消耗' : 'Extra'}: {quota.payg.usedText}
              </span>
            </span>
          ) : null}
          {quota?.renewalInfo ? (
            <span className="tray-extra-pill is-neutral">
              <Clock size={10} />
              <span>{quota.renewalInfo}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function TrayQuotaApp(): ReactElement {
  const [state, setState] = useState<TrayQuotaStatePayload>(INITIAL_STATE);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    let unlistenState: (() => void) | undefined;
    let unlistenOpened: (() => void) | undefined;

    void listenTrayQuotaState((nextState) => {
      if (active) {
        setState(nextState);
      }
    }).then((dispose) => {
      unlistenState = dispose;
    });

    void listenTrayQuotaOpened(() => {
      void requestTrayQuotaState({ forceRefresh: false });
    }).then((dispose) => {
      unlistenOpened = dispose;
    });

    void requestTrayQuotaState({ forceRefresh: false });

    return () => {
      active = false;
      unlistenState?.();
      unlistenOpened?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void hideTrayQuotaPopover();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (rect.height > 40) {
        void resizeTrayQuotaPopover(Math.ceil(rect.height + 12));
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);

  const handleRefreshAll = useCallback(() => {
    void requestTrayQuotaState({ forceRefresh: true });
  }, []);

  const handleRefreshProvider = useCallback((providerId: string) => {
    void requestTrayQuotaState({ forceRefresh: true, providerId });
  }, []);

  const handleOpenPiwinWorkspace = useCallback(() => {
    void openPiwinFromTray();
  }, []);

  const handleOpenOauthSettings = useCallback(() => {
    void openPiwinFromTray('oauth');
  }, []);

  return (
    <div ref={containerRef} className="tray-quota-shell">
      <TrayQuotaView
        state={state}
        onRefreshAll={handleRefreshAll}
        onRefreshProvider={handleRefreshProvider}
        onOpenPiwinWorkspace={handleOpenPiwinWorkspace}
        onOpenOauthSettings={handleOpenOauthSettings}
      />
    </div>
  );
}
