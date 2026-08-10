import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getThemesDir, listThemes, loadThemeManifest } from './theme-store.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('bundled theme store', () => {
  it('installs and lists the ink-wash theme as a bundled theme', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    const listed = await listThemes(root);
    const ink = listed.themes.find((theme) => theme.id === 'piwin-ink-wash');

    expect(ink).toMatchObject({
      id: 'piwin-ink-wash',
      name: '砚夜泼墨',
      mode: 'dark',
      source: 'bundled',
      active: false,
    });
    expect(ink?.path).toBe(join(getThemesDir(root), 'piwin-ink-wash'));

    const manifest = await loadThemeManifest(root, 'piwin-ink-wash');
    expect(manifest.tokens.bg).toBe('#1c1d20');
    expect(manifest.artifact?.accent).toBe('#9bb2b8');
  });

  it('does not add executable payloads to the canonical bundled manifest', async () => {
    const manifestPath = new URL('../bundled/piwin-ink-wash/theme.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

    expect(manifest.css).toBeUndefined();
    expect(manifest.js).toBeUndefined();
    expect(manifest.script).toBeUndefined();
  });
});
