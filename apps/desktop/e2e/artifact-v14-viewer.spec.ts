import { expect, test, type Locator, type Page } from '@playwright/test';

async function openShowcase(page: Page, theme: 'paper' | 'ink'): Promise<void> {
  await page.setViewportSize({ width: 1480, height: 1000 });
  await page.goto(`/#/e2e/artifacts?id=v14-showcase&theme=${theme}`);
  await expect(page.getByTestId('v14-inline')).toBeVisible();
}

async function resumePreview(preview: Locator): Promise<void> {
  const resume = preview.getByTestId('artifact-load-preview');
  if (await resume.isVisible()) await resume.click();
  await expect(preview).toHaveAttribute('data-artifact-height-status', 'ready');
}

for (const theme of ['paper', 'ink'] as const) {
  test(`${theme}: status charts use semantic colors for bars, slices and legends`, async ({ page }) => {
    await openShowcase(page, theme);
    const preview = page.getByTestId('v14-inline').getByTestId('artifact-frame').first();
    await resumePreview(preview);
    const dashboard = page.frameLocator('iframe[title="构建健康度"]');
    const bars = dashboard.locator('figure[data-piwin-chart="bar"] .piwin-chart-bar');
    await expect(bars).toHaveCount(14);
    expect(await bars.evaluateAll((elements) => elements.map((element) => element.getAttribute('fill'))))
      .toEqual(Array.from({ length: 7 }, () => [
        'var(--piwin-artifact-ok)', 'var(--piwin-artifact-risk)',
      ]).flat());

    const canvas = page.frameLocator('[data-testid="v14-canvas"] iframe[title="代码审查"]');
    const slices = canvas.locator('figure[data-piwin-chart="donut"] circle');
    await expect(slices).toHaveCount(4);
    const colors = await slices.evaluateAll((elements) => elements.slice(1).map((element) => element.getAttribute('stroke')));
    expect(colors).toEqual([
      'var(--piwin-artifact-ok)', 'var(--piwin-artifact-warn)', 'var(--piwin-artifact-risk)',
    ]);
    expect(await canvas.locator('.piwin-chart-legend i').evaluateAll((elements) => elements.map((element) => element.getAttribute('style'))))
      .toEqual(colors.map((color) => `background: ${color};`));
  });

  test(`${theme}: expressive stages follow the host and flag opposite-theme gradients`, async ({ page }) => {
    await openShowcase(page, theme);
    const previews = page.getByTestId('v14-inline').getByTestId('artifact-frame');
    await resumePreview(previews.nth(1));
    const stage = page.frameLocator('iframe[title="周末徒步"]').locator('.stage');
    await expect(stage).toHaveCSS('color', theme === 'paper' ? 'rgb(42, 31, 61)' : 'rgb(246, 240, 255)');
    expect(await stage.evaluate((element) => getComputedStyle(element).backgroundImage))
      .toContain(theme === 'paper' ? 'rgb(255, 246, 234)' : 'rgb(29, 27, 58)');
    await expect(previews.nth(1).getByTestId('artifact-contrast-badge')).toHaveCount(0);

    const offTheme = previews.nth(3);
    await resumePreview(offTheme);
    await expect(offTheme.getByTestId('artifact-contrast-badge')).toContainText('与当前主题不一致');
    await offTheme.getByTestId('artifact-contrast-host-view').click();
    await expect(page.getByTestId('artifact-host-view')).toContainText('已用主题样式显示');
    await page.getByTestId('artifact-host-view-restore').click();
    await expect(page.getByTestId('artifact-host-view')).toHaveCount(0);
  });

  test(`${theme}: fullscreen width and preview controls preserve the host and restore focus`, async ({ page }) => {
    await openShowcase(page, theme);
    const hostBackground = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
    // Desktop Canvas has no fullscreen button; F on its chrome opens the overlay.
    const opener = page.getByTestId('artifact-canvas-code');
    await opener.focus();
    await page.keyboard.press('f');
    const overlay = page.getByTestId('artifact-fullscreen-overlay');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByTestId('artifact-fullscreen-stage')).toHaveAttribute('data-width', 'mobile');
    await page.keyboard.press('t');
    await expect(overlay).toHaveAttribute('data-preview-theme', 'paper');
    expect(await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(hostBackground);
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(opener).toBeFocused();

    const inlineOpener = page.getByTestId('v14-inline').getByTestId('artifact-open-fullscreen').first();
    await inlineOpener.click();
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(inlineOpener).toBeFocused();
  });
}
