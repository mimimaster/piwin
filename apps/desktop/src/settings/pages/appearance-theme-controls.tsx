import type { ReactElement } from 'react';
import { Button, ColorInput, Select, SegmentedControl, IconLaptop, IconSun, IconMoon } from '@piwin/ui-kit';
import type { DesktopCopy } from '../../desktop-locale.js';
import { DEFAULT_DARK_THEME_SETTINGS, DEFAULT_LIGHT_THEME_SETTINGS, type AppearanceMode, type AppearanceThemeSettings, type DesktopPreferences } from '../../ui-preferences.js';
import { AppearanceThemePreview } from './appearance-theme-preview.js';

type ThemeMode = 'light' | 'dark';
export type ThemeColorKey = keyof Pick<AppearanceThemeSettings, 'background' | 'foreground' | 'accent'>;

export function getAppearanceThemeSettings(
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

function getModeLabel(
  mode: AppearanceMode,
  copy: DesktopCopy['appearance'],
  locale: 'zh-CN' | 'en',
): string {
  if (mode === 'system') return copy.system;
  if (locale === 'zh-CN') return mode === 'light' ? '纸面' : '墨面';
  return mode === 'light' ? 'Paper' : 'Ink';
}

export function AppearanceModeControl(props: {
  value: AppearanceMode;
  onChange: (mode: AppearanceMode) => void;
  copy: DesktopCopy['appearance'];
  locale: 'zh-CN' | 'en';
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
            {mode === 'system' ? <IconLaptop /> : mode === 'light' ? <IconSun /> : <IconMoon />}
            {getModeLabel(mode, props.copy, props.locale)}
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

export function ThemeSettingsCard(props: {
  mode: ThemeMode;
  locale: 'zh-CN' | 'en';
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  settings: AppearanceThemeSettings;
  copy: DesktopCopy['appearance'];
  onChange: (key: ThemeColorKey, value: string) => void;
}): ReactElement {
  const title = 'Inkstone';
  const prefix = 'inkstone';
  const faceLabel =
    props.locale === 'zh-CN'
      ? props.mode === 'light'
        ? '纸'
        : '墨'
      : props.mode === 'light'
        ? 'Paper'
        : 'Ink';
  const faceDescription =
    props.mode === 'light' ? '白天纸面 · 温润明亮' : '黑夜墨面 · 安静专注';

  return (
    <section className="settings-section settings-section-card appearance-theme-card">
      <Button
        variant="ghost"
        className="appearance-face-preview"
        onClick={props.onSelect}
        disabled={props.disabled}
        aria-pressed={props.selected}
        aria-label={props.locale === 'zh-CN' ? '使用 Inkstone 主题' : 'Use the Inkstone theme'}
        data-testid={`${prefix}-theme-preview`}
      >
        <AppearanceThemePreview mode={props.mode} settings={props.settings} />
        <span className="appearance-face-caption">
          <strong>{title}</strong>
          <span>
            {props.locale === 'zh-CN'
              ? faceDescription
              : `Inkstone · ${props.mode === 'light' ? 'Paper by day' : 'Ink by night'}`}
          </span>
          <span className="appearance-face-selection" aria-hidden="true" />
        </span>
      </Button>
      <details className="appearance-color-disclosure">
        <summary>{props.locale === 'zh-CN' ? '自定义配色' : 'Customize colors'}</summary>
        <div className="appearance-theme-setting-row">
          <span>{props.copy.preset}</span>
          <Select
            value={props.settings.preset}
            onChange={() => undefined}
            data={[{ value: 'default', label: 'Default' }]}
            aria-label={`${title} ${faceLabel} ${props.copy.preset}`}
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
      </details>
    </section>
  );
}
