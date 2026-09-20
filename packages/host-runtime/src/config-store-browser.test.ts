import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPiwinConfig } from './config-store.js';
import { normalizeBrowserWorkbenchConfig } from './config-store-browser.js';

describe('PiwinConfig.browser', () => {
  it('normalizes headed Chromium and an explicit CDP endpoint', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-browser-'));
    await writeFile(
      join(rootDir, 'config.json'),
      JSON.stringify({
        hostMode: 'sdk',
        browser: { headless: false, cdpEndpoint: 'http://127.0.0.1:9222' },
      }),
      'utf8',
    );
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.browser).toEqual({
      headless: false,
      cdpEndpoint: 'http://127.0.0.1:9222',
    });
  });

  it('normalizes deviceScaleFactor within range [1, 3]', () => {
    expect(normalizeBrowserWorkbenchConfig({ deviceScaleFactor: 2 })).toEqual({
      deviceScaleFactor: 2,
    });
    expect(normalizeBrowserWorkbenchConfig({ deviceScaleFactor: 0.5 })).toEqual({
      deviceScaleFactor: 1,
    });
    expect(normalizeBrowserWorkbenchConfig({ deviceScaleFactor: 5 })).toEqual({
      deviceScaleFactor: 3,
    });
  });

  it('normalizes quality within range [50, 100]', () => {
    expect(normalizeBrowserWorkbenchConfig({ quality: 90 })).toEqual({
      quality: 90,
    });
    expect(normalizeBrowserWorkbenchConfig({ quality: 20 })).toEqual({
      quality: 50,
    });
    expect(normalizeBrowserWorkbenchConfig({ quality: 120 })).toEqual({
      quality: 100,
    });
  });

  it('drops invalid values', () => {
    expect(normalizeBrowserWorkbenchConfig(null)).toBeUndefined();
    expect(normalizeBrowserWorkbenchConfig({})).toBeUndefined();
    expect(normalizeBrowserWorkbenchConfig({ deviceScaleFactor: 'auto' })).toBeUndefined();
  });
});
