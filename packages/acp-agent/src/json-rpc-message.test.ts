import { describe, expect, it } from 'vitest';
import { parseJsonRpcLine } from './json-rpc-message.js';

describe('parseJsonRpcLine', () => {
  it('classifies a request', () => {
    const parsed = parseJsonRpcLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } }),
    );
    expect(parsed).toEqual({
      kind: 'request',
      message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } },
    });
  });

  it('classifies a notification', () => {
    const parsed = parseJsonRpcLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } }),
    );
    expect(parsed).toEqual({
      kind: 'notification',
      message: { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } },
    });
  });

  it('classifies a success response', () => {
    const parsed = parseJsonRpcLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: true } }));
    expect(parsed).toEqual({
      kind: 'response',
      message: { jsonrpc: '2.0', id: 2, result: { ok: true } },
    });
  });

  it('classifies a failure response', () => {
    const parsed = parseJsonRpcLine(
      JSON.stringify({ jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Method not found' } }),
    );
    expect(parsed.kind).toBe('response');
    if (parsed.kind !== 'response') {
      return;
    }
    expect(parsed.message).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32601, message: 'Method not found' },
    });
  });

  it('returns invalid empty for blank lines', () => {
    expect(parseJsonRpcLine('')).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parseJsonRpcLine('   ')).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parseJsonRpcLine('\n')).toEqual({ kind: 'invalid', reason: 'empty' });
  });

  it('never throws on malformed json', () => {
    expect(parseJsonRpcLine('{')).toEqual({ kind: 'invalid', reason: 'malformed-json' });
  });
});
