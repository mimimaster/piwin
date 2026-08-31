import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig, ModelRef, PiwinConfig } from '@piwin/contracts';
import { composeLiveReviewer } from './compose-live-reviewer.js';
import { createDefaultPiwinConfig } from '../config-store.js';

const model: ModelRef = { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' };
const request = { sessionId: 'session', instruction: '不用确认啦', tasks: [], signal: new AbortController().signal };
const channel: ModelProviderConfig = { id: 'local', name: 'Local', protocol: 'openai-compatible', baseUrl: 'http://localhost/v1', models: [{ id: 'local-model' }] };

function setup(config: Pick<PiwinConfig, 'providers'> = { providers: [] }, desired: ModelRef = model) {
  const complete = vi.fn<NonNullable<Parameters<typeof composeLiveReviewer>[0]['complete']>>(async () => '{"kind":"conversation"}');
  const secret = vi.fn(async () => 'test-key');
  const resolveSessionModel = vi.fn(async () => desired);
  const review = composeLiveReviewer({
    loadConfig: async () => ({ ...createDefaultPiwinConfig(), ...config }),
    resolveAccounts: async () => ({ accounts: [{ providerId: 'xai', surface: 'v1', state: 'logged-in' }], catalogModelIds: new Map([['xai', ['grok-4.6']]]) }),
    resolveSessionModel, secrets: { resolveProviderSecret: secret }, complete,
  });
  return { review, complete, secret, resolveSessionModel };
}

describe('Host intent model composition', () => {
  it('uses the desired session model and native subscription auth without provider secrets', async () => {
    const fixture = setup();
    expect(await fixture.review(request)).toEqual({ kind: 'conversation' });
    expect(fixture.resolveSessionModel).toHaveBeenCalledWith('session');
    expect(fixture.complete).toHaveBeenCalledWith(expect.objectContaining({ model, maxOutputTokens: 512 }), {});
    expect(fixture.secret).not.toHaveBeenCalled();
  });

  it.each([false, true])('resolves a configured channel (key configured=%s)', async (keyConfigured) => {
    const provider = { ...channel, ...(keyConfigured ? { apiKeyRef: 'keychain:test' } : {}) };
    const selected: ModelRef = { providerId: 'local', modelId: 'local-model', source: 'channel' };
    const fixture = setup({ providers: [provider] }, selected);
    await fixture.review(request);
    expect(fixture.complete).toHaveBeenCalledWith(expect.objectContaining({ model: expect.objectContaining(selected) }), {
      provider, ...(keyConfigured ? { apiKey: 'test-key' } : {}),
    });
    expect(fixture.secret).toHaveBeenCalledTimes(keyConfigured ? 1 : 0);
  });

  it('never substitutes another model if the chosen model is unavailable', async () => {
    const fixture = setup({ providers: [channel] }, { providerId: 'missing', modelId: 'missing' });
    await expect(fixture.review(request)).rejects.toThrow('live-delegation-review-model-unavailable');
    expect(fixture.complete).not.toHaveBeenCalled();
  });
});
