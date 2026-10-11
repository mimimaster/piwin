import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostRuntime } from '@piwin/host-runtime';
import { HostDevicePairing, HostServer } from '@piwin/host-server';
import { hostData, openTuiHostLink } from './tui/tui-host-link.js';

afterEach(() => vi.unstubAllEnvs());
describe('embedded TUI attaches to another Host authority', () => {
  it.each(['token', 'paired-device'] as const)('opens remote project sessions with %s admission', async (admission) => {
    const sandbox = await mkdtemp(join(tmpdir(), 'piwin-remote-tui-'));
    const remoteRoot = join(sandbox, 'remote');
    const localRoot = join(sandbox, 'local-shell');
    const projectPath = join(sandbox, 'remote-project');
    await mkdir(projectPath);
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: remoteRoot });
    const pairing = new HostDevicePairing();
    const credential = pairing.completePairing(pairing.mintToken().token, 'Desktop').credential;
    const authToken = randomUUID();
    const server = new HostServer({
      runtime, host: '127.0.0.1', port: 0, authToken, devicePairing: pairing, piwinRoot: remoteRoot,
      instanceId: runtime.getHostInstanceId(),
    });
    let link: Awaited<ReturnType<typeof openTuiHostLink>> | undefined;
    try {
      await runtime.handleCommand({ type: 'project/open', path: projectPath });
      await runtime.handleCommand({ type: 'project/trust', path: projectPath });
      const address = await server.start();
      vi.stubEnv('PIWIN_ROOT', localRoot);
      vi.stubEnv('PIWIN_HOST_URL', address.url);
      vi.stubEnv('PIWIN_HOST_TOKEN', admission === 'token' ? authToken : 'obsolete-token');
      vi.stubEnv('PIWIN_HOST_DEVICE_ID', admission === 'paired-device' ? credential.deviceId : '');
      vi.stubEnv('PIWIN_HOST_DEVICE_SECRET', admission === 'paired-device' ? credential.deviceSecret : '');
      link = await openTuiHostLink({ mock: true, onHostError: (message) => { throw new Error(message); } });
      expect(link.kind).toBe('attached');
      expect(link.endpoint).toBe(address.url);
      const { projects } = hostData<{ projects: { projectId: string }[] }>(await link.request({ type: 'project/list' }));
      const projectId = projects[0]?.projectId;
      if (projectId === undefined) throw new Error('No remote project');
      expect(projectId).toMatch(/^project-/);
      const created = hostData<{ sessionId: string }>(await link.request({ type: 'session/create', input: { projectId } }));
      const activeLink = link;
      const prompted = await activeLink.request({
        type: 'session/prompt', sessionId: created.sessionId,
        input: { text: 'remote attachment test' }, foreground: { kind: 'if-idle' },
      });
      expect(prompted.success).toBe(true);
      // Empty sessions enter the durable index after their first message.
      await vi.waitFor(async () => {
        const listed = hostData<{ sessions: { sessionId: string; projectId: string }[] }>(await activeLink.request({
          type: 'session/list', scopeRef: { kind: 'project', projectId },
        }));
        expect(listed.sessions).toContainEqual(expect.objectContaining({ sessionId: created.sessionId, projectId }));
      });
      await link.dispose();
      link = await openTuiHostLink({ mock: true, onHostError: (message) => { throw new Error(message); } });
      const resumed = await link.request({ type: 'session/resume', sessionId: created.sessionId });
      expect(resumed.success).toBe(true);
    } finally {
      await link?.dispose();
      await server.stop();
      await runtime.dispose();
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
