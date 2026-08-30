import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

test.describe('context usage ring', () => {
  test('empty shell and typed-not-sent hide the ring', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('context-usage-ring')).toHaveCount(0);

    await page.getByTestId('composer-input').fill('typed but not sent');
    await expect(page.getByTestId('context-usage-ring')).toHaveCount(0);
  });

  test('mock assistant reply shows the ring; New hides it again', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    const prompt = 'hello context usage e2e';
    await page.getByTestId('composer-input').fill(prompt);
    await page.getByTestId('send-btn').click();

    await expect(
      page.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: prompt }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="message-bubble"][data-role="assistant"]')).toBeVisible();
    await expect(page.getByTestId('context-usage-ring')).toBeVisible();

    await page.getByTestId('context-usage-ring').click();
    const popover = page.getByTestId('context-usage-popover');
    await expect(popover).toBeVisible();
    await expect(popover).not.toContainText(/expires in|Cache estimate|Higher cost|Prompt cache/i);
    await expect(popover).not.toContainText('~');
    await expect(popover).not.toContainText(/System prompt|Tool definitions/i);

    await page.keyboard.press('Escape');
    await page.getByTestId('new-session-btn').click();
    await expect(page.getByTestId('context-usage-ring')).toHaveCount(0);
  });
});
