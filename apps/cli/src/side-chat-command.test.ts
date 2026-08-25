import { describe, expect, it, vi } from 'vitest';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  SessionSummary,
  SideChatListData,
  SideChatOpenData,
  SideChatSyncData,
} from '@piwin/contracts';
import { createAttachedCliCommandHandler } from './cli-host.js';
import {
  bindSideChatHostClient,
  formatSideChatListRow,
  formatSideChatListTable,
  runSideChatList,
  runSideChatOpen,
  runSideChatSync,
  runSideChatSend,
  runSideChatResume,
  type SideChatHostClient,
} from './side-chat-command.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'side-001',
    kind: 'side-chat',
    name: 'Side Chat · Main',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messageCount: 0,
    scope: { kind: 'general' },
    workingDirectory: '',
    projectPath: '',
    sideChatRelation: {
      kind: 'side-chat',
      sourceSessionId: 'main-001',
      sourceCapturedAt: '2026-08-01T00:00:00.000Z',
      contextVersion: 1,
      sourceState: 'active',
    },
    ...overrides,
  };
}

function createMockClient(
  handler: (command: HostCommand, options?: { idempotencyKey?: string }) => HostResponse,
): SideChatHostClient {
  return {
    handleCommand: vi.fn(async (command: HostCommand, options?: { idempotencyKey?: string }) =>
      handler(command, options),
    ),
    onPush: vi.fn(() => () => {}),
    dispose: vi.fn(async () => undefined),
  };
}

function okResponse(data: unknown): HostResponse {
  return { type: 'response', command: 'test', success: true, data };
}

function failResponse(error: string): HostResponse {
  return { type: 'response', command: 'test', success: false, error };
}

/* ------------------------------------------------------------------ */
/* Formatting tests                                                    */
/* ------------------------------------------------------------------ */

describe('formatSideChatListRow', () => {
  it('formats a row with id, name, version, sourceState', () => {
    const session = makeSessionSummary();
    const row = formatSideChatListRow(session);
    expect(row).toBe('side-001\tSide Chat · Main\tv1\tactive');
  });

  it('uses (unnamed) when name is empty', () => {
    const session = makeSessionSummary({ name: '' });
    const row = formatSideChatListRow(session);
    expect(row).toContain('(unnamed)');
  });

  it('defaults sourceState to active when relation is missing', () => {
    const { sideChatRelation: _omit, ...rest } = makeSessionSummary();
    const session: SessionSummary = { ...rest };
    const row = formatSideChatListRow(session);
    expect(row).toContain('active');
    expect(row).toContain('v0');
  });
});

describe('formatSideChatListTable', () => {
  it('returns placeholder for empty input', () => {
    expect(formatSideChatListTable([])).toBe('(no side chats)');
  });

  it('renders header + rows for non-empty input', () => {
    const sessions = [
      makeSessionSummary({ id: 's1', name: 'First' }),
      makeSessionSummary({ id: 's2', name: 'Second' }),
    ];
    const table = formatSideChatListTable(sessions);
    const lines = table.split('\n');
    expect(lines[0]).toBe('sessionId\tname\tversion\tsourceState');
    expect(lines[1]).toContain('s1');
    expect(lines[2]).toContain('s2');
  });
});

/* ------------------------------------------------------------------ */
/* Command tests                                                       */
/* ------------------------------------------------------------------ */

describe('runSideChatList', () => {
  it('sends side-chat/list and logs the table', async () => {
    const data: SideChatListData = {
      sourceSessionId: 'main-001',
      sessions: [makeSessionSummary()],
    };
    const client = createMockClient((cmd) =>
      cmd.type === 'side-chat/list' ? okResponse(data) : failResponse('wrong type'),
    );
    const logs: string[] = [];
    await runSideChatList(client, 'main-001', (line) => logs.push(line));

    expect(logs[0]).toContain('side-001');
    expect(client.handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'side-chat/list', sourceSessionId: 'main-001' }),
    );
  });

  it('passes includeArchived when set', async () => {
    const data: SideChatListData = { sourceSessionId: 'main-001', sessions: [] };
    const client = createMockClient((cmd) =>
      cmd.type === 'side-chat/list' ? okResponse(data) : failResponse('wrong type'),
    );
    await runSideChatList(client, 'main-001', () => {}, { includeArchived: true });
    expect(client.handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'side-chat/list', includeArchived: true }),
    );
  });

  it('throws on host error', async () => {
    const client = createMockClient(() => failResponse('source not found'));
    await expect(runSideChatList(client, 'missing', () => {})).rejects.toThrow('source not found');
  });
});

describe('runSideChatOpen', () => {
  it('sends side-chat/open and logs the new session id', async () => {
    const data: SideChatOpenData = {
      sideChatSessionId: 'side-new',
      session: makeSessionSummary({ id: 'side-new' }),
      relation: {
        kind: 'side-chat',
        sourceSessionId: 'main-001',
        sourceCapturedAt: '2026-08-01T00:00:00.000Z',
        contextVersion: 1,
        sourceState: 'active',
      },
      context: {
        version: 1,
        capturedAt: '2026-08-01T00:00:00.000Z',
        sourceSessionId: 'main-001',
        conversation: { messageIds: [], formattedText: '', truncated: false },
        workspace: { scope: 'general', workingDirectory: '' },
        refs: [],
      },
    };
    const client = createMockClient((cmd) =>
      cmd.type === 'side-chat/open' ? okResponse(data) : failResponse('wrong type'),
    );
    const logs: string[] = [];
    const result = await runSideChatOpen(client, 'main-001', (line) => logs.push(line), {
      name: 'My Side Chat',
    });
    expect(result.sideChatSessionId).toBe('side-new');
    expect(logs[0]).toContain('side-new');
    expect(logs[0]).toContain('v1');
    expect(client.handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'side-chat/open', name: 'My Side Chat' }),
    );
  });
});

describe('runSideChatSync', () => {
  it('sends side-chat/sync and logs the new version', async () => {
    const data: SideChatSyncData = {
      sideChatSessionId: 'side-001',
      relation: {
        kind: 'side-chat',
        sourceSessionId: 'main-001',
        sourceCapturedAt: '2026-08-01T00:00:00.000Z',
        contextVersion: 2,
        sourceState: 'active',
      },
      context: {
        version: 2,
        capturedAt: '2026-08-01T00:00:00.000Z',
        sourceSessionId: 'main-001',
        conversation: { messageIds: [], formattedText: '', truncated: false },
        workspace: { scope: 'general', workingDirectory: '' },
        refs: [],
      },
    };
    const client = createMockClient((cmd) =>
      cmd.type === 'side-chat/sync' ? okResponse(data) : failResponse('wrong type'),
    );
    const logs: string[] = [];
    const result = await runSideChatSync(client, 'side-001', (line) => logs.push(line));
    expect(result.relation.contextVersion).toBe(2);
    expect(logs[0]).toContain('v2');
  });
});

describe('runSideChatSend', () => {
  it('sends session/prompt, streams response, and waits for run/terminal', async () => {
    // The send command now subscribes to pushes and waits for run/terminal.
    // We emit text deltas + a terminal event after the prompt is accepted.
    let pushHandler: ((message: HostPush) => void) | undefined;
    const client = createMockClient((cmd) => {
      if (cmd.type === 'session/prompt') {
        // Simulate streaming text then terminal completion.
        setTimeout(() => {
          pushHandler?.({
            type: 'event',
            sessionId: 'side-001',
            event: { type: 'message/text_delta', delta: 'Hello ' } as never,
          });
          pushHandler?.({
            type: 'event',
            sessionId: 'side-001',
            event: { type: 'message/text_delta', delta: 'world!' } as never,
          });
          pushHandler?.({
            type: 'event',
            sessionId: 'side-001',
            event: { type: 'message/end' } as never,
          });
          pushHandler?.({
            type: 'run/terminal',
            run: {
              sessionId: 'side-001',
              runId: 'r1',
              status: 'completed',
              phase: 'terminal',
              terminalCode: 'completed',
            } as never,
          });
        }, 10);
        return okResponse({ sessionId: 'side-001' });
      }
      return failResponse('wrong type');
    });
    client.onPush = vi.fn((handler: (message: HostPush) => void) => {
      pushHandler = handler;
      return () => {
        pushHandler = undefined;
      };
    });
    const logs: string[] = [];
    await runSideChatSend(client, 'side-001', 'hello side chat', (line) => logs.push(line), {
      timeoutMs: 5000,
    });
    expect(client.handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/prompt',
        sessionId: 'side-001',
        input: { text: 'hello side chat' },
        foreground: { kind: 'if-idle' },
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    // Streaming deltas should have been logged.
    expect(logs.some((line) => line.includes('Hello '))).toBe(true);
    expect(logs.some((line) => line.includes('world!'))).toBe(true);
    // Terminal status should have been logged.
    expect(logs.some((line) => line.includes('completed'))).toBe(true);
  });

  it('throws on host error without waiting', async () => {
    const client = createMockClient(() => failResponse('session not found'));
    await expect(
      runSideChatSend(client, 'missing', 'text', () => {}, { timeoutMs: 1000 }),
    ).rejects.toThrow('session not found');
  });

  it('forwards the caller-owned key through the attached CLI host bind', async () => {
    const sent: Array<{ type: string; key?: string }> = [];
    const host = {
      handleCommand: createAttachedCliCommandHandler(async (command, options) => {
        sent.push({
          type: command.type,
          ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
        });
        return okResponse({ sessionId: 'side-001' });
      }),
      dispose: async () => undefined,
    };
    const pushHandlers = new Set<(message: HostPush) => void>();
    const client = bindSideChatHostClient(host, pushHandlers);
    const sending = runSideChatSend(client, 'side-001', 'hello side chat', () => undefined, {
      timeoutMs: 2000,
    });
    queueMicrotask(() => {
      for (const handler of pushHandlers) {
        handler({
          type: 'run/terminal',
          run: {
            sessionId: 'side-001',
            runId: 'r1',
            status: 'completed',
            phase: 'terminal',
            terminalCode: 'completed',
          } as never,
        });
      }
    });
    await sending;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('session/prompt');
    expect(sent[0]?.key).toEqual(expect.any(String));
    expect(sent[0]?.key?.length).toBeGreaterThan(0);
  });

  it('includes foreground admission on the attached prompt command', async () => {
    let prompted: HostCommand | undefined;
    const host = {
      handleCommand: createAttachedCliCommandHandler(async (command) => {
        prompted = command;
        return okResponse({ sessionId: 'side-001' });
      }),
      dispose: async () => undefined,
    };
    const pushHandlers = new Set<(message: HostPush) => void>();
    const client = bindSideChatHostClient(host, pushHandlers);
    const sending = runSideChatSend(client, 'side-001', 'hello', () => undefined, {
      timeoutMs: 2000,
    });
    queueMicrotask(() => {
      for (const handler of pushHandlers) {
        handler({
          type: 'run/terminal',
          run: {
            sessionId: 'side-001',
            runId: 'r1',
            status: 'completed',
            phase: 'terminal',
            terminalCode: 'completed',
          } as never,
        });
      }
    });
    await sending;
    expect(prompted).toMatchObject({
      type: 'session/prompt',
      foreground: { kind: 'if-idle' },
    });
  });

  it('fails attached side-chat send when the host bind drops the key', async () => {
    const host = {
      handleCommand: createAttachedCliCommandHandler(async () => okResponse({ sessionId: 'side-001' })),
      dispose: async () => undefined,
    };
    const dropBind: SideChatHostClient = {
      handleCommand: (command) => host.handleCommand(command),
      onPush: () => () => undefined,
      dispose: () => host.dispose(),
    };
    await expect(
      runSideChatSend(dropBind, 'side-001', 'hello', () => undefined, { timeoutMs: 200 }),
    ).rejects.toThrow('idempotency-key-required');
  });
});

describe('runSideChatResume', () => {
  it('sends session/resume with the side chat session id', async () => {
    const client = createMockClient((cmd) =>
      cmd.type === 'session/resume' ? okResponse({ sessionId: 'side-001' }) : failResponse('wrong type'),
    );
    const logs: string[] = [];
    await runSideChatResume(client, 'side-001', (line) => logs.push(line));
    expect(client.handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session/resume', sessionId: 'side-001' }),
    );
    expect(logs[0]).toContain('side-001');
  });
});
