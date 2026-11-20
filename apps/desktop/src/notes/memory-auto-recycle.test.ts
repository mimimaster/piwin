// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_RECYCLE_COOLDOWN_MS,
  AUTO_RECYCLE_HIDDEN_MS,
  AUTO_RECYCLE_RETRY_MS,
  AUTO_RECYCLE_UNFOCUSED_IDLE_MS,
  installMemoryAutoRecycle,
} from './memory-auto-recycle.js';
import { MEMORY_PRESSURE_CRITICAL_BYTES } from './memory-pressure.js';

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('installMemoryAutoRecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('recycles after 60s hidden when footprint is critical, idle, and no modal is open', () => {
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => false,
      getFootprintBytes: () => MEMORY_PRESSURE_CRITICAL_BYTES + 1,
      isUiBlockingModalOpen: () => false,
      recover,
    });

    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS - 1);
    expect(recover).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(recover).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('cancels scheduled recycle when window becomes visible before timeout', () => {
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => false,
      getFootprintBytes: () => MEMORY_PRESSURE_CRITICAL_BYTES + 1,
      recover,
    });

    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS / 2);
    setVisibility('visible');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).not.toHaveBeenCalled();
    dispose();
  });

  it('skips when run is active, footprint is below critical, or modal is open', () => {
    let runActive = true;
    let footprint = MEMORY_PRESSURE_CRITICAL_BYTES + 1;
    let modalOpen = false;
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => runActive,
      getFootprintBytes: () => footprint,
      isUiBlockingModalOpen: () => modalOpen,
      recover,
    });

    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).not.toHaveBeenCalled();

    runActive = false;
    footprint = MEMORY_PRESSURE_CRITICAL_BYTES - 1;
    setVisibility('visible');
    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).not.toHaveBeenCalled();

    footprint = MEMORY_PRESSURE_CRITICAL_BYTES;
    modalOpen = true;
    setVisibility('visible');
    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).not.toHaveBeenCalled();

    modalOpen = false;
    dispose();
  });

  it('skips auto-recycle when protected renderer surfaces (open PTY/settings/subpage) are active', () => {
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => false,
      getFootprintBytes: () => MEMORY_PRESSURE_CRITICAL_BYTES,
      isUiBlockingModalOpen: () => false,
      isProtectedSurfaceActive: () => true,
      recover,
    });

    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).not.toHaveBeenCalled();
    dispose();
  });

  it('respects cooldown across repeated hidden episodes', () => {
    let now = 1_000_000;
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => false,
      getFootprintBytes: () => MEMORY_PRESSURE_CRITICAL_BYTES,
      isUiBlockingModalOpen: () => false,
      recover,
      now: () => now,
    });

    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    now += 60_000;
    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    now += AUTO_RECYCLE_COOLDOWN_MS;
    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('retries while remaining hidden after an active run finishes', () => {
    let runActive = true;
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => runActive,
      getFootprintBytes: () => MEMORY_PRESSURE_CRITICAL_BYTES,
      isUiBlockingModalOpen: () => false,
      recover,
    });

    setVisibility('hidden');
    vi.advanceTimersByTime(AUTO_RECYCLE_HIDDEN_MS);
    expect(recover).not.toHaveBeenCalled();

    runActive = false;
    vi.advanceTimersByTime(AUTO_RECYCLE_RETRY_MS - 1);
    expect(recover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(recover).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('recycles after unfocused idle on visible macOS windows and resets on focus or input', () => {
    let runActive = false;
    const recover = vi.fn(() => ({ allowed: true, checks: [] }));
    const dispose = installMemoryAutoRecycle({
      isRunActive: () => runActive,
      getFootprintBytes: () => MEMORY_PRESSURE_CRITICAL_BYTES,
      isUiBlockingModalOpen: () => false,
      recover,
    });

    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(AUTO_RECYCLE_UNFOCUSED_IDLE_MS - 1);
    expect(recover).not.toHaveBeenCalled();

    // User focus cancels the scheduled unfocused recycle.
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(AUTO_RECYCLE_UNFOCUSED_IDLE_MS);
    expect(recover).not.toHaveBeenCalled();

    // Input activity while blurred also cancels.
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(AUTO_RECYCLE_UNFOCUSED_IDLE_MS / 2);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(AUTO_RECYCLE_UNFOCUSED_IDLE_MS);
    expect(recover).not.toHaveBeenCalled();

    // Active run skips then retries once run ends while still blurred.
    runActive = true;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(AUTO_RECYCLE_UNFOCUSED_IDLE_MS);
    expect(recover).not.toHaveBeenCalled();

    runActive = false;
    vi.advanceTimersByTime(AUTO_RECYCLE_RETRY_MS);
    expect(recover).toHaveBeenCalledTimes(1);
    dispose();
  });
});
