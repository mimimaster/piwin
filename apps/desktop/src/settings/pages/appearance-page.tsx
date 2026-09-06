/** Appearance preferences; theme catalog and preview controls own their views. */
import type { ReactElement } from 'react';
import { Button, SegmentedControl, Switch } from '@piwin/ui-kit';
import { buildAppearanceTheme, isThemeAppearanceLocked, resolveSystemThemeMode } from '../../appearance-tokens.js';
import { getDesktopCopy } from '../../desktop-locale.js';
import { useDesktopLocale } from '../../desktop-locale-context.js';
import { DEFAULT_DARK_THEME_SETTINGS, DEFAULT_LIGHT_THEME_SETTINGS, saveDesktopPreferences, type AppearanceMode, type AppearanceThemeSettings, type DesktopPreferences, type ConversationWidth, type ToolCallDensity } from '../../ui-preferences.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';
import { settingsHostSupportsCommand, useSettings } from '../settings-context.js';
import { AppearanceModeControl, ThemeSettingsCard, getAppearanceThemeSettings, type ThemeColorKey } from './appearance-theme-controls.js';
import { ThemeLibraryCard } from './appearance-theme-library.js';

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

export function AppearancePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).appearance;
  const settings = useSettings();
  const { preferences, onPreferencesChange, onThemeApplied, activeTheme } = settings;
  const themeLibraryAvailable = settingsHostSupportsCommand(settings, 'theme/list');
  const themePackageActive = isThemeAppearanceLocked(activeTheme);

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

  function handleThemeColorChange(mode: 'light' | 'dark', key: ThemeColorKey, value: string): void {
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
      <section className="settings-section settings-section-card appearance-mode-card">
        <div className="appearance-mode-copy">
          <h3>{locale === 'zh-CN' ? '纸与墨' : 'Paper & Ink'}</h3>
          <p>{locale === 'zh-CN' ? '一张纸，一块砚。选择你的工作台。' : 'One page, one inkstone. Make the workspace yours.'}</p>
        </div>
        <div className="appearance-mode-control">
          <AppearanceModeControl
            value={preferences.appearanceMode}
            onChange={handleAppearanceModeChange}
            copy={copy}
          />
        </div>
      </section>

      <div className="appearance-face-grid">
      <ThemeSettingsCard
        mode="light"
        locale={locale}
        selected={activeTheme.mode === 'light'}
        disabled={themePackageActive}
        onSelect={() => handleAppearanceModeChange('light')}
        settings={getAppearanceThemeSettings(preferences, 'light')}
        copy={copy}
        onChange={(key, value) => handleThemeColorChange('light', key, value)}
      />
      <ThemeSettingsCard
        mode="dark"
        locale={locale}
        selected={activeTheme.mode === 'dark'}
        disabled={themePackageActive}
        onSelect={() => handleAppearanceModeChange('dark')}
        settings={getAppearanceThemeSettings(preferences, 'dark')}
        copy={copy}
        onChange={(key, value) => handleThemeColorChange('dark', key, value)}
      />

      </div>
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
