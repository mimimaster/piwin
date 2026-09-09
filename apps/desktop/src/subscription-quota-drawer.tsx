import type { ReactElement } from 'react';
import type { SubscriptionAccountQuota } from '@piwin/contracts';
import { AlertCircle, CheckCircle2, Clock, Mail, RefreshCw, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Button } from '@piwin/ui-kit';

export type SubscriptionQuotaDrawerProps = {
  quota: SubscriptionAccountQuota | undefined;
  loading: boolean;
  isChinese: boolean;
  onRefresh: () => void;
  onReset?: () => void;
  isResetting?: boolean;
};

export function SubscriptionQuotaDrawer({
  quota,
  loading,
  isChinese,
  onRefresh,
  onReset,
  isResetting = false,
}: SubscriptionQuotaDrawerProps): ReactElement {
  const hasWindows = Boolean(quota?.groups.some((group) => group.windows.length > 0));
  if (loading && !hasWindows) {
    return (
      <div className="oauth-quota-drawer is-loading" data-testid="subscription-quota-loading">
        <div className="oauth-quota-loading-state">
          <span className="oauth-status-dot is-spinning" />
          <span>{isChinese ? '正在读取最新额度与配额窗口...' : 'Fetching live quota and rate limit windows...'}</span>
        </div>
      </div>
    );
  }

  if (!quota || !hasWindows) {
    return (
      <div className="oauth-quota-drawer is-empty" data-testid="subscription-quota-empty">
        <div className="oauth-quota-empty-state">
          <AlertCircle size={14} className="text-muted" />
          <span>
            {quota?.error ??
              (isChinese ? '暂无可用额度数据' : 'No quota data available')}
          </span>
          <Button variant="secondary" size="compact" onClick={onRefresh}>
            <RefreshCw size={12} />
            <span>{isChinese ? '重试读取' : 'Retry'}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="oauth-quota-drawer" data-testid={`subscription-quota-drawer-${quota.providerId}`}>
      {/* Account & Plan Meta Bar */}
      <div className="oauth-quota-meta-bar">
        <div className="oauth-quota-account-info">
          {quota.accountEmailOrId ? (
            <span className="oauth-quota-account-id" title={quota.accountEmailOrId}>
              <Mail size={12} className="oauth-quota-account-icon" />
              <span>{quota.accountEmailOrId}</span>
            </span>
          ) : (
            <span className="oauth-quota-account-id is-official">
              <ShieldCheck size={12} className="oauth-quota-account-icon text-mint" />
              <span>{isChinese ? '官方订阅凭证有效' : 'Active Subscription Auth'}</span>
            </span>
          )}
        </div>
        <div className="oauth-quota-plan-tags">
          {quota.planType && (
            <span className="oauth-quota-plan-badge">
              <Sparkles size={11} />
              <span>{quota.planType} {isChinese ? '套餐' : 'Plan'}</span>
            </span>
          )}
          {quota.renewalInfo && (
            <span className="oauth-quota-renewal-text">
              <Clock size={11} />
              <span>{quota.renewalInfo}</span>
            </span>
          )}
        </div>
      </div>

      {/* Active Resets Box (if available for OpenAI Codex Plus) */}
      {quota.activeResets && quota.activeResets.count > 0 && (
        <div className="oauth-quota-resets-card">
          <div className="oauth-quota-resets-header">
            <div className="oauth-quota-resets-title">
              <Zap size={13} className="text-amber" />
              <span>{isChinese ? '主动重置可用次数' : 'Active Resets Available'}</span>
            </div>
            <span className="oauth-quota-resets-count">
              {quota.activeResets.count} {isChinese ? '次' : 'available'}
            </span>
          </div>

          {quota.activeResets.slots.length > 0 && (
            <div className="oauth-quota-resets-slots">
              {quota.activeResets.slots.map((slot) => (
                <div key={slot.index} className="oauth-quota-reset-slot-item">
                  <span className="oauth-quota-reset-slot-label">{slot.label}</span>
                  <span className="oauth-quota-reset-slot-time">{slot.expiresText}</span>
                </div>
              ))}
            </div>
          )}

          {quota.activeResets.canTriggerReset && onReset && (
            <div className="oauth-quota-resets-action">
              <Button
                variant="secondary"
                size="compact"
                onClick={onReset}
                disabled={isResetting || loading}
              >
                <RefreshCw size={12} className={isResetting ? 'is-spinning' : ''} />
                <span>{isResetting ? (isChinese ? '正在重置...' : 'Resetting...') : (isChinese ? '立即重置额度' : 'Reset Quota Now')}</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Quota Groups (e.g. Gemini group, Claude group, or standard windows) */}
      <div className="oauth-quota-groups-list">
        {quota.groups.map((group, gIdx) => {
          const meterWindows = group.windows.filter(
            (win) =>
              win.percentage !== undefined ||
              (win.valueText && win.valueText !== '已用 --' && win.valueText !== '--'),
          );
          const featureWindows = group.windows.filter(
            (win) =>
              win.percentage === undefined &&
              (win.valueText === '已用 --' || win.valueText === '--'),
          );

          return (
            <div key={group.id ?? gIdx} className="oauth-quota-group-card">
              {group.title && (
                <div className="oauth-quota-group-header">
                  <strong className="oauth-quota-group-title">{group.title}</strong>
                  {group.description && (
                    <span className="oauth-quota-group-desc">{group.description}</span>
                  )}
                </div>
              )}

              {/* Numerical/Progress Quota Meters */}
              {meterWindows.length > 0 && (
                <div className="oauth-quota-windows-list">
                  {meterWindows.map((win, wIdx) => {
                    const colorTone = win.colorTone ?? (win.type === 'used' ? 'amber' : 'mint');
                    const isDisabled = win.type === 'disabled';

                    return (
                      <div
                        key={win.id ?? wIdx}
                        className={`oauth-quota-window-item is-${colorTone}${isDisabled ? ' is-disabled' : ''}`}
                      >
                        <div className="oauth-quota-window-top">
                          <span className="oauth-quota-window-label">{win.label}</span>
                          <span className={`oauth-quota-window-val is-${colorTone}`}>
                            {win.valueText ?? (win.percentage !== undefined ? `${win.percentage}%` : '--')}
                          </span>
                        </div>

                        {win.percentage !== undefined && !isDisabled && (
                          <div className="oauth-quota-progress-track">
                            <div
                              className={`oauth-quota-progress-bar is-${colorTone}`}
                              style={{ width: `${Math.min(100, Math.max(0, win.percentage))}%` }}
                            />
                          </div>
                        )}

                        {win.resetTimeText && (
                          <div className="oauth-quota-window-bottom">
                            <Clock size={11} />
                            <span>{win.resetTimeText}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Functional/Capability Features without progress meters */}
              {featureWindows.length > 0 && (
                <div className="oauth-quota-capabilities">
                  <span className="oauth-quota-capabilities-title">
                    {isChinese ? '支持特性与辅助模型' : 'Included Models & Capabilities'}
                  </span>
                  <div className="oauth-quota-capabilities-list">
                    {featureWindows.map((win, fIdx) => (
                      <span key={win.id ?? fIdx} className="oauth-quota-capability-tag">
                        <CheckCircle2 size={11} className="text-mint" />
                        <span>{win.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* PAYG (Pay-As-You-Go) section (e.g. Grok) */}
      {quota.payg && (
        <div className="oauth-quota-payg-card">
          <div className="oauth-quota-payg-header">
            <span className="oauth-quota-payg-label">{isChinese ? '按量付费 (PAYG)' : 'Pay As You Go (PAYG)'}</span>
            <span className={`oauth-quota-payg-status ${quota.payg.enabled ? 'is-enabled' : 'is-disabled'}`}>
              {quota.payg.enabled ? (isChinese ? '已启用' : 'Enabled') : (isChinese ? '未启用' : 'Disabled')}
            </span>
          </div>
          {quota.payg.enabled && (
            <div className="oauth-quota-payg-usage">
              <span>{isChinese ? '月度消耗' : 'Monthly Usage'}: {quota.payg.usedText}</span>
              {quota.payg.resetText && <span>· {quota.payg.resetText}</span>}
            </div>
          )}
        </div>
      )}

      {/* Updated Footer */}
      <div className="oauth-quota-footer">
        <div className="oauth-quota-updated-text">
          <CheckCircle2 size={12} className="text-mint" />
          <span>{isChinese ? '已同步最新额度' : 'Synced with provider'}</span>
          {quota.lastUpdated && (
            <span className="oauth-quota-updated-time">
              {new Date(quota.lastUpdated).toLocaleTimeString(isChinese ? 'zh-CN' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        <button
          type="button"
          className="oauth-quota-recheck-btn"
          onClick={onRefresh}
          disabled={loading}
          title={isChinese ? '重新拉取最新额度' : 'Refresh quota'}
        >
          <RefreshCw size={11} className={loading ? 'is-spinning' : ''} />
          <span>{isChinese ? '刷新' : 'Refresh'}</span>
        </button>
      </div>
    </div>
  );
}
