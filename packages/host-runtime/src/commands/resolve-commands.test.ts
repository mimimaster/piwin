import { describe, expect, it } from 'vitest';
import type { PermissionDecision } from '@piwin/contracts';
import type { HostCommandContext } from './host-command-context.js';
import { handleResolveCommand } from './resolve-commands.js';

function createContext(
  pending: Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      sessionId: string;
      action: string;
      detail: string;
    }
  >,
): HostCommandContext {
  return {
    piwinRoot: '/tmp/piwin',
    push: () => {},
    requireSession: () => {
      throw new Error('unused');
    },
    getMcpManager: () => {
      throw new Error('unused');
    },
    getJobController: () => {
      throw new Error('unused');
    },
    todoStore: {} as HostCommandContext['todoStore'],
    petStateStore: {} as HostCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: false }),
    pendingPermissions: pending,
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => {},
    rememberSessionPermission: () => {},
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => {},
    clearSessionPermissionOverride: () => {},
  } as unknown as HostCommandContext;
}

describe('handleResolveCommand permission/resolve', () => {
  it('fails when the request is no longer pending', async () => {
    const response = await handleResolveCommand(
      { type: 'permission/resolve', requestId: 'missing', decision: 'allow' },
      'req-1',
      createContext(new Map()),
    );
    expect(response?.success).toBe(false);
    if (response?.success !== false) {
      throw new Error('expected failure');
    }
    expect(response.error).toMatch(/Unknown permission request/);
  });

  it('resolves a pending request and returns the decision', async () => {
    let settled: PermissionDecision | undefined;
    const pending = new Map<
      string,
      {
        resolve: (decision: PermissionDecision) => void;
        sessionId: string;
        action: string;
        detail: string;
      }
    >();
    pending.set('req-live', {
      resolve: (decision) => {
        settled = decision;
      },
      sessionId: 'sess-1',
      action: 'bash',
      detail: 'ls',
    });
    const response = await handleResolveCommand(
      { type: 'permission/resolve', requestId: 'req-live', decision: 'allow' },
      'req-1',
      createContext(pending),
    );
    expect(response?.success).toBe(true);
    expect(settled).toBe('allow');
  });
});
