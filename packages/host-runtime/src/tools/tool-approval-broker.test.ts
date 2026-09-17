import { describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration } from '@piwin/contracts';
import { createToolApprovalBroker } from './tool-approval-broker.js';
import type { ToolPolicyDecision } from './tool-policy-evaluator.js';

const registration: HostToolRegistration = {
  descriptor: { name: 'bash', description: 'bash', parameters: { type: 'object' } },
  family: 'shell',
  permissionSpec: {
    action: 'bash',
    risk: 'command',
    rememberable: false,
    subjectBuilder: (args) => ({ kind: 'bash', command: String(args.command ?? '') }),
  },
  execute: async () => ({ ok: true, output: 'ok' }),
};

const context = {
  sessionId: 's1',
  runtimeGenerationId: 'g1',
  runId: 'r1',
  toolName: 'bash',
};

function policy(partial: Partial<ToolPolicyDecision>): ToolPolicyDecision {
  return {
    decision: 'ask',
    reason: 'destructive-command',
    action: 'bash',
    rememberable: false,
    subject: { kind: 'bash', command: 'rm -rf /tmp/approved' },
    ...partial,
  };
}

describe('createToolApprovalBroker', () => {
  it('never lets session memory override an explicit deny', async () => {
    const broker = createToolApprovalBroker({
      getSessionAllowlist: () => ({
        hasBashCommand: () => true,
        hasFilePath: () => false,
      }),
    });
    await expect(
      broker.resolve({
        invocationId: 'inv-1',
        registration,
        arguments: { command: 'rm -rf /tmp/approved' },
        context,
        policy: policy({ decision: 'deny', reason: 'blocked' }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'blocked' });
  });

  it('allows an ask from session bash memory without prompting', async () => {
    const requestPermission = vi.fn(async () => 'deny' as const);
    const broker = createToolApprovalBroker({
      getSessionAllowlist: () => ({
        hasBashCommand: (command) => command === 'rm -rf /tmp/approved',
        hasFilePath: () => false,
      }),
      requestPermission,
    });
    await expect(
      broker.resolve({
        invocationId: 'inv-1',
        registration,
        arguments: { command: 'rm -rf /tmp/approved' },
        context,
        policy: policy({}),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ allowed: true, source: 'session-memory' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('settles a confined worktree rm-recursive-force ask without prompting', async () => {
    const requestPermission = vi.fn(async () => 'deny' as const);
    const autoApproveRecursiveRemove = vi.fn(async () => true);
    const broker = createToolApprovalBroker({ requestPermission, autoApproveRecursiveRemove });
    await expect(
      broker.resolve({
        invocationId: 'inv-rm',
        registration,
        arguments: { command: 'rm -rf node_modules' },
        context,
        policy: policy({ reason: 'chain-ask:rm-recursive-force' }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ allowed: true, source: 'subagent-worktree' });
    expect(autoApproveRecursiveRemove).toHaveBeenCalledWith('rm -rf node_modules');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('still prompts for other ask reasons or an unconfined rm', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const autoApproveRecursiveRemove = vi.fn(async () => false);
    const broker = createToolApprovalBroker({ requestPermission, autoApproveRecursiveRemove });
    const resolve = (reason: string) =>
      broker.resolve({
        invocationId: 'inv-ask',
        registration,
        arguments: { command: 'rm -rf ../main' },
        context,
        policy: policy({ reason }),
        signal: new AbortController().signal,
      });
    await expect(resolve('rm-recursive-force')).resolves.toEqual({ allowed: true, source: 'user' });
    await expect(resolve('sudo')).resolves.toEqual({ allowed: true, source: 'user' });
    expect(autoApproveRecursiveRemove).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it('denies ask when there is no interactive handler', async () => {
    const broker = createToolApprovalBroker({});
    await expect(
      broker.resolve({
        invocationId: 'inv-1',
        registration,
        arguments: { command: 'rm -rf /tmp/other' },
        context,
        policy: policy({ subject: { kind: 'bash', command: 'rm -rf /tmp/other' } }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'destructive-command' });
  });
});
