import { describe, expect, it, vi } from 'vitest';
import type { BackendPermissionOption, HostCommand, HostResponse } from '@piwin/contracts';
import type { PermissionPromptUi } from './chat-ui-types';
import type { HostClient } from './host-client';
import { buildPermissionResolveCommand, resolvePermissionPrompt } from './permission-resolve';

function prompt(overrides: Partial<PermissionPromptUi> = {}): PermissionPromptUi {
  return {
    requestId: 'req-1',
    sessionId: 'session-1',
    action: 'bash',
    detail: 'ls',
    defaultDecision: 'ask',
    ...overrides,
  };
}

const ACP_OPTIONS: readonly BackendPermissionOption[] = [
  { optionId: 'opt-allow-once', label: 'Allow once', kind: 'allow_once' },
  { optionId: 'opt-allow-always', label: 'Always allow', kind: 'allow_always' },
  { optionId: 'opt-reject-once', label: 'Reject once', kind: 'reject_once' },
];

const SUCCESS: HostResponse = {
  type: 'response',
  command: 'permission/resolve',
  success: true,
  data: {},
} as HostResponse;

describe('buildPermissionResolveCommand', () => {
  it('remembers an allow for the session scope and defaults to once', () => {
    expect(
      buildPermissionResolveCommand({
        prompt: prompt(),
        decision: 'allow',
        rememberScope: 'session',
      }),
    ).toEqual({
      type: 'permission/resolve',
      requestId: 'req-1',
      decision: 'allow',
      rememberScope: 'session',
    });
    expect(buildPermissionResolveCommand({ prompt: prompt(), decision: 'allow' })).toEqual({
      type: 'permission/resolve',
      requestId: 'req-1',
      decision: 'allow',
      rememberScope: 'once',
    });
  });

  it('omits the remember scope on deny', () => {
    expect(
      buildPermissionResolveCommand({
        prompt: prompt(),
        decision: 'deny',
        rememberScope: 'session',
      }),
    ).toEqual({ type: 'permission/resolve', requestId: 'req-1', decision: 'deny' });
  });

  it('sends the backend option id instead of a piwin remember scope (ADR 0082)', () => {
    const backendPrompt = prompt({
      context: { kind: 'command', summary: 'ls', backendOptions: [...ACP_OPTIONS] },
    });
    const command = buildPermissionResolveCommand({
      prompt: backendPrompt,
      decision: 'allow',
      rememberScope: 'session',
    });
    expect(command).toEqual({
      type: 'permission/resolve',
      requestId: 'req-1',
      decision: 'allow',
      backendOptionId: 'opt-allow-always',
    });
    expect(command).not.toHaveProperty('rememberScope');
  });

  it('falls back to the same-polarity backend option for a keyboard allow', () => {
    const backendPrompt = prompt({
      context: { kind: 'command', summary: 'ls', backendOptions: [...ACP_OPTIONS] },
    });
    expect(
      buildPermissionResolveCommand({ prompt: backendPrompt, decision: 'deny' }),
    ).toMatchObject({ backendOptionId: 'opt-reject-once' });
  });
});

describe('resolvePermissionPrompt', () => {
  it('sends the resolve with a gesture idempotency key', async () => {
    const request = vi.fn(
      async (_command: HostCommand, _options?: { idempotencyKey?: string }) => SUCCESS,
    );
    const hostClient = { request } as unknown as Pick<HostClient, 'request'>;

    const response = await resolvePermissionPrompt({
      hostClient,
      prompt: prompt(),
      decision: 'deny',
    });

    expect(response).toBe(SUCCESS);
    expect(request).toHaveBeenCalledTimes(1);
    const [command, options] = request.mock.calls[0]!;
    expect(command).toEqual({ type: 'permission/resolve', requestId: 'req-1', decision: 'deny' });
    expect(options?.idempotencyKey).toEqual(expect.any(String));
  });

  it('drops a second resolve for a request that is still in flight', async () => {
    let settle: (response: HostResponse) => void = () => undefined;
    const request = vi.fn(
      () =>
        new Promise<HostResponse>((resolve) => {
          settle = resolve;
        }),
    );
    const hostClient = { request } as unknown as Pick<HostClient, 'request'>;

    const first = resolvePermissionPrompt({ hostClient, prompt: prompt(), decision: 'allow' });
    const second = await resolvePermissionPrompt({
      hostClient,
      prompt: prompt(),
      decision: 'deny',
    });
    expect(second).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);

    settle(SUCCESS);
    await expect(first).resolves.toBe(SUCCESS);

    // Once settled, the same requestId is resolvable again (e.g. after a failed send).
    const retry = resolvePermissionPrompt({ hostClient, prompt: prompt(), decision: 'deny' });
    settle(SUCCESS);
    await expect(retry).resolves.toBe(SUCCESS);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases the in-flight slot when the request rejects', async () => {
    const request = vi
      .fn<() => Promise<HostResponse>>()
      .mockRejectedValueOnce(new Error('transport down'))
      .mockResolvedValueOnce(SUCCESS);
    const hostClient = { request } as unknown as Pick<HostClient, 'request'>;

    await expect(
      resolvePermissionPrompt({ hostClient, prompt: prompt(), decision: 'deny' }),
    ).rejects.toThrow('transport down');
    await expect(
      resolvePermissionPrompt({ hostClient, prompt: prompt(), decision: 'deny' }),
    ).resolves.toBe(SUCCESS);
  });
});
