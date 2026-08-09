import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openSession(page: Page): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await page.getByRole('menuitem', { name: /打开工作区文件夹|open workspace folder/i }).click();
  await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-session-lineage');
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);

  await page.getByTestId('composer-input').fill('initialize session tree');
  await page.getByTestId('send-btn').click();
  await expect(page.locator('[data-testid="message-bubble"][data-role="assistant"]')).toBeVisible();
  await expect(page.getByTestId('context-session-tree-btn')).toBeVisible();
}

test.describe('product session tree', () => {
  test('keeps a persistent entry and navigates newly created branches', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openSession(page);

    const headerEntry = page.getByTestId('context-session-tree-btn');
    await expect(headerEntry).toHaveAttribute('data-has-branches', 'false');
    await expect(headerEntry).toContainText('1');

    await headerEntry.click();
    await expect(page.getByTestId('session-lineage-empty')).toBeVisible();
    await expect(page.getByTestId('session-lineage-popover')).toContainText(
      /1 个会话 · 0 个分支|1 sessions · 0 branches/,
    );

    await headerEntry.click();
    await page.getByTestId('response-fork-btn').click();
    await expect(page.getByTestId('session-item')).toHaveCount(2);
    await expect(headerEntry).toHaveAttribute('data-has-branches', 'true');
    await expect(headerEntry).toContainText('2');

    await headerEntry.click();
    const treeItems = page.getByRole('treeitem');
    await expect(treeItems).toHaveCount(2);
    await expect(treeItems.last()).toContainText(/从此处分叉|Forked from/);

    await treeItems.first().click();
    await expect(page.getByTestId('context-bar-origin-badge')).toHaveCount(0);
  });
});
