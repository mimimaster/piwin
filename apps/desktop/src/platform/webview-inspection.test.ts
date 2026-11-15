import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
import { requestWebviewInspection } from './webview-inspection.js';

beforeEach(() => {
  native.invoke.mockReset();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('native page inspection', () => {
  it('queries status without opting in', async () => {
    native.invoke.mockResolvedValue({ supported: true, enabled: false });
    expect(await requestWebviewInspection()).toEqual({ supported: true, enabled: false });
    expect(native.invoke).toHaveBeenCalledWith('webview_inspection', {});
  });

  it('passes explicit opt-in and opt-out independently of task state', async () => {
    native.invoke.mockResolvedValueOnce({ supported: true, enabled: true })
      .mockResolvedValueOnce({ supported: true, enabled: false });
    expect((await requestWebviewInspection(true)).enabled).toBe(true);
    expect((await requestWebviewInspection(false)).enabled).toBe(false);
    expect(native.invoke).toHaveBeenNthCalledWith(1, 'webview_inspection', { enabled: true });
    expect(native.invoke).toHaveBeenNthCalledWith(2, 'webview_inspection', { enabled: false });
  });

  it('stays unavailable in the browser without invoking native commands', async () => {
    vi.stubGlobal('window', {});
    expect(await requestWebviewInspection(true)).toEqual({ supported: false, enabled: false });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('rejects invalid or failed responses instead of reporting inspection enabled', async () => {
    native.invoke.mockResolvedValueOnce({ supported: true, enabled: 'true' })
      .mockRejectedValueOnce(new Error('view closed'));
    await expect(requestWebviewInspection(true)).rejects.toThrow('invalid native response');
    await expect(requestWebviewInspection(true)).rejects.toThrow('view closed');
  });
});
