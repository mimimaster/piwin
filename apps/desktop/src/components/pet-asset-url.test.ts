// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { convertPetAssetPath } from './pet-asset-url.js';

describe('convertPetAssetPath', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('uses convertFileSrc and never falls back to file:// (CSP blocks file in the overlay)', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        convertFileSrc: (assetPath: string) => `https://asset.localhost/${assetPath}`,
      },
    });

    expect(convertPetAssetPath('/Users/me/.piwin/pets/clawd/spritesheet.webp')).toBe(
      'https://asset.localhost//Users/me/.piwin/pets/clawd/spritesheet.webp',
    );
  });

  it('returns empty when convertFileSrc is unavailable instead of a file:// URL', () => {
    expect(convertPetAssetPath('/tmp/spritesheet.webp')).toBe('');
    expect(convertPetAssetPath('')).toBe('');
  });
});
