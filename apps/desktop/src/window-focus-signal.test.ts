// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentWindow = vi.fn();

vi.mock('./tauri-pty.js', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow,
}));

type Signal = typeof import('./window-focus-signal');

async function loadSignal(): Promise<Signal> {
  return import('./window-focus-signal');
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('window-focus-signal', () => {
  beforeEach(() => {
    vi.resetModules();
    getCurrentWindow.mockReset();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers native listeners once across subscribers (AN-T38)', async () => {
    const { subscribeWindowPresence } = await loadSignal();
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');

    const unsubA = subscribeWindowPresence(() => undefined);
    const unsubB = subscribeWindowPresence(() => undefined);

    expect(documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    expect(windowAdd.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1);
    expect(windowAdd.mock.calls.filter(([type]) => type === 'blur')).toHaveLength(1);

    unsubA();
    unsubB();
    const unsubC = subscribeWindowPresence(() => undefined);
    expect(documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    expect(windowAdd.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1);
    unsubC();
  });

  it('emits the same snapshot to every subscriber', async () => {
    const { subscribeWindowPresence } = await loadSignal();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeWindowPresence(a);
    const unsubB = subscribeWindowPresence(b);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ focused: expect.any(Boolean), documentVisible: false });
    expect(b.mock.calls[0]?.[0]).toEqual(a.mock.calls[0]?.[0]);

    unsubA();
    unsubB();
  });

  it('stops notifying a subscriber after unsubscribe', async () => {
    const { subscribeWindowPresence } = await loadSignal();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeWindowPresence(a);
    const unsubB = subscribeWindowPresence(b);
    unsubA();

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledWith({ focused: expect.any(Boolean), documentVisible: false });
    unsubB();
  });

  it('uses document.hasFocus and window focus/blur when not Tauri', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { getWindowPresence, subscribeWindowPresence } = await loadSignal();
    const listener = vi.fn();
    const unsub = subscribeWindowPresence(listener);

    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(getWindowPresence()).toEqual({ focused: true, documentVisible: true });

    window.dispatchEvent(new Event('blur'));
    expect(getWindowPresence()).toEqual({ focused: false, documentVisible: true });
    expect(listener).toHaveBeenCalledWith({ focused: false, documentVisible: true });

    window.dispatchEvent(new Event('focus'));
    expect(getWindowPresence().focused).toBe(true);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getWindowPresence()).toEqual({ focused: true, documentVisible: false });

    unsub();
  });
});
