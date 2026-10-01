import { describe, expect, it } from 'vitest';
import type { HostCommand, HostPush } from '@piwin/contracts';
import { createCliBackendPermissionResponder, parseCliAgent } from './external-agent-cli.js';

describe('parseCliAgent', () => {
  it('defaults to pi and accepts any enabled-backend id', () => {
    expect(parseCliAgent(['chat', 'hi'])).toBe('pi');
    expect(parseCliAgent(['chat', '--agent', 'example-build', 'hi'])).toBe('example-build');
    expect(parseCliAgent(['chat', '--agent', '../secret'])).toEqual({
      error: '--agent must be pi or a lowercase backend id (got ../secret)',
    });
  });
});

describe('createCliBackendPermissionResponder', () => {
  const push: HostPush = {
    type: 'permission/request',
    sessionId: 's',
    requestId: 'r-1',
    action: 'edit',
    detail: '/tmp/a',
    defaultDecision: 'ask',
    context: {
      kind: 'file-write',
      summary: 'Write `a`',
      backendAgentId: 'grok',
      backendOptions: [
        { optionId: 'allow-once', kind: 'allow_once', label: 'Yes' },
        { optionId: 'reject-once', kind: 'reject_once', label: 'No' },
      ],
    },
  };

  it('prints Grok options and answers with the reject option', async () => {
    const sent: HostCommand[] = [];
    const lines: string[] = [];
    const respond = createCliBackendPermissionResponder(
      async (command) => {
        sent.push(command);
        return { type: 'response', command: command.type, success: true };
      },
      (line) => lines.push(line),
    );
    expect(respond(push)).toBe(true);
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'permission/resolve', requestId: 'r-1', decision: 'deny', backendOptionId: 'reject-once' }]);
    expect(lines.join('')).toContain('Yes [allow-once] | No [reject-once]');
  });

  it('ignores Pi permission requests', () => {
    const respond = createCliBackendPermissionResponder(async () => {
      throw new Error('should not be called');
    });
    expect(respond({ ...push, context: { kind: 'command', summary: 'x' } } as HostPush)).toBe(false);
    expect(respond({ type: 'host/log', level: 'info', message: 'x' })).toBe(false);
  });
});
