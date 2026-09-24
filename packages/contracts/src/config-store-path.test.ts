import { describe, expect, it } from 'vitest';

import { configStoreDisplayRef, configStoreRelativePath } from './config-store-path.js';

describe('configStoreRelativePath', () => {
  it('maps a path under the root, in either home form', () => {
    expect(configStoreRelativePath('/Users/me/.piwin/pi-agent/auth.json', '/Users/me/.piwin')).toBe(
      'pi-agent/auth.json',
    );
    expect(configStoreRelativePath('~/.piwin/pi-agent/auth.json', '/Users/me/.piwin')).toBe(
      'pi-agent/auth.json',
    );
    expect(configStoreRelativePath('/Users/me/.piwin/config.json', '~/.piwin')).toBe('config.json');
    expect(configStoreRelativePath('file:///home/me/.piwin/a/b.md', '~/.piwin')).toBe('a/b.md');
    expect(configStoreRelativePath('C:\\Users\\me\\.piwin\\x.json', 'c:/Users/me/.piwin')).toBe('x.json');
  });

  it('uses the Host home directory when it is known', () => {
    expect(configStoreRelativePath('/srv/piwin-user/.piwin/x.json', '~/.piwin', '/srv/piwin-user')).toBe(
      'x.json',
    );
    // Another user's store is not this Host's store.
    expect(configStoreRelativePath('/Users/other/.piwin/x.json', '~/.piwin', '/Users/me')).toBeNull();
  });

  it('never lets a different store stand in for this one', () => {
    // A test Host rooted at ~/.piwin-test must not read its own auth.json for
    // a chip naming the production store.
    expect(configStoreRelativePath('~/.piwin/pi-agent/auth.json', '/Users/me/.piwin-test')).toBeNull();
    expect(configStoreRelativePath('~/.piwin-test/pi-agent/auth.json', '/Users/me/.piwin')).toBeNull();
    expect(configStoreRelativePath('/Users/me/backup/.piwin-old/config.json', '/Users/me/.piwin')).toBeNull();
    expect(configStoreRelativePath('/Users/me/.piwin-extra/x', '/Users/me/.piwin')).toBeNull();
  });

  it('rejects the root itself, the media vault, traversal, and a missing root', () => {
    expect(configStoreRelativePath('~/.piwin', '~/.piwin')).toBeNull();
    expect(configStoreRelativePath('~/.piwin/media/s/a.png', '~/.piwin')).toBeNull();
    expect(configStoreRelativePath('~/.piwin/a/../../etc/passwd', '~/.piwin')).toBeNull();
    expect(configStoreRelativePath('~/.piwin/x.json', undefined)).toBeNull();
    expect(configStoreRelativePath('/tmp/x.json', '/Users/me/.piwin')).toBeNull();
  });
});

describe('configStoreDisplayRef', () => {
  it('names the store the Host actually uses', () => {
    expect(configStoreDisplayRef('/Users/me/.piwin-test', 'pi-agent/auth.json')).toBe(
      '~/.piwin-test/pi-agent/auth.json',
    );
    expect(configStoreDisplayRef('~/.piwin', '')).toBe('~/.piwin');
  });
});
