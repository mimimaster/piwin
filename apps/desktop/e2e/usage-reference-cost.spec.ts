import { expect, test } from '@playwright/test';

test('usage statistics exposes reference USD costs and preserves recent-call paging', async ({ page }) => {
  await page.goto('/');
  const local = page.getByTestId('host-gate-choose-sidecar');
  if (await local.isVisible()) await local.click();
  await expect(page.getByTestId('settings-open-shelf-btn')).toBeVisible();
  await page.getByTestId('settings-open-shelf-btn').click();
  await page.getByTestId('settings-nav-usage').click();

  const summary = page.getByTestId('usage-cost-summary');
  await expect(summary).toBeVisible();
  await expect(page.getByTestId('usage-cost-total')).toHaveText(/\$0\.384[01]/);
  await expect(page.getByTestId('usage-cost-source')).toContainText('models.dev');
  await expect(page.getByTestId('usage-cost-coverage')).toContainText('66 / 66');
  await expect(page.getByTestId('usage-cost-model-row')).toHaveCount(3);
  await expect(summary).toContainText('openai-work');
  await expect(summary).toContainText('mock/gpt-5.2-codex');

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
  await expect(page.getByTestId('usage-cost-source')).toContainText('models.dev');
  await expect(page.getByTestId('usage-cost-total')).toHaveText(/\$0\.384[01]/);
});
