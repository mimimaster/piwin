import { describe, expect, it, vi } from 'vitest';
import { FetchRenderUnavailableError, renderPageHtml } from './render-page.js';
import type { Browser } from 'playwright-core';

function fakeBrowser(html: string, finalUrl: string): Browser {
  return {
    newContext: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        content: async () => html,
        url: () => finalUrl,
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
    close: vi.fn(async () => undefined),
  } as unknown as Browser;
}

describe('renderPageHtml', () => {
  it('navigates a throwaway browser and returns the DOM', async () => {
    const closed = vi.fn(async () => undefined);
    const browser = fakeBrowser('<html><body>hydrated</body></html>', 'https://example.com/app');
    (browser as unknown as { close: typeof closed }).close = closed;

    const result = await renderPageHtml(
      { url: 'https://example.com/app', timeoutMs: 5_000 },
      { launch: async () => browser },
    );

    expect(result.finalUrl).toBe('https://example.com/app');
    expect(result.html).toContain('hydrated');
    expect(closed).toHaveBeenCalledOnce();
  });

  it('maps a launch failure to an install hint', async () => {
    await expect(
      renderPageHtml(
        { url: 'https://example.com/app', timeoutMs: 1_000 },
        {
          launch: async () => {
            throw new Error('Executable does not exist');
          },
        },
      ),
    ).rejects.toBeInstanceOf(FetchRenderUnavailableError);
  });

  it('does not launch when the caller already aborted', async () => {
    const launch = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderPageHtml(
        { url: 'https://example.com/app', timeoutMs: 1_000, signal: controller.signal },
        { launch },
      ),
    ).rejects.toThrow(/aborted/);
    expect(launch).not.toHaveBeenCalled();
  });
});
