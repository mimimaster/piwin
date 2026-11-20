/**
 * Settings → Extensions Hub page.
 * Unified capability extension hub aggregating:
 * - Skills & Rules
 * - MCP Tools
 * - Plugins
 * - Pi Extensions
 */
import { useState, type ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';
import { SkillsPanel } from '../../extensions/SkillsPanel';
import { McpPanel } from '../../mcp/McpPanel';
import { PluginsPanel } from '../../extensions/PluginsPanel';
import { ExtensionsPanel } from '../../extensions/ExtensionsPanel';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

type ExtensionsSubTab = 'extensions' | 'skills' | 'tools' | 'plugins';

export function ExtensionsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const settings = useSettings();
  const {
    projectPath,
    activeSessionId,
    requestSkills,
    requestMcp,
    requestPlugins,
    requestExtensions,
  } = settings;
  const extensionsReadOnly = !settingsHostSupportsCommand(settings, 'extensions/set_enabled');
  const toolsAvailable = settingsHostSupportsCommand(settings, 'mcp/get');
  const pluginsAvailable = settingsHostSupportsCommand(settings, 'plugins/list');
  const skillsAvailable = settingsHostSupportsCommand(settings, 'skills/list');
  const skillsReadOnly = !settingsHostSupportsCommand(settings, 'skills/set_enabled');

  const [activeTab, setActiveTab] = useState<ExtensionsSubTab>('extensions');
  useResetSettingsMainScroll(activeTab);

  return (
    <div className="settings-card settings-hub-page extensions-hub-page" data-testid="settings-extensions-hub">
      <div className="settings-hub-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(val) => setActiveTab(val as ExtensionsSubTab)}
          data={[
            { value: 'extensions', label: isChinese ? '扩展' : 'Extensions' },
            {
              value: 'skills',
              label: isChinese ? '技能' : 'Skills',
              disabled: !skillsAvailable,
            },
            {
              value: 'tools',
              label: isChinese ? 'MCP 工具' : 'MCP',
              disabled: !toolsAvailable,
            },
            {
              value: 'plugins',
              label: isChinese ? '插件' : 'Plugins',
              disabled: !pluginsAvailable,
            },
          ]}
          testId="extensions-subtabs-control"
        />
      </div>

      <div className="settings-hub-panels">
      {activeTab === 'extensions' && (
        <div className="settings-card" data-testid="settings-extensions">
          <ExtensionsPanel
            projectPath={projectPath}
            sessionId={activeSessionId}
            request={requestExtensions}
            variant="inline"
            readOnly={extensionsReadOnly}
          />
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="settings-card settings-card-flush" data-testid="settings-skills">
          <SkillsPanel
            request={requestSkills}
            projectPath={projectPath}
            variant="inline"
            readOnly={skillsReadOnly}
          />
        </div>
      )}

      {activeTab === 'tools' && (
        <div className="settings-card settings-card-flush" data-testid="settings-mcp">
          <McpPanel request={requestMcp} variant="inline" />
        </div>
      )}

      {activeTab === 'plugins' && (
        <div className="settings-card" data-testid="settings-plugins">
          <PluginsPanel
            request={requestPlugins}
            variant="inline"
            onError={settings.setError}
            onInfo={settings.setInfo}
          />
        </div>
      )}
      </div>
    </div>
  );
}
