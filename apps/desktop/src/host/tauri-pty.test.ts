import { describe, expect, it, vi } from 'vitest';
import { isTauriPtyAvailable, isTauriRuntime, tauriPtyOpenTui } from './tauri-pty.js';

const invoke = vi.hoisted(() => vi.fn(async () => ({ pty_id: 'pty-1' })));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('tauri-pty', () => {
  it('forwards the active remote Host and project ID to native launch', async () => {
    await tauriPtyOpenTui({
      projectPath: 'project-0123456789abcdef01234567',
      remoteTarget: { endpoint: 'wss://remote.example/ws', authToken: 'secret' },
      cols: 100, rows: 30,
    });
    expect(invoke).toHaveBeenLastCalledWith('pty_open_remote_tui', {
      projectId: 'project-0123456789abcdef01234567',
      remoteTarget: { endpoint: 'wss://remote.example/ws', authToken: 'secret' },
      cols: 100, rows: 30,
    });
  });

  it('leaves the local entrance to native code and resumes without a scope hint', async () => {
    await tauriPtyOpenTui({ sessionId: 'session-1', projectPath: '/work/app' });
    expect(invoke).toHaveBeenLastCalledWith('pty_open_tui', { sessionId: 'session-1' });
  });

  it('does not fall back to the sidecar when a running native build lacks remote launch', async () => {
    invoke.mockClear();
    invoke.mockRejectedValueOnce(new Error('Command pty_open_remote_tui not found'));
    await expect(tauriPtyOpenTui({ remoteTarget: { endpoint: 'ws://remote.example' } })).rejects.toThrow('not found');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('pty_open_remote_tui', { remoteTarget: { endpoint: 'ws://remote.example' } });
  });

  it('reports non-Tauri runtime in vitest/jsdom', () => {
    expect(isTauriRuntime()).toBe(false);
    expect(isTauriPtyAvailable()).toBe(false);
  });
});
