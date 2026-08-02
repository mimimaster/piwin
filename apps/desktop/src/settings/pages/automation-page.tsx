/**
 * Settings → Automation page (Wave 2 migration from SettingsPanel).
 * Sub-agents are merged into Automation as a separate section until a tabbed
 * refactor lands in Phase 5.
 */
import { useMemo, type ReactElement } from 'react';
import { BUILTIN_SUBAGENT_PROFILE_SUMMARIES, type SubagentProfile } from '@piwin/contracts';
import { AutomationPanel } from '../../AutomationPanel';
import { SubAgentPanel } from '../../SubAgentPanel';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

export function AutomationPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const {
    projectPath,
    requestAutomation,
    requestSubAgent,
    activeSessionId,
    subagentChildren,
    onOpenSubagentSession,
    config,
  } = useSettings();

  const liveChildren =
    activeSessionId && subagentChildren
      ? Object.values(subagentChildren).filter((child) => child.parentSessionId === activeSessionId)
      : undefined;

  // CE-SUB-PROF: merge built-in profile summaries with Settings overrides by id.
  const profiles = useMemo<SubagentProfile[]>(() => {
    const settingsProfiles = config?.subagents?.profiles ?? [];
    const byId = new Map<string, SubagentProfile>();
    for (const builtin of BUILTIN_SUBAGENT_PROFILE_SUMMARIES) {
      byId.set(builtin.id, {
        id: builtin.id,
        description: builtin.description,
        isolation: 'readonly',
        source: 'builtin',
      });
    }
    for (const settingsProfile of settingsProfiles) {
      byId.set(settingsProfile.id, { ...settingsProfile, source: 'settings' });
    }
    return [...byId.values()];
  }, [config]);

  return (
    <div className="settings-card">
      <AutomationPanel projectPath={projectPath} request={requestAutomation} variant="inline" />

      {requestSubAgent && (
        <div
          className="settings-section settings-section-card"
          style={{ marginTop: 24 }}
          data-testid="settings-automation-subagents"
        >
          <SubAgentPanel
            parentSessionId={activeSessionId}
            request={requestSubAgent}
            variant="embedded"
            onOpenSession={(sessionId) => onOpenSubagentSession?.(sessionId)}
            {...(liveChildren ? { children: liveChildren } : {})}
            profiles={profiles}
          />
        </div>
      )}
      {!requestSubAgent && (
        <p className="muted settings-section">
          {isChinese
            ? '当前壳层无法使用子代理 Host 命令。'
            : 'Sub-agent host commands are unavailable in this shell.'}
        </p>
      )}
    </div>
  );
}
