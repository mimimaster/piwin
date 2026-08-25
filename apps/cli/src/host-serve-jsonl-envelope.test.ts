import { describe, expect, it } from 'vitest';
import { HOST_COMMAND_REQUEST_ENVELOPE_VERSION, parseHostCommandRequest } from '@piwin/contracts';
import { HostCommandIdempotencyRegistry, admitAndExecuteHostCommand } from '@piwin/host-server';
import { createHostServeDispatcher } from './host-serve-dispatcher.js';
import type { HostRuntime } from '@piwin/host-runtime';

describe('local JSONL request envelope', () => {
  it('carries command, idempotencyKey, and clientPrincipalId into admission', async () => {
    const parsed = parseHostCommandRequest({
      v: HOST_COMMAND_REQUEST_ENVELOPE_VERSION,
      command: {
        type: 'session/abort',
        sessionId: 's1',
        runId: 'run-1',
      },
      idempotencyKey: 'gesture-1',
      clientPrincipalId: 'desktop-install-1',
    });
    expect(parsed).toEqual({
      command: { type: 'session/abort', sessionId: 's1', runId: 'run-1' },
      idempotencyKey: 'gesture-1',
      clientPrincipalId: 'desktop-install-1',
    });
  });

  it('retries a lost JSONL ACK as join/replay of one mutation', async () => {
    const registry = new HostCommandIdempotencyRegistry();
    let executions = 0;
    const runtime = {
      handleCommand: async (command: { type: string }) => {
        executions += 1;
        return { type: 'response' as const, command: command.type, success: true, data: { runId: 'r1' } };
      },
    };
    const written: unknown[] = [];
    const dispatcher = createHostServeDispatcher({
      runtime: runtime as unknown as HostRuntime,
      send: async (message) => {
        written.push(message);
      },
      admit: (request, execute) =>
        admitAndExecuteHostCommand({
          registry,
          principalId: request.clientPrincipalId ?? 'local-jsonl',
          idempotencyKey: request.idempotencyKey,
          command: request.command,
          execute,
        }),
    });
    const envelope = {
      command: {
        type: 'session/prompt' as const,
        sessionId: 's1',
        input: { text: 'once' },
        foreground: { kind: 'if-idle' as const },
      },
      idempotencyKey: 'jsonl-gesture',
      clientPrincipalId: 'desktop-install-1',
    };
    dispatcher.dispatch(envelope);
    dispatcher.dispatch(envelope);
    await dispatcher.drain();
    expect(executions).toBe(1);
    expect(written).toHaveLength(2);
  });
});
