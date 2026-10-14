import { expect, test, type Locator, type Page } from '@playwright/test';

async function openShowcase(page: Page, theme: 'paper' | 'ink'): Promise<Locator> {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto(`/#/e2e/artifacts?id=kit-showcase&theme=${theme}`);
  const showcase = page.getByTestId('kit-showcase');
  await expect(showcase).toBeVisible();
  return showcase.getByTestId('artifact-frame');
}

async function resumePreview(preview: Locator): Promise<void> {
  await preview.scrollIntoViewIfNeeded();
  const resume = preview.getByTestId('artifact-load-preview');
  if (await resume.isVisible()) await resume.click();
  await expect(preview).toHaveAttribute('data-artifact-height-status', 'ready');
}

for (const theme of ['paper', 'ink'] as const) {
  test(`${theme}: every chart kind draws with an axis, values and a legend`, async ({ page }) => {
    const frames = await openShowcase(page, theme);
    await resumePreview(frames.nth(0));
    const charts = page.frameLocator('iframe[title="图表"]');
    await expect(charts.locator('figure[data-piwin-chart][data-piwin-chart-ready]')).toHaveCount(6);
    await expect(charts.locator('figure[data-piwin-chart="bar"] .piwin-chart-bar')).toHaveCount(10);
    await expect(charts.locator('figure[data-piwin-chart="bar"] .piwin-chart-tick').last()).toHaveText('100');
    await expect(charts.locator('figure[data-piwin-chart="line"] .piwin-chart-value')).toHaveText('212ms');
    await expect(charts.locator('figure[data-piwin-chart="hbar"] .piwin-chart-label').first()).toHaveText('packages/host-runtime');
    await expect(charts.locator('figure[data-piwin-chart="donut"] .piwin-chart-legend b')).toHaveText(['78%', '17%', '4%']);
    await expect(charts.locator('figure[data-piwin-chart="stack"] .piwin-chart-bar')).toHaveCount(4);
    // A drawn chart no longer shows the streaming placeholder.
    expect(
      await charts.locator('figure[data-piwin-chart="bar"]').evaluate((figure) => getComputedStyle(figure, '::before').content),
    ).toBe('none');
  });

  test(`${theme}: diagram and component kits are styled by the host`, async ({ page }) => {
    const frames = await openShowcase(page, theme);
    const diagrams = frames.nth(1).getByTestId('artifact-static');
    await diagrams.scrollIntoViewIfNeeded();
    await expect(diagrams.locator('.piwin-flow')).toHaveCSS('display', 'flex');
    await expect(diagrams.locator('.piwin-lanes thead th').nth(1)).toHaveText('下单');
    expect(
      await diagrams.locator('.piwin-lanes thead th').nth(1).evaluate((th) => getComputedStyle(th, '::before').content),
    ).toContain('counter(piwin-phase)');

    const components = frames.nth(2).getByTestId('artifact-static');
    await components.scrollIntoViewIfNeeded();
    await expect(components.locator('.piwin-steps > li').first()).toHaveCSS('position', 'relative');
    expect(
      await components.locator('.piwin-steps > li[data-state="done"]').evaluate((li) => getComputedStyle(li, '::before').content),
    ).toBe('"✓"');
    await expect(components.locator('.piwin-progress')).toHaveCount(2);
    await expect(components.locator('.piwin-compare')).toHaveCSS('display', 'grid');
    await expect(frames.nth(2).getByTestId('artifact-layout-badge')).toHaveCount(0);
  });

  test(`${theme}: the layout probe flags squeezed text in both renderers`, async ({ page }) => {
    const frames = await openShowcase(page, theme);
    const staticFrame = frames.nth(3);
    await staticFrame.scrollIntoViewIfNeeded();
    await expect(staticFrame).toHaveAttribute('data-artifact-renderer', 'static-flow');
    await expect(staticFrame.getByTestId('artifact-layout-badge')).toContainText('部分文字被挤成了窄列');
    await expect(staticFrame.getByTestId('artifact-layout-badge')).toHaveAttribute('data-shattered-text', '3');

    const sandboxFrame = frames.nth(4);
    await resumePreview(sandboxFrame);
    await expect(sandboxFrame.getByTestId('artifact-layout-badge')).toContainText('部分文字被挤成了窄列');
    // Healthy artifacts on the same page stay quiet.
    await expect(page.getByTestId('artifact-layout-badge')).toHaveCount(2);
  });
}
