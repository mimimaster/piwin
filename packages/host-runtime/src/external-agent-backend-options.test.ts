import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { HostPush, SessionBackendOptions } from '@piwin/contracts';
import { ExternalAgentBackend } from './external-agent-backend.js';
import { requireExtensionBackendLaunch } from './extension-session-backends.js';
import { installFixtureAgentAdapter } from './testing/agent-plugin-fixture.js';

it('pushes the initial catalog after a cold query, and pushes later option changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piwin-backend-options-'));
  const options: SessionBackendOptions = {
    agentId: 'fixture', models: [{ id: 'grok-4.7-build-fast', label: 'Grok 4.7 Build Fast' }],
    currentModelId: 'grok-4.7-build-fast', modes: [], modeConfirmed: true, commands: [],
  };
  const installed = await installFixtureAgentAdapter(root, { script: { options } });
  const pushes: HostPush[] = [];
  const backend = new ExternalAgentBackend({
    push: (push) => pushes.push(push), pendingPermissions: new Map(),
    getForegroundRunId: () => undefined, onSessionTitle: () => undefined,
    onSessionTransportClosed: () => undefined,
    requireInstall: (agentId) => requireExtensionBackendLaunch(root, agentId),
    createRequestId: () => 'request-1', piwinRoot: root, env: installed.env,
  });
  let opened: Awaited<ReturnType<ExternalAgentBackend['openSession']>> | undefined;
  try {
    expect(backend.getSessionOptions('product-1')).toBeUndefined();
    opened = await backend.openSession({
      agentId: installed.agentId, productSessionId: 'product-1', cwd: root,
      binding: { agentId: installed.agentId }, mode: 'new', runtimeGenerationId: 'gen-1',
    });
    expect(pushes).toContainEqual({ type: 'session/backend-updated', sessionId: 'product-1', options });
    const before = pushes.length;
    await opened.handle.setModel('grok-4.7-build-fast');
    expect(pushes.slice(before)).toContainEqual({
      type: 'session/backend-updated', sessionId: 'product-1', options,
    });
  } finally {
    await opened?.handle.release();
    await backend.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
