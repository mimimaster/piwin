import { describe, expect, it, vi } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  estimateTranscriptMessagesTokens,
  maybeEstimateExternalSessionContext,
} from './session-external-context.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

describe('session-external-context', () => {
  it('returns 0 for empty messages', () => {
    expect(estimateTranscriptMessagesTokens([])).toBe(0);
  });

  it('estimates tokens from text and thinking across messages', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        text: 'Hello world',
        createdAt: new Date().toISOString(),
        status: 'done',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        text: 'Hi there, how can I help you today?',
        thinking: 'Thinking about the response...',
        createdAt: new Date().toISOString(),
        status: 'done',
      },
    ];
    const tokens = estimateTranscriptMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('skips non-external sessions gracefully', async () => {
    const pushed: unknown[] = [];
    const mockDeps = {
      options: { piwinRoot: '/tmp/test-piwin' },
      getTranscriptStore: vi.fn(),
      push: (event: unknown) => pushed.push(event),
    } as unknown as HostRuntimeKernel;

    await maybeEstimateExternalSessionContext(mockDeps, 'non-existent-session');
    expect(mockDeps.getTranscriptStore).not.toHaveBeenCalled();
    expect(pushed).toHaveLength(0);
  });
});
