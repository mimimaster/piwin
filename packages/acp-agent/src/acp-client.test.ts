import { describe, expect, it } from 'vitest';
import { AcpClient } from './acp-client.js';
import { AcpProtocolShapeError } from './acp-errors.js';
import { JsonRpcConnection } from './json-rpc-connection.js';
import { GROK_XAI_METHODS } from './grok-acp-methods.js';
import { createFakeLineTransport } from './testing/fake-line-transport.js';

function parseSent(line: string | undefined): Record<string, unknown> {
  expect(line).toBeTypeOf('string');
  if (typeof line !== 'string') {
    throw new Error('expected sent line');
  }
  return JSON.parse(line) as Record<string, unknown>;
}

describe('AcpClient', () => {
  it('sends initialize / session methods with exact names and params', async () => {
    const transport = createFakeLineTransport();
    const client = new AcpClient(new JsonRpcConnection(transport));

    const initialize = client.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'piwin', version: '0.0.0' },
    });
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        clientInfo: { name: 'piwin', version: '0.0.0' },
      },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }));
    await expect(initialize).resolves.toEqual({ protocolVersion: 1 });

    const created = client.newSession({ cwd: '/tmp/work', mcpServers: [] });
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: '/tmp/work', mcpServers: [] },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { sessionId: 'sess-1' } }));
    await expect(created).resolves.toEqual({ sessionId: 'sess-1' });

    const loaded = client.loadSession({ sessionId: 'sess-1', cwd: '/tmp/work', mcpServers: [] });
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/load',
      params: { sessionId: 'sess-1', cwd: '/tmp/work', mcpServers: [] },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { configOptions: [] } }));
    await expect(loaded).resolves.toMatchObject({ sessionId: 'sess-1' });

    const resumed = client.resumeSession({ sessionId: 'sess-1', cwd: '/tmp/work', mcpServers: [] });
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/resume',
      params: { sessionId: 'sess-1', cwd: '/tmp/work', mcpServers: [] },
    });
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        result: { models: {}, configOptions: [], _meta: {} },
      }),
    );
    await expect(resumed).resolves.toMatchObject({ sessionId: 'sess-1', configOptions: [] });

    const listed = client.listSessions({ cwd: '/tmp/work' });
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/list',
      params: { cwd: '/tmp/work' },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 5, result: { sessions: [] } }));
    await listed;
  });

  it('sends prompt with timeout disabled and cancel as a notification without id', async () => {
    const transport = createFakeLineTransport();
    const connection = new JsonRpcConnection(transport, { defaultTimeoutMs: 5 });
    const client = new AcpClient(connection);
    const prompted = client.prompt({
      sessionId: 'sess-1',
      prompt: [{ type: 'text', text: 'hi' }],
    });
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/prompt',
      params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hi' }] },
    });
    client.cancel('sess-1');
    const cancelLine = parseSent(transport.sent.at(-1));
    expect(cancelLine).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'sess-1' },
    });
    expect(Object.prototype.hasOwnProperty.call(cancelLine, 'id')).toBe(false);
    transport.deliver(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason: 'cancelled' } }),
    );
    await expect(prompted).resolves.toEqual({ stopReason: 'cancelled' });
    await connection.close();
  });

  it('sends set_mode and set_config_option with exact params', async () => {
    const transport = createFakeLineTransport();
    const client = new AcpClient(new JsonRpcConnection(transport));
    const mode = client.setMode('sess-1', 'plan');
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/set_mode',
      params: { sessionId: 'sess-1', modeId: 'plan' },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await mode;

    const config = client.setConfigOption('sess-1', 'reasoning_effort', 'low');
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/set_config_option',
      params: { sessionId: 'sess-1', configId: 'reasoning_effort', value: 'low' },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: true } }));
    await config;
  });

  it('sends underscore-prefixed xai methods', async () => {
    const transport = createFakeLineTransport();
    const client = new AcpClient(new JsonRpcConnection(transport));

    const listed = client.xaiListSessions();
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: GROK_XAI_METHODS.sessionsList,
      params: {},
    });
    transport.deliver(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { sessions: [{ sessionId: 'a' }] } }),
    );
    await listed;

    const renamed = client.xaiRenameSession('a', 'New title');
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: GROK_XAI_METHODS.sessionRename,
      params: { sessionId: 'a', title: 'New title' },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { success: true } }));
    await renamed;

    const deleted = client.xaiDeleteSession('a');
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: GROK_XAI_METHODS.sessionDelete,
      params: { sessionId: 'a' },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { success: true } }));
    await deleted;

    const interjected = client.xaiInterject('a', 'hold on');
    expect(parseSent(transport.sent.at(-1))).toEqual({
      jsonrpc: '2.0',
      id: 4,
      method: GROK_XAI_METHODS.interject,
      params: { sessionId: 'a', text: 'hold on' },
    });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 4, result: { status: 'queued' } }));
    await expect(interjected).resolves.toEqual({ status: 'queued' });

    // Grok 1.0.44 wire shape wraps extension results.
    const wrapped = client.xaiInterject('a', 'again');
    transport.deliver(
      JSON.stringify({ jsonrpc: '2.0', id: 5, result: { result: { status: 'queued' } } }),
    );
    await expect(wrapped).resolves.toEqual({ status: 'queued' });
  });

  it('parses both wrapped and unwrapped xai session lists', async () => {
    const transport = createFakeLineTransport();
    const client = new AcpClient(new JsonRpcConnection(transport));

    const unwrapped = client.xaiListSessions();
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          sessions: [
            { sessionId: 'keep', cwd: '/tmp', origin: { kind: 'tui' } },
            { sessionId: 12 },
            { title: 'no-id' },
          ],
        },
      }),
    );
    await expect(unwrapped).resolves.toEqual([
      { sessionId: 'keep', cwd: '/tmp', origin: { kind: 'tui' } },
    ]);

    const wrapped = client.xaiListSessions();
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { result: { sessions: [{ sessionId: 'nested' }] } },
      }),
    );
    await expect(wrapped).resolves.toEqual([{ sessionId: 'nested' }]);
  });

  it('throws AcpProtocolShapeError when required fields are missing', async () => {
    const transport = createFakeLineTransport();
    const client = new AcpClient(new JsonRpcConnection(transport));
    const pending = client.newSession({ cwd: '/tmp', mcpServers: [] });
    transport.deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { sessionId: 99 } }));
    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AcpProtocolShapeError);
    if (!(error instanceof AcpProtocolShapeError)) {
      throw new Error('expected shape error');
    }
    expect(error.name).toBe('AcpProtocolShapeError');
    expect(error.method).toBe('session/new');
  });
});
