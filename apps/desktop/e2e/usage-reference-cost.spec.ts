import { expect, test } from '@playwright/test';

for (const mode of ['dark', 'light'] as const) {
  test(`usage integrates reference costs and model filtering (${mode})`, async ({ page }) => {
    await page.addInitScript((appearanceMode) => {
      localStorage.setItem('piwin.desktop.appearanceMode', appearanceMode);
    }, mode);
    await page.goto('/');
    const local = page.getByTestId('host-gate-choose-sidecar');
    if (await local.isVisible()) await local.click();
    await page.getByTestId('settings-open-shelf-btn').click();
    await page.getByTestId('settings-nav-usage').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode);

    const card = page.getByTestId('usage-total-card');
    await expect(page.locator('.usage-summary-card')).toHaveCount(3);
    await expect(card.getByTestId('usage-cost-total')).toHaveText('$0.38');
    await expect(page.getByTestId('usage-request-count')).toHaveText('66');
    await expect(page.getByTestId('usage-cost-section')).toHaveCount(0);
    await expect(card.getByRole('button', { name: /展开|收起/ })).toHaveCount(0);

    await card.getByTestId('usage-cost-pricing-toggle').click();
    const pricing = page.getByTestId('usage-cost-pricing-details');
    await expect(pricing.getByTestId('usage-cost-source')).toContainText('models.dev');
    await expect(pricing.getByTestId('usage-cost-coverage')).toContainText('66 / 66');
    await page.keyboard.press('Escape');

    // Selecting a model narrows totals and the entire paged result, not one page.
    await page.getByTestId('usage-time-select').selectOption('all');
    await page.getByTestId('usage-model-select').selectOption('claude-sonnet-4-5');
    await expect(page.getByTestId('usage-request-count')).toHaveText('16');
    await expect(page.getByTestId('usage-total')).toHaveText('96.0k');
    await expect(card.getByTestId('usage-cost-total')).toHaveText('$0.10');
    await expect(page.getByTestId('usage-call-row')).toHaveCount(20);
    for (const row of await page.getByTestId('usage-call-row').all()) {
      await expect(row).toContainText('claude-sonnet-4-5');
      await expect(row.getByTestId('usage-call-cost')).toBeVisible();
    }
    await expect(page.locator('.usage-calls-table thead th')).toHaveCount(10);
    await page.getByTestId('usage-calls-next').click();
    await expect(page.getByTestId('usage-calls-page')).toHaveText('第 2 / 3 页');
    await page.getByTestId('usage-model-select').selectOption('gpt-5.2-codex');
    await expect(page.getByTestId('usage-request-count')).toHaveText('50');
    await expect(card.getByTestId('usage-cost-total')).toHaveText('$0.28');
    await expect(page.getByTestId('usage-calls-page')).toHaveText('第 1 / 5 页');
    await page.getByTestId('usage-model-select').selectOption('');
    await expect(page.getByTestId('usage-request-count')).toHaveText('66');
    await expect(page.getByTestId('usage-calls-page')).toHaveText('第 1 / 7 页');

    const heatmap = page.getByTestId('usage-activity-heatmap');
    await heatmap.locator('[data-today="true"]').hover();
    await expect(page.getByTestId('usage-heatmap-cost')).toContainText('参考估算');
    await page.mouse.move(0, 0);
    const metric = heatmap.getByTestId('usage-activity-metric');
    await metric.getByText('请求数', { exact: true }).click();
    await heatmap.locator('[data-today="true"]').hover();
    await expect(page.getByTestId('usage-heatmap-tooltip')).toContainText('次请求');
    await metric.getByText('Token', { exact: true }).click();
    await page.mouse.move(0, 0);
    for (const width of [1920, 1280, 960]) {
      await page.setViewportSize({ width, height: 1080 });
      const heatmapBounds = await heatmap.boundingBox();
      const gridBounds = await heatmap.getByTestId('usage-heatmap-grid').boundingBox();
      const metricBounds = await metric.boundingBox();
      const headingBounds = await heatmap.locator('.usage-heatmap-heading').boundingBox();
      expect(heatmapBounds?.height).toBeLessThan(230);
      expect(metricBounds?.height).toBeLessThanOrEqual(28);
      if (!heatmapBounds || !gridBounds || !metricBounds || !headingBounds) throw new Error('Missing heatmap layout');
      expect(heatmapBounds.x + heatmapBounds.width - gridBounds.x - gridBounds.width).toBeLessThan(40);
      expect(metricBounds.x - headingBounds.x - headingBounds.width).toBeLessThan(24);
      expect((await card.boundingBox())?.height).toBeLessThan(180);
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/piwin-usage-heatmap-${mode}.png` });
  });
}
