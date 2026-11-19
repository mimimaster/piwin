// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_RECYCLE_COOLDOWN_MS,
  AUTO_RECYCLE_HIDDEN_MS,
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
});
