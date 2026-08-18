// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalMemoryGovernor } from './memory-governor';
import {
  PARK_AFTER_HIDDEN_MS,
  installMemoryParking,
  isMemoryParked,
  resetMemoryParking,
  uninstallMemoryParking,
} from './memory-parking';
import * as memoryPressure from './memory-pressure';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('memory parking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
    globalMemoryGovernor.reset();
    resetMemoryParking();
    uninstallMemoryParking();
    vi.spyOn(memoryPressure, 'requestNativeWebviewMemoryPurge').mockResolvedValue(undefined);
  });

  afterEach(() => {
    uninstallMemoryParking();
    globalMemoryGovernor.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not park after a short hide (cmd-tab)', () => {
    installMemoryParking();
    setVisibility('hidden');
    vi.advanceTimersByTime(1_000);
    expect(isMemoryParked()).toBe(false);
    expect(document.documentElement.hasAttribute('data-memory-parked')).toBe(false);
    expect(memoryPressure.requestNativeWebviewMemoryPurge).not.toHaveBeenCalled();
  });

  it('parks after the window stays hidden for two minutes', () => {
    installMemoryParking();
    setVisibility('hidden');
    vi.advanceTimersByTime(PARK_AFTER_HIDDEN_MS);
    expect(isMemoryParked()).toBe(true);
    expect(document.documentElement.hasAttribute('data-memory-parked')).toBe(true);
    expect(memoryPressure.requestNativeWebviewMemoryPurge).toHaveBeenCalledOnce();
  });

  it('clears the parked attribute and the timer on the visible turn', () => {
    installMemoryParking();
    setVisibility('hidden');
    vi.advanceTimersByTime(PARK_AFTER_HIDDEN_MS);
    expect(isMemoryParked()).toBe(true);

    setVisibility('visible');
    expect(isMemoryParked()).toBe(false);
    expect(document.documentElement.hasAttribute('data-memory-parked')).toBe(false);

    setVisibility('hidden');
    vi.advanceTimersByTime(PARK_AFTER_HIDDEN_MS - 1);
    expect(isMemoryParked()).toBe(false);
  });

  it('leaves data-memory-pressure in place across park and wake', () => {
    globalMemoryGovernor.setLevel('moderate');
    expect(document.documentElement.dataset.memoryPressure).toBe('moderate');

    installMemoryParking();
    setVisibility('hidden');
    vi.advanceTimersByTime(PARK_AFTER_HIDDEN_MS);
    expect(document.documentElement.hasAttribute('data-memory-parked')).toBe(true);
    expect(document.documentElement.dataset.memoryPressure).toBe('moderate');
    expect(globalMemoryGovernor.getLevel()).toBe('moderate');

    setVisibility('visible');
    expect(document.documentElement.hasAttribute('data-memory-parked')).toBe(false);
    expect(document.documentElement.dataset.memoryPressure).toBe('moderate');
    expect(globalMemoryGovernor.getLevel()).toBe('moderate');
  });
});
