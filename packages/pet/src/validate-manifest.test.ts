import { describe, expect, it } from 'vitest';
import { validatePetManifest } from './validate-manifest.js';

describe('validatePetManifest', () => {
  it('accepts a minimal Codex-style manifest', () => {
    const result = validatePetManifest({
      id: 'happy-dog',
      displayName: 'Happy Dog',
      description: 'A cheerful pixel dog.',
      spritesheetPath: 'spritesheet.webp',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('happy-dog');
      expect(result.manifest.displayName).toBe('Happy Dog');
    }
  });

  it('accepts name alias as displayName', () => {
    const result = validatePetManifest({
      id: 'x',
      name: 'X Pet',
      spritesheetPath: 'sheet.png',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects path traversal spritesheet', () => {
    const result = validatePetManifest({
      id: 'x',
      displayName: 'X',
      spritesheetPath: '../secret.webp',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects executable payloads', () => {
    const result = validatePetManifest({
      id: 'x',
      displayName: 'X',
      spritesheetPath: 'spritesheet.webp',
      js: 'alert(1)',
    });
    expect(result.ok).toBe(false);
  });
});
