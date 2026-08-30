import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { runAuthCommand, type AuthHostClient } from './auth-command.js';

function createClient(response: HostResponse): AuthHostClient & {
  handleCommand: ReturnType<typeof vi.fn>;
} {
  return {
    handleCommand: vi.fn(async (_command: HostCommand) => response),
    onPush: () => () => undefined,
  };
}

describe('auth CLI', () => {
  it('prints v1 account rows', async () => {
    const client = createClient({
      type: 'response',
      command: 'auth/status',
      success: true,
      data: {
        accounts: [
          { providerId: 'openai-codex', surface: 'v1', state: 'logged-out' },
          { providerId: 'xai', surface: 'v1', state: 'logged-in' },
        ],
      },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runAuthCommand(client, ['status']);
    expect(client.handleCommand).toHaveBeenCalledWith({ type: 'auth/status' });
    expect(log).toHaveBeenCalledWith('openai-codex\tv1\tlogged-out');
    expect(log).toHaveBeenCalledWith('xai\tv1\tlogged-in');
    log.mockRestore();
  });

  it('rejects unknown providers before talking to Host', async () => {
    const client = createClient({
      type: 'response',
      command: 'auth/login',
      success: true,
      data: { loginId: 'unused' },
    });
    await expect(runAuthCommand(client, ['login', 'antigravity'])).rejects.toThrow(
      /kimi-coding\|openai-codex\|anthropic\|xai\|github-copilot/,
    );
    expect(client.handleCommand).not.toHaveBeenCalled();
  });

  it('sends logout for an allowlisted id', async () => {
    const client = createClient({
      type: 'response',
      command: 'auth/logout',
      success: true,
      data: {},
    });
    await runAuthCommand(client, ['logout', 'xai']);
    expect(client.handleCommand).toHaveBeenCalledWith({
      type: 'auth/logout',
      input: { providerId: 'xai' },
    });
  });

  it('sends a caller-owned idempotency key with auth/login', async () => {
    const handleCommand = vi.fn(async (command: HostCommand, _options?: { idempotencyKey?: string }): Promise<HostResponse> => {
      if (command.type === 'auth/login') {
        return {
          type: 'response',
          command: 'auth/login',
          success: true,
          data: { loginId: 'login-1' },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });
    const client: AuthHostClient & { handleCommand: ReturnType<typeof vi.fn> } = {
      handleCommand,
      onPush: (handler) => {
        queueMicrotask(() =>
          handler({
            type: 'auth/login-finished',
            result: { loginId: 'login-1', providerId: 'xai', ok: true },
          }),
        );
        return () => undefined;
      },
    };
    await runAuthCommand(client, ['login', 'xai']);
    expect(handleCommand).toHaveBeenCalledWith(
      {
        type: 'auth/login',
        input: { providerId: 'xai', ownerDeviceId: 'cli', preferLoopback: true },
      },
      { idempotencyKey: expect.any(String) },
    );
  });
});
