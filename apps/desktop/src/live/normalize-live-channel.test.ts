import { describe, expect, it } from 'vitest';
import {
  buildContextAppendPayloads,
  parseLiveChannelMessage,
} from './normalize-live-channel.js';

describe('parseLiveChannelMessage', () => {
  it('normalizes Codex client delegation', () => {
    const event = parseLiveChannelMessage(
      JSON.stringify({
        type: 'delegation.created',
        item: {
          id: 'del-1',
          type: 'delegation',
          target: 'client',
          content: [{ type: 'input_text', text: 'open the log' }],
        },
      }),
    );
    expect(event).toEqual({
      type: 'delegation',
      providerDelegationId: 'del-1',
      instruction: 'open the log',
    });
  });

  it('maps speech activity events', () => {
    expect(parseLiveChannelMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))).toEqual({
      type: 'activity',
      activity: 'user-speaking',
    });
    expect(parseLiveChannelMessage(JSON.stringify({ type: 'response.done' }))).toEqual({
      type: 'activity',
      activity: 'listening',
    });
  });

  it('ignores unknown or invalid payloads', () => {
    expect(parseLiveChannelMessage('not-json')).toBeNull();
    expect(parseLiveChannelMessage(JSON.stringify({ type: 'session.updated' }))).toBeNull();
  });

  it('builds Codex delegation context append frames', () => {
    const [frame] = buildContextAppendPayloads({
      target: 'delegation',
      channel: 'speakable',
      providerDelegationId: 'del-1',
      content: '洛杉矶今天晴',
    });
    expect(JSON.parse(frame ?? '{}')).toEqual({
      type: 'delegation.context.append',
      delegation_item_id: 'del-1',
      channel: 'speakable',
      content: [{ type: 'input_text', text: '洛杉矶今天晴' }],
    });
  });
});
