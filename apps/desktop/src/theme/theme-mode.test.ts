import { afterEach, describe, expect, it, vi } from 'vitest';

import { readThemeMode } from './theme-mode.js';

describe('readThemeMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to dark when no mode has been projected yet', () => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });

    expect(readThemeMode()).toBe('dark');
  });

  it('reads the resolved light mode from the document root', () => {
    vi.stubGlobal('document', { documentElement: { dataset: { themeMode: 'light' } } });

    expect(readThemeMode()).toBe('light');
  });

  it('treats unknown values as dark for a safe renderer fallback', () => {
    vi.stubGlobal('document', {
      documentElement: { dataset: { themeMode: 'unexpected' } },
    });

    expect(readThemeMode()).toBe('dark');
  });
});
