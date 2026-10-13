import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  pickCloudProviderFields,
  rewriteVertexThinkingPayload,
  resolveCloudStreamOptions,
  wrapStreamSimpleWithCloudOptions,
} from './cloud-provider-stream.js';
import { buildPiProviderRegistration, resolvePiApiForProvider } from './pi-model-runtime.js';
import { buildWorkerProviderRegistration } from './rpc/worker-pi-session-factory.js';

const vertex: ModelProviderConfig = {
  id: 'vertex',
  protocol: 'google-vertex',
  name: 'Vertex AI',
  baseUrl: '',
  project: 'project-vm-507617',
  location: 'global',
  models: [{ id: 'gemini-4-argon' }],
};

const bedrock: ModelProviderConfig = {
  id: 'bedrock',
  protocol: 'amazon-bedrock',
  name: 'Amazon Bedrock',
  baseUrl: '',
  region: 'us-west-2',
  profile: 'sso-dev',
  models: [{ id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', input: ['text', 'image'] }],
};

describe('cloud provider protocols', () => {
  it('maps protocols to Pi apis', () => {
    expect(resolvePiApiForProvider('google-vertex')).toBe('google-vertex');
    expect(resolvePiApiForProvider('amazon-bedrock')).toBe('bedrock-converse-stream');
  });

  it('Vertex ADC: project/location/env + x-goog-user-project, no key', () => {
    expect(resolveCloudStreamOptions(vertex)).toEqual({
      project: 'project-vm-507617',
      location: 'global',
      env: { GOOGLE_CLOUD_LOCATION: 'global', GOOGLE_CLOUD_PROJECT: 'project-vm-507617' },
      headers: { 'x-goog-user-project': 'project-vm-507617' },
      vertexThinkingLevels: true,
    });
  });

  it('Vertex defaults location to global and passes a service-account file', () => {
    const options = resolveCloudStreamOptions({
      protocol: 'google-vertex',
      project: 'p',
      credentialsFile: '/k.json',
    });
    expect(options?.location).toBe('global');
    expect(options?.env).toMatchObject({ GOOGLE_APPLICATION_CREDENTIALS: '/k.json' });
  });

  it('Vertex express-mode key: apiKey set, no quota header', () => {
    const options = resolveCloudStreamOptions(vertex, ' vx-key ');
    expect(options?.apiKey).toBe('vx-key');
    expect(options?.headers).toBeUndefined();
  });

  it('Bedrock: region/profile, optional bearer key', () => {
    expect(resolveCloudStreamOptions(bedrock)).toEqual({
      region: 'us-west-2',
      profile: 'sso-dev',
      env: { AWS_REGION: 'us-west-2', AWS_PROFILE: 'sso-dev' },
    });
    expect(resolveCloudStreamOptions(bedrock, 'brk')).toMatchObject({
      apiKey: 'brk',
      bearerToken: 'brk',
    });
  });

  it('HTTP protocols get no cloud options', () => {
    expect(resolveCloudStreamOptions({ protocol: 'google-gemini' })).toBeUndefined();
    expect(pickCloudProviderFields({ protocol: 'openai-compatible', project: 'x' })).toBeUndefined();
  });

  it('wrapper overrides Pi-resolved placeholder keys and merges env/headers', () => {
    const inner = vi.fn(() => 'stream');
    const wrapped = wrapStreamSimpleWithCloudOptions(inner, resolveCloudStreamOptions(bedrock)!);
    wrapped({ id: 'm' }, {}, {
      apiKey: '<authenticated>',
      env: { OTHER: '1' },
      headers: { a: 'b' },
    } as never);
    const options = (inner.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(options.apiKey).toBeUndefined();
    expect(options.bearerToken).toBeUndefined();
    expect(options).toMatchObject({
      region: 'us-west-2',
      profile: 'sso-dev',
      env: { OTHER: '1', AWS_REGION: 'us-west-2', AWS_PROFILE: 'sso-dev' },
      headers: { a: 'b' },
    });
  });

  it('registration: no authHeader, cloud-wrapped stream injects Vertex options', () => {
    const registration = buildPiProviderRegistration(vertex);
    expect(registration.api).toBe('google-vertex');
    expect(registration.authHeader).toBe(false);
    expect(registration.models[0]?.api).toBe('google-vertex');
    expect(typeof registration.streamSimple).toBe('function');
  });

  it('worker registration carries cloud fields from the envelope', () => {
    const registration = buildWorkerProviderRegistration(
      {
        providerId: 'bedrock',
        protocol: 'amazon-bedrock',
        baseUrl: '',
        cloud: pickCloudProviderFields(bedrock)!,
        models: [{ id: 'm' }],
        auth: { kind: 'none' },
      },
      undefined,
    );
    expect(registration.api).toBe('bedrock-converse-stream');
    expect(registration.authHeader).toBe(false);
    expect(registration.streamSimple).toBeTypeOf('function');
  });

  it('maps Pi thinking budgets to levels for post-2.x Gemini on Vertex', () => {
    const payload = (budget: number) => ({
      model: 'gemini-4-argon',
      config: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget }, maxOutputTokens: 9 },
    });
    expect(rewriteVertexThinkingPayload(payload(-1), 'gemini-4-argon', 'high')).toEqual({
      model: 'gemini-4-argon',
      config: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' }, maxOutputTokens: 9 },
    });
    expect(rewriteVertexThinkingPayload(payload(-1), 'gemini-4-argon', 'low')).toMatchObject({
      config: { thinkingConfig: { thinkingLevel: 'LOW' } },
    });
    expect(rewriteVertexThinkingPayload(payload(0), 'gemini-4-argon', undefined)).toEqual({
      model: 'gemini-4-argon',
      config: { maxOutputTokens: 9 },
    });
    // Gemini 2.x keeps budgets untouched.
    const legacy = payload(8192);
    expect(rewriteVertexThinkingPayload(legacy, 'gemini-2.5-pro', 'medium')).toBe(legacy);
  });

  it('wrapper installs onPayload for Vertex and chains an existing hook', async () => {
    const inner = vi.fn(() => 'stream');
    const wrapped = wrapStreamSimpleWithCloudOptions(inner, resolveCloudStreamOptions(vertex)!);
    const seen: unknown[] = [];
    wrapped({ id: 'gemini-4-argon' }, {}, {
      reasoning: 'medium',
      onPayload: (p: unknown) => {
        seen.push(p);
        return undefined;
      },
    } as never);
    const options = (inner.mock.calls[0] as unknown[])[2] as {
      onPayload: (p: unknown, m: unknown) => Promise<unknown>;
    };
    const out = await options.onPayload({ config: { thinkingConfig: { thinkingBudget: -1 } } }, {});
    expect(seen).toHaveLength(1);
    expect(out).toEqual({ config: { thinkingConfig: { thinkingLevel: 'HIGH' } } });
  });
});
