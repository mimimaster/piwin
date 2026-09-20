import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_CODE_OAUTH_PROVIDER_ID } from '@piwin/contracts';
import {
  attachSubscriptionStreamTiming,
  resolveSubscriptionStreamTimingOverlay,
} from './attach-subscription-stream-timing.js';
import type { PiModelRuntime } from './pi-model-runtime.js';

describe('resolveSubscriptionStreamTimingOverlay', () => {
  it('wraps xAI Grok 4.6 on openai-completions without replacing models', () => {
    const overlay = resolveSubscriptionStreamTimingOverlay('xai');
    expect(overlay?.api).toBe('openai-completions');
    expect(overlay?.streamSimple).toBeTypeOf('function');
  });

  it('wraps Codex on openai-codex-responses', () => {
    expect(resolveSubscriptionStreamTimingOverlay('openai-codex')?.api).toBe(
      'openai-codex-responses',
    );
  });

  it('skips Claude Code — that path registers a full shaped stream', () => {
    expect(resolveSubscriptionStreamTimingOverlay(CLAUDE_CODE_OAUTH_PROVIDER_ID)).toBeUndefined();
  });

  it('skips unknown provider ids', () => {
    expect(resolveSubscriptionStreamTimingOverlay('openrouter')).toBeUndefined();
  });
});

describe('attachSubscriptionStreamTiming', () => {
  it('registers timing overlays only for supported oauth builtins', () => {
    const registerProvider = vi.fn();
    const runtime = { registerProvider } as unknown as PiModelRuntime;
    attachSubscriptionStreamTiming(runtime, [
      'xai',
      CLAUDE_CODE_OAUTH_PROVIDER_ID,
      'openai-codex',
      'unknown',
    ]);
    expect(registerProvider).toHaveBeenCalledTimes(2);
    expect(registerProvider).toHaveBeenCalledWith(
      'xai',
      expect.objectContaining({ api: 'openai-completions', streamSimple: expect.any(Function) }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      'openai-codex',
      expect.objectContaining({
        api: 'openai-codex-responses',
        streamSimple: expect.any(Function),
      }),
    );
    expect(registerProvider.mock.calls[0]?.[1]).not.toHaveProperty('models');
  });

  it('defaults to every v1 subscription id', () => {
    const registerProvider = vi.fn();
    const runtime = { registerProvider } as unknown as PiModelRuntime;
    attachSubscriptionStreamTiming(runtime);
    const ids = registerProvider.mock.calls.map((call) => call[0]);
    expect(ids).toEqual(
      expect.arrayContaining(['xai', 'openai-codex', 'anthropic', 'kimi-coding', 'github-copilot']),
    );
    expect(ids).not.toContain('anthropic-claude-code');
  });
});
