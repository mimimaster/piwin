import { describe, expect, it, vi } from 'vitest';
import { createPiwinSettingsManager } from './pi-settings-manager.js';

type RetrySettings = {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
};

type SettingsManagerLike = {
  getRetryEnabled: () => boolean;
  getRetrySettings: () => RetrySettings;
  getProviderRetrySettings: () => { maxRetries?: number; timeoutMs?: number };
  getTheme: () => string;
};

describe('createPiwinSettingsManager', () => {
  it('preserves native settings while disabling implicit provider retries', () => {
    const nativeManager: SettingsManagerLike = {
      getRetryEnabled: vi.fn(() => true),
      getRetrySettings: vi.fn(() => ({
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 2000,
      })),
      getProviderRetrySettings: vi.fn(() => ({ maxRetries: 2, timeoutMs: 5000 })),
      getTheme: vi.fn(() => 'dark'),
    };
    const create = vi.fn(() => nativeManager);

    const manager = createPiwinSettingsManager(
      { SettingsManager: { create } },
      '/tmp/project',
      '/tmp/agent',
    ) as SettingsManagerLike;

    expect(create).toHaveBeenCalledWith('/tmp/project', '/tmp/agent');
    expect(manager.getRetryEnabled()).toBe(false);
    expect(manager.getRetrySettings()).toEqual({
      enabled: false,
      maxRetries: 0,
      baseDelayMs: 2000,
    });
    expect(manager.getProviderRetrySettings()).toEqual({ maxRetries: 0, timeoutMs: 5000 });
    expect(manager.getTheme()).toBe('dark');
  });
});
