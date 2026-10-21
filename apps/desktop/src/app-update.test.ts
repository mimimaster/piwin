import { describe, expect, it } from 'vitest';
import {
  appUpdatePercent,
  parseAppUpdateInstallOutcome,
  parseAppUpdateProgress,
  parseAvailableAppUpdate,
} from './app-update.js';

describe('parseAvailableAppUpdate', () => {
  it('reads the Rust payload and drops blank notes', () => {
    expect(
      parseAvailableAppUpdate({ version: '0.2.6', currentVersion: '0.2.5', notes: '  ' }),
    ).toEqual({ version: '0.2.6', currentVersion: '0.2.5' });
    expect(
      parseAvailableAppUpdate({ version: '0.2.6', currentVersion: '0.2.5', notes: '新增\n- a' }),
    ).toEqual({ version: '0.2.6', currentVersion: '0.2.5', notes: '新增\n- a' });
  });

  it('treats null (no update) and malformed payloads as nothing', () => {
    expect(parseAvailableAppUpdate(null)).toBeUndefined();
    expect(parseAvailableAppUpdate({ version: 1 })).toBeUndefined();
  });
});

describe('parseAppUpdateInstallOutcome', () => {
  it('maps every Rust outcome', () => {
    expect(parseAppUpdateInstallOutcome({ kind: 'busy', busySessionCount: 2 })).toEqual({
      kind: 'busy',
      busySessionCount: 2,
    });
    expect(parseAppUpdateInstallOutcome({ kind: 'restarting' })).toEqual({ kind: 'restarting' });
    expect(parseAppUpdateInstallOutcome({ kind: 'noUpdate' })).toEqual({ kind: 'noUpdate' });
    expect(parseAppUpdateInstallOutcome('garbage')).toEqual({ kind: 'noUpdate' });
  });
});

describe('progress', () => {
  it('parses progress and computes a whole percent', () => {
    const progress = parseAppUpdateProgress({ downloaded: 50, total: 200, finished: false });
    expect(progress).toEqual({ downloaded: 50, total: 200, finished: false });
    expect(appUpdatePercent(progress)).toBe(25);
  });

  it('has no percent without a known size', () => {
    const progress = parseAppUpdateProgress({ downloaded: 50, total: null, finished: false });
    expect(progress).toEqual({ downloaded: 50, finished: false });
    expect(appUpdatePercent(progress)).toBeUndefined();
    expect(parseAppUpdateProgress({})).toBeUndefined();
  });
});
