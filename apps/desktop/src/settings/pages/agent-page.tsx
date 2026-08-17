/**
 * Settings → Agent & Workflows page.
 * Unified intelligent agent orchestration hub aggregating:
 * - Subagent Schemes (Orchestration / Ultra Code)
 * - Automation & Hooks
 * - Artifacts Policy & Playground
 */
import { useState, type ReactElement } from 'react';
import { Button, SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { SubagentProfilesPage } from './subagents-page';
import { AutomationPanel } from '../../AutomationPanel';
import { SubAgentPanel } from '../../SubAgentPanel';
import { ArtifactPage } from './artifact-page';
import { ArtifactPlaygroundPage } from './artifact-playground-page';
import { useSettings } from '../settings-context';

type AgentSubTab = 'subagents' | 'automation' | 'artifact' | 'playground';

export function AgentPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const {
    projectPath,
    requestAutomation,
    requestSubAgent,
    activeSessionId,
    subagentChildren,
    subagentBatches,
    onOpenSubagentSession,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<AgentSubTab>('subagents');

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
            { value: 'subagents', label: isChinese ? '子代理编排 (Schemes)' : 'Orchestration' },
            { value: 'automation', label: isChinese ? '自动化与任务 (Automation)' : 'Automation' },
            { value: 'artifact', label: isChinese ? '产物与渲染 (Artifacts)' : 'Artifacts' },
            { value: 'playground', label: isChinese ? 'Artifact 实验场' : 'Playground' },
          ]}
          testId="agent-subtabs-control"
        />
      </div>

      {activeTab === 'subagents' && (
        <div data-testid="agent-tab-subagents">
          <SubagentProfilesPage />
        </div>
      )}

      {activeTab === 'automation' && (
        <div className="settings-card" data-testid="agent-tab-automation">
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
                {...(subagentBatches ? { batches: subagentBatches } : {})}
              />
            </div>
          )}
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
