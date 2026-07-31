/**
 * Settings → Appearance page (Wave 1 migration from SettingsPanel).
 * Typography/density preference controls plus the ThemePanel wrapper.
 */
import type { ReactElement } from 'react';
import { Button, SegmentedControl, Switch } from '@piwin/ui-kit';
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
  const isChinese = locale === 'zh-CN';
  const { preferences, onPreferencesChange, requestTheme, onThemeApplied } = useSettings();

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={locale === 'zh-CN' ? '字体与排印' : 'Typography'}
          description={
            locale === 'zh-CN'
              ? '调整助手文本和代码块的字体大小与换行策略。'
              : 'Adjust font sizes and line wrapping for assistant text and code blocks.'
          }
        />

        {/* Assistant text size */}
        <FieldRow
          label={locale === 'zh-CN' ? '助手文本大小' : 'Assistant text size'}
          description={
            locale === 'zh-CN' ? '助手回答的字体大小。' : 'Font size for assistant responses.'
          }
        >
          <SegmentedControl
            value={preferences.assistantTextSize}
            onChange={(value) =>
              updatePreference(
                preferences,
                'assistantTextSize',
                value as typeof preferences.assistantTextSize,
                onPreferencesChange,
              )
            }
            data={[
              { value: 'small', label: isChinese ? '小' : 'Small' },
              { value: 'default', label: isChinese ? '默认' : 'Default' },
              { value: 'large', label: isChinese ? '大' : 'Large' },
            ]}
          />
        </FieldRow>

        {/* Code text size */}
        <FieldRow
          label={locale === 'zh-CN' ? '代码块大小' : 'Code block size'}
          description={
            locale === 'zh-CN'
              ? '代码和工具输出中的等宽字体大小。'
              : 'Monospace font size for code and tool output.'
          }
        >
          <SegmentedControl
            value={preferences.codeTextSize}
            onChange={(value) =>
              updatePreference(
                preferences,
                'codeTextSize',
                value as typeof preferences.codeTextSize,
                onPreferencesChange,
              )
            }
            data={[
              { value: 'small', label: isChinese ? '小' : 'Small' },
              { value: 'default', label: isChinese ? '默认' : 'Default' },
              { value: 'large', label: isChinese ? '大' : 'Large' },
            ]}
          />
        </FieldRow>

        {/* Code wrap toggle */}
        <FieldRow
          label={locale === 'zh-CN' ? '代码自动换行' : 'Code wrap'}
          description={
            locale === 'zh-CN'
              ? '开启后代码块将自动换行而非水平滚动。'
              : 'When enabled, code blocks wrap instead of scrolling horizontally.'
          }
        >
          <Switch
            checked={preferences.codeWrap}
            onCheckedChange={(checked) => {
              updatePreference(preferences, 'codeWrap', checked, onPreferencesChange);
            }}
            aria-label={locale === 'zh-CN' ? '代码自动换行' : 'Code wrap'}
          />
        </FieldRow>
      </div>

      <div className="settings-section settings-section-card">
        <PageTitle
          title={locale === 'zh-CN' ? '交互与渲染' : 'Interaction & Rendering'}
          description={
            locale === 'zh-CN'
              ? '自定义工具调用详细度、工作详情展开策略与 Artifact 动态渲染。'
              : 'Customize tool call details, work section default expansion, and Artifact live rendering.'
          }
        />

        {/* Tool call density */}
        <FieldRow
          label={locale === 'zh-CN' ? '工具调用密度' : 'Tool call density'}
          description={
            locale === 'zh-CN'
              ? '调整工具调用显示的详细程度。'
              : 'Adjust how much detail is shown for tool calls.'
          }
        >
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
              { value: 'compact', label: isChinese ? '紧凑' : 'Compact' },
              { value: 'comfortable', label: isChinese ? '适中' : 'Comfortable' },
              { value: 'detailed', label: isChinese ? '详细' : 'Detailed' },
            ]}
            testId="tool-density-segmented"
          />
        </FieldRow>

        {/* Work details default */}
        <FieldRow
          label={locale === 'zh-CN' ? '工作详情默认展开' : 'Work details default'}
          description={
            locale === 'zh-CN'
              ? '控制助手消息中工作详情的默认展开行为。'
              : 'Controls the default expansion of work details in assistant messages.'
          }
        >
          <SegmentedControl
            value={preferences.workDetailsExpanded}
            onChange={(value) =>
              updatePreference(
                preferences,
                'workDetailsExpanded',
                value as typeof preferences.workDetailsExpanded,
                onPreferencesChange,
              )
            }
            data={[
              { value: 'auto', label: isChinese ? '自动' : 'Auto' },
              { value: 'always', label: isChinese ? '始终展开' : 'Always' },
              { value: 'collapsed', label: isChinese ? '默认收起' : 'Collapsed' },
            ]}
          />
        </FieldRow>

        {/* Artifact 代码优先 toggle */}
        <FieldRow
          label={isChinese ? '代码优先' : 'Code-first mode'}
          description={
            locale === 'zh-CN'
              ? '开启后生成 Artifact 时优先展示源代码，悬停代码块可通过 Preview 按钮切换具现 UI。'
              : 'When enabled, Artifacts display source code first with a Preview toggle to render the UI.'
          }
        >
          <Switch
            checked={preferences.artifactCodeFirst}
            onCheckedChange={(checked) => {
              updatePreference(preferences, 'artifactCodeFirst', checked, onPreferencesChange);
            }}
            aria-label={isChinese ? '代码优先' : 'Code-first mode'}
            testId="artifact-code-first-switch"
          />
        </FieldRow>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
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
                artifactPreviewEnabled: true,
                artifactCodeFirst: false,
              };
              saveDesktopPreferences(defaults);
              onPreferencesChange(defaults);
            }}
          >
            {locale === 'zh-CN' ? '重置排印默认值' : 'Reset defaults'}
          </Button>
        </div>
      </div>

      <div className="settings-section settings-section-card">
        <PageTitle
          title={locale === 'zh-CN' ? '界面主题' : 'UI Themes'}
          description={
            locale === 'zh-CN'
              ? '选择、应用或安装 piwin 界面外观主题。'
              : 'Select, apply, or install piwin UI appearance themes.'
          }
        />
        <ThemePanel request={requestTheme} onApplied={onThemeApplied} variant="inline" />
      </div>
    </div>
  );
}
