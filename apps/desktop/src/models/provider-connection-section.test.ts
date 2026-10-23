import { describe, expect, it } from 'vitest';
import { connectionKeySummary } from './provider-connection-section.js';
import { providerToDraft } from './provider-draft.js';

describe('connectionKeySummary', () => {
  it('flags a missing key only where a key is required', () => {
    const gateway = providerToDraft({
      id: 'gw',
      name: 'Gateway',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [],
    });
    expect(connectionKeySummary(gateway, true)).toEqual({ text: '未设置密钥', missing: true });
  });

  it('names the credential chain for keyless cloud platforms', () => {
    const vertex = providerToDraft({
      id: 'vertex',
      name: 'Vertex AI',
      protocol: 'google-vertex',
      baseUrl: '',
      project: 'demo',
      models: [],
    });
    expect(connectionKeySummary(vertex, true)).toEqual({ text: 'gcloud 登录（ADC）', missing: false });
    const bedrock = providerToDraft({
      id: 'bedrock',
      name: 'Amazon Bedrock',
      protocol: 'amazon-bedrock',
      baseUrl: '',
      models: [],
    });
    expect(connectionKeySummary(bedrock, false)).toEqual({ text: 'AWS credentials', missing: false });
  });
});
