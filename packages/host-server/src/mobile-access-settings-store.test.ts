import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOBILE_ACCESS_SETTINGS,
  MobileAccessSettingsFileStore,
  readMobileAccessSettings,
} from './mobile-access-settings-store.js';

describe('MobileAccessSettingsFileStore', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('defaults to enabled when nothing was saved and round-trips a save', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-mobile-settings-'));
    const path = join(dir, 'devices', 'mobile-access.json');
    const store = new MobileAccessSettingsFileStore(path);
    expect(await store.load()).toEqual(DEFAULT_MOBILE_ACCESS_SETTINGS);

    await store.save({ enabled: false, port: 8788, advertisedEndpoint: 'ws://192.168.1.5:8788' });
    expect(await store.load()).toEqual({
      enabled: false,
      port: 8788,
      advertisedEndpoint: 'ws://192.168.1.5:8788',
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('throws on a corrupt file instead of guessing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-mobile-settings-'));
    const path = join(dir, 'mobile-access.json');
    await writeFile(path, '{oops', 'utf8');
    await expect(new MobileAccessSettingsFileStore(path).load()).rejects.toThrow('parse');
  });

  it('drops invalid fields', () => {
    expect(readMobileAccessSettings({ enabled: 'yes', port: 70_000, advertisedEndpoint: '  ' })).toEqual({
      enabled: true,
    });
    expect(() => readMobileAccessSettings([])).toThrow();
  });
});
