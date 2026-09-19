/**
 * `ensureSettingsLazyLoaded()` shares an in-flight load but must not share a
 * failed one. Caching the rejection is what made the settings shell
 * unrecoverable (see settings-shell-lazy-load-error.test.tsx).
 *
 * Lives in its own file because mocking the lazy barrel replaces the module
 * that `settings-lazy-load.test.ts` deliberately exercises for real.
 */
import { describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({ attempts: 0 }));

vi.mock('./pages/lazy-load.js', () => {
  loader.attempts += 1;
  if (loader.attempts === 1) {
    throw new Error('chunk load failed');
  }
  return {};
});

describe('ensureSettingsLazyLoaded retry', () => {
  it('shares one in-flight load and retries after a failure', async () => {
    const { ensureSettingsLazyLoaded } = await import('./settings-lazy-load.js');

    const first = ensureSettingsLazyLoaded();
    const concurrent = ensureSettingsLazyLoaded();
    await expect(first).rejects.toThrow();
    await expect(concurrent).rejects.toThrow();
    // One attempt served both callers: the in-flight promise is still shared.
    expect(loader.attempts).toBe(1);

    // The rejected promise was not cached, so this call re-imports.
    await expect(ensureSettingsLazyLoaded()).resolves.toBeUndefined();
    expect(loader.attempts).toBe(2);
  });
});
