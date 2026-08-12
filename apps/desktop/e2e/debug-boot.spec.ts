import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
  await page.getByTestId('open-workspace-btn').waitFor({ state: 'visible' });
  await page.getByTestId('open-workspace-btn').click();
  await page.getByRole('menuitem').first().click();
  await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-cm-debug');
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await page.getByTestId('right-panel-open-btn').first().click();
  await page.getByTestId('right-panel-tab-add').click();
  await page.getByTestId('right-panel-plus-files').click();
  await expect(page.locator('button.file-tree-row[title="README.md"]')).toBeVisible();
}

test('debug preview layout', async ({ page }) => {
  await boot(page);
  await page.locator('button.file-tree-row[title="package.json"]').click();
  const preview = page.getByTestId('code-preview-view');
  await expect(preview).toBeVisible();
  await page.waitForTimeout(1200);
  console.log('PREVIEW BOX:', await preview.boundingBox());
  console.log(
    'ROWS:',
    await preview.locator('.code-preview-row').count(),
  );
  console.log(
    'ROW BOXES:',
    await preview
      .locator('.code-preview-text')
      .evaluateAll((els) => els.map((el) => `${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight} text=${el.textContent?.slice(0, 30)}`)),
  );
  console.log(
    'PREVIEW HTML:',
    (await preview.evaluate((el) => el.innerHTML)).slice(0, 400),
  );
  const panelBox = await page.getByTestId('file-tree-panel').boundingBox();
  console.log('PANEL BOX:', panelBox);
});
