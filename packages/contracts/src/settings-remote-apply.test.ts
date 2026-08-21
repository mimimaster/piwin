import { describe, expect, it } from 'vitest';
import { partitionRemoteSettingsMutations } from './settings.js';

describe('partitionRemoteSettingsMutations', () => {
  it('allows Run Mode and desktop restore on the same apply', () => {
    const { allowed, blocked } = partitionRemoteSettingsMutations([
      { kind: 'replace-domain', domain: 'thinking', value: { ultraEnabled: true } },
      { kind: 'replace-domain', domain: 'permissions', value: { mode: 'auto', preset: 'auto' } },
      { kind: 'replace-domain', domain: 'desktop', value: {} },
    ]);
    expect(allowed.map((mutation) => mutation.domain)).toEqual([
      'thinking',
      'permissions',
      'desktop',
    ]);
    expect(blocked).toEqual([]);
  });

  it('allows Host-shared domains including desktop restore', () => {
    const { allowed, blocked } = partitionRemoteSettingsMutations([
      {
        kind: 'replace-domain',
        domain: 'artifact',
        value: {
          enabled: true,
          triggerMode: 'automatic',
          decisionPrompt: { mode: 'default', customPrompt: '' },
          maxBytes: 1_000_000,
        },
      },
      { kind: 'replace-domain', domain: 'automation', value: { enabled: true } },
      { kind: 'replace-domain', domain: 'providers', value: [] },
      { kind: 'replace-domain', domain: 'process', value: {} },
      { kind: 'replace-domain', domain: 'desktop', value: {} },
    ]);
    expect(allowed.map((mutation) => mutation.domain)).toEqual([
      'artifact',
      'automation',
      'providers',
      'process',
      'desktop',
    ]);
    expect(blocked).toEqual([]);
  });
});
