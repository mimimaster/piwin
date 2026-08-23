/** Settings → Appearance: chat preferences and editable light/dark themes. */
import { useEffect, useState, type ReactElement } from 'react';
import { Button, ColorInput, Select, SegmentedControl, Switch } from '@piwin/ui-kit';
import { buildAppearanceTheme, resolveSystemThemeMode } from '../../appearance-tokens';
import { getDesktopCopy, type DesktopCopy } from '../../desktop-locale';
import { useDesktopLocale } from '../../desktop-locale-context';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  saveDesktopPreferences,
  type AppearanceMode,
  type AppearanceThemeSettings,
  type DesktopPreferences,
  type ConversationWidth,
  type ToolCallDensity,
} from '../../ui-preferences';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';

type ThemeMode = 'light' | 'dark';
type ThemeColorKey = keyof Pick<AppearanceThemeSettings, 'background' | 'foreground' | 'accent'>;

function updatePreference<K extends keyof DesktopPreferences>(
  prefs: DesktopPreferences,
  key: K,
  value: DesktopPreferences[K],
  onChange: (prefs: DesktopPreferences) => void,
): void {
  const nextPreferences = { ...prefs, [key]: value } as DesktopPreferences;
  onChange(nextPreferences);
  saveDesktopPreferences(nextPreferences);
}

function getAppearanceThemeSettings(
  preferences: DesktopPreferences,
  mode: ThemeMode,
): AppearanceThemeSettings {
  return mode === 'light'
    ? (preferences.lightTheme ?? DEFAULT_LIGHT_THEME_SETTINGS)
    : (preferences.darkTheme ?? DEFAULT_DARK_THEME_SETTINGS);
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function getModeLabel(mode: AppearanceMode, copy: DesktopCopy['appearance']): string {
  if (mode === 'system') return copy.system;
  return mode === 'light' ? copy.light : copy.dark;
}

function ModeIcon({ mode }: { mode: AppearanceMode }): ReactElement {
  if (mode === 'system') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (mode === 'light') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z" />
    </svg>
  );
}

function AppearanceModeControl(props: {
  value: AppearanceMode;
  onChange: (mode: AppearanceMode) => void;
  copy: DesktopCopy['appearance'];
}): ReactElement {
  return (
    <SegmentedControl
      value={props.value}
      onChange={(value) => props.onChange(value as AppearanceMode)}
      aria-label={props.copy.appearance}
      data={(['system', 'light', 'dark'] as const).map((mode) => ({
        value: mode,
        label: (
          <span className="appearance-mode-option">
            <ModeIcon mode={mode} />
            {getModeLabel(mode, props.copy)}
          </span>
        ),
      }))}
      testId="appearance-mode-control"
    />
  );
}

function ThemeColorRow(props: {
  label: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="appearance-theme-color-row">
      <span className="appearance-theme-color-label">{props.label}</span>
      <ColorInput
        value={props.value}
        onValueChange={(value) => {
          if (isHexColor(value)) {
            props.onChange(value.toUpperCase());
          }
        }}
        aria-label={props.label}
        testId={props.testId}
      />
    </div>
  );
}

function ThemeSettingsCard(props: {
  mode: ThemeMode;
  settings: AppearanceThemeSettings;
  copy: DesktopCopy['appearance'];
  onChange: (key: ThemeColorKey, value: string) => void;
}): ReactElement {
  const title = props.mode === 'light' ? props.copy.lightTheme : props.copy.darkTheme;
  const prefix = props.mode === 'light' ? 'light' : 'dark';

  return (
    <section className="settings-section settings-section-card appearance-theme-card">
      <PageTitle title={title} />
      <div className="appearance-theme-setting-row">
        <span>{props.copy.preset}</span>
        <Select
          value={props.settings.preset}
          onChange={() => undefined}
          data={[{ value: 'default', label: 'Default' }]}
          aria-label={`${title} ${props.copy.preset}`}
          testId={`${prefix}-theme-preset`}
        />
      </div>
      <ThemeColorRow
        label={props.copy.background}
        value={props.settings.background}
        testId={`${prefix}-theme-background`}
        onChange={(value) => props.onChange('background', value)}
      />
      <ThemeColorRow
        label={props.copy.foreground}
        value={props.settings.foreground}
        testId={`${prefix}-theme-foreground`}
        onChange={(value) => props.onChange('foreground', value)}
      />
      <ThemeColorRow
        label={props.copy.accent}
        value={props.settings.accent}
        testId={`${prefix}-theme-accent`}
        onChange={(value) => props.onChange('accent', value)}
      />
    </section>
  );
}

function ThemeLibraryCard(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const copy = getDesktopCopy(locale).appearance;
  const { request, activeTheme, onThemeApplied, preferences, setError, setInfo } = useSettings();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void request({ type: 'theme/list' }).then(() => {
      if (disposed) return;
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [request]);

  const selectValue = activeTheme.id === 'piwin-ink-wash' ? 'piwin-ink-wash' : 'system';
  const activeLabel = selectValue === 'piwin-ink-wash' ? (isChinese ? '砚夜泼墨' : 'Ink Wash') : (isChinese ? '系统' : 'System');

  async function handleThemeChange(targetValue: string): Promise<void> {
    if (targetValue === selectValue) {
      return;
    }
    if (targetValue === 'system') {
      const activeMode =
        preferences.appearanceMode === 'system'
          ? resolveSystemThemeMode()
          : preferences.appearanceMode;
      const baseThemeId = activeMode === 'light' ? 'piwin-bone' : 'piwin-obsidian';
      const response = await request({ type: 'theme/set-active', themeId: baseThemeId });
      if (!response.success) {
        setError(response.error);
        return;
      }
      onThemeApplied(
        buildAppearanceTheme(activeMode, getAppearanceThemeSettings(preferences, activeMode)),
      );
      setInfo(
        isChinese ? '已恢复系统外观。' : 'Switched to system appearance.',
        'success',
      );
      return;
    }
    const response = await request({ type: 'theme/set-active', themeId: targetValue });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { theme?: import('@piwin/contracts').ThemeManifest } | undefined;
    if (!data?.theme) {
      setError('theme/set-active returned no theme');
      return;
    }
    onThemeApplied(data.theme);
    setInfo(
      isChinese ? `已切换到 ${data.theme.name}。` : `Switched to ${data.theme.name}.`,
      'success',
    );
  }

  return (
    <section className="settings-section settings-section-card appearance-theme-library">
      <PageTitle title={copy.themeLibrary} description={copy.themeLibraryDescription} />
      <div className="appearance-theme-setting-row">
        <span>{activeLabel}</span>
        <Select
          value={selectValue}
          onChange={(event) => void handleThemeChange(event.currentTarget.value)}
          data={[
            { value: 'system', label: isChinese ? '系统 · system' : 'System · system' },
            { value: 'piwin-ink-wash', label: isChinese ? '砚夜泼墨 · dark' : 'Ink Wash · dark' },
          ]}
          aria-label={copy.themeLibrary}
          disabled={loading}
          testId="theme-library-select"
        />
      </div>
    </section>
  );
}

export function AppearancePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).appearance;
  const settings = useSettings();
  const { preferences, onPreferencesChange, onThemeApplied, activeTheme } = settings;
  const themeLibraryAvailable = settingsHostSupportsCommand(settings, 'theme/list');
  const themePackageActive = activeTheme.visualStyle !== undefined;

  function handleAppearanceModeChange(mode: AppearanceMode): void {
    if (themePackageActive) return;
    const nextPreferences = { ...preferences, appearanceMode: mode };
    onPreferencesChange(nextPreferences);
    saveDesktopPreferences(nextPreferences);

    const activeMode = mode === 'system' ? resolveSystemThemeMode() : mode;
    onThemeApplied(
      buildAppearanceTheme(activeMode, getAppearanceThemeSettings(nextPreferences, activeMode)),
    );
  }

  function handleThemeColorChange(mode: ThemeMode, key: ThemeColorKey, value: string): void {
    if (themePackageActive) return;
    const currentThemeSettings = getAppearanceThemeSettings(preferences, mode);
    const nextThemeSettings: AppearanceThemeSettings = {
      ...currentThemeSettings,
      [key]: value,
    };
    const nextPreferences: DesktopPreferences = {
      ...preferences,
      ...(mode === 'light' ? { lightTheme: nextThemeSettings } : { darkTheme: nextThemeSettings }),
    };
    onPreferencesChange(nextPreferences);
    saveDesktopPreferences(nextPreferences);
    if (activeTheme.mode === mode) {
      onThemeApplied(buildAppearanceTheme(mode, nextThemeSettings));
    }
  }

  function resetAppearanceDefaults(): void {
    if (themePackageActive) return;
    const nextPreferences: DesktopPreferences = {
      ...preferences,
      verboseAgentChat: true,
      conversationWidth: 'default',
      appearanceMode: 'system',
      lightTheme: { ...DEFAULT_LIGHT_THEME_SETTINGS },
      darkTheme: { ...DEFAULT_DARK_THEME_SETTINGS },
    };
    onPreferencesChange(nextPreferences);
    saveDesktopPreferences(nextPreferences);
    const activeMode = resolveSystemThemeMode();
    onThemeApplied(
      buildAppearanceTheme(activeMode, getAppearanceThemeSettings(nextPreferences, activeMode)),
    );
  }

  return (
    <div className="settings-card appearance-page" data-testid="settings-appearance">
      {themeLibraryAvailable ? <ThemeLibraryCard /> : null}
      <section className="settings-section settings-section-card">
        <PageTitle title={copy.chatSettings} description={copy.chatSettingsDescription} />
        <FieldRow label={copy.verboseAgentChat} description={copy.verboseAgentChatDescription}>
          <Switch
            checked={preferences.verboseAgentChat}
            onCheckedChange={(checked) =>
              updatePreference(preferences, 'verboseAgentChat', checked, onPreferencesChange)
            }
            aria-label={copy.verboseAgentChat}
            testId="verbose-agent-chat-switch"
          />
        </FieldRow>
        <FieldRow label={copy.conversationWidth} description={copy.conversationWidthDescription}>
          <SegmentedControl
            value={preferences.conversationWidth}
            onChange={(value) =>
              updatePreference(
                preferences,
                'conversationWidth',
                value as ConversationWidth,
                onPreferencesChange,
              )
            }
            data={[
              { value: 'default', label: copy.default },
              { value: 'narrow', label: copy.narrow },
              { value: 'wide', label: copy.wide },
            ]}
            testId="conversation-width-control"
          />
        </FieldRow>
      </section>

      <section className="settings-section settings-section-card appearance-mode-card">
        <div className="appearance-mode-copy">
          <h3>{copy.appearance}</h3>
          <p>{copy.appearanceDescription}</p>
        </div>
        <div className="appearance-mode-control">
          <AppearanceModeControl
            value={preferences.appearanceMode}
            onChange={handleAppearanceModeChange}
            copy={copy}
          />
        </div>
      </section>

      <ThemeSettingsCard
        mode="light"
        settings={getAppearanceThemeSettings(preferences, 'light')}
        copy={copy}
        onChange={(key, value) => handleThemeColorChange('light', key, value)}
      />
      <ThemeSettingsCard
        mode="dark"
        settings={getAppearanceThemeSettings(preferences, 'dark')}
        copy={copy}
        onChange={(key, value) => handleThemeColorChange('dark', key, value)}
      />

      <div className="settings-section settings-section-card">
        <PageTitle title={copy.typography} description={copy.typographyDescription} />
        <FieldRow label={copy.assistantTextSize} description={copy.assistantTextSizeDescription}>
          <SegmentedControl
            value={preferences.assistantTextSize}
            onChange={(value) =>
              updatePreference(
                preferences,
                'assistantTextSize',
                value as DesktopPreferences['assistantTextSize'],
                onPreferencesChange,
              )
            }
            data={[
              { value: 'small', label: copy.small },
              { value: 'default', label: copy.default },
              { value: 'large', label: copy.large },
            ]}
          />
        </FieldRow>
        <FieldRow label={copy.codeBlockSize} description={copy.codeBlockSizeDescription}>
          <SegmentedControl
            value={preferences.codeTextSize}
            onChange={(value) =>
              updatePreference(
                preferences,
                'codeTextSize',
                value as DesktopPreferences['codeTextSize'],
                onPreferencesChange,
              )
            }
            data={[
              { value: 'small', label: copy.small },
              { value: 'default', label: copy.default },
              { value: 'large', label: copy.large },
            ]}
          />
        </FieldRow>
        <FieldRow label={copy.codeWrap} description={copy.codeWrapDescription}>
          <Switch
            checked={preferences.codeWrap}
            onCheckedChange={(checked) =>
              updatePreference(preferences, 'codeWrap', checked, onPreferencesChange)
            }
            aria-label={copy.codeWrap}
          />
        </FieldRow>
      </div>

      <div className="settings-section settings-section-card">
        <PageTitle
          title={copy.interactionRendering}
          description={copy.interactionRenderingDescription}
        />
        <FieldRow label={copy.toolCallDensity} description={copy.toolCallDensityDescription}>
          <SegmentedControl
            value={preferences.toolDensity}
            onChange={(value) =>
              updatePreference(
                preferences,
                'toolDensity',
                value as ToolCallDensity,
                onPreferencesChange,
              )
            }
            data={[
              { value: 'compact', label: copy.compact },
              { value: 'comfortable', label: copy.comfortable },
              { value: 'detailed', label: copy.detailed },
            ]}
          />
        </FieldRow>
        <FieldRow label={copy.workDetailsDefault} description={copy.workDetailsDefaultDescription}>
          <SegmentedControl
            value={preferences.workDetailsExpanded}
            onChange={(value) =>
              updatePreference(
                preferences,
                'workDetailsExpanded',
                value as DesktopPreferences['workDetailsExpanded'],
                onPreferencesChange,
              )
            }
            data={[
              { value: 'auto', label: copy.auto },
              { value: 'always', label: copy.always },
              { value: 'collapsed', label: copy.collapsed },
            ]}
          />
        </FieldRow>
        <FieldRow label={copy.codeFirstMode} description={copy.codeFirstModeDescription}>
          <Switch
            checked={preferences.artifactCodeFirst}
            onCheckedChange={(checked) =>
              updatePreference(preferences, 'artifactCodeFirst', checked, onPreferencesChange)
            }
            aria-label={copy.codeFirstMode}
            testId="artifact-code-first-switch"
          />
        </FieldRow>
        <div className="appearance-reset-actions">
          <Button
            size="compact"
            variant="ghost"
            data-testid="reset-typography-defaults"
            onClick={resetAppearanceDefaults}
          >
            {copy.resetDefaults}
          </Button>
        </div>
      </div>
    </div>
  );
}
