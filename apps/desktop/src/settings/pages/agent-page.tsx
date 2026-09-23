/**
 * Settings → Agent & Workflows page.
 * Automation (cron jobs and event hooks) plus the live subagent inspector.
 * Artifact policy and the playground are their own nav sections.
 * Orchestration schemes live in the dedicated `subagents` section.
 */
import type { ReactElement } from 'react';
import { AutomationPanel } from '../../AutomationPanel';
import { SubAgentPanel } from '../../SubAgentPanel';
import { useDesktopLocale } from '../../desktop-locale-context';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';

export function AgentPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const settings = useSettings();
  const {
    projectPath,
    requestAutomation,
    requestSubAgent,
    activeSessionId,
    subagentChildren,
    subagentBatches,
    subagentInvocations,
    onOpenSubagentSession,
  } = settings;
  const automationAvailable = settingsHostSupportsCommand(settings, 'cron/list');

  const liveChildren =
    activeSessionId && subagentChildren
      ? Object.values(subagentChildren).filter((child) => child.parentSessionId === activeSessionId)
      : undefined;

  if (!automationAvailable) {
    return (
      <div className="settings-card" data-testid="settings-agent-hub">
        <p className="muted" data-testid="agent-automation-unavailable">
          {isChinese
            ? '当前 Host 不支持自动化（缺少 cron/list）。'
            : 'This Host does not support automation (cron/list is unavailable).'}
        </p>
      </div>
    );
  }

  return (
    <div className="settings-card" data-testid="settings-agent-hub">
      <AutomationPanel projectPath={projectPath} request={requestAutomation} variant="inline" />
      {requestSubAgent ? (
        <SubAgentPanel
          parentSessionId={activeSessionId}
          request={requestSubAgent}
          variant="embedded"
          onOpenSession={(sessionId) => onOpenSubagentSession?.(sessionId)}
          {...(liveChildren ? { children: liveChildren } : {})}
          {...(subagentBatches ? { batches: subagentBatches } : {})}
          {...(subagentInvocations ? { invocations: subagentInvocations } : {})}
        />
      ) : null}
    </div>
  );
}
