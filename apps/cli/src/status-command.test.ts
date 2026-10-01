import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';

const host = vi.hoisted(() => ({ handleCommand: vi.fn(), dispose: vi.fn(async () => undefined) }));
vi.mock('./cli-host.js', () => ({ openCliHost: async () => ({ ...host, transport: 'attached' }) }));
import { commandStatus } from './status-command.js';

const summary = {
  turnId: 'turn-user',
  userMessageId: 'user',
  firstMessageId: 'user',
  revision: 'r1',
  startIndex: 0,
  endIndex: 900,
  toolCount: 934,
  fileCount: 141,
  failureCount: 15,
};
beforeEach(() => {
  host.handleCommand.mockReset();
  host.dispose.mockClear();
  host.handleCommand.mockImplementation(async (command: HostCommand): Promise<HostResponse> => {
    if (command.type === 'host/status')
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          mode: 'sdk',
          ready: true,
          mock: true,
          piwinRoot: '/tmp/root',
          activeSessionIds: [],
          capabilities: {},
        },
      };
    if (command.type === 'session/transcript-page')
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: { status: 'page', messages: [], page: { turnSummaries: [summary] } },
      };
    return { type: 'response', command: command.type, success: false, error: 'unavailable' };
  });
});
afterEach(() => vi.restoreAllMocks());

it('reads complete work totals from the attached Host without resuming a session', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await commandStatus(['status', '--session', 'session', '--mock']);
  expect(host.handleCommand).toHaveBeenCalledWith({
    type: 'session/transcript-page',
    query: { sessionId: 'session', limit: 50, maximumBytes: 256 * 1024 },
  });
  expect(host.handleCommand.mock.calls.some(([command]) => command.type === 'session/resume')).toBe(
    false,
  );
  expect(output.mock.calls.flat().join('\n')).toContain('- tools: 934');
  expect(host.dispose).toHaveBeenCalledOnce();
});

it('does not read a transcript without an explicit session option', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await commandStatus(['status', '--mock']);
  expect(
    host.handleCommand.mock.calls.some(([command]) => command.type === 'session/transcript-page'),
  ).toBe(false);
});

it('rejects a missing session id and disposes the connection', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(commandStatus(['status', '--session', '--mock'])).rejects.toThrow('Usage:');
  expect(host.dispose).toHaveBeenCalledOnce();
});
