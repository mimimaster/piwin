/**
 * Settings → Appearance page (Wave 1 migration from SettingsPanel).
 * Typography/density preference controls plus the ThemePanel wrapper.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { ThemePanel } from '../../ThemePanel';
import { useDesktopLocale } from '../../desktop-locale-context';
import {
  saveDesktopPreferences,
  type DesktopPreferences,
  type ToolCallDensity,
} from '../../ui-preferences';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

function updatePreference<K extends keyof DesktopPreferences>(
  prefs: DesktopPreferences,
  key: K,
  value: DesktopPreferences[K],
  onChange: (prefs: DesktopPreferences) => void,
): void {
  onChange({ ...prefs, [key]: value });
}

export function AppearancePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { preferences, onPreferencesChange, requestTheme, onThemeApplied } = useSettings();

  return (
    <div className="settings-card">
      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? '排印与密度' : 'Typography & density'}
          description={locale === 'zh-CN' ? '调整助手文本、代码块和工具调用的字体大小与布局。' : 'Adjust font sizes and layout for assistant text, code, and tool calls.'}
        />

        {/* Assistant text size */}
        <FieldRow
          label={locale === 'zh-CN' ? '助手文本大小' : 'Assistant text size'}
          description={locale === 'zh-CN' ? '助手回答的字体大小。' : 'Font size for assistant responses.'}
        >
          <div className="segmented-control" role="radiogroup" aria-label={locale === 'zh-CN' ? '助手文本大小' : 'Assistant text size'}>
            {(['small', 'default', 'large'] as const).map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={preferences.assistantTextSize === size}
                data-state={preferences.assistantTextSize === size ? 'active' : 'inactive'}
                className="segmented-control-item"
                onClick={() => {
                  updatePreference(preferences, 'assistantTextSize', size, onPreferencesChange);
                }}
              >
                {locale === 'zh-CN'
                  ? ({ small: '小', default: '默认', large: '大' } as const)[size]
                  : ({ small: 'Small', default: 'Default', large: 'Large' } as const)[size]}
              </button>
            ))}
          </div>
        </FieldRow>

        {/* Code text size */}
        <FieldRow
          label={locale === 'zh-CN' ? '代码块大小' : 'Code block size'}
          description={locale === 'zh-CN' ? '代码和工具输出中的等宽字体大小。' : 'Monospace font size for code and tool output.'}
        >
          <div className="segmented-control" role="radiogroup" aria-label={locale === 'zh-CN' ? '代码块大小' : 'Code block size'}>
            {(['small', 'default', 'large'] as const).map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={preferences.codeTextSize === size}
                data-state={preferences.codeTextSize === size ? 'active' : 'inactive'}
                className="segmented-control-item"
                onClick={() => {
                  updatePreference(preferences, 'codeTextSize', size, onPreferencesChange);
                }}
              >
                {locale === 'zh-CN'
                  ? ({ small: '小', default: '默认', large: '大' } as const)[size]
                  : ({ small: 'Small', default: 'Default', large: 'Large' } as const)[size]}
              </button>
            ))}
          </div>
        </FieldRow>

        {/* Code wrap toggle */}
        <FieldRow
          label={locale === 'zh-CN' ? '代码自动换行' : 'Code wrap'}
          description={locale === 'zh-CN' ? '开启后代码块将自动换行而非水平滚动。' : 'When enabled, code blocks wrap instead of scrolling horizontally.'}
        >
          <span
            role="switch"
            aria-checked={preferences.codeWrap ? 'true' : 'false'}
            tabIndex={0}
            className={preferences.codeWrap ? 'mcp-toggle checked' : 'mcp-toggle'}
            onClick={() => {
              updatePreference(preferences, 'codeWrap', !preferences.codeWrap, onPreferencesChange);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                updatePreference(preferences, 'codeWrap', !preferences.codeWrap, onPreferencesChange);
              }
            }}
          />
        </FieldRow>

        {/* Work details default */}
        <FieldRow
          label={locale === 'zh-CN' ? '工作详情默认展开' : 'Work details default'}
          description={locale === 'zh-CN' ? '控制助手消息中工作详情的默认展开行为。' : 'Controls the default expansion of work details in assistant messages.'}
        >
          <div className="segmented-control" role="radiogroup" aria-label={locale === 'zh-CN' ? '工作详情展开方式' : 'Work details expansion'}>
            {(['auto', 'always', 'collapsed'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={preferences.workDetailsExpanded === mode}
                data-state={preferences.workDetailsExpanded === mode ? 'active' : 'inactive'}
                className="segmented-control-item"
                onClick={() => {
                  updatePreference(preferences, 'workDetailsExpanded', mode, onPreferencesChange);
                }}
              >
                {locale === 'zh-CN'
                  ? ({ auto: '自动', always: '始终展开', collapsed: '默认收起' } as const)[mode]
                  : ({ auto: 'Auto', always: 'Always', collapsed: 'Collapsed' } as const)[mode]}
              </button>
            ))}
          </div>
        </FieldRow>

        {/* Tool call density (existing, now wired through preferences) */}
        <FieldRow
          label={locale === 'zh-CN' ? '工具调用密度' : 'Tool call density'}
          description={locale === 'zh-CN' ? '调整工具调用显示的详细程度。' : 'Adjust how much detail is shown for tool calls.'}
        >
          <div className="density-field-container">
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              data-testid="tool-density-slider"
              aria-valuetext={preferences.toolDensity}
              className="density-slider"
              value={
                preferences.toolDensity === 'compact'
                  ? 0
                  : preferences.toolDensity === 'detailed'
                    ? 2
                    : 1
              }
              onChange={(event) => {
                const value = Number(event.target.value);
                const next: ToolCallDensity =
                  value <= 0 ? 'compact' : value >= 2 ? 'detailed' : 'comfortable';
                updatePreference(preferences, 'toolDensity', next, onPreferencesChange);
              }}
            />
            <div className="density-slider-labels muted" aria-hidden>
              <span>{locale === 'zh-CN' ? '紧凑' : 'Compact'}</span>
              <span>{locale === 'zh-CN' ? '适中' : 'Comfortable'}</span>
              <span>{locale === 'zh-CN' ? '详细' : 'Detailed'}</span>
            </div>
          </div>
        </FieldRow>
        
        <div style={{ marginTop: 16 }}>
          <Button
            size="compact"
            variant="ghost"
            data-testid="reset-typography-defaults"
            onClick={() => {
              const defaults: DesktopPreferences = {
                assistantTextSize: 'default',
                codeTextSize: 'default',
                codeWrap: false,
                toolDensity: 'comfortable',
                workDetailsExpanded: 'auto',
              };
              saveDesktopPreferences(defaults);
              onPreferencesChange(defaults);
            }}
          >
            {locale === 'zh-CN' ? '重置为默认值' : 'Reset to defaults'}
          </Button>
        </div>
      </div>

      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? '主题' : 'Themes'}
          description={locale === 'zh-CN' ? '选择、应用或安装界面主题。' : 'Select, apply, or install UI themes.'}
        />
        <ThemePanel request={requestTheme} onApplied={onThemeApplied} variant="inline" />
      </div>
    </div>
  );
}
