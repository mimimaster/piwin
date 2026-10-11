import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryDeviceCredentialVault } from '@piwin/host-client';
import { rememberDeviceCredential, setDeviceCredentialVaultForTesting } from './device-admission.js';
import { resolveEmbeddedTuiLaunch } from './embedded-tui-target.js';

afterEach(() => setDeviceCredentialVaultForTesting(undefined));
describe('embedded TUI follows the active Host', () => {
  const projectId = 'project-0123456789abcdef01234567';
  it('uses a local project path with the sidecar', () => {
    expect(resolveEmbeddedTuiLaunch({ sessionId: null, projectPath: '/work/app' })).toEqual({ projectPath: '/work/app' });
  });
  it('passes the remote endpoint, token and opaque project id', () => {
    expect(resolveEmbeddedTuiLaunch({
      sessionId: null, projectPath: projectId,
      remoteTarget: { endpoint: 'wss://host.example/ws', authToken: 'secret' },
    })).toEqual({
      projectId, remoteTarget: { endpoint: 'wss://host.example/ws', authToken: 'secret' },
    });
  });
  it('uses the same device admission as Desktop instead of an obsolete token', async () => {
    setDeviceCredentialVaultForTesting(createMemoryDeviceCredentialVault());
    const deviceCredential = { deviceId: 'device-1', deviceSecret: 'secret' };
    await rememberDeviceCredential('wss://host.example/ws', deviceCredential);
    expect(resolveEmbeddedTuiLaunch({
      sessionId: 'session-1', projectPath: projectId,
      remoteTarget: { endpoint: 'wss://host.example/ws', authToken: 'obsolete' },
    })).toEqual({ sessionId: 'session-1', remoteTarget: { endpoint: 'wss://host.example/ws', deviceCredential } });
  });
  it('never forwards a remote project key as a local filesystem path', () => {
    expect(() => resolveEmbeddedTuiLaunch({
      sessionId: null, projectPath: '/remote/root', remoteTarget: { endpoint: 'ws://host.example' },
    })).toThrow('project id');
  });
});
