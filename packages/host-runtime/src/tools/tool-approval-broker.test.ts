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
