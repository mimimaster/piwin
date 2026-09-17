import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import type { HostPush, SubagentInvocationActivity } from '@piwin/contracts';
import { requestPermission } from './host-runtime-permissions.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { RunRegistry } from './run-registry.js';

function fakeKernel(options: { childSessionId: string; invocationId: string }) {
  let activity: SubagentInvocationActivity = { kind: 'tool', toolName: 'bash', title: 'bash' };
  const recorded: SubagentInvocationActivity[] = [];
  const pushes: HostPush[] = [];
  const deps = {
    runRegistry: new RunRegistry(),
    runExecutionContext: new AsyncLocalStorage<string>(),
    pendingPermissions: new Map(),
    push: (message: HostPush) => pushes.push(message),
    subagentSessionContexts: new Map([
      [options.childSessionId, { parentSessionId: 'parent', invocationId: options.invocationId }],
    ]),
    subagentOrchestrator: {
      getRunningInvocationActivity: () => activity,
      updateInvocationActivity: (_id: string, next: SubagentInvocationActivity) => {
        activity = next;
        recorded.push(next);
        return Promise.resolve();
      },
    },
  } as unknown as HostRuntimeKernel;
  return {
    deps,
    recorded,
    pushes,
    setActivity: (next: SubagentInvocationActivity) => {
      activity = next;
    },
  };
}

function resolvePending(deps: HostRuntimeKernel, decision: 'allow' | 'deny'): void {
  for (const pending of deps.pendingPermissions.values()) pending.resolve(decision);
}

describe('requestPermission for a subagent child', () => {
  it('marks the invocation as waiting for approval and restores the tool activity after', async () => {
    const fake = fakeKernel({ childSessionId: 'child', invocationId: 'inv-1' });
    const decision = requestPermission(fake.deps, {
      sessionId: 'child',
      action: 'bash',
      detail: 'rm -rf node_modules',
      defaultDecision: 'ask',
    });

    expect(fake.recorded).toEqual([{ kind: 'permission', action: 'bash' }]);
    resolvePending(fake.deps, 'allow');
    await expect(decision).resolves.toBe('allow');
    expect(fake.recorded.at(-1)).toEqual({ kind: 'tool', toolName: 'bash', title: 'bash' });
  });

  it('does not overwrite activity the child reported while the prompt was open', async () => {
    const fake = fakeKernel({ childSessionId: 'child', invocationId: 'inv-1' });
    const decision = requestPermission(fake.deps, {
      sessionId: 'child',
      action: 'bash',
      detail: 'rm -rf node_modules',
      defaultDecision: 'ask',
    });
    fake.setActivity({ kind: 'thinking' });
    resolvePending(fake.deps, 'deny');
    await decision;

    expect(fake.recorded).toEqual([{ kind: 'permission', action: 'bash' }]);
  });

  it('leaves non-subagent sessions untouched', async () => {
    const fake = fakeKernel({ childSessionId: 'child', invocationId: 'inv-1' });
    const decision = requestPermission(fake.deps, {
      sessionId: 'parent',
      action: 'bash',
      detail: 'rm -rf dist',
      defaultDecision: 'ask',
    });
    resolvePending(fake.deps, 'allow');
    await decision;

    expect(fake.recorded).toEqual([]);
  });
});
