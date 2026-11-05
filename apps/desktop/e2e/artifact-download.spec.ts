import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('a sandboxed canvas exports PNG bytes through the shell Save As flow', async ({ page }) => {
  await page.goto('/#/e2e/artifacts?id=script-fragment');
  const iframe = page.locator('iframe.artifact-iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.getByTestId('artifact-frame')).toHaveAttribute(
    'data-artifact-height-status',
    'ready',
  );

  // Exercise the production saver from a real opaque-origin iframe. The
  // frame bridge's source/channel/seq handling is covered by its unit suite.
  await page.evaluate(async () => {
    const modulePath = '/src/artifact/artifact-download.ts';
    const saver: {
      saveArtifactDownload: (payload: { filename?: string; dataUrl: string }) => Promise<unknown>;
    } = await import(modulePath);
    Reflect.deleteProperty(window, 'showSaveFilePicker');
    const frame = document.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame?.contentWindow ||
        typeof event.data !== 'object' ||
        event.data === null
      )
        return;
      const data = event.data as {
        action?: string;
        payload?: { filename?: string; dataUrl: string };
      };
      if (data.action === 'artifact/download' && data.payload)
        void saver.saveArtifactDownload(data.payload);
    });
  });

  const frame = iframe.contentFrame();
  await frame.locator('body').evaluate((body) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.fillStyle = '#ff653d';
    context.fillRect(0, 0, 64, 64);
    for (const kind of ['data', 'blob']) {
      const button = document.createElement('button');
      button.textContent = `Download ${kind}`;
      button.onclick = () => {
        const save = (href: string) => {
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.download = `cat-${kind}.png`;
          anchor.click();
          if (kind === 'blob') URL.revokeObjectURL(href);
        };
        if (kind === 'data') save(canvas.toDataURL('image/png'));
        else
          canvas.toBlob((blob) => {
            if (blob) save(URL.createObjectURL(blob));
          }, 'image/png');
      };
      body.appendChild(button);
    }
  });

  for (const kind of ['data', 'blob']) {
    const downloadReady = page.waitForEvent('download');
    await frame.getByRole('button', { name: `Download ${kind}`, exact: true }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe(`cat-${kind}.png`);
    const path = await download.path();
    if (!path) throw new Error('download file missing');
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(64);
    expect(bytes.readUInt32BE(20)).toBe(64);
  }
});
