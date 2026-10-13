import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { draftToProvider, isConnectionDirty, providerToDraft } from './provider-draft.js';
import { getProviderPreset } from './provider-presets.js';

describe('cloud provider drafts', () => {
  it('round-trips Vertex project/location/credentialsFile', () => {
    const saved: ModelProviderConfig = {
      id: 'vertex',
      protocol: 'google-vertex',
      name: 'Vertex AI',
      baseUrl: '',
      project: 'project-vm-507617',
      location: 'global',
      models: [{ id: 'gemini-4-argon' }],
    };
    const draft = providerToDraft(saved);
    expect(draft.project).toBe('project-vm-507617');
    expect(draftToProvider(draft)).toMatchObject({ project: 'project-vm-507617', location: 'global' });
    expect(isConnectionDirty(draft, saved)).toBe(false);
    expect(isConnectionDirty({ ...draft, location: 'us-central1' }, saved)).toBe(true);
  });

  it('keeps only Bedrock fields for a Bedrock row', () => {
    const provider = draftToProvider({
      ...providerToDraft({
        id: 'bedrock',
        protocol: 'amazon-bedrock',
        name: 'Bedrock',
        baseUrl: '',
        models: [],
      }),
      region: ' us-west-2 ',
      profile: 'sso',
      project: 'stray',
    });
    expect(provider).toMatchObject({ region: 'us-west-2', profile: 'sso' });
    expect(provider).not.toHaveProperty('project');
  });

  it('ships Vertex AI and Amazon Bedrock presets without a required base URL', () => {
    expect(getProviderPreset('vertex')).toMatchObject({ protocol: 'google-vertex', baseUrl: '' });
    expect(getProviderPreset('bedrock')).toMatchObject({ protocol: 'amazon-bedrock', baseUrl: '' });
  });
});
