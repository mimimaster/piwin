import { useEffect, useState } from 'react';

export type MobileThemeMode = 'system' | 'dark' | 'light' | 'ink-wash';

const THEME_STORAGE_KEY = 'piwin.mobile.theme-mode';

export function useTheme() {
  const [themeMode, setThemeModeState] = useState<MobileThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'system' || stored === 'dark' || stored === 'light' || stored === 'ink-wash') {
        return stored;
      }
    } catch {
      // ignore
    }
    return 'dark';
  });

  const setThemeMode = (mode: MobileThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      let effectiveMode: 'dark' | 'light' | 'ink-wash' = 'dark';

      if (themeMode === 'system') {
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        effectiveMode = isSystemDark ? 'dark' : 'light';
      } else {
        effectiveMode = themeMode;
      }

      root.setAttribute('data-theme', effectiveMode);
      root.setAttribute('data-color-mode', effectiveMode === 'light' ? 'light' : 'dark');
      root.setAttribute('data-theme-visual-style', effectiveMode === 'ink-wash' ? 'ink-wash' : 'flat');
    };

    applyTheme();

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [themeMode]);

  return {
    themeMode,
    setThemeMode,
  };
}
