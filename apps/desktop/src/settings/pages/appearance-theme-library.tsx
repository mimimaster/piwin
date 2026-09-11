import { useEffect, useState, type ReactElement } from 'react';
import { Select } from '@piwin/ui-kit';
import {
  buildAppearanceTheme,
  isInkstoneThemeId,
  PIWIN_INKSTONE_THEME_ID,
  resolveInkstoneFaceThemeId,
  resolveSystemThemeMode,
  toHostCatalogThemeId,
} from '../../appearance-tokens.js';
import { getDesktopCopy } from '../../desktop-locale.js';
import { useDesktopLocale } from '../../desktop-locale-context.js';
import { PageTitle } from '../page-title.js';
import { useSettings } from '../settings-context.js';
import { getAppearanceThemeSettings } from './appearance-theme-controls.js';

function themeHostFailureNotice(error: string, isChinese: boolean): string {
  if (
    error.includes('ENOENT') ||
    error.includes('[host-path]') ||
    error.includes('theme not installed')
  ) {
    return isChinese
      ? '这个主题 Host 上还没有，还停在当前主题。'
      : 'That theme is not installed on the Host. Staying on the current theme.';
  }
  return error;
}

export function ThemeLibraryCard(): ReactElement {
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

  const selectValue =
    activeTheme.id === 'piwin-ink-wash'
      ? 'piwin-ink-wash'
      : isInkstoneThemeId(activeTheme.id)
        ? PIWIN_INKSTONE_THEME_ID
        : 'current';
  const LIBRARY_THEME_LABELS: Record<string, { zh: string; en: string }> = {
    [PIWIN_INKSTONE_THEME_ID]: { zh: '系统默认', en: 'System default' },
    'piwin-ink-wash': { zh: '砚夜泼墨', en: 'Ink Wash' },
  };
  const activeLabel =
    selectValue === 'current'
      ? activeTheme.name
      : isChinese
        ? LIBRARY_THEME_LABELS[selectValue]?.zh ?? selectValue
        : LIBRARY_THEME_LABELS[selectValue]?.en ?? selectValue;

  async function handleThemeChange(targetValue: string): Promise<void> {
    if (targetValue === selectValue) {
      return;
    }
    if (targetValue === PIWIN_INKSTONE_THEME_ID) {
      const activeMode =
        preferences.appearanceMode === 'system'
          ? resolveSystemThemeMode()
          : preferences.appearanceMode;
      const baseThemeId = toHostCatalogThemeId(
        resolveInkstoneFaceThemeId(activeMode),
      );
      const response = await request({ type: 'theme/set-active', themeId: baseThemeId });
      if (!response.success) {
        setError(themeHostFailureNotice(response.error, isChinese));
        return;
      }
      onThemeApplied(
        buildAppearanceTheme(activeMode, getAppearanceThemeSettings(preferences, activeMode)),
      );
      setInfo(isChinese ? '已恢复系统默认外观。' : 'Restored the system default appearance.', 'success');
      return;
    }
    const response = await request({
      type: 'theme/set-active',
      themeId: toHostCatalogThemeId(targetValue),
    });
    if (!response.success) {
      setError(themeHostFailureNotice(response.error, isChinese));
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
            {
              value: PIWIN_INKSTONE_THEME_ID,
              label: isChinese ? '系统默认' : 'System default',
            },
            {
              value: 'piwin-ink-wash',
              label: isChinese ? '砚夜泼墨 · dark' : 'Ink Wash · dark',
            },
            ...(selectValue === 'current'
              ? [
                  {
                    value: 'current',
                    label: isChinese
                      ? `${activeTheme.name} · 当前`
                      : `${activeTheme.name} · Current`,
                  },
                ]
              : []),
          ]}
          aria-label={copy.themeLibrary}
          disabled={loading}
          testId="theme-library-select"
        />
      </div>
    </section>
  );
}
