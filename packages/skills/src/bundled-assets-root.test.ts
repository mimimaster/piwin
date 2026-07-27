import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  PIWIN_BUNDLED_ASSETS_ROOT_ENV,
  resolveBundledAssetsRoot,
} from './bundled-assets-root.js';

describe('resolveBundledAssetsRoot (skills)', () => {
  it('uses env layout path', () => {
    expect(
      resolveBundledAssetsRoot({
        layoutPath: 'skills',
        moduleUrl: import.meta.url,
        relativeFallback: '../../../skills',
        env: { [PIWIN_BUNDLED_ASSETS_ROOT_ENV]: '/assets' },
      }),
    ).toBe(join('/assets', 'skills'));
  });
});
