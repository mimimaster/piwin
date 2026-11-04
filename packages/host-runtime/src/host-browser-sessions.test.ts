import { afterEach, describe, expect, it, vi } from 'vitest';
import * as browser from '@piwin/browser';
import type { HostPush } from '@piwin/contracts';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { disposeBrowserSessions, ensureBrowserSession } from './host-browser-sessions.js';

function createKernel(): { deps: HostRuntimeKernel; pushes: HostPush[] } {
  const pushes: HostPush[] = [];
  const deps = {
    options: { piwinRoot: process.env.PIWIN_ROOT },
    browserSessions: new Map<string, Promise<browser.BrowserSession>>(),
    browserFrameSinks: new Set(),
    hostClosing: false,
    push: (push: HostPush) => pushes.push(push),
  } as unknown as HostRuntimeKernel;
  return { deps, pushes };
}

afterEach(() => vi.restoreAllMocks());

describe('Host conversation browser registry', () => {
  it('shares one resource within a conversation and isolates profiles, pushes, and binary bytes across conversations', async () => {
    const factory = vi.spyOn(browser, 'createBrowserSession');
    const { deps, pushes } = createKernel();
    const [first, same, second, legacy] = await Promise.all([
      ensureBrowserSession(deps, 'a'),
      ensureBrowserSession(deps, 'a'),
      ensureBrowserSession(deps, 'b'),
      ensureBrowserSession(deps),
    ]);
    expect(first).toBe(same);
    expect(first).not.toBe(second);
    expect(first).not.toBe(legacy);
    expect(factory).toHaveBeenCalledTimes(3);
    const options = factory.mock.calls.map((call) => call[0]);
    expect(new Set(options.map((option) => option?.profileDir)).size).toBe(3);
    expect(options[0]).toMatchObject({ keepAlive: true, isolatedContext: true });
    await first.lock('agent', { runId: 'run-a' });
    await second.lock('agent', { runId: 'run-b' });
    expect(pushes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'browser/controller', sessionId: 'a' }),
        expect.objectContaining({ type: 'browser/controller', sessionId: 'b' }),
      ]),
    );
    const sink = vi.fn();
    deps.browserFrameSinks.add(sink);
    options[0]?.onFrameBytes?.(
      {
        version: 1,
        frameId: '1',
        generation: 1,
        pageId: 'same',
        documentRevision: 0,
        width: 1,
        height: 1,
        encodedWidth: 1,
        encodedHeight: 1,
        byteLength: 4,
        mime: 'image/jpeg',
      },
      new Uint8Array(4),
    );
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'a' }),
      expect.any(Uint8Array),
    );
    const close = vi.spyOn(first, 'close');
    expect(await disposeBrowserSessions(deps)).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
    expect(deps.browserSessions.size).toBe(0);
  });

  it('allows retrying a failed initialization instead of caching failure forever', async () => {
    const factory = vi.spyOn(browser, 'createBrowserSession').mockImplementationOnce(() => {
      throw new Error('initialization failed');
    });
    const { deps } = createKernel();
    await expect(ensureBrowserSession(deps, 'a')).rejects.toThrow('initialization failed');
    expect(deps.browserSessions.size).toBe(0);
    await ensureBrowserSession(deps, 'a');
    expect(factory).toHaveBeenCalledTimes(2);
    await disposeBrowserSessions(deps);
  });

  it('does not create or leak a browser when the Host closes during initialization', async () => {
    const { deps } = createKernel();
    const pending = ensureBrowserSession(deps, 'a');
    const rejected = expect(pending).rejects.toThrow('Host is closing');
    deps.hostClosing = true;
    expect(await disposeBrowserSessions(deps)).toEqual([]);
    await rejected;
    expect(deps.browserSessions.size).toBe(0);
    await expect(ensureBrowserSession(deps, 'b')).rejects.toThrow('Host is closing');
  });
});
