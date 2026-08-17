/**
 * Settings → Extensions Hub page.
 * Unified capability extension hub aggregating:
 * - Skills & Rules
 * - MCP Tools
 * - Prompt Templates
 * - Plugins
 * - Pi Extensions
 */
import { useState, type ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';
import { SkillsPanel } from '../../SkillsPanel';
import { McpPanel } from '../../McpPanel';
import { PromptsPanel } from '../../PromptsPanel';
import { PluginsPanel } from '../../PluginsPanel';
import { ExtensionsPanel } from '../../ExtensionsPanel';

type ExtensionsSubTab = 'skills' | 'tools' | 'prompts' | 'plugins' | 'extensions';

export function ExtensionsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const {
    projectPath,
    activeSessionId,
    requestSkills,
    requestMcp,
    requestPrompts,
    requestPlugins,
    requestExtensions,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<ExtensionsSubTab>('skills');

  return (
    <div className="settings-card extensions-hub-page" data-testid="settings-extensions-hub">
      <div style={{ marginBottom: 16 }}>
        <SegmentedControl
          value={activeTab}
          onChange={(val) => setActiveTab(val as ExtensionsSubTab)}
          data={[
            { value: 'skills', label: isChinese ? '技能 (Skills)' : 'Skills' },
            { value: 'tools', label: isChinese ? 'MCP 工具 (Tools)' : 'MCP Tools' },
            { value: 'prompts', label: isChinese ? '提示词模板 (Prompts)' : 'Prompts' },
            { value: 'plugins', label: isChinese ? '插件 (Plugins)' : 'Plugins' },
            { value: 'extensions', label: isChinese ? '扩展 (Extensions)' : 'Extensions' },
          ]}
          testId="extensions-subtabs-control"
        />
      </div>

      {activeTab === 'skills' && (
        <div className="settings-card settings-card-flush" data-testid="settings-skills">
          <SkillsPanel request={requestSkills} projectPath={projectPath} variant="inline" />
        </div>
      )}

      {activeTab === 'tools' && (
        <div className="settings-card settings-card-flush" data-testid="settings-mcp">
          <McpPanel request={requestMcp} variant="inline" />
        </div>
      )}

      {activeTab === 'prompts' && (
        <div className="settings-card" data-testid="settings-prompts">
          <PromptsPanel projectPath={projectPath} request={requestPrompts} variant="inline" />
        </div>
      )}

      {activeTab === 'plugins' && (
        <div className="settings-card" data-testid="settings-plugins">
          <PluginsPanel request={requestPlugins} variant="inline" />
        </div>
      )}

      {activeTab === 'extensions' && (
        <div className="settings-card" data-testid="settings-extensions">
          <ExtensionsPanel
            projectPath={projectPath}
            sessionId={activeSessionId}
            request={requestExtensions}
            variant="inline"
          />
        </div>
      )}
    </div>
  );
}

