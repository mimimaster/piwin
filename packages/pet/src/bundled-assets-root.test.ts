import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  PIWIN_BUNDLED_ASSETS_ROOT_ENV,
  resolveBundledAssetsRoot,
} from './bundled-assets-root.js';

describe('resolveBundledAssetsRoot (pet)', () => {
  it('uses env layout path', () => {
    expect(
      resolveBundledAssetsRoot({
        layoutPath: 'pet/bundled',
        moduleUrl: import.meta.url,
        relativeFallback: '../bundled',
        env: { [PIWIN_BUNDLED_ASSETS_ROOT_ENV]: '/assets' },
      }),
    ).toBe(join('/assets', 'pet/bundled'));
  });
});
