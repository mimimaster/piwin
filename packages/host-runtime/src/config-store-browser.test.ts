import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPiwinConfig } from './config-store.js';

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
});
