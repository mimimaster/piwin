// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseFontMetadata } from './font-parser.js';
import { clearCustomFonts, listCustomFonts, saveCustomFont } from './font-storage.js';
import {
  applyCustomFontsToDocument,
  computeFontVariables,
} from './font-manager.js';

describe('font-integration with the shipped default faces', () => {
  const testDir = 'public/fonts/default';
  const testFiles = [
    { file: 'sans.ttf', role: 'sans' as const, family: 'Sans Variable' },
    { file: 'mono.ttf', role: 'mono' as const, family: 'Mono Web' },
    { file: 'serif.ttf', role: 'serif' as const, family: 'Serif Variable' },
  ];

  beforeEach(async () => {
    await clearCustomFonts();
  });

  it('stores and applies the three faces under sanitized family names', async () => {
    const savedFamilies: Record<string, string> = {};

    for (const { file, role, family } of testFiles) {
      const fullPath = `${testDir}/${file}`;
      if (!existsSync(fullPath)) continue;

      const buffer = readFileSync(fullPath);
      const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const meta = parseFontMetadata(arrayBuf, file);
      expect(meta.family).toBe(family);
      expect(meta.family.toLowerCase()).not.toContain('anthropic');

      const saved = await saveCustomFont({
        family: meta.family,
        fileName: file,
        format: meta.format,
        data: arrayBuf,
      });

      expect(saved.id).toBeDefined();
      expect(saved.size).toBe(arrayBuf.byteLength);
      savedFamilies[role] = saved.family;
    }

    const allFonts = await listCustomFonts();
    expect(allFonts.length).toBe(3);

    const sansFamily = savedFamilies.sans;
    const monoFamily = savedFamilies.mono;
    const serifFamily = savedFamilies.serif;
    expect(sansFamily).toBeDefined();
    expect(monoFamily).toBeDefined();
    expect(serifFamily).toBeDefined();
    if (!sansFamily || !monoFamily || !serifFamily) throw new Error('Missing families');

    const vars = computeFontVariables({
      sansFont: sansFamily,
      monoFont: monoFamily,
      serifFont: serifFamily,
    });

    expect(vars['--font']).toContain(sansFamily);
    expect(vars['--font-sans']).toContain(sansFamily);
    expect(vars['--font-mono']).toContain(monoFamily);
    expect(vars['--mono']).toContain(monoFamily);
    expect(vars['--serif']).toContain(serifFamily);
    expect(vars['--font-serif']).toContain(serifFamily);
    expect(JSON.stringify(vars).toLowerCase()).not.toContain('anthropic');

    const root = document.createElement('html');
    applyCustomFontsToDocument(
      {
        sansFont: sansFamily,
        monoFont: monoFamily,
        serifFont: serifFamily,
      },
      root,
    );

    expect(root.style.getPropertyValue('--font-sans')).toContain(sansFamily);
    expect(root.style.getPropertyValue('--font-mono')).toContain(savedFamilies.mono);
    expect(root.style.getPropertyValue('--serif')).toContain(savedFamilies.serif);
    expect(root.style.fontFamily).toContain(savedFamilies.sans);
    expect(root.style.fontFamily.toLowerCase()).not.toContain('anthropic');
  });
});
