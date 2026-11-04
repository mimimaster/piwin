// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRendererSelfHeal, SELF_HEAL_PRESSURE_COOLDOWN_MS } from './renderer-self-heal.js';

const { getBytes, invoke } = vi.hoisted(() => ({ getBytes: vi.fn(), invoke: vi.fn() }));
vi.mock('../notes/memory-pressure.js', () => ({
  getLastMemoryPressureBytes: getBytes,
  MEMORY_PRESSURE_CRITICAL_BYTES: 1536 * 1024 * 1024,
}));
vi.mock('./window-focus-signal', () => ({
  getWindowPresence: () => ({ focused: true, documentVisible: true }),
  subscribeWindowPresence: () => () => undefined,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('native renderer budget bridge', () => {
  let dispose: (() => void) | undefined;
  const activity = { runActive: true, protectedWork: false };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    window.sessionStorage.clear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    getBytes.mockReturnValue(2 * 1024 * 1024 * 1024);
    invoke.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.useRealTimers();
  });
  const pressure = (): void => {
    window.dispatchEvent(new Event('desktop:memory-pressure'));
  };

  it('checks each native pressure sample without waiting for the background timer', async () => {
    dispose = installRendererSelfHeal(() => activity);
    pressure();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('relaunch_webview_renderer'));
    dispose();
    dispose = undefined;
    await vi.advanceTimersByTimeAsync(SELF_HEAL_PRESSURE_COOLDOWN_MS);
    pressure();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('preserves the cooldown across a renderer controller replacement', async () => {
    dispose = installRendererSelfHeal(() => activity);
    pressure();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    dispose();
    dispose = installRendererSelfHeal(() => activity);
    pressure();
    expect(invoke).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SELF_HEAL_PRESSURE_COOLDOWN_MS);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it('waits for local work to clear, then reclaims on the next sample', async () => {
    let protectedWork = true;
    dispose = installRendererSelfHeal(() => ({ ...activity, protectedWork }));
    pressure();
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    protectedWork = false;
    pressure();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  });
});
