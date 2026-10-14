import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriPtyDataEvent, TauriPtyExitEvent } from './tauri-pty';

const bridge = vi.hoisted(() => ({
  data: undefined as ((event: TauriPtyDataEvent) => void) | undefined,
  exit: undefined as ((event: TauriPtyExitEvent) => void) | undefined,
  unlistenData: vi.fn(), unlistenExit: vi.fn(), close: vi.fn(async () => {}),
}));
vi.mock('./tauri-pty', () => ({
  listenTauriPtyData: vi.fn(async (handler: (event: TauriPtyDataEvent) => void) => {
    bridge.data = handler;
    return bridge.unlistenData;
  }),
  listenTauriPtyExit: vi.fn(async (handler: (event: TauriPtyExitEvent) => void) => {
    bridge.exit = handler;
    return bridge.unlistenExit;
  }),
  tauriPtyClose: bridge.close,
  tauriPtyWrite: vi.fn(async () => {}),
  tauriPtyResize: vi.fn(async () => {}),
}));
import { connectXtermPty } from './xterm-pty-connection';
import { listenTauriPtyData, listenTauriPtyExit } from './tauri-pty';

beforeEach(() => { vi.clearAllMocks(); });

function callbacks() {
  return { onOpen: vi.fn(), onData: vi.fn(), onExit: vi.fn() };
}

describe('PTY startup lifecycle', () => {
  it('retains the initial frame and session announcement sent before open resolves', async () => {
    const signal = new AbortController();
    const events = callbacks();
    await connectXtermPty({
      signal: signal.signal, ...events,
      open: async () => {
        bridge.data?.({ pty_id: 'other', data: 'other terminal' });
        bridge.data?.({ pty_id: 'tui', data: 'first frame' });
        bridge.data?.({ pty_id: 'tui', data: '\x1b]777;piwin;session;session-1\x07' });
        return { pty_id: 'tui' };
      },
    });
    expect(events.onOpen).toHaveBeenCalledWith('tui');
    expect(events.onData.mock.calls).toEqual([
      ['first frame'], ['\x1b]777;piwin;session;session-1\x07'],
    ]);
    bridge.data?.({ pty_id: 'tui', data: 'next frame' });
    expect(events.onData).toHaveBeenLastCalledWith('next frame');
    signal.abort();
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(bridge.unlistenData).toHaveBeenCalledOnce();
    expect(bridge.unlistenExit).toHaveBeenCalledOnce();
  });

  it('delivers an early exit after opening so failure does not look like a running blank terminal', async () => {
    const signal = new AbortController();
    const events = callbacks();
    await connectXtermPty({ signal: signal.signal, ...events, open: async () => {
      bridge.exit?.({ pty_id: 'tui', exit_code: 1 });
      return { pty_id: 'tui' };
    } });
    expect(events.onExit).toHaveBeenCalledWith({ pty_id: 'tui', exit_code: 1 });
    signal.abort();
  });

  it('closes a process whose open response arrives after the pane was removed', async () => {
    const signal = new AbortController();
    const events = callbacks();
    await connectXtermPty({ signal: signal.signal, ...events, open: async () => {
      signal.abort();
      bridge.data?.({ pty_id: 'tui', data: 'late frame' });
      return { pty_id: 'tui' };
    } });
    expect(events.onOpen).not.toHaveBeenCalled();
    expect(events.onData).not.toHaveBeenCalled();
    expect(bridge.close).toHaveBeenCalledWith('tui');
  });

  it('disposes a listener that finishes registering after unmount', async () => {
    const signal = new AbortController();
    vi.mocked(listenTauriPtyData).mockImplementationOnce(async () => {
      signal.abort();
      return bridge.unlistenData;
    });
    const open = vi.fn(async () => ({ pty_id: 'tui' }));
    await connectXtermPty({ signal: signal.signal, open, ...callbacks() });
    expect(open).not.toHaveBeenCalled();
    expect(bridge.unlistenData).toHaveBeenCalledOnce();
  });

  it('cleans up the first listener and reports subscription errors', async () => {
    vi.mocked(listenTauriPtyExit).mockRejectedValueOnce(new Error('events unavailable'));
    await expect(connectXtermPty({
      signal: new AbortController().signal,
      open: async () => ({ pty_id: 'tui' }), ...callbacks(),
    })).rejects.toThrow('events unavailable');
    expect(bridge.unlistenData).toHaveBeenCalledOnce();
  });
});

it('does not replay live chunks already present in the reconnect snapshot', async () => {
  const handlers: Array<(event: { pty_id: string; data: string; sequence?: number }) => void> = [];
  const data = vi.fn();
  const abort = new AbortController();
  await connectXtermPty({
    signal: abort.signal,
    transport: {
      listenData: async (handler) => { handlers.push(handler); return () => undefined; },
      listenExit: async () => () => undefined,
      write: async () => undefined, resize: async () => undefined, close: async () => undefined,
    },
    open: async () => {
      for (const handler of handlers) {
        handler({ pty_id: 'same', data: 'already cached', sequence: 2 });
        handler({ pty_id: 'same', data: 'new output', sequence: 4 });
      }
      return { pty_id: 'same', initial_output: 'cached screen', output_through: 3 };
    },
    onOpen: vi.fn(), onData: data, onExit: vi.fn(),
  });
  expect(data.mock.calls.map((call) => call[0])).toEqual(['cached screen', 'new output']);
  abort.abort();
});
