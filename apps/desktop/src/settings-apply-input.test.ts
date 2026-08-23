import { describe, expect, it } from 'vitest';
import type { SettingsMutation } from '@piwin/contracts';
import {
  settingsApplyInputFromSnapshot,
  settingsMutationsAdmittedByRemoteSnapshot,
} from './settings-apply-input.js';

const knowledgeMutation: SettingsMutation = {
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
};

const notesMutation: SettingsMutation = {
  kind: 'replace-domain',
  domain: 'notes',
  value: {
    embedding: {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'Qwen/Qwen3-Embedding-8B',
    },
  },
};

describe('settingsMutationsAdmittedByRemoteSnapshot', () => {
  it('keeps notes when the Host snapshot predates the knowledge domain', () => {
    expect(
      settingsMutationsAdmittedByRemoteSnapshot([knowledgeMutation, notesMutation], {
        notes: 'hash-notes',
      }).map((mutation) => mutation.domain),
    ).toEqual(['notes']);
  });

  it('folds reranker extras onto notes when knowledge is not hashed', () => {
    const rerankerOnly: SettingsMutation = {
      kind: 'replace-domain',
      domain: 'knowledge',
      value: {
        reranker: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'Qwen/Qwen3-Reranker-8B',
        },
      },
    };
    const admitted = settingsMutationsAdmittedByRemoteSnapshot(
      [rerankerOnly],
      { notes: 'hash-notes' },
      { embedding: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'emb' } },
    );
    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.domain).toBe('notes');
    expect(admitted[0]?.value).toMatchObject({
      embedding: { model: 'emb' },
      knowledgeExtras: {
        reranker: { enabled: true, model: 'Qwen/Qwen3-Reranker-8B' },
      },
    });
  });

  it('keeps knowledge when the Host snapshot hashes it', () => {
    expect(
      settingsMutationsAdmittedByRemoteSnapshot([knowledgeMutation, notesMutation], {
        notes: 'hash-notes',
        knowledge: 'hash-knowledge',
      }).map((mutation) => mutation.domain),
    ).toEqual(['knowledge', 'notes']);
  });

  it('drops every mutation when the snapshot has no domain hashes', () => {
    expect(settingsMutationsAdmittedByRemoteSnapshot([knowledgeMutation, notesMutation], {})).toEqual(
      [],
    );
  });
});

describe('settingsApplyInputFromSnapshot', () => {
  it('omits CAS hashes the snapshot does not have', () => {
    expect(
      settingsApplyInputFromSnapshot(
        { revision: 'rev-1', domainRevisions: { notes: 'hash-notes' } },
        [knowledgeMutation, notesMutation],
      ),
    ).toEqual({
      expectedRevision: 'rev-1',
      mutations: [knowledgeMutation, notesMutation],
      expectedDomainRevisions: { notes: 'hash-notes' },
    });
  });
});
