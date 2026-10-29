import { expect, test, type Page } from '@playwright/test';

/**
 * Phone composer cleanup: no run-mode or orchestration pill in the composer;
 * run mode lives in the titleband ⋯ menu, per conversation, default "follow
 * Host". Desktop keeps both pills.
 */
const SHOT_DIR = process.env.PIWIN_SHOT_DIR;

async function openPhoneShell(page: Page): Promise<void> {
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible().catch(() => false)) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'phone');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-top', '59px');
    document.documentElement.style.setProperty('--app-safe-bottom', '34px');
  });
}

/** Run mode applies to project sessions; the default mock lands in Chat. */
async function openProject(page: Page): Promise<void> {
  const jsClick = (testId: string) =>
    page.evaluate((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click(), testId);
  await jsClick('sidebar-mode-code');
  await expect(page.getByTestId('open-workspace-btn')).toHaveCount(1);
  await jsClick('open-workspace-btn');
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await jsClick('open-project-btn');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await page.keyboard.press('Escape');
}

test('phone composer has no run-mode / orchestration pill; ⋯ menu owns run mode', async ({ page }) => {
  await openPhoneShell(page);
  await openProject(page);
  await page.getByTestId('composer-input').fill('hello phone');
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('response-copy-btn').first()).toBeVisible();

  await expect(page.getByTestId('run-mode-trigger')).toHaveCount(0);
  await expect(page.getByTestId('orchestration-scheme-trigger')).toHaveCount(0);
  await expect(page.getByTestId('thinking-effort-trigger')).toBeVisible();
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/composer-phone-clean.png` });

  await page.getByTestId('phone-session-menu-btn').click();
  await expect(page.getByTestId('phone-session-menu')).toBeVisible();
  await expect(page.getByTestId('phone-run-mode-host')).toHaveAttribute('aria-checked', 'true');
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/session-menu-phone.png` });

  await page.getByTestId('phone-run-mode-ask').click();
  await expect(page.getByTestId('phone-session-menu')).toHaveCount(0);
  await page.getByTestId('phone-session-menu-btn').click();
  await expect(page.getByTestId('phone-run-mode-ask')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('phone-run-mode-host').click();
  await page.getByTestId('phone-session-menu-btn').click();
  await expect(page.getByTestId('phone-run-mode-host')).toHaveAttribute('aria-checked', 'true');
});

test('desktop width keeps the run-mode pill and has no ⋯ session menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible().catch(() => false)) await chooseSidecar.click();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await openProject(page);
  await page.getByTestId('composer-input').fill('hello desktop');
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('response-copy-btn').first()).toBeVisible();
  await expect(page.getByTestId('run-mode-trigger')).toBeVisible();
  await expect(page.getByTestId('phone-session-menu-btn')).toHaveCount(0);
});
