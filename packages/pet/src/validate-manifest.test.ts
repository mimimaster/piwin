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

  it('accepts CodexPetHub codexpet.v1 packages with install defaults', () => {
    // Real-world shape from https://codexpethub.com (guga) — no id / spritesheetPath.
    const result = validatePetManifest(
      {
        schema_version: 'codexpet.v1',
        name: 'Guga',
        description: '咕咕嘎嘎小企鹅',
        author: 'zclouder',
        atlas: {
          width: 1536,
          height: 1872,
          columns: 8,
          rows: 9,
          cell_width: 192,
          cell_height: 208,
        },
        states: [
          { name: 'idle', row: 0, frames: 6 },
          { name: 'running-right', row: 1, frames: 8 },
          { name: 'running-left', row: 2, frames: 8 },
          { name: 'waving', row: 3, frames: 4 },
          { name: 'jumping', row: 4, frames: 5 },
          { name: 'failed', row: 5, frames: 8 },
          { name: 'waiting', row: 6, frames: 6 },
          { name: 'running', row: 7, frames: 6 },
          { name: 'review', row: 8, frames: 6 },
        ],
      },
      { defaultId: 'guga', defaultSpritesheetPath: 'spritesheet.webp' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe('guga');
    expect(result.manifest.displayName).toBe('Guga');
    expect(result.manifest.spritesheetPath).toBe('spritesheet.webp');
    expect(result.manifest.cellWidth).toBe(192);
    expect(result.manifest.cellHeight).toBe(208);
    expect(result.manifest.cols).toBe(8);
    expect(result.manifest.rows).toBe(9);
    expect(result.manifest.stateRows?.idle).toBe(0);
    // Explicit "running" row wins over running-right/left.
    expect(result.manifest.stateRows?.running).toBe(7);
    expect(result.manifest.stateRows?.waving).toBe(3);
    expect(result.manifest.stateRows?.review).toBe(8);
  });

  it('defaults spritesheet.webp for codexpet.v1 without install options', () => {
    const result = validatePetManifest({
      schema_version: 'codexpet.v1',
      id: 'blankie',
      name: 'Blankie',
      atlas: { columns: 8, rows: 9, cell_width: 192, cell_height: 208 },
      states: [{ name: 'idle', row: 0, frames: 6 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.spritesheetPath).toBe('spritesheet.webp');
    }
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
