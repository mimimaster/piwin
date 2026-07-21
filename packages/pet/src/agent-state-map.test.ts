import { describe, expect, it } from 'vitest';
import {
  createInitialPetAgentContext,
  petStateFromChatFlags,
  reducePetAgentContext,
} from './agent-state-map.js';

describe('reducePetAgentContext', () => {
  it('goes running while assistant streams', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, { type: 'message/start', messageId: 'm1', role: 'assistant' });
    expect(ctx.state).toBe('running');
    ctx = reducePetAgentContext(ctx, { type: 'message/end', messageId: 'm1' });
    expect(ctx.state).toBe('idle');
  });

  it('goes waiting on permission request', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, {
      type: 'permission/request',
      requestId: 'p1',
      action: 'bash',
      detail: 'rm -rf',
      defaultDecision: 'ask',
    });
    expect(ctx.state).toBe('waiting');
  });

  it('goes failed on error', () => {
    let ctx = createInitialPetAgentContext();
    ctx = reducePetAgentContext(ctx, { type: 'error', message: 'boom' });
    expect(ctx.state).toBe('failed');
  });
});

describe('petStateFromChatFlags', () => {
  it('prioritizes error over streaming', () => {
    expect(
      petStateFromChatFlags({
        streaming: true,
        toolRunning: true,
        hasError: true,
        waitingPermission: false,
      }),
    ).toBe('failed');
  });
});
