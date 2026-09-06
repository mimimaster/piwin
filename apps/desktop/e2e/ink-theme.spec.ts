import { expect, test } from '@playwright/test';

/**
 * Token-only visual gate for the bundled ink-wash manifest.
 * This fixture intentionally exercises the existing primitive gallery only;
 * bitmap assets and execution surfaces are not part of Phase 1.
 */
test('token-only ink-wash theme preview @1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto('/#/e2e/primitives');
  await expect(page.getByTestId('primitive-gallery')).toBeVisible();

  await page.getByTestId('gallery-theme-ink-wash').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-ink-wash');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
  await expect(page.getByTestId('primitive-gallery')).toHaveScreenshot(
    'primitive-gallery-ink-wash-1280.png',
    {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    },
  );
});

test('ink-wash empty canvas loads optional art and keeps execution surfaces image-free @1280', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await page.getByTestId('settings-open-btn').click();
  await page.getByTestId('settings-nav-appearance').click();
  await page.getByTestId('theme-library-select').selectOption('piwin-ink-wash');

  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-ink-wash');
  await page.getByTestId('settings-back-button').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  await expect(page.getByTestId('ink-wash-empty-session')).toBeVisible();
  await expect(
    page.locator(
      '[data-testid="run-activity-slot"] img, [data-testid="tool-call-card"] img, [data-testid="permission-bar"] img, pre img, code img',
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId('app-shell')).toHaveScreenshot('ink-empty-shell-1280.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  });
});
