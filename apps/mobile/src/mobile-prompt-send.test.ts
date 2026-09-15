import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  buildMobileAbortCommand,
  buildMobilePermissionResolveCommand,
  executeMobileMutation,
  nextMobileSendIntent,
  readMobilePromptFailure,
  buildMobileSessionPrompt,
} from './mobile-prompt-send.js';

describe('mobile prompt send', () => {
  it('attaches Apple Health as a structured context ref without changing user text', () => {
    const prompt = buildMobileSessionPrompt({
      sessionId: 's1',
      text: '分析我最近七天的睡眠',
      includeAppleHealth: true,
    });
    expect(prompt.input.text).toBe('分析我最近七天的睡眠');
    expect(prompt.input.contextRefs).toEqual([
      { kind: 'connected-source', source: 'apple-health', label: 'Apple Health' },
    ]);
  });

  it('always admits with if-idle unless replacing a named run', () => {
    expect(
      buildMobileSessionPrompt({ sessionId: 's1', text: 'hello' }).foreground,
    ).toEqual({ kind: 'if-idle' });
    expect(
      buildMobileSessionPrompt({
        sessionId: 's1',
        text: 'hello',
        replaceRunId: 'run-a',
      }).foreground,
    ).toEqual({ kind: 'replace-run', runId: 'run-a' });
  });

  it('surfaces foreground-run-mismatch with the live run id', () => {
    const response: HostResponse = {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'foreground-run-mismatch: session is busy',
      problem: {
        code: 'foreground-run-mismatch',
        data: { reason: 'active', actualRun: { runId: 'run-a' } },
      },
    };
    expect(readMobilePromptFailure(response)).toEqual({
      message: 'foreground-run-mismatch: session is busy',
      replaceRunId: 'run-a',
    });
  });

  it('maps a missing-foreground problem without offering replace-run', () => {
    const response: HostResponse = {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'Remote session/prompt requires foreground admission',
      problem: { code: 'command-not-allowed', data: { reason: 'foreground-required' } },
    };
    expect(readMobilePromptFailure(response)).toEqual({
      message: 'Remote session/prompt requires foreground admission',
    });
  });

  it('disables send while reconciling and queues when a Run is known', () => {
    expect(
      nextMobileSendIntent({
        sessionId: 's1',
        text: 'hi',
        foreground: { kind: 'reconciling', generation: 1 },
      }).kind,
    ).toBe('disabled');
    expect(
      nextMobileSendIntent({
        sessionId: 's1',
        text: 'hi',
        foreground: { kind: 'idle', generation: 1 },
      }).kind,
    ).toBe('prompt');
    const queued = nextMobileSendIntent({
      sessionId: 's1',
      text: 'later',
      foreground: { kind: 'active', generation: 1, runId: 'run-a', status: 'running' },
      queuedTurnId: 'qt-1',
      userMessageId: 'um-1',
    });
    expect(queued).toMatchObject({
      kind: 'queued-turn',
      command: { type: 'session/queued-turn-submit', queuedTurnId: 'qt-1' },
    });
  });

  it('passes a caller-owned key into prompt, abort, and permission resolve', async () => {
    const calls: Array<{ command: HostCommand; key?: string }> = [];
    const request = async (
      command: HostCommand,
      options?: { idempotencyKey?: string },
    ): Promise<HostResponse> => {
      calls.push(
        options?.idempotencyKey === undefined
          ? { command }
          : { command, key: options.idempotencyKey },
      );
      return { type: 'response', command: command.type, success: true };
    };
    await executeMobileMutation(request, buildMobileSessionPrompt({ sessionId: 's1', text: 'hi' }), 'k-prompt');
    await executeMobileMutation(request, buildMobileAbortCommand('s1', 'run-a'), 'k-abort');
    await executeMobileMutation(
      request,
      buildMobilePermissionResolveCommand('perm-1', 'allow'),
      'k-perm',
    );
    expect(calls.map((call) => call.key)).toEqual(['k-prompt', 'k-abort', 'k-perm']);
  });

  it('forwards the selected permission remember scope to Host', () => {
    expect(buildMobilePermissionResolveCommand('perm-1', 'allow', 'project')).toEqual({
      type: 'permission/resolve',
      requestId: 'perm-1',
      decision: 'allow',
      rememberScope: 'project',
    });
  });

  it('treats queue and replace as new attempts with distinct keys', async () => {
    const keys: string[] = [];
    const request = async (
      command: HostCommand,
      options?: { idempotencyKey?: string },
    ): Promise<HostResponse> => {
      keys.push(options?.idempotencyKey ?? '');
      return { type: 'response', command: command.type, success: true };
    };
    const prompt = nextMobileSendIntent({
      sessionId: 's1',
      text: 'hi',
      foreground: { kind: 'idle', generation: 1 },
    });
    const queued = nextMobileSendIntent({
      sessionId: 's1',
      text: 'hi',
      foreground: { kind: 'active', generation: 1, runId: 'run-a', status: 'running' },
      queuedTurnId: 'qt-new',
      userMessageId: 'um-new',
    });
    const replace = nextMobileSendIntent({
      sessionId: 's1',
      text: 'hi',
      foreground: { kind: 'idle', generation: 1 },
      replaceRunId: 'run-a',
    });
    expect(prompt.kind).toBe('prompt');
    expect(queued.kind).toBe('queued-turn');
    expect(replace.kind).toBe('prompt');
    if (prompt.kind === 'prompt') {
      await executeMobileMutation(request, prompt.command, 'key-idle');
    }
    if (queued.kind === 'queued-turn') {
      await executeMobileMutation(request, queued.command, 'key-queue');
    }
    if (replace.kind === 'prompt') {
      await executeMobileMutation(request, replace.command, 'key-replace');
    }
    expect(keys).toEqual(['key-idle', 'key-queue', 'key-replace']);
  });
});
