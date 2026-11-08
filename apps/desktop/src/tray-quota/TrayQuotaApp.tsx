/**
 * macOS menu-bar OAuth quota popover UI.
 *
 * Design (方案 A: 极简无框列表):
 * - 完全移除外层卡片框和内外边距堆叠，单层纯净毛玻璃面板。
 * - 无顶栏冗余文字胶囊与“打开 piwin”按钮，无底栏。
 * - 点击任意平台的品牌图标或整行，立即收起下拉并唤起 piwin 主窗口。
 * - 进度条采用 4px 细条，两端对齐，自然紧凑。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { QuotaWindow, SubscriptionAccount, SubscriptionAccountQuota } from '@piwin/contracts';
import { ProviderIcon } from '@piwin/ui-kit';
import { AlertCircle, Clock, RefreshCw } from 'lucide-react';
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

/** Format reset timestamps or text nicely (handles unix epoch strings like '1793865600'). */
function formatResetTime(resetText?: string): string | undefined {
  if (!resetText) return undefined;
  const match = /^(?:重置\s*)?(\d{10,13})$/.exec(resetText.trim());
  if (match && match[1]) {
    const rawNum = Number(match[1]);
    const ms = match[1].length === 10 ? rawNum * 1000 : rawNum;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      const diffHours = Math.round((ms - Date.now()) / (1000 * 60 * 60));
      if (diffHours > 0 && diffHours <= 48) {
        return `${diffHours}小时后`;
      }
      return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
  }
  return resetText.replace(/^重置\s*/, '');
}

export type TrayQuotaViewProps = {
  state: TrayQuotaStatePayload;
  onRefreshProvider: (providerId: string) => void;
  onOpenPiwin: () => void;
};

export function TrayQuotaView({
  state,
  onRefreshProvider,
  onOpenPiwin,
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

  return (
    <div
      className={`tray-quota-popover is-${state.themeMode}`}
      data-testid="tray-quota-popover"
      data-theme={state.themeMode}
    >
      <div className="tray-quota-flat-list" role="list">
        {connectedAccounts.map((account) => (
          <TrayProviderRow
            key={account.providerId}
            account={account}
            quota={state.quotas[account.providerId]}
            loading={loadingSet.has(account.providerId)}
            isZh={isZh}
            onRefresh={() => onRefreshProvider(account.providerId)}
            onOpenPiwin={onOpenPiwin}
          />
        ))}
      </div>
    </div>
  );
}

type TrayProviderRowProps = {
  account: SubscriptionAccount;
  quota: SubscriptionAccountQuota | undefined;
  loading: boolean;
  isZh: boolean;
  onRefresh: () => void;
  onOpenPiwin: () => void;
};

function TrayProviderRow({
  account,
  quota,
  loading,
  isZh,
  onRefresh,
  onOpenPiwin,
}: TrayProviderRowProps): ReactElement {
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

  return (
    <article
      className="tray-provider-row"
      role="listitem"
      data-testid={`tray-provider-card-${account.providerId}`}
      onClick={onOpenPiwin}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenPiwin();
        }
      }}
      tabIndex={0}
      title={isZh ? '点击图案打开 piwin' : 'Click to open piwin'}
    >
      {/* Platform Title Bar */}
      <div className="tray-provider-title-bar">
        <div className="tray-provider-identity">
          <span
            className={`tray-provider-icon is-${meta.markClass}`}
            aria-hidden="true"
            data-testid={`tray-provider-icon-${account.providerId}`}
          >
            <ProviderIcon id={meta.iconId} name={meta.title} size={18} />
          </span>
          <div className="tray-provider-name-cluster">
            <strong className="tray-provider-name">{isZh ? meta.title : meta.titleEn}</strong>
            {quota?.planType ? (
              <span className="tray-plan-badge">{quota.planType}</span>
            ) : meta.badgeText ? (
              <span className="tray-plan-badge">{meta.badgeText}</span>
            ) : null}
          </div>
        </div>

        <div className="tray-provider-header-right">
          {quota?.accountEmailOrId ? (
            <span className="tray-provider-account" title={quota.accountEmailOrId}>
              {quota.accountEmailOrId}
            </span>
          ) : quota?.renewalInfo ? (
            <span className="tray-provider-renewal">
              {formatResetTime(quota.renewalInfo)}
            </span>
          ) : null}

          {meta.supportsLiveQuota ? (
            <button
              type="button"
              className="tray-provider-refresh-mini"
              onClick={(event) => {
                event.stopPropagation();
                onRefresh();
              }}
              disabled={loading}
              title={isZh ? '刷新此项额度' : 'Refresh quota'}
              data-testid={`tray-provider-refresh-${account.providerId}`}
            >
              <RefreshCw size={11} className={loading ? 'is-spinning' : ''} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Quota Progress Windows */}
      {loading && meterWindows.length === 0 ? (
        <div className="tray-row-loading" data-testid={`tray-provider-loading-${account.providerId}`}>
          <RefreshCw size={11} className="is-spinning" />
          <span>{isZh ? '正在同步额度…' : 'Syncing…'}</span>
        </div>
      ) : meterWindows.length > 0 ? (
        <div className="tray-row-meters">
          {meterWindows.map(({ groupTitle, window: win }, idx) => {
            const fillPercent = quotaBarFillPercent(win);
            const tone = resolveWindowTone(win, fillPercent);
            const isDisabled = win.type === 'disabled';
            const displayLabel = groupTitle ? `${groupTitle} · ${win.label}` : win.label;
            const resetFormatted = formatResetTime(win.resetTimeText);
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
                className={`tray-flat-meter is-${tone}${isDisabled ? ' is-disabled' : ''}`}
              >
                <div className="tray-flat-meter-top">
                  <div className="tray-flat-meter-label-wrap">
                    <span className="tray-flat-meter-label" title={displayLabel}>
                      {displayLabel}
                    </span>
                    {resetFormatted ? (
                      <span className="tray-flat-meter-reset">
                        <Clock size={9} />
                        <span>{resetFormatted}</span>
                      </span>
                    ) : null}
                  </div>
                  <span className={`tray-flat-meter-val is-${tone}`}>{valueDisplay}</span>
                </div>
                {win.percentage !== undefined && !isDisabled ? (
                  <div className="tray-flat-track">
                    <div
                      className={`tray-flat-fill is-${tone}`}
                      style={{ width: `${fillPercent}%` }}
                      data-testid={`tray-meter-fill-${account.providerId}-${idx}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tray-row-empty">
          <AlertCircle size={11} />
          <span>
            {quota?.error ??
              (isZh ? '点击查看套餐详情' : 'Click to view details in piwin')}
          </span>
        </div>
      )}
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
      if (rect.height > 20) {
        void resizeTrayQuotaPopover(Math.ceil(rect.height));
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);

  const handleRefreshProvider = useCallback((providerId: string) => {
    void requestTrayQuotaState({ forceRefresh: true, providerId });
  }, []);

  const handleOpenPiwin = useCallback(() => {
    void openPiwinFromTray();
  }, []);

  return (
    <div ref={containerRef} className="tray-quota-shell">
      <TrayQuotaView
        state={state}
        onRefreshProvider={handleRefreshProvider}
        onOpenPiwin={handleOpenPiwin}
      />
    </div>
  );
}
