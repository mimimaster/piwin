import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AcpConnectionClosedError,
  AcpRequestTimeoutError,
  AcpRpcError,
} from './acp-errors.js';
import { JsonRpcConnection } from './json-rpc-connection.js';
import type { AcpProtocolIssue } from './json-rpc-connection.js';
import { GROK_DROPPED_NOTIFICATION_METHODS } from './grok-acp-methods.js';
import { createFakeLineTransport } from './testing/fake-line-transport.js';

const SECRET = 'sk-test-secret-value';

afterEach(() => {
  vi.useRealTimers();
});

function lastSent(transport: ReturnType<typeof createFakeLineTransport>): Record<string, unknown> {
  const line = transport.sent.at(-1);
  expect(line).toBeTypeOf('string');
  if (typeof line !== 'string') {
    throw new Error('expected sent line');
  }
  return JSON.parse(line) as Record<string, unknown>;
}

describe('JsonRpcConnection', () => {
  it('matches responses by id', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    const first = connection.request<{ value: number }>('alpha', { n: 1 });
    const second = connection.request<{ value: number }>('beta', { n: 2 });
    expect(transport.sent).toHaveLength(2);
    expect(lastSent(transport).id).toBe(2);
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { value: 20 } }));
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 10 } }));
    await expect(first).resolves.toEqual({ value: 10 });
    await expect(second).resolves.toEqual({ value: 20 });
    await connection.close();
  });

  it('rejects error responses as AcpRpcError with the rpc code', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    const pending = connection.request('session/new', { cwd: '/tmp', mcpServers: [] });
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'Invalid params', data: { XAI_API_KEY: SECRET } },
      }),
    );
    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AcpRpcError);
    if (!(error instanceof AcpRpcError)) {
      throw new Error('expected AcpRpcError');
    }
    expect(error.name).toBe('AcpRpcError');
    expect(error.code).toBe(-32602);
    expect(error.method).toBe('session/new');
    expect(error.message).toContain('session/new');
    expect(error.message).toContain('-32602');
    expect(error.message).not.toContain(SECRET);
    await connection.close();
  });

  it('times out pending requests', async () => {
    vi.useFakeTimers();
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport, { defaultTimeoutMs: 50 });
    const pending = connection.request('slow');
    const expectation = expect(pending).rejects.toBeInstanceOf(AcpRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    try {
      await pending;
      throw new Error('expected timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(AcpRequestTimeoutError);
      if (!(error instanceof AcpRequestTimeoutError)) {
        throw new Error('expected timeout');
      }
      expect(error.method).toBe('slow');
      expect(error.timeoutMs).toBe(50);
    }
    await connection.close();
  });

  it('timeoutMs 0 disables timeout', async () => {
    vi.useFakeTimers();
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport, { defaultTimeoutMs: 10 });
    const pending = connection.request<{ ok: boolean }>('hang', undefined, { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
    await connection.close();
  });

  it('aborts a pending request and forgets it', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    const controller = new AbortController();
    const pending = connection.request('session/prompt', { sessionId: 's' }, { signal: controller.signal });
    const abortReason = new Error('user-cancel');
    abortReason.name = 'AbortError';
    controller.abort(abortReason);
    await expect(pending).rejects.toBe(abortReason);
    const issues: AcpProtocolIssue[] = [];
    const watched = new JsonRpcConnection(createFakeLineTransport(), {
      onProtocolIssue: (issue) => {
        issues.push(issue);
      },
    });
    await watched.close();
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason: 'cancelled' } }));
    await connection.close();
  });

  it('abort of a pending request reports unmatched later response', async () => {
    const transport = createFakeLineTransport();
    const issues: AcpProtocolIssue[] = [];
    const connection = new JsonRpcConnection(transport, {
      onProtocolIssue: (issue) => {
        issues.push(issue);
      },
    });
    const controller = new AbortController();
    const pending = connection.request('ping', undefined, { signal: controller.signal });
    controller.abort(new Error('aborted'));
    await expect(pending).rejects.toBeInstanceOf(Error);
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'late' }));
    expect(issues.some((issue) => issue.kind === 'unmatched-response')).toBe(true);
    await connection.close();
  });

  it('local close rejects pending requests', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    const pending = connection.request('initialize');
    await connection.close();
    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AcpConnectionClosedError);
    if (!(error instanceof AcpConnectionClosedError)) {
      throw new Error('expected closed');
    }
    expect(error.method).toBe('initialize');
    expect(connection.closed).toBe(true);
  });

  it('transport close rejects pending requests with close reason', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    const pending = connection.request('initialize');
    transport.closeFromRemote({ code: 1, signal: null, reason: 'exited' });
    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AcpConnectionClosedError);
    if (!(error instanceof AcpConnectionClosedError)) {
      throw new Error('expected closed');
    }
    expect(error.reason).toBe('exited');
    expect(connection.closed).toBe(true);
  });

  it('replies to agent-to-client requests via handler', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    connection.setRequestHandler('session/request_permission', async (params) => {
      expect(params).toEqual({ tool: 'write' });
      return { outcome: 'allow' };
    });
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'session/request_permission',
        params: { tool: 'write' },
      }),
    );
    await Promise.resolve();
    expect(lastSent(transport)).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: { outcome: 'allow' },
    });
    await connection.close();
  });

  it('returns -32601 when no handler is registered', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    transport.deliver(
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'session/request_permission', params: {} }),
    );
    await Promise.resolve();
    expect(lastSent(transport)).toEqual({
      jsonrpc: '2.0',
      id: 4,
      error: { code: -32601, message: 'Method not found' },
    });
    await connection.close();
  });

  it('returns -32603 when a handler rejects', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    connection.setRequestHandler('fs/read_text_file', async () => {
      throw new Error('boom');
    });
    transport.deliver(
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'fs/read_text_file', params: {} }),
    );
    await Promise.resolve();
    expect(lastSent(transport)).toEqual({
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32603, message: 'Internal error' },
    });
    await connection.close();
  });

  it('drops secret-bearing notifications before listeners and protocol issues', async () => {
    const transport = createFakeLineTransport();
    const issues: AcpProtocolIssue[] = [];
    const received: Array<{ method: string; params: unknown }> = [];
    const connection = new JsonRpcConnection(transport, {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      onProtocolIssue: (issue) => {
        issues.push(issue);
      },
    });
    connection.onNotification((method, params) => {
      received.push({ method, params });
    });
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        method: '_x.ai/mcp/servers_updated',
        params: { env: { XAI_API_KEY: SECRET } },
      }),
    );
    expect(received).toEqual([]);
    expect(issues).toEqual([]);
    const dump = JSON.stringify({ received, issues });
    expect(dump).not.toContain(SECRET);
    await connection.close();
  });

  it('reports invalid lines without throwing', async () => {
    const transport = createFakeLineTransport();
    const issues: AcpProtocolIssue[] = [];
    const connection = new JsonRpcConnection(transport, {
      onProtocolIssue: (issue) => {
        issues.push(issue);
      },
    });
    transport.deliver('not-json');
    expect(issues).toEqual([{ kind: 'invalid-line', reason: 'malformed-json' }]);
    await connection.close();
  });

  it('isolates throwing notification listeners', async () => {
    const transport = createFakeLineTransport();
    const issues: AcpProtocolIssue[] = [];
    const seen: string[] = [];
    const connection = new JsonRpcConnection(transport, {
      onProtocolIssue: (issue) => {
        issues.push(issue);
      },
    });
    connection.onNotification(() => {
      const failure = new Error('listener exploded');
      failure.name = 'ListenerBoom';
      throw failure;
    });
    connection.onNotification((method) => {
      seen.push(method);
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { n: 1 } }));
    expect(seen).toEqual(['session/update']);
    expect(issues).toEqual([
      { kind: 'handler-failed', method: 'session/update', reason: 'ListenerBoom' },
    ]);
    await connection.close();
  });

  it('notify throws when closed', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport);
    await connection.close();
    expect(() => {
      connection.notify('session/cancel', { sessionId: 's' });
    }).toThrow(AcpConnectionClosedError);
  });
});
