import { expect, test } from '@playwright/test';

test('classic phone and tablet respect the visible height and side insets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const root = page.locator('.inkstone-root');
  const phone = root.locator('.phone').first();
  await expect(phone).toBeVisible();
  await root.evaluate((element) => {
    element.style.setProperty('--mobile-safe-left', '30px');
    element.style.setProperty('--mobile-safe-right', '50px');
  });
  await page.evaluate(() => document.documentElement.style.setProperty('--mobile-visible-height', '500px'));
  let box = await phone.boundingBox();
  expect(box?.x).toBe(30);
  expect(box?.width).toBe(310);
  expect(box?.height).toBe(500);

  await page.setViewportSize({ width: 1100, height: 768 });
  const tablet = page.locator('.tablet-shell');
  await expect(tablet).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty('--mobile-visible-height', '500px'));
  box = await tablet.boundingBox();
  expect(box?.x).toBe(30);
  expect(box?.width).toBe(1020);
  expect(box?.height).toBe(500);
  const paneHeights = await tablet.locator(':scope > .phone').evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  );
  expect(paneHeights).toEqual([500, 500]);
});
