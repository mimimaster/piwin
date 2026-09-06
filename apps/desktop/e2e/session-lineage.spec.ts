import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openSession(page: Page): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-session-lineage');
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);

  await page.getByTestId('composer-input').fill('initialize session tree');
  await page.getByTestId('send-btn').click();
  await expect(page.locator('[data-testid="message-bubble"][data-role="assistant"]')).toBeVisible();
  await expect(page.getByTestId('context-session-tree-btn')).toBeVisible();
}

test.describe('session tree and Fork Chat', () => {
  test('header tree stays in-session; Fork Chat creates a numbered sibling session', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openSession(page);

    const headerEntry = page.getByTestId('context-session-tree-btn');
    await expect(headerEntry).toHaveAttribute('data-has-branches', 'false');
    await expect(headerEntry).toContainText('0');

    await headerEntry.click();
    await expect(page.getByTestId('branch-points-empty')).toBeVisible();
    await expect(page.getByTestId('session-tree-popover')).toContainText(/0 个分岔|0 branches/);
    await expect(page.getByTestId('session-tree-popover')).not.toContainText(/Fork Chat|分叉会话/);

    await headerEntry.click();
    await page.getByTestId('response-fork-btn').click();
    await expect(page.getByTestId('session-item')).toHaveCount(2);
    await expect(page.getByTestId('session-item').filter({ hasText: '(1) ' })).toHaveCount(1);
    await expect(headerEntry).toHaveAttribute('data-has-branches', 'false');
  });
});
