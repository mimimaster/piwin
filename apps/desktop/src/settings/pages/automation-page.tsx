/**
 * Settings → Automation page (Wave 2 migration from SettingsPanel).
 * Sub-agents are merged into Automation as a separate section until a tabbed
 * refactor lands in Phase 5.
 */
import type { ReactElement } from 'react';
import { AutomationPanel } from '../../AutomationPanel';
import { SubAgentPanel } from '../../SubAgentPanel';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

export function AutomationPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { projectPath, requestAutomation, requestSubAgent, activeSessionId, onOpenSubagentSession } = useSettings();

  return (
    <div className="settings-card">
      <AutomationPanel
        projectPath={projectPath}
        request={requestAutomation}
        variant="inline"
      />

      {requestSubAgent && (
        <div className="settings-section" data-testid="settings-automation-subagents">
          <SubAgentPanel
            parentSessionId={activeSessionId}
            request={requestSubAgent}
            variant="embedded"
            onOpenSession={(sessionId) => onOpenSubagentSession?.(sessionId)}
          />
        </div>
      )}
      {!requestSubAgent && (
        <p className="muted settings-section">
          {isChinese ? '当前壳层无法使用子代理 Host 命令。' : 'Sub-agent host commands are unavailable in this shell.'}
        </p>
      )}
    </div>
  );
}
