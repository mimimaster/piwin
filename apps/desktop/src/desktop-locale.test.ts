import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDesktopCopy,
  getDesktopTranslator,
  loadDesktopLocale,
  saveDesktopLocale,
} from './desktop-locale';

describe('desktop locale preference', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          storage.set(key, value);
        },
      },
    });
  });

  it('uses Simplified Chinese until a user explicitly chooses a language', () => {
    expect(loadDesktopLocale()).toBe('zh-CN');
  });

  it('persists a supported locale and returns its matching UI copy', () => {
    saveDesktopLocale('en');

    expect(loadDesktopLocale()).toBe('en');
    expect(getDesktopCopy('en').settings).toBe('Settings');
    expect(getDesktopCopy('zh-CN').settings).toBe('设置');
  });

  it('formats settings model counts in the selected display language', () => {
    expect(getDesktopTranslator('zh-CN').settings.provider.models(2)).toBe('2 个模型');
    expect(getDesktopTranslator('en').settings.provider.models(1)).toBe('1 model');
    expect(getDesktopTranslator('en').settings.provider.models(2)).toBe('2 models');
  });
});
