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

  it('loads Deck face ids from the pre-Deck bundled directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-theme-store-'));
    temporaryRoots.push(root);

    expect(resolveOnDiskThemeId('piwin-obsidian')).toBe('piwin-dark');
    expect(resolveOnDiskThemeId('piwin-bone')).toBe('piwin-light');
    expect(resolveOnDiskThemeId('piwin-ink-wash')).toBe('piwin-ink-wash');

    const obsidian = await loadThemeManifest(root, 'piwin-obsidian');
    const dark = await loadThemeManifest(root, 'piwin-dark');
    expect(obsidian.id).toBe(dark.id);
    expect(obsidian.tokens).toEqual(dark.tokens);

    const bone = await loadThemeManifest(root, 'piwin-bone');
    const light = await loadThemeManifest(root, 'piwin-light');
    expect(bone.id).toBe(light.id);
    expect(bone.tokens).toEqual(light.tokens);

    const activated = await setActiveTheme(root, 'piwin-obsidian');
    expect(activated.id).toBe('piwin-dark');
    const preference = JSON.parse(await readFile(join(root, 'theme.json'), 'utf8')) as {
      activeThemeId: string;
    };
    expect(preference.activeThemeId).toBe('piwin-dark');
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
