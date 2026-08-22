import { describe, expect, it } from 'vitest';
import { enrichAgentEventSessionModel } from './agent-event-session-model.js';

const gemini = {
  protocol: 'openai-compatible' as const,
  providerId: 'cpa',
  modelId: 'gemini-3.7-flash',
};

describe('enrichAgentEventSessionModel', () => {
  it('attaches the session model to assistant message/start', () => {
    expect(
      enrichAgentEventSessionModel(
        { type: 'message/start', messageId: 'a1', role: 'assistant' },
        gemini,
      ),
    ).toEqual({
      type: 'message/start',
      messageId: 'a1',
      role: 'assistant',
      model: gemini,
    });
  });

  it('does not overwrite an event that already carries a model', () => {
    const existing = {
      protocol: 'anthropic-compatible' as const,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
    };
    const event = {
      type: 'message/start' as const,
      messageId: 'a1',
      role: 'assistant' as const,
      model: existing,
    };
    expect(enrichAgentEventSessionModel(event, gemini)).toEqual(event);
  });

  it('leaves non-assistant lifecycle events unchanged', () => {
    const start = {
      type: 'message/start' as const,
      messageId: 'u1',
      role: 'user' as const,
    };
    expect(enrichAgentEventSessionModel(start, gemini)).toBe(start);
  });
});
