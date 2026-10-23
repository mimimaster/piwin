import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopLiveCapabilities } from './live-capabilities.js';
import { isIosTauriRuntime } from '../tool-cards/shell-runtime.js';

vi.mock('../tool-cards/shell-runtime.js', () => ({ isIosTauriRuntime: vi.fn(() => false) }));
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(isIosTauriRuntime).mockReturnValue(false); });

describe('Live microphone capabilities', () => {
  it('advertises the native iOS microphone when WebKit capture is unavailable', () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    vi.mocked(isIosTauriRuntime).mockReturnValue(true);
    expect(desktopLiveCapabilities().microphone).toBe(true);
  });

  it('does not advertise browser capture without getUserMedia', () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    expect(desktopLiveCapabilities().microphone).toBe(false);
  });
});
