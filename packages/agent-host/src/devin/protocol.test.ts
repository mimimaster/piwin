import { describe, expect, it } from 'vitest';
import {
  decodeChatResponse,
  frameConnect,
  normalizeSessionToken,
  parseConnectFrames,
  trailerError,
} from './protocol.js';

describe('devin protocol', () => {
  it('prefixes session tokens once', () => {
    expect(normalizeSessionToken('abc')).toBe('devin-session-token$abc');
    expect(normalizeSessionToken('devin-session-token$abc')).toBe('devin-session-token$abc');
  });

  it('roundtrips a small payload through Connect gzip frames', () => {
    const payload = Buffer.from('hello-devin', 'utf8');
    const framed = frameConnect(payload);
    expect(framed[0]).toBe(1);
    const frames = parseConnectFrames(framed);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.trailer).toBe(false);
    expect(frames[0]?.payload.toString('utf8')).toBe('hello-devin');
  });

  it('decodes text, thinking, tool, and usage deltas', () => {
    const payload = Buffer.concat([
      encodeLength(1, Buffer.from('msg-1')),
      encodeLength(3, Buffer.from('hello')),
      encodeLength(9, Buffer.from('think')),
      encodeLength(10, Buffer.from('sig')),
      encodeLength(
        6,
        Buffer.concat([
          encodeLength(1, Buffer.from('tool-1')),
          encodeLength(2, Buffer.from('bash')),
          encodeLength(3, Buffer.from('{"cmd":"ls"}')),
        ]),
      ),
      encodeLength(
        7,
        Buffer.concat([encodeVarintField(2, 11), encodeVarintField(3, 7), encodeVarintField(5, 2)]),
      ),
    ]);
    expect(decodeChatResponse(payload)).toEqual([
      { type: 'message', id: 'msg-1' },
      { type: 'text', value: 'hello' },
      { type: 'thinking', value: 'think', signature: 'sig' },
      { type: 'tool', id: 'tool-1', name: 'bash', argumentsJson: '{"cmd":"ls"}' },
      { type: 'usage', input: 11, output: 7, cacheWrite: 0, cacheRead: 2 },
    ]);
  });

  it('reads trailer JSON errors', () => {
    expect(trailerError(Buffer.from(JSON.stringify({ error: { message: 'boom' } })))).toBe('boom');
    expect(trailerError(Buffer.from('not-json'))).toBeUndefined();
  });
});

function encodeLength(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 2), encodeVarint(value.length), value]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 0), encodeVarint(value)]);
}

function encodeKey(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeVarint(value: number): Buffer {
  let current = value;
  const output: number[] = [];
  while (current > 127) {
    output.push((current & 127) | 128);
    current >>= 7;
  }
  output.push(current);
  return Buffer.from(output);
}
