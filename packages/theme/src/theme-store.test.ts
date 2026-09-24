import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getThemesDir,
  listThemes,
  loadThemeManifest,
  resolveOnDiskThemeId,
  setActiveTheme,
  ThemeNotFoundError,
} from './theme-store.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('bundled theme store', () => {
  it('lists Inkstone as the sole bundled default theme', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    const listed = await listThemes(root);
    const inkstone = listed.themes.find((theme) => theme.id === 'piwin-inkstone');

    expect(listed.activeThemeId).toBe('piwin-inkstone');
    expect(listed.themes).toHaveLength(1);
    expect(inkstone).toMatchObject({
      id: 'piwin-inkstone',
      name: 'Inkstone',
      source: 'bundled',
      active: true,
    });
    for (const hiddenOrRemovedId of [
      'piwin-ink-wash',
      'piwin-inkstone-paper',
      'piwin-inkstone-ink',
      'piwin-dark',
      'piwin-light',
      'piwin-orange-white',
      'piwin-obsidian',
      'piwin-bone',
    ]) {
      expect(listed.themes.some((theme) => theme.id === hiddenOrRemovedId)).toBe(false);
    }
    expect(inkstone?.path).toBe(join(getThemesDir(root), 'piwin-inkstone'));

    const manifest = await loadThemeManifest(root, 'piwin-inkstone');
    expect(manifest.tokens.bg).toBe('#0b0a09');
  });

  it('migrates retired face ids to the single Inkstone package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    expect(resolveOnDiskThemeId('piwin-obsidian')).toBe('piwin-inkstone');
    expect(resolveOnDiskThemeId('piwin-bone')).toBe('piwin-inkstone');
    expect(resolveOnDiskThemeId('piwin-inkstone-paper')).toBe('piwin-inkstone');
    expect(resolveOnDiskThemeId('piwin-ink-wash')).toBe('piwin-inkstone');

    const obsidian = await loadThemeManifest(root, 'piwin-obsidian');
    expect(obsidian.id).toBe('piwin-inkstone');

    const bone = await loadThemeManifest(root, 'piwin-bone');
    expect(bone.id).toBe('piwin-inkstone');

    const inkWash = await loadThemeManifest(root, 'piwin-ink-wash');
    expect(inkWash.id).toBe('piwin-inkstone');

    const activated = await setActiveTheme(root, 'piwin-obsidian');
    expect(activated.id).toBe('piwin-inkstone');
    const preference = JSON.parse(await readFile(join(root, 'theme.json'), 'utf8')) as {
      activeThemeId: string;
    };
    expect(preference.activeThemeId).toBe('piwin-inkstone');
  });

  it('refuses unknown theme ids without leaking a filesystem path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    await expect(loadThemeManifest(root, 'does-not-exist')).rejects.toMatchObject({
      name: 'ThemeNotFoundError',
      message: 'theme not installed: does-not-exist',
    });
    await expect(loadThemeManifest(root, 'does-not-exist')).rejects.toBeInstanceOf(
      ThemeNotFoundError,
    );
    await expect(loadThemeManifest(root, 'does-not-exist')).rejects.not.toMatchObject({
      message: expect.stringMatching(/ENOENT|themes[/\\]/),
    });
  });

  it('does not add executable payloads to the canonical bundled manifest', async () => {
    const manifestPath = new URL('../bundled/piwin-inkstone/theme.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

    expect(manifest.css).toBeUndefined();
    expect(manifest.js).toBeUndefined();
    expect(manifest.script).toBeUndefined();
  });
});
