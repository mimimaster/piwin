import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, ModelRef } from '@piwin/contracts';
import { describeComposerModel } from './use-composer-model.js';
import { commitSessionComposerProfile } from './commit-session-composer-profile.js';
import type { ModelOption } from '../model-options';

const gpt: ModelOption = {
  providerId: 'openai',
  protocol: 'openai-compatible',
  modelId: 'gpt',
  label: 'GPT',
  contextWindow: 128_000,
};

const sonnet: ModelOption = {
  providerId: 'anthropic',
  protocol: 'anthropic-compatible',
  modelId: 'sonnet',
  label: 'Sonnet',
  contextWindow: 200_000,
};

describe('describeComposerModel', () => {
  it('uses the selected model label and context window', () => {
    const described = describeComposerModel([gpt, sonnet], 'anthropic::sonnet', {
      providerId: 'openai',
      modelId: 'gpt',
    });
    expect(described.label).toBe('Sonnet');
    expect(described.contextWindow).toBe(200_000);
    expect(described.promptModel).toEqual({
      protocol: 'anthropic-compatible',
      providerId: 'anthropic',
      modelId: 'sonnet',
    });
  });

  it('falls back to the product default when nothing is selected', () => {
    const described = describeComposerModel([gpt, sonnet], '', {
      providerId: 'openai',
      modelId: 'gpt',
    });
    expect(described.label).toBe('Default model');
    expect(described.contextWindow).toBe(128_000);
    expect(described.promptModel?.modelId).toBe('gpt');
  });
});

const composerModel: ModelRef = { providerId: 'openai', modelId: 'gpt' };

function profileSuccess(): HostResponse {
  return {
    type: 'response',
    command: 'session/set-composer-profile',
    success: true,
    data: { ok: true },
  };
}

describe('commitSessionComposerProfile', () => {
  it('does not request when sessionId is null', async () => {
    const request = vi.fn();
    const result = await commitSessionComposerProfile({
      request,
      sessionId: null,
      model: composerModel,
    });
    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('sends session/set-composer-profile when sessionId is set', async () => {
    const request = vi.fn(async (_command: HostCommand): Promise<HostResponse> => profileSuccess());
    const result = await commitSessionComposerProfile({
      request,
      sessionId: 's1',
      model: composerModel,
      thinkingLevel: 'low',
    });
    expect(request).toHaveBeenCalledWith({
      type: 'session/set-composer-profile',
      sessionId: 's1',
      model: composerModel,
      thinkingLevel: 'low',
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false when Host fails', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/set-composer-profile',
      success: false,
      error: 'Unknown session: s1',
    }));
    const result = await commitSessionComposerProfile({
      request,
      sessionId: 's1',
      thinkingLevel: 'off',
    });
    expect(result).toEqual({ ok: false, error: 'Unknown session: s1' });
  });
});
