import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { isSafeRemoteSettingsApply } from './remote-settings-apply.js';

const permissionsApply: Extract<HostCommand, { type: 'settings/apply' }> = {
  type: 'settings/apply',
  input: {
    expectedRevision: 'rev-1',
    expectedDomainRevisions: { permissions: 'hash-1' },
    mutations: [
      { kind: 'replace-domain', domain: 'permissions', value: { mode: 'auto', preset: 'auto' } },
    ],
  },
};

describe('isSafeRemoteSettingsApply', () => {
  it('admits a Run Mode permissions write', () => {
    expect(isSafeRemoteSettingsApply(permissionsApply)).toBe(true);
  });

  it('rejects extra keys on permissions', () => {
    expect(
      isSafeRemoteSettingsApply({
        ...permissionsApply,
        input: {
          ...permissionsApply.input,
          mutations: [
            {
              kind: 'replace-domain',
              domain: 'permissions',
              value: { mode: 'bypass', preset: 'yolo', rulesPath: '/etc/passwd' } as never,
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it('admits desktop restore (composer profile / last session)', () => {
    expect(
      isSafeRemoteSettingsApply({
        type: 'settings/apply',
        input: {
          expectedRevision: 'rev-1',
          expectedDomainRevisions: { desktop: 'hash-1' },
          mutations: [{ kind: 'replace-domain', domain: 'desktop', value: {} }],
        },
      }),
    ).toBe(true);
  });

  it('admits artifact and provider rows with refs', () => {
    expect(
      isSafeRemoteSettingsApply({
        type: 'settings/apply',
        input: {
          expectedRevision: 'rev-1',
          expectedDomainRevisions: { artifact: 'hash-a', providers: 'hash-p' },
          mutations: [
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
            {
              kind: 'replace-domain',
              domain: 'providers',
              value: [
                {
                  id: 'openai',
                  protocol: 'openai-compatible',
                  name: 'OpenAI',
                  baseUrl: 'https://api.openai.com/v1',
                  apiKeyRef: 'keychain:openai',
                  models: [],
                },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('admits notes and knowledge embedding writes', () => {
    expect(
      isSafeRemoteSettingsApply({
        type: 'settings/apply',
        input: {
          expectedRevision: 'rev-1',
          expectedDomainRevisions: { notes: 'hash-n', knowledge: 'hash-k' },
          mutations: [
            {
              kind: 'replace-domain',
              domain: 'notes',
              value: {
                embedding: {
                  provider: 'openai-compatible',
                  baseUrl: 'https://api.example.com/v1',
                  model: 'Qwen/Qwen3-Embedding-8B',
                },
              },
            },
            {
              kind: 'replace-domain',
              domain: 'knowledge',
              value: {
                embedding: {
                  enabled: true,
                  provider: 'openai-compatible',
                  baseUrl: 'https://api.example.com/v1',
                  model: 'Qwen/Qwen3-Embedding-8B',
                },
              },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('rejects a knowledge write when the CAS hash is missing', () => {
    expect(
      isSafeRemoteSettingsApply({
        type: 'settings/apply',
        input: {
          expectedRevision: 'rev-1',
          expectedDomainRevisions: { notes: 'hash-n' },
          mutations: [
            {
              kind: 'replace-domain',
              domain: 'notes',
              value: {},
            },
            {
              kind: 'replace-domain',
              domain: 'knowledge',
              value: { embedding: { enabled: true } },
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it('rejects provider rows that carry raw apiKey', () => {
    expect(
      isSafeRemoteSettingsApply({
        type: 'settings/apply',
        input: {
          expectedRevision: 'rev-1',
          expectedDomainRevisions: { providers: 'hash-p' },
          mutations: [
            {
              kind: 'replace-domain',
              domain: 'providers',
              value: [
                {
                  id: 'openai',
                  protocol: 'openai-compatible',
                  name: 'OpenAI',
                  baseUrl: 'https://api.openai.com/v1',
                  apiKey: 'sk-live',
                  models: [],
                },
              ] as never,
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
