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
  await expect(page.getByTestId('usage-request-count')).toHaveText('66');
  // The card has no buttons of its own; 费用构成 is a section of the page.
  await expect(card.locator('button')).toHaveCount(0);
  const section = page.getByTestId('usage-cost-section');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('usage-panel')).not.toContainText('mock/gpt-5.2-codex');

  // Daily trend spans the 30-day window; hover changes only the readout.
  await expect(section.getByTestId('usage-cost-trend-bar')).toHaveCount(31);
  const readout = section.getByTestId('usage-cost-trend-readout');
  await expect(readout).toContainText('峰值');
  await section.getByTestId('usage-cost-trend-bar').last().hover();
  await expect(readout).toContainText('次请求');

  // By model: gpt-5.2-codex merges two Keys and expands in place.
  const rows = section.getByTestId('usage-cost-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('2 个 Key');
  await rows.first().getByRole('button', { name: /展开/ }).click();
  await expect(section.getByTestId('usage-cost-child-row')).toHaveCount(2);
  await expect(section.getByTestId('usage-cost-child-row').first()).toContainText('openai-work');

  // By Key: three rows, no children.
  await section.getByTestId('usage-cost-grouping').getByText('按 Key').click();
  await expect(rows).toHaveCount(3);
  await expect(section.getByTestId('usage-cost-child-row')).toHaveCount(0);

  // Pricing basis sits under the table.
  await expect(section.getByTestId('usage-cost-exact')).toHaveText(/\$0\.384[01]/);
  await expect(section.getByTestId('usage-cost-coverage')).toContainText('66 / 66');
  await expect(section.getByTestId('usage-cost-source')).toContainText('models.dev');

  // 137 mock calls at the default 20 rows per page.
  await expect(page.getByTestId('usage-call-row')).toHaveCount(20);
  await expect(page.getByTestId('usage-call-cost').first()).toHaveText('$0.0295');
  await page.getByTestId('usage-calls-next').click();
  await expect(page.getByTestId('usage-calls-page')).toHaveText('第 2 / 7 页');
  await expect(page.getByTestId('usage-call-cost').first()).toHaveText(/\$/);
  await page.getByTestId('usage-calls-prev').click();
  await expect(page.getByTestId('usage-calls-page')).toHaveText('第 1 / 7 页');
  await expect(page.getByTestId('usage-call-cost').first()).toHaveText('$0.0295');

  await page.getByTestId('usage-time-select').selectOption('all');
  await page.getByTestId('usage-refresh-button').click();
  await expect(page.getByTestId('usage-cost-total')).toHaveText('$0.38');
});
