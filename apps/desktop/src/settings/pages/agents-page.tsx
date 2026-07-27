/**
 * Settings → Sub-agents page (Wave 2 migration from SettingsPanel).
 * Wrapper markup (heading, beta badge, intro) moved from the legacy branch;
 * renders SubAgentPanel only when the host exposes sub-agent commands.
 */
import type { ReactElement } from 'react';
import { SubAgentPanel } from '../../SubAgentPanel';
import { getDesktopCopy } from '../../desktop-locale';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

export function AgentsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale);
  const { requestSubAgent, activeSessionId, onOpenSubagentSession } = useSettings();

  return (
    <div className="settings-card">
      <div className="settings-section">
        <div className="settings-heading-with-badge">
          <h4>{locale === 'zh-CN' ? '子代理' : 'Sub-agents'}</h4>
          <span className="settings-beta-badge" aria-label={copy.betaFeature}>Beta</span>
        </div>
        <p className="muted">
          {locale === 'zh-CN'
            ? '模型拉起的子代理会以活动卡片出现在父会话中。'
            : 'Model-spawned sub-agents appear as activity cards in their parent session.'}
        </p>
        {requestSubAgent ? (
          <SubAgentPanel
            parentSessionId={activeSessionId}
            request={requestSubAgent}
            variant="embedded"
            onOpenSession={(sessionId) => onOpenSubagentSession?.(sessionId)}
          />
        ) : (
          <p className="muted">{locale === 'zh-CN' ? '当前壳层无法使用子代理 Host 命令。' : 'Sub-agent host commands are unavailable in this shell.'}</p>
        )}
      </div>
    </div>
  );
}
