import { chromium, expect, test, webkit } from '@playwright/test';

// Tauri adds a nonce to the boot stylesheet and style-src at build time.
// Once a nonce is present, 'unsafe-inline' no longer authorizes style blocks.
const HOST_STYLE_NONCE = 'piwin-e2e-host-style';
const ARTIFACT_SOURCE = [
  '```artifact-html title="Network layers" style="host"',
  '<style nonce="model-style">',
  '.hero { padding:14px 16px; border-radius:12px; }',
  '.hero h1 { margin:0 0 6px; font-size:18px; }',
  '.grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }',
  '@container (max-width:560px) { .grid { grid-template-columns:1fr; } }',
  '.layer { display:grid; grid-template-columns:max-content 1fr; gap:10px; }',
  '.badge { display:inline-flex; border-radius:999px; padding:0 6px; }',
  '</style>',
  '<div class="wrap">',
  '<header class="hero"><h1>OSI and TCP/IP</h1></header>',
  '<div class="grid"><section class="card">',
  '<div class="layer"><span class="badge">7</span><p>Application</p></div>',
  '</section><section class="card">TCP/IP</section></div>',
  '<div class="inline-style" style="display:flex;gap:9px;padding:7px">Inline CSS</div>',
  '<svg viewBox="0 0 20 20"><circle class="svg-style" cx="10" cy="10" r="8" style="fill:rgb(12,34,56)" /></svg>',
  '</div>',
  '```',
].join('\n');

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  test(`${engineName}: completed inline styles survive the packaged nonce CSP`, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 840 } });
      await page.route('**/', async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace(
          '<style id="boot-splash-style">',
          `<style id="boot-splash-style" nonce="${HOST_STYLE_NONCE}">`,
        );
        await route.fulfill({
          response,
          body,
          headers: {
            ...response.headers(),
            'content-security-policy': `style-src 'self' 'unsafe-inline' 'nonce-${HOST_STYLE_NONCE}'`,
          },
        });
      });
      await page.addInitScript((source) => {
        (window as unknown as { __piwinE2eMarkdownSource: string }).__piwinE2eMarkdownSource = source;
      }, ARTIFACT_SOURCE);
      await page.goto('/#/e2e/artifacts?id=markdown-stream&from=100000&chunk=0');
      const frame = page.getByTestId('artifact-frame');
      await expect(frame).toHaveAttribute('data-artifact-renderer', 'static-flow');
      await expect(frame.locator('.grid')).toHaveCSS('display', 'grid');
      await expect(frame.locator('.layer')).toHaveCSS('display', 'grid');
      await expect(frame.locator('.hero h1')).toHaveCSS('margin', '0px 0px 6px');
      await expect(frame.locator('.badge')).toHaveCSS('border-radius', '999px');
      await expect(frame.locator('.inline-style')).toHaveCSS('display', 'flex');
      await expect(frame.locator('.inline-style')).toHaveCSS('gap', '9px');
      await expect(frame.locator('.svg-style')).toHaveCSS('fill', 'rgb(12, 34, 56)');
      await expect(frame.locator('iframe')).toHaveCount(0);
      const nonces = await frame.getByTestId('artifact-static').evaluate((host) =>
        [...(host.shadowRoot?.querySelectorAll('style') ?? [])].map((style) => style.nonce),
      );
      expect(nonces).toEqual([HOST_STYLE_NONCE, HOST_STYLE_NONCE]);

      // Container queries must still respond to the conversation column.
      await page.setViewportSize({ width: 480, height: 840 });
      await expect.poll(async () => frame.locator('.grid').evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      )).toBe(1);
    } finally {
      await browser.close();
    }
  });
}
