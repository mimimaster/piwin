import { afterEach, describe, expect, it, vi } from 'vitest';
import { logRollbackFailure } from './rollback-cleanup.js';

describe('logRollbackFailure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs the failed step without rethrowing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      Promise.reject(new Error('disk full')).catch(
        logRollbackFailure('delete-index', 'session s-1'),
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"delete-index" failed for session s-1'),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });
});
