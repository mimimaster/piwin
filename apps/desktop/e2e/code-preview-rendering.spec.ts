import { expect, test } from '@playwright/test';

test('large files color visible lines, preserve multiline context, and keep all source selectable', async ({
  page,
}) => {
  await page.goto('/#/e2e/artifacts?id=code-preview');
  const preview = page.getByTestId('code-preview-view');
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-line="1"] .code-preview-text [style]').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(preview.locator('.code-preview-row')).toHaveCount(2000);
  expect(await preview.locator('.code-preview-text [style]').count()).toBeLessThan(2000);

  const comment = preview.locator('[data-line="81"] .code-preview-text');
  await comment.scrollIntoViewIfNeeded();
  await expect(comment.locator('[style]').first()).toBeVisible();
  const color = await comment
    .locator('[style]')
    .first()
    .evaluate((node) => (node as HTMLElement).style.color);
  expect(color).not.toBe('');
  await expect(preview.locator('[data-line="80"] .code-preview-text [style]').first()).toHaveCSS(
    'color',
    color,
  );

  const last = preview.locator('[data-line="2000"]');
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('.code-preview-text [style]').first()).toBeVisible();
  await expect(last).toContainText('value1999');
  expect(await preview.locator('.code-preview-text [style]').count()).toBeLessThan(2000);
  const selected = await preview.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });
  expect(selected).toContain('value0');
  expect(selected).toContain('value1999');
});
