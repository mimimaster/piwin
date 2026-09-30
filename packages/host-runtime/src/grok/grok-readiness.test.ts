import { expect, it, vi } from 'vitest';
import type { ExternalAgentStatus } from '@piwin/contracts';
import { GrokBackendService } from './grok-backend-service.js';
import { detectGrokCli } from './grok-cli-detection.js';

it('does not publish a late ready result after disabling or changing the selected CLI', async () => {
  let complete: ((status: ExternalAgentStatus) => void) | undefined;
  const push = vi.fn();
  const service = new GrokBackendService({
    push, pendingPermissions: new Map(), getForegroundRunId: () => undefined,
    onSessionTitle: () => undefined, onSessionTransportClosed: () => undefined,
    createRequestId: () => 'request',
    detect: () => new Promise((resolve) => { complete = resolve; }),
  });
  const detection = service.getStatus(true);
  service.invalidateStatus();
  if (complete === undefined) throw new Error('detection did not start');
  complete({ agentId: 'grok', state: 'ready', binaryPath: '/fake/grok', version: '1.0.44', supportStatus: 'verified', checkedAt: new Date().toISOString() });
  await expect(detection).rejects.toThrow('agent-readiness-changed');
  expect(service.peekStatus()).toBeUndefined();
  expect(push).not.toHaveBeenCalled();
});

it('does not silently fall back when the user explicitly selected a missing CLI', async () => {
  const createTransport = vi.fn();
  const status = await detectGrokCli({
    binaryPath: '/chosen/missing-grok', env: { PATH: '/otherwise-installed' }, homeDir: '/home/fixture', platform: 'linux',
    fileExists: async (path) => path !== '/chosen/missing-grok', createTransport,
  });
  expect(status).toMatchObject({ state: 'not-installed', searched: ['/chosen/missing-grok'] });
  expect(createTransport).not.toHaveBeenCalled();
});
