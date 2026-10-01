import { describe, expect, it } from 'vitest';
import { parseExtensionRegistryIndex } from './extension-registry-index.js';

const valid = {
  schemaVersion: 1,
  extensions: [{
    id: 'mimimaster/commandcode-provider',
    name: 'Command Code',
    description: 'Command Code models for piwin',
    repository: 'https://github.com/mimimaster/piwin-commandcode-provider',
    subdir: 'piwin',
    owners: ['mimimaster'],
    versions: [{ version: '0.7.1-piwin.1', commit: 'a'.repeat(40) }],
  }],
};

describe('piwin extension registry index', () => {
  it('projects a commit-pinned managed extension install', () => {
    const [entry] = parseExtensionRegistryIndex(valid);
    expect(entry?.entryId).toBe('extension:mimimaster/commandcode-provider');
    expect(entry?.install).toEqual({
      kind: 'managed-extension',
      name: 'piwin-mimimaster-commandcode-provider',
      source: { kind: 'git', url: valid.extensions[0]?.repository,
        ref: 'a'.repeat(40), subdir: 'piwin' },
    });
  });

  it('rejects an unpinned commit and a traversal subdirectory', () => {
    expect(() => parseExtensionRegistryIndex({
      ...valid,
      extensions: [{ ...valid.extensions[0], versions: [{ version: '1.0.0', commit: 'main' }] }],
    })).toThrow();
    expect(() => parseExtensionRegistryIndex({
      ...valid,
      extensions: [{ ...valid.extensions[0], subdir: '../secret' }],
    })).toThrow();
  });

  it('offers the newest unwithdrawn version', () => {
    const [entry] = parseExtensionRegistryIndex({
      ...valid,
      extensions: [{ ...valid.extensions[0], versions: [
        { version: '2.0.0', commit: 'b'.repeat(40), yanked: { reason: 'broken' } },
        { version: '1.0.0', commit: 'a'.repeat(40) },
      ] }],
    });
    expect(entry?.version).toBe('1.0.0');
  });

  it('provides Chinese default summary for known extensions', () => {
    const [entry] = parseExtensionRegistryIndex(valid);
    expect(entry?.summary.zhCN).toContain('Command Code 登录');
  });
});
