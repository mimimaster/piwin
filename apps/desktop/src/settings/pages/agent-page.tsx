/**
 * Settings → Agent & Workflows page.
 * Automation, artifacts policy, and the artifact playground.
 * Orchestration schemes live in the dedicated `subagents` section.
 */
import { useState, type ReactElement } from 'react';
import { Button, SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { AutomationPanel } from '../../AutomationPanel';
import { SubAgentPanel } from '../../SubAgentPanel';
import { ArtifactPage } from './artifact-page';
import { ArtifactPlaygroundPage } from './artifact-playground-page';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';

type AgentSubTab = 'automation' | 'artifact' | 'playground';

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
    onOpenSubagentSession,
  } = settings;
  const automationAvailable = settingsHostSupportsCommand(settings, 'cron/list');

  const [activeTab, setActiveTab] = useState<AgentSubTab>(
    automationAvailable ? 'automation' : 'artifact',
  );

  const liveChildren =
    activeSessionId && subagentChildren
      ? Object.values(subagentChildren).filter((child) => child.parentSessionId === activeSessionId)
      : undefined;

  return (
    <div className="settings-card agent-hub-page" data-testid="settings-agent-hub">
      <div style={{ marginBottom: 16 }}>
        <SegmentedControl
          value={activeTab}
          onChange={(val) => setActiveTab(val as AgentSubTab)}
          data={[
            {
              value: 'automation',
              label: isChinese ? '自动化与任务 (Automation)' : 'Automation',
              disabled: !automationAvailable,
            },
            { value: 'artifact', label: isChinese ? '渲染 (Artifact)' : 'Artifact' },
            { value: 'playground', label: isChinese ? 'Artifact 实验场' : 'Playground' },
          ]}
          testId="agent-subtabs-control"
        />
      </div>

      {activeTab === 'automation' && (
        <div className="settings-card" data-testid="agent-tab-automation">
          <AutomationPanel projectPath={projectPath} request={requestAutomation} variant="inline" />
          {requestSubAgent ? (
            <SubAgentPanel
              parentSessionId={activeSessionId}
              request={requestSubAgent}
              variant="embedded"
              onOpenSession={(sessionId) => onOpenSubagentSession?.(sessionId)}
              {...(liveChildren ? { children: liveChildren } : {})}
              {...(subagentBatches ? { batches: subagentBatches } : {})}
            />
          ) : null}
        </div>
      )}

      {activeTab === 'artifact' && (
        <div data-testid="agent-tab-artifact">
          <ArtifactPage />
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="compact"
              onClick={() => setActiveTab('playground')}
              data-testid="artifact-goto-playground"
            >
              {isChinese ? '在 Artifact 实验场中调试 →' : 'Debug in Artifact Playground →'}
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'playground' && (
        <div data-testid="agent-tab-playground">
          <ArtifactPlaygroundPage />
        </div>
      )}
    </div>
  );
}
