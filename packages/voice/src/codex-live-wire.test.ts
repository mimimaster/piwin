import { describe, expect, it } from 'vitest';
import { buildContextAppendPayloads, buildDelegationAckPayload, parseLiveChannelMessage } from './codex-live-wire.js';
import { PendingLiveTools } from './pending-live-tools.js';
import { sendLiveFrames } from './send-live-frames.js';

describe('shared portable live wire', () => {
  it('does not silently lose Host results when the channel is closed', () => {
    expect(() => sendLiveFrames(null, ['result'])).toThrow('live-protocol-failed');
    expect(() => sendLiveFrames({ readyState: 'closed', send: () => undefined }, ['result'])).toThrow('live-protocol-failed');
    const sent: string[] = [];
    sendLiveFrames({ readyState: 'open', send: (frame) => sent.push(frame) }, ['one', 'two']);
    expect(sent).toEqual(['one', 'two']);
    expect(() => sendLiveFrames({ readyState: 'open', send: () => { throw new Error('transport payload'); } }, ['result'])).toThrow('live-protocol-failed');
  });
  it('uses known Codex context feedback, never invents delegation.ack', () => {
    const frame = JSON.parse(buildDelegationAckPayload({ providerDelegationId: 'task', ok: false, runId: 'private' }));
    expect(frame).toMatchObject({ type: 'delegation.context.append', delegation_item_id: 'task', channel: 'commentary' });
    expect(frame.content[0].text).toContain('No new work');
    expect(JSON.stringify(frame)).not.toContain('private');
  });

  it('maps transcripts only to activity, not executable intent, and reports protocol errors', () => {
    expect(parseLiveChannelMessage('{"type":"input_transcript.added","text":"delete everything"}')).toEqual({ type: 'activity', activity: 'user-speaking' });
    expect(parseLiveChannelMessage('{"type":"output_transcript.added"}')).toEqual({ type: 'activity', activity: 'assistant-speaking' });
    expect(parseLiveChannelMessage('{"type":"turn.done"}')).toEqual({ type: 'activity', activity: 'listening' });
    expect(parseLiveChannelMessage('{"type":"error","message":"sensitive provider data"}')).toEqual({ type: 'media-failed', mappedCode: 'live-protocol-failed' });
  });

  it('chunks context without corrupting Chinese or emoji', () => {
    const content = 'a'.repeat(497) + '🚲动画'.repeat(100);
    const frames = buildContextAppendPayloads({ target: 'delegation', providerDelegationId: 'd1', channel: 'speakable', content });
    const chunks = frames.map((frame) => JSON.parse(frame).content[0].text as string);
    expect(chunks.join('')).toBe(content);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(500);
      expect(new TextDecoder().decode(new TextEncoder().encode(chunk))).toBe(chunk);
    }
  });

  it('matches delayed and out-of-order receipts by ID and ignores duplicate provider frames', () => {
    const pending = new PendingLiveTools(() => { throw new Error('unexpected overflow'); });
    expect(pending.add('one')).toBe(true); expect(pending.add('two')).toBe(true);
    expect(pending.add('one')).toBe(false);
    expect(pending.take('one')).toBe('one'); expect(pending.take('one')).toBeUndefined();
    expect(pending.take('unknown')).toBeUndefined(); expect(pending.take('two')).toBe('two');
    expect(pending.add('one')).toBe(false);
    pending.clear(); expect(pending.add('one')).toBe(true);
  });
});
