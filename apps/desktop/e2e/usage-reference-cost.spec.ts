import { expect, test } from '@playwright/test';

test('usage statistics integrates reference USD cost into the existing page', async ({ page }) => {
  await page.goto('/');
  const local = page.getByTestId('host-gate-choose-sidecar');
  if (await local.isVisible()) await local.click();
  await expect(page.getByTestId('settings-open-shelf-btn')).toBeVisible();
  await page.getByTestId('settings-open-shelf-btn').click();
  await page.getByTestId('settings-nav-usage').click();

  // Cost is the first of four peer summary cards; no full-width cost panel.
  const card = page.getByTestId('usage-cost-card');
  await expect(card).toBeVisible();
  await expect(page.locator('.usage-summary-card')).toHaveCount(4);
  await expect(page.locator('.usage-summary-card').first()).toHaveAttribute('data-testid', 'usage-cost-card');
  await expect(page.getByTestId('usage-cost-total')).toHaveText('$0.38');
  await expect(page.getByTestId('usage-cost-details')).toHaveCount(0);
  await expect(page.getByTestId('usage-panel')).not.toContainText('mock/gpt-5.2-codex');

  // Pricing notes: keyboard-reachable popover with exact amount and basis.
  await page.getByTestId('usage-cost-notes-trigger').focus();
  await page.keyboard.press('Enter');
  const notes = page.getByTestId('usage-cost-notes');
  await expect(notes.getByTestId('usage-cost-exact')).toHaveText(/\$0\.384[01]/);
  await expect(notes.getByTestId('usage-cost-coverage')).toContainText('66 / 66');
  await expect(notes.getByTestId('usage-cost-source')).toContainText('models.dev');
  await page.keyboard.press('Escape');
  await expect(notes).toHaveCount(0);

  // Breakdown is opt-in.
  const toggle = page.getByTestId('usage-cost-details-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('usage-cost-model-row')).toHaveCount(3);
  await expect(page.getByTestId('usage-cost-details')).toContainText('openai-work');
  await toggle.click();
  await expect(page.getByTestId('usage-cost-details')).toHaveCount(0);

  await expect(page.getByTestId('usage-call-row')).toHaveCount(100);
  await expect(page.getByTestId('usage-call-cost').first()).toHaveText('$0.0295');
  await page.getByTestId('usage-calls-next').click();
  await expect(page.getByTestId('usage-call-row')).toHaveCount(37);
  await expect(page.getByTestId('usage-call-cost').first()).toHaveText(/\$/);
  await page.getByTestId('usage-calls-prev').click();
  await expect(page.getByTestId('usage-call-row')).toHaveCount(100);
  await expect(page.getByTestId('usage-call-cost').first()).toHaveText('$0.0295');

  await page.getByTestId('usage-time-select').selectOption('all');
  await page.getByTestId('usage-refresh-button').click();
  await expect(page.getByTestId('usage-cost-total')).toHaveText('$0.38');
});
