import { expect, test } from '@playwright/test';

/**
 * Composer drag & drop regression (MED-06).
 *
 * The composer accepts image drops anywhere on the composer card (the drop
 * zone overlay advertises the full card), not just on the tiny textarea.
 * In Tauri this requires `dragDropEnabled: false` (tauri.conf.json) so the
 * webview receives real HTML5 drag events instead of Tauri's native
 * file-drop handler swallowing them.
 *
 * Note: the optimistic chip shows the pending local id (UUID), not the
 * original file name, until the background media/save completes — so the
 * assertions here check the chip + its decoded preview, not the name.
 */

/** Self-contained page-side drop helper (runs inside the webview). */
function dropImagePageScript(selector: string): string {
  return `(async () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error('drop target missing: ' + ${JSON.stringify(selector)});
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true }));
    // Let React flush the drop-active state before observing the overlay.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const overlayShown = document.querySelector('.composer-v2-drop-overlay') !== null;
    target.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
    return overlayShown;
  })()`;
}

test('composer shows the drop zone over the whole card and accepts an image drop', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('composer-input')).toBeEnabled({ timeout: 20_000 });

  // Drop on the CARD container, not the textarea: the full-card drop zone
  // must actually accept the drop (dragenter → dragover → drop on card).
  const overlayShown = await page.evaluate(
    dropImagePageScript('[data-testid="composer-card"]'),
  );
  expect(overlayShown).toBe(true);

  // Optimistic chip paints with a decoded preview from the object URL.
  const chip = page.getByTestId('composer-card').locator('.composer-v2-attachment-chip');
  await expect(chip).toBeVisible({ timeout: 5000 });
  await expect(chip.locator('img')).toBeVisible({ timeout: 5000 });
});

test('composer still accepts a drop directly on the textarea (bubbles to card)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('composer-input')).toBeEnabled({ timeout: 20_000 });

  await page.evaluate(dropImagePageScript('[data-testid="composer-input"]'));

  const chip = page.getByTestId('composer-card').locator('.composer-v2-attachment-chip');
  await expect(chip).toBeVisible({ timeout: 5000 });
  await expect(chip.locator('img')).toBeVisible({ timeout: 5000 });
});
