/**
 * Desktop-only display language preference.
 *
 * This stays in the renderer because it affects presentation only; it must not
 * alter shared host configuration, model data, or transcript content.
 */
import { DESKTOP_COPY_EN } from './desktop-locale-copy-en.js';
import { DESKTOP_COPY_ZH_CN } from './desktop-locale-copy-zh.js';
import type { DesktopCopy } from './desktop-locale-copy-types.js';
import type { DesktopLocale } from './desktop-locale-id.js';

export type { DesktopLocale } from './desktop-locale-id.js';
export type { DesktopCopy } from './desktop-locale-copy-types.js';
export type { DesktopTranslator } from './desktop-locale-translator-types.js';
export { getDesktopTranslator } from './desktop-locale-translator.js';

const DESKTOP_LOCALE_KEY = 'piwin.desktop.locale';
const DEFAULT_DESKTOP_LOCALE: DesktopLocale = 'zh-CN';

const COPY_BY_LOCALE: Record<DesktopLocale, DesktopCopy> = {
  'zh-CN': DESKTOP_COPY_ZH_CN,
  en: DESKTOP_COPY_EN,
};

export function getDesktopCopy(locale: DesktopLocale): DesktopCopy {
  return COPY_BY_LOCALE[locale];
}

export function loadDesktopLocale(): DesktopLocale {
  try {
    const storedLocale = localStorage.getItem(DESKTOP_LOCALE_KEY);
    if (storedLocale === 'zh-CN' || storedLocale === 'en') {
      return storedLocale;
    }
  } catch {
    // Storage may be unavailable in private browsing or test environments.
  }

  return DEFAULT_DESKTOP_LOCALE;
}

export function saveDesktopLocale(locale: DesktopLocale): void {
  try {
    localStorage.setItem(DESKTOP_LOCALE_KEY, locale);
  } catch {
    // A display preference must never block rendering.
  }
}
