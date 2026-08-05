import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PIWIN_BUNDLED_ASSETS_ROOT_ENV,
  resolveBundledAssetsRoot,
} from './bundled-assets-root.js';

describe('resolveBundledAssetsRoot (agent-host)', () => {
  const moduleUrl = import.meta.url;

  it('falls back to import.meta.url-relative path when env unset', () => {
    const resolved = resolveBundledAssetsRoot({
      layoutPath: 'agent-host/bundled-prompts',
      moduleUrl,
      relativeFallback: '../bundled-prompts',
      env: {},
    });
    expect(resolved).toBe(
      join(dirname(fileURLToPath(moduleUrl)), '../bundled-prompts'),
    );
  });

  it('uses PIWIN_BUNDLED_ASSETS_ROOT layout when set', () => {
    const resolved = resolveBundledAssetsRoot({
      layoutPath: 'agent-host/bundled-prompts',
      moduleUrl,
      relativeFallback: '../bundled-prompts',
      env: { [PIWIN_BUNDLED_ASSETS_ROOT_ENV]: '/tmp/piwin-assets' },
    });
    expect(resolved).toBe(join('/tmp/piwin-assets', 'agent-host/bundled-prompts'));
  });
});
