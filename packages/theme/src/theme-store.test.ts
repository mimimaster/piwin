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
  it('lists Inkstone as the default theme and keeps Ink Wash as an alternative', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    const listed = await listThemes(root);
    const ink = listed.themes.find((theme) => theme.id === 'piwin-ink-wash');
    const inkstone = listed.themes.find((theme) => theme.id === 'piwin-inkstone');

    expect(listed.activeThemeId).toBe('piwin-inkstone');
    expect(inkstone).toMatchObject({
      id: 'piwin-inkstone',
      name: 'Inkstone',
      source: 'bundled',
      active: true,
    });
    expect(ink).toMatchObject({
      id: 'piwin-ink-wash',
      name: '砚夜泼墨',
      mode: 'dark',
      source: 'bundled',
      active: false,
    });
    for (const hiddenThemeId of [
      'piwin-inkstone-paper',
      'piwin-inkstone-ink',
      'piwin-dark',
      'piwin-light',
      'piwin-orange-white',
      'piwin-obsidian',
      'piwin-bone',
    ]) {
      expect(listed.themes.some((theme) => theme.id === hiddenThemeId)).toBe(false);
    }
    expect(ink?.path).toBe(join(getThemesDir(root), 'piwin-ink-wash'));

    const manifest = await loadThemeManifest(root, 'piwin-ink-wash');
    expect(manifest.tokens.bg).toBe('#1c1d20');
    expect(manifest.artifact?.accent).toBe('#9bb2b8');
  });

  it('migrates retired face ids to the single Inkstone package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    expect(resolveOnDiskThemeId('piwin-obsidian')).toBe('piwin-inkstone');
    expect(resolveOnDiskThemeId('piwin-bone')).toBe('piwin-inkstone');
    expect(resolveOnDiskThemeId('piwin-inkstone-paper')).toBe('piwin-inkstone');
    expect(resolveOnDiskThemeId('piwin-ink-wash')).toBe('piwin-ink-wash');

    const obsidian = await loadThemeManifest(root, 'piwin-obsidian');
    expect(obsidian.id).toBe('piwin-inkstone');

    const bone = await loadThemeManifest(root, 'piwin-bone');
    expect(bone.id).toBe('piwin-inkstone');

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
    const manifestPath = new URL('../bundled/piwin-ink-wash/theme.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

    expect(manifest.css).toBeUndefined();
    expect(manifest.js).toBeUndefined();
    expect(manifest.script).toBeUndefined();
  });
});
