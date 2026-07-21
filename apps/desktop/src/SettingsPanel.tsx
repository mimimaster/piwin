import { useEffect, useState } from 'react';
import type {
  PiwinConfig,
  HostResponse,
  WebConfig,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { ProviderSettings } from './ProviderSettings';
import { IconBack } from './shell-icons';
import { SkillsPanel, type SkillsPanelProps } from './SkillsPanel';
import { McpPanel, type McpPanelProps } from './McpPanel';
import { ExtensionsPanel, type ExtensionsPanelProps } from './ExtensionsPanel';
import { PromptsPanel, type PromptsPanelProps } from './PromptsPanel';
import { ThemePanel, type ThemePanelProps } from './ThemePanel';
import { PetPanel, type PetPanelProps } from './PetPanel';
import { MemoryPanel, type MemoryPanelProps } from './MemoryPanel';

type SettingsPanelProps = {
  request: (command: {
    type: 'config/get' | 'config/set';
    config?: PiwinConfig;
  }) => Promise<HostResponse>;
  onClose: () => void;
  onSaved?: (config: PiwinConfig) => void;
  toolCallDensity?: import('./ui-preferences').ToolCallDensity;
  onToolCallDensityChange?: (density: import('./ui-preferences').ToolCallDensity) => void;
  projectPath: string | null;
  requestSkills: SkillsPanelProps['request'];
  requestMcp: McpPanelProps['request'];
  requestExtensions: ExtensionsPanelProps['request'];
  requestPrompts: PromptsPanelProps['request'];
  requestTheme: ThemePanelProps['request'];
  requestPet: PetPanelProps['request'];
  requestMemory: MemoryPanelProps['request'];
  onThemeApplied: ThemePanelProps['onApplied'];
  onPetActiveChanged: PetPanelProps['onActiveChanged'];
  initialSection?: SettingsSectionId;
};

type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'models'
  | 'agents'
  | 'rules'
  | 'skills'
  | 'extensions'
  | 'prompts'
  | 'tools'
  | 'session'
  | 'memory';

type DraftWeb = {
  searchProvider: WebConfig['searchProvider'];
  searchApiKeyEnv: string;
  searchMaxResults: string;
  fetchMaxBytes: string;
  fetchTimeoutMs: string;
  fetchBlockedUrlPrefixes: string;
};

function webToDraft(web: WebConfig): DraftWeb {
  return {
    searchProvider: web.searchProvider,
    searchApiKeyEnv: web.searchApiKeyEnv,
    searchMaxResults: String(web.searchMaxResults),
    fetchMaxBytes: String(web.fetchMaxBytes),
    fetchTimeoutMs: String(web.fetchTimeoutMs),
    fetchBlockedUrlPrefixes: web.fetchBlockedUrlPrefixes.join(', '),
  };
}

function draftToWeb(draft: DraftWeb): WebConfig {
  const maxResults = Number(draft.searchMaxResults);
  const maxBytes = Number(draft.fetchMaxBytes);
  const timeoutMs = Number(draft.fetchTimeoutMs);
  return {
    searchProvider: draft.searchProvider,
    searchApiKeyEnv: draft.searchApiKeyEnv.trim() || 'BRAVE_API_KEY',
    searchMaxResults:
      Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 5,
    fetchMaxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 65536,
    fetchTimeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15000,
    fetchBlockedUrlPrefixes: draft.fetchBlockedUrlPrefixes
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export function SettingsPanel({
  request,
  onClose,
  onSaved,
  toolCallDensity = 'comfortable',
  onToolCallDensityChange,
  projectPath,
  requestSkills,
  requestMcp,
  requestExtensions,
  requestPrompts,
  requestTheme,
  requestPet,
  requestMemory,
  onThemeApplied,
  onPetActiveChanged,
  initialSection,
}: SettingsPanelProps) {
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [root, setRoot] = useState('~/.piwin');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [webDraft, setWebDraft] = useState<DraftWeb>(webToDraft(createDefaultWebConfig()));
  const [saving, setSaving] = useState(false);
  const [settingsNav, setSettingsNav] = useState<SettingsSectionId>(initialSection ?? 'general');

  useEffect(() => {
    void (async () => {
      const response = await request({ type: 'config/get' });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { config: PiwinConfig; root: string };
      setConfig(data.config);
      setRoot(data.root);
      setWebDraft(webToDraft(data.config.web ?? createDefaultWebConfig()));
    })();
  }, [request]);

  useEffect(() => {
    if (initialSection) {
      setSettingsNav(initialSection);
    }
  }, [initialSection]);

  async function saveConfig(next: PiwinConfig): Promise<boolean> {
    setSaving(true);
    setError(null);
    setInfo(null);
    const response = await request({ type: 'config/set', config: next });
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return false;
    }
    setConfig(next);
    onSaved?.(next);
    return true;
  }

  async function handleSaveWeb(): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      web: draftToWeb(webDraft),
    };
    if (await saveConfig(next)) {
      setInfo('Web tools settings saved (new sessions pick up provider keys)');
    }
  }

  async function handleToggleMock(agentMock: boolean): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = { ...config, agentMock };
    await saveConfig(next);
  }

  async function handleToggleAutoCompact(autoEnabledDefault: boolean): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      compaction: {
        autoEnabledDefault,
        writeTranscriptNote: config.compaction?.writeTranscriptNote === true,
      },
    };
    if (await saveConfig(next)) {
      setInfo('Auto-compact default saved (new sessions inherit it)');
    }
  }

  const navItems: Array<{
    id: typeof settingsNav;
    label: string;
    group: 'Workspace' | 'Agent' | 'System';
  }> = [
    { id: 'general', label: 'General', group: 'Workspace' },
    { id: 'appearance', label: 'Appearance', group: 'Workspace' },
    { id: 'models', label: 'Models', group: 'Agent' },
    { id: 'agents', label: 'Agents', group: 'Agent' },
    { id: 'rules', label: 'Rules', group: 'Agent' },
    { id: 'skills', label: 'Skills', group: 'Agent' },
    { id: 'extensions', label: 'Extensions', group: 'Agent' },
    { id: 'prompts', label: 'Prompts', group: 'Agent' },
    { id: 'memory', label: 'Memory', group: 'Agent' },
    { id: 'tools', label: 'Tools & MCPs', group: 'System' },
    { id: 'session', label: 'Sessions', group: 'System' },
  ];

  const navigationGroups: Array<(typeof navItems)[number]['group']> = [
    'Workspace',
    'Agent',
    'System',
  ];

  const activeSection = navItems.find((item) => item.id === settingsNav);

  return (
    <div className="settings-page" data-testid="settings-panel" aria-label="Settings">
      <aside className="settings-nav">
        <div className="settings-nav-brand">
          <span className="settings-nav-mark" aria-hidden>π</span>
          <span>
            <strong>Settings</strong>
            <small>piwin desktop</small>
          </span>
        </div>
        <button
          type="button"
          className="settings-back"
          data-testid="settings-close-btn"
          onClick={onClose}
          title="Back to workspace"
          aria-label="Back to workspace"
        >
          <IconBack />
          <kbd>Esc</kbd>
        </button>
        <nav className="settings-nav-list" aria-label="Settings sections">
          {navigationGroups.map((group) => (
            <div key={group} className="settings-nav-group">
              <div className="settings-nav-group-label">{group}</div>
              {navItems
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      settingsNav === item.id ? 'settings-nav-item active' : 'settings-nav-item'
                    }
                    onClick={() => setSettingsNav(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="settings-nav-footer">
          <span className="settings-connection-dot" aria-hidden />
          Local configuration
        </div>
      </aside>
      <div className="settings-main">
        <header className="settings-main-header">
          <div>
            <div className="settings-section-kicker">{activeSection?.group ?? 'Settings'}</div>
            <h2>{activeSection?.label ?? 'Settings'}</h2>
            <p className="muted" data-testid="settings-config-root">Config root: {root}</p>
          </div>
          <div className="settings-main-status">
            <span className="settings-connection-dot" aria-hidden />
            Saved locally
          </div>
        </header>
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <p className="muted">{info}</p> : null}

        {settingsNav === 'general' ? (
        <div className="settings-card settings-overview-card">
        <div className="settings-section">
          <div className="settings-card-heading">
            <div><h4>Providers</h4><p>Models available to new conversations.</p></div>
            <span className="settings-count">{config?.providers.length ?? 0}</span>
          </div>
          {!config || config.providers.length === 0 ? (
            <p className="muted">No providers yet — open Models to add OpenAI, Anthropic, Ollama…</p>
          ) : (
            <ul className="provider-list">
              {config.providers.map((provider) => (
                <li key={provider.id}>
                  <strong>{provider.name}</strong>
                  {config.defaultProviderId === provider.id ? ' · default' : ''}
                  <br />
                  <span className="muted">
                    {provider.baseUrl} · {provider.models.length} model(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
          {config ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.agentMock === true}
                onChange={(event) => void handleToggleMock(event.target.checked)}
              />
              <span>agentMock (offline mock sessions)</span>
            </label>
          ) : null}
          <button
            type="button"
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => setSettingsNav('models')}
          >
            Manage providers…
          </button>
        </div>
        </div>
        ) : null}

        {settingsNav === 'models' && config ? (
          <div className="settings-card settings-card-flush" data-testid="settings-models">
            <ProviderSettings
              config={config}
              saving={saving}
              onSave={saveConfig}
              onError={setError}
              onInfo={setInfo}
            />
          </div>
        ) : null}
        {settingsNav === 'models' && !config ? (
          <p className="muted">Loading config…</p>
        ) : null}

        {settingsNav === 'session' || settingsNav === 'general' ? (
        <div className="settings-card">
        <div className="settings-section">
          <div className="settings-card-heading"><div><h4>Session / Context</h4><p>Context behavior for new sessions.</p></div></div>
          <p className="muted">
            Global default for automatic context compaction on new SDK/mock sessions. Per-session
            overrides still apply for the live handle only.
          </p>
          {config ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.compaction?.autoEnabledDefault !== false}
                onChange={(event) => void handleToggleAutoCompact(event.target.checked)}
              />
              <span>Auto-compact by default</span>
            </label>
          ) : null}
        </div>

        </div>
        ) : null}



        {settingsNav === 'memory' || settingsNav === 'agents' ? (
        <div className="settings-card" data-testid="settings-memory">
          <MemoryPanel projectPath={projectPath} request={requestMemory} variant="inline" />
        </div>
        ) : null}

        {settingsNav === 'tools' || settingsNav === 'agents' ? (
        <div className="settings-card">
        <div className="settings-section">
          <h4>Web tools</h4>
          <p className="muted">
            Used by host-registered <code>web_search</code> / <code>web_fetch</code>. API keys stay
            in env vars (not stored in config).
          </p>
          <label className="field">
            Search provider
            <select
              value={webDraft.searchProvider}
              onChange={(event) =>
                setWebDraft({
                  ...webDraft,
                  searchProvider: event.target.value as DraftWeb['searchProvider'],
                })
              }
            >
              <option value="brave">Brave</option>
              <option value="tavily">Tavily</option>
              <option value="none">None (disabled)</option>
            </select>
          </label>
          <label className="field">
            Search API key env
            <input
              value={webDraft.searchApiKeyEnv}
              onChange={(event) =>
                setWebDraft({ ...webDraft, searchApiKeyEnv: event.target.value })
              }
              placeholder="BRAVE_API_KEY or TAVILY_API_KEY"
            />
          </label>
          <label className="field">
            Max search results
            <input
              value={webDraft.searchMaxResults}
              onChange={(event) =>
                setWebDraft({ ...webDraft, searchMaxResults: event.target.value })
              }
            />
          </label>
          <label className="field">
            Fetch max bytes
            <input
              value={webDraft.fetchMaxBytes}
              onChange={(event) =>
                setWebDraft({ ...webDraft, fetchMaxBytes: event.target.value })
              }
            />
          </label>
          <label className="field">
            Fetch timeout (ms)
            <input
              value={webDraft.fetchTimeoutMs}
              onChange={(event) =>
                setWebDraft({ ...webDraft, fetchTimeoutMs: event.target.value })
              }
            />
          </label>
          <label className="field">
            Blocked URL prefixes (comma-separated)
            <input
              value={webDraft.fetchBlockedUrlPrefixes}
              onChange={(event) =>
                setWebDraft({ ...webDraft, fetchBlockedUrlPrefixes: event.target.value })
              }
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void handleSaveWeb()}
          >
            {saving ? 'Saving…' : 'Save web settings'}
          </button>
        </div>

        </div>
        ) : null}

        {settingsNav === 'rules' ? (
          <div className="settings-card">
            <div className="settings-section">
              <h4>Rules</h4>
              <p className="muted">
                Rules guide agent behavior (like Cursor Rules / AGENTS.md). Apply always, by path,
                or manually. Full editor lands next — open project AGENTS.md for now.
              </p>
              <div className="settings-empty-rules muted" data-testid="settings-rules-empty">
                No rules yet
              </div>
              <button type="button" className="btn" disabled>
                New Rule (soon)
              </button>
            </div>
          </div>
        ) : null}

        {settingsNav === 'skills' ? (
          <div className="settings-card">
            <SkillsPanel projectPath={projectPath} request={requestSkills} variant="inline" />
          </div>
        ) : null}

        {settingsNav === 'extensions' ? (
          <div className="settings-card">
            <ExtensionsPanel
              projectPath={projectPath}
              request={requestExtensions}
              variant="inline"
            />
          </div>
        ) : null}

        
        {settingsNav === 'prompts' ? (
          <div className="settings-card">
            <PromptsPanel projectPath={projectPath} request={requestPrompts} variant="inline" />
          </div>
        ) : null}

        {settingsNav === 'appearance' ? (
          <div className="settings-card">
            <div className="settings-section">
              <h4>Appearance</h4>
              <p className="muted">
                Theme is controlled from the rail sun/moon toggle (piwin-dark / piwin-light).
              </p>
              <label className="field density-field">
                <span>Tool Call Density</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Adjust how much detail is shown for tool calls
                </span>
                <div className="density-slider-row">
                  <span className="muted">Compact</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={1}
                    data-testid="tool-density-slider"
                    value={
                      toolCallDensity === 'compact'
                        ? 0
                        : toolCallDensity === 'detailed'
                          ? 2
                          : 1
                    }
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      const next =
                        value <= 0 ? 'compact' : value >= 2 ? 'detailed' : 'comfortable';
                      onToolCallDensityChange?.(next);
                    }}
                  />
                  <span className="muted">Detailed</span>
                </div>
                <div className="density-value" data-testid="tool-density-value">
                  {toolCallDensity}
                </div>
              </label>
              <ThemePanel request={requestTheme} onApplied={onThemeApplied} variant="inline" />
              <PetPanel request={requestPet} onActiveChanged={onPetActiveChanged} variant="inline" />
            </div>
          </div>
        ) : null}

        {settingsNav === 'tools' ? (
          <div className="settings-card">
            <McpPanel request={requestMcp} variant="inline" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
