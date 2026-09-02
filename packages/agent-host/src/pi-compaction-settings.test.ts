import { describe, expect, it, vi } from 'vitest';
import {
  readPiAutoCompactionEnabled,
  setPiAutoCompactionEnabled,
} from './pi-compaction-settings.js';

describe('Pi auto-compaction settings adapter', () => {
  it('uses in-memory SettingsManager overrides instead of the global setter', () => {
    let enabled = true;
    const applyOverrides = vi.fn((overrides: { compaction: { enabled: boolean } }) => {
      enabled = overrides.compaction.enabled;
    });
    const sessionSetter = vi.fn();

    const settingsManager = {
      getCompactionEnabled: () => enabled,
      applyOverrides,
    };
    const session = {
      autoCompactionEnabled: enabled,
      setAutoCompactionEnabled: sessionSetter,
    };

    expect(readPiAutoCompactionEnabled(session, settingsManager)).toBe(true);
    setPiAutoCompactionEnabled(session, settingsManager, false);
    expect(applyOverrides).toHaveBeenCalledWith({ compaction: { enabled: false } });
    expect(sessionSetter).not.toHaveBeenCalled();
    expect(readPiAutoCompactionEnabled(session, settingsManager)).toBe(false);
  });

  it('falls back to the session property and legacy methods', () => {
    expect(
      readPiAutoCompactionEnabled({ autoCompactionEnabled: false }, undefined),
    ).toBe(false);

    let enabled = true;
    const getter = vi.fn(() => enabled);
    const setter = vi.fn((next: boolean) => {
      enabled = next;
    });
    const session = {
      getAutoCompactionEnabled: getter,
      setAutoCompactionEnabled: setter,
    };
    expect(readPiAutoCompactionEnabled(session, undefined)).toBe(true);
    setPiAutoCompactionEnabled(session, undefined, false);
    expect(setter).toHaveBeenCalledWith(false);
    expect(getter).toHaveBeenCalled();
    expect(readPiAutoCompactionEnabled(session, undefined)).toBe(false);
  });

  it('preserves an asynchronous legacy setter result', async () => {
    let enabled = true;
    let resolveSetter: (() => void) | undefined;
    const setter = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSetter = () => {
            enabled = false;
            resolve();
          };
        }),
    );
    const session = {
      getAutoCompactionEnabled: () => enabled,
      setAutoCompactionEnabled: setter,
    };

    const pending = setPiAutoCompactionEnabled(session, undefined, false);
    expect(enabled).toBe(true);
    resolveSetter?.();
    await pending;
    expect(enabled).toBe(false);
  });
});
