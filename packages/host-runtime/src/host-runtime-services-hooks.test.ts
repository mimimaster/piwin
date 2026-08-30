import { describe, expect, it } from 'vitest';
import { hookEventForAgentEvent } from './host-runtime-services.js';

describe('hookEventForAgentEvent', () => {
  it('does not map usage/update or session/aborted to turn_end', () => {
    expect(
      hookEventForAgentEvent({
        type: 'usage/update',
        sessionId: 's1',
        usage: { sessionId: 's1', updatedAt: '2026-08-30T00:00:00.000Z' },
      }),
    ).toBeNull();
    expect(hookEventForAgentEvent({ type: 'session/aborted', sessionId: 's1' })).toBeNull();
  });

  it('keeps agent_start, turn_start, tool_execution_end, and agent_end', () => {
    expect(hookEventForAgentEvent({ type: 'session/started', sessionId: 's1' })).toBe('agent_start');
    expect(hookEventForAgentEvent({ type: 'session/ended', sessionId: 's1' })).toBe('agent_end');
    expect(hookEventForAgentEvent({ type: 'message/start', messageId: 'm1', role: 'user' })).toBe(
      'turn_start',
    );
    expect(
      hookEventForAgentEvent({ type: 'tool/end', toolCallId: 't1', isError: false }),
    ).toBe('tool_execution_end');
  });
});
