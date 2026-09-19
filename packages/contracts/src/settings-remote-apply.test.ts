import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from './config.js';
import {
  buildSettingsDomainMutations,
  partitionRemoteSettingsMutations,
} from './settings.js';

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

  it('allows codeSearch on remote apply', () => {
    const { allowed, blocked } = partitionRemoteSettingsMutations([
      {
        kind: 'replace-domain',
        domain: 'codeSearch',
        value: { enabled: true, backend: 'windsurf' },
      },
    ]);
    expect(allowed.map((mutation) => mutation.domain)).toEqual(['codeSearch']);
    expect(blocked).toEqual([]);
  });
});

describe('buildSettingsDomainMutations codeSearch', () => {
  it('emits a replace-domain mutation when codeSearch changes', () => {
    const previous = {
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 1, allowedMimeTypes: [] },
      artifact: {
        enabled: false,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 1,
      },
    } as PiwinConfig;
    const next = { ...previous, codeSearch: { enabled: true, backend: 'windsurf' as const } };
    const mutations = buildSettingsDomainMutations(previous, next);
    expect(mutations).toEqual([
      expect.objectContaining({
        kind: 'replace-domain',
        domain: 'codeSearch',
        value: { enabled: true, backend: 'windsurf' },
      }),
    ]);
  });
});
