import { describe, expect, it } from 'vitest';
import type { HostPush, PermissionMode } from '@piwin/contracts';
import {
  ExternalAgentBackend,
  yoloAllowDecision,
  type ExternalAgentBackendDeps,
} from './external-agent-backend.js';

const options = [
  { optionId: 'a1', kind: 'allow_once', name: 'Allow' },
  { optionId: 'aa', kind: 'allow_always', name: 'Always' },
  { optionId: 'r1', kind: 'reject_once', name: 'Reject' },
] as const;

function backend(mode: PermissionMode | undefined) {
  const pushes: HostPush[] = [];
  const deps = {
    push: (m: HostPush) => pushes.push(m),
    pendingPermissions: new Map(),
    getForegroundRunId: () => 'run-1',
    onSessionTitle: () => undefined,
    onSessionTransportClosed: () => undefined,
    requireInstall: () => Promise.reject(new Error('unused')),
    createRequestId: () => 'req-1',
    getPermissionMode: () => mode,
  } as unknown as ExternalAgentBackendDeps;
  const b = new ExternalAgentBackend(deps) as unknown as {
    requestPermission: (input: unknown) => Promise<unknown>;
  };
  const ask = () =>
    b.requestPermission({
      agentId: 'codex',
      sessionId: 's1',
      prompt: { action: 'shell', detail: 'ls', options, context: undefined },
    });
  return { pushes, ask, pending: deps.pendingPermissions };
}

describe('external agent permission under YOLO', () => {
  it('prefers allow_once', () => {
    expect(yoloAllowDecision(options as never)).toEqual({ optionId: 'a1' });
    expect(yoloAllowDecision([] as never)).toBeUndefined();
  });

  it.each(['bypass', 'unrestricted'] as const)(
    'auto-allows under %s with an audit record',
    async (mode) => {
      const t = backend(mode);
      await expect(t.ask()).resolves.toEqual({ optionId: 'a1' });
      expect(t.pushes.some((p) => p.type === 'permission/request')).toBe(false);
      expect(t.pushes.some((p) => p.type === 'permission/resolved')).toBe(true);
      expect(t.pushes.some((p) => p.type === 'host/log')).toBe(true);
    },
  );

  it.each(['auto', 'ask-all', undefined] as const)('still asks under %s', (mode) => {
    const t = backend(mode);
    void t.ask();
    expect(t.pushes.some((p) => p.type === 'permission/request')).toBe(true);
    expect(t.pending.size).toBe(1);
  });
});
