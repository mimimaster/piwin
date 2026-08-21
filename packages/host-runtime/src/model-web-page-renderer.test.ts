import { describe, expect, it, vi } from 'vitest';
import { buildWebPageRenderer } from './model-web-page-renderer.js';

describe('buildWebPageRenderer', () => {
  it('forwards renderHtml to the isolated render function', async () => {
    const render = vi.fn(async () => ({
      finalUrl: 'https://example.com/app',
      html: '<html><body>ok</body></html>',
    }));
    const renderer = buildWebPageRenderer({ render });
    const result = await renderer.renderHtml({
      url: 'https://example.com/app',
      timeoutMs: 1_000,
    });
    expect(render).toHaveBeenCalledOnce();
    expect(result.html).toContain('ok');
  });
});
