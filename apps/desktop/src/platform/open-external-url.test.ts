// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from './open-external-url.js';

describe('openExternalUrl', () => {
  it('ignores non-http URLs', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(openExternalUrl('javascript:alert(1)')).resolves.toBe(false);
    await expect(openExternalUrl('/relative')).resolves.toBe(false);
    await expect(openExternalUrl('')).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('opens http(s) in the browser runtime', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await expect(openExternalUrl('https://claude.ai/oauth')).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('https://claude.ai/oauth', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
