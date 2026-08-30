import { describe, expect, it } from 'vitest';
import {
  openaiRealtimeFunctionOutputPayload,
  openaiRealtimeSessionUpdatePayload,
  parseOpenaiRealtimeMessage,
} from './openai-realtime-events.js';

describe('openai realtime events', () => {
  it('registers the work-session tool on session.update', () => {
    const payload = JSON.parse(openaiRealtimeSessionUpdatePayload({ voice: 'eve' })) as {
      session: { tools: { name: string }[] };
    };
    expect(payload.session.tools[0]?.name).toBe('delegate_to_work_session');
  });

  it('parses function-call arguments as a delegation', () => {
    expect(
      parseOpenaiRealtimeMessage(
        JSON.stringify({
          type: 'response.function_call_arguments.done',
          call_id: 'call-9',
          name: 'delegate_to_work_session',
          arguments: '{"instruction":"fix the tests"}',
        }),
      ),
    ).toEqual({ kind: 'tool-call', id: 'call-9', instruction: 'fix the tests' });
  });

  it('acks with a function_call_output item', () => {
    const payload = JSON.parse(
      openaiRealtimeFunctionOutputPayload({ callId: 'call-9', accepted: true, queued: true }),
    ) as { item: { call_id: string; output: string } };
    expect(payload.item.call_id).toBe('call-9');
    expect(payload.item.output).toContain('queued');
  });
});
