import { describe, expect, it } from 'vitest';
import {
  compareAppVersions,
  findAvailableUpdate,
  releasePlatformForUserAgent,
} from './app-update.js';

const MANIFEST = {
  latest: {
    'macos-aarch64': { version: '0.2.1', url: 'https://dl.piwinwin.com/x.dmg' },
    'windows-x64': { version: '0.2.0', url: 'https://dl.piwinwin.com/x.exe' },
  },
  releases: [],
};

describe('compareAppVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareAppVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareAppVersions('0.2.0', '0.1.12')).toBeGreaterThan(0);
    expect(compareAppVersions('0.1.1', '0.1.1')).toBe(0);
  });

  it('refuses anything that is not X.Y.Z', () => {
    expect(compareAppVersions('1.0-preview', '0.1.0')).toBeUndefined();
  });
});

describe('findAvailableUpdate', () => {
  it('offers the newest installer for this platform only', () => {
    expect(findAvailableUpdate(MANIFEST, 'macos-aarch64', '0.2.0')).toEqual({ version: '0.2.1' });
    expect(findAvailableUpdate(MANIFEST, 'windows-x64', '0.2.0')).toBeUndefined();
  });

  it('stays quiet when up to date, ahead, or the manifest is malformed', () => {
    expect(findAvailableUpdate(MANIFEST, 'macos-aarch64', '0.2.1')).toBeUndefined();
    expect(findAvailableUpdate(MANIFEST, 'macos-aarch64', '0.3.0')).toBeUndefined();
    expect(
      findAvailableUpdate({ latest: { 'macos-aarch64': {} } }, 'macos-aarch64', '0.1.0'),
    ).toBeUndefined();
    expect(findAvailableUpdate('not json', 'macos-aarch64', '0.1.0')).toBeUndefined();
  });
});

describe('releasePlatformForUserAgent', () => {
  it('maps Desktop webviews to installer platforms', () => {
    expect(releasePlatformForUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(
      'macos-aarch64',
    );
    expect(releasePlatformForUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'windows-x64',
    );
    expect(releasePlatformForUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBeUndefined();
  });
});
