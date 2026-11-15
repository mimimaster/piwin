// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopMemoryObservabilitySnapshot,
  DesktopMemoryPressureSample,
} from '@piwin/contracts';

type NativePressureListener = (event: { payload: DesktopMemoryPressureSample }) => void;

const native = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  listener: undefined as NativePressureListener | undefined,
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('./reclaim-wiring.js', () => ({
  globalReclaimCoordinator: { onPressureSample: vi.fn() },
}));

const MIB = 1024 * 1024;
let removeDomListeners: () => void;

beforeEach(() => {
  vi.resetModules();
  native.listener = undefined;
  native.listen.mockReset();
  native.invoke.mockReset();
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: { invoke: native.invoke },
  });
  const domListeners = vi.spyOn(window, 'addEventListener');
  removeDomListeners = () => {
    for (const [event, listener] of domListeners.mock.calls) {
      if (event === 'desktop:memory-pressure') window.removeEventListener(event, listener);
    }
  };
  native.listen.mockImplementation(async (_event: string, listener: NativePressureListener) => {
    native.listener = listener;
    return () => {
      native.listener = undefined;
    };
  });
});

afterEach(async () => {
  // ACKs deliberately start before governor work and are not awaited by it.
  // Let their imports finish before resetting modules for the next case.
  await vi.dynamicImportSettled();
  removeDomListeners();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  delete document.documentElement.dataset.memoryPressure;
  vi.restoreAllMocks();
});

function snapshot(
  samples: DesktopMemoryPressureSample[],
  pendingSampleId?: number,
): DesktopMemoryObservabilitySnapshot {
  return {
    samples,
    purgeResults: [],
    stalledTicks: 12,
    ...(pendingSampleId === undefined ? {} : { pendingSampleId }),
  };
}

async function installBridge() {
  const pressure = await import('./memory-pressure.js');
  pressure.installMemoryPressureBridge();
  await vi.waitFor(() => expect(native.listener).toBeDefined());
  return pressure;
}

describe('native memory-pressure bridge startup', () => {
  it('recovers a first sample lost before the listener existed and resumes gated delivery', async () => {
    // Native setup emitted sample 1 with no listener. Its successful emit left
    // the ACK gate occupied, so no later live sample can arrive until recovered.
    let pendingSampleId: number | undefined = 1;
    native.invoke.mockImplementation(async (command: string, args?: { sampleId: number }) => {
      if (command === 'memory_observability_snapshot') {
        expect(native.listener).toBeDefined();
        return snapshot([{ sampleId: 1, bytes: 2000 * MIB }], pendingSampleId);
      }
      if (command === 'ack_memory_sample' && args?.sampleId === pendingSampleId) {
        pendingSampleId = undefined;
        return true;
      }
      return false;
    });

    const pressure = await installBridge();
    await vi.waitFor(() => expect(pendingSampleId).toBeUndefined(), { timeout: 250 });
    expect(pressure.getLastMemoryPressureBytes()).toBe(2000 * MIB);
    const { globalMemoryGovernor } = await import('./memory-governor.js');
    expect(globalMemoryGovernor.getLevel()).toBe('critical');

    pendingSampleId = 2;
    native.listener?.({ payload: { sampleId: 2, bytes: 2100 * MIB } });
    await vi.waitFor(() => expect(pendingSampleId).toBeUndefined());
    expect(pressure.getLastMemoryPressureBytes()).toBe(2100 * MIB);
  });

  it('acknowledges a startup sample even before its payload enters the retained ring', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      return command === 'memory_observability_snapshot' ? snapshot([], 1) : true;
    });
    const pressure = await installBridge();
    await vi.waitFor(() => {
      expect(native.invoke).toHaveBeenCalledWith('ack_memory_sample', { sampleId: 1 }, undefined);
    }, { timeout: 250 });
    expect(pressure.getLastMemoryPressureBytes()).toBeNull();

    native.listener?.({ payload: { sampleId: 2, bytes: 2200 * MIB } });
    expect(pressure.getLastMemoryPressureBytes()).toBe(2200 * MIB);
  });

  it('does not reapply a stale snapshot or duplicate event after a newer live sample', async () => {
    let resolveSnapshot: (value: DesktopMemoryObservabilitySnapshot) => void = () => {
      throw new Error('Snapshot resolver not initialized');
    };
    const pendingSnapshot = new Promise<DesktopMemoryObservabilitySnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    native.invoke.mockImplementation(async (command: string) => {
      return command === 'memory_observability_snapshot' ? pendingSnapshot : true;
    });
    const pressure = await installBridge();
    native.listener?.({ payload: { sampleId: 2, bytes: 2200 * MIB } });
    resolveSnapshot(snapshot([{ sampleId: 1, bytes: 100 * MIB }], 1));
    await vi.waitFor(() => {
      expect(native.invoke).toHaveBeenCalledWith('ack_memory_sample', { sampleId: 1 }, undefined);
    }, { timeout: 250 });
    expect(pressure.getLastMemoryPressureBytes()).toBe(2200 * MIB);

    native.listener?.({ payload: { sampleId: 2, bytes: 100 * MIB } });
    expect(pressure.getLastMemoryPressureBytes()).toBe(2200 * MIB);
    // Duplicate delivery still receives an ACK so it cannot hold native flow.
    await vi.waitFor(() => {
      expect(native.invoke.mock.calls.filter(([command, args]) =>
        command === 'ack_memory_sample' && args?.sampleId === 2,
      )).toHaveLength(2);
    });
  });

  it('keeps the live bridge usable if the native snapshot is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'memory_observability_snapshot') throw new Error('snapshot unavailable');
      return true;
    });
    const pressure = await installBridge();
    native.listener?.({ payload: { sampleId: 3, bytes: 2300 * MIB } });
    expect(pressure.getLastMemoryPressureBytes()).toBe(2300 * MIB);
    await vi.waitFor(() => {
      expect(native.invoke).toHaveBeenCalledWith('ack_memory_sample', { sampleId: 3 }, undefined);
    });
  });

  it('continues to apply legacy live events without a sample ID', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      return command === 'memory_observability_snapshot' ? snapshot([]) : true;
    });
    const pressure = await installBridge();
    native.listener?.({ payload: { bytes: 2400 * MIB } });
    expect(pressure.getLastMemoryPressureBytes()).toBe(2400 * MIB);
    expect(native.invoke.mock.calls.some(([command]) => command === 'ack_memory_sample')).toBe(false);
  });

  it('applies the newest retained sample even when no ACK is pending', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      return command === 'memory_observability_snapshot'
        ? snapshot([{ sampleId: 5, bytes: 100 * MIB }, { sampleId: 6, bytes: 2500 * MIB }])
        : true;
    });
    const pressure = await installBridge();
    await vi.waitFor(() => expect(pressure.getLastMemoryPressureBytes()).toBe(2500 * MIB));
  });

  it('does not start native observation in a browser-only shell', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const pressure = await import('./memory-pressure.js');
    pressure.installMemoryPressureBridge();
    await vi.dynamicImportSettled();
    expect(native.listen).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
