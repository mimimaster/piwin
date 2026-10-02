import { expect, test } from '@playwright/test';

// Browser mock Host only; never changes the operator's live permissions.
test('permission cards expose an independent true-YOLO toggle and no feature pills', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await page.getByTestId('settings-open-shelf-btn').click();
  await page.getByTestId('settings-nav-permissions').click();
  const checkbox = page.getByTestId('settings-permission-true-yolo');
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.mode-card-feature-pill')).toHaveCount(0);
  await expect(page.locator('button').filter({ has: checkbox })).toHaveCount(0);
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId('settings-permission-mode-yolo')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.mode-yolo .mode-card-desc')).toContainText('跳过所有工具权限规则与确认');
  // Re-mounting the settings page retains the saved mock Host setting.
  await page.getByTestId('settings-nav-general').click();
  await page.getByTestId('settings-nav-permissions').click();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.mode-yolo .mode-card-desc')).toContainText('拒绝规则仍强制生效');
  await checkbox.check();
  await page.getByTestId('settings-permission-mode-auto').click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByTestId('settings-permission-mode-auto')).toHaveAttribute('aria-checked', 'true');
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(checkbox).toBeVisible();
  const card = page.locator('.permission-mode-card.mode-yolo');
  const cardBounds = await card.boundingBox();
  const checkBounds = await checkbox.boundingBox();
  if (!cardBounds || !checkBounds) throw new Error('permission card/toggle bounds missing');
  expect(checkBounds.x).toBeGreaterThanOrEqual(cardBounds.x);
  expect(checkBounds.x + checkBounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width);
});
