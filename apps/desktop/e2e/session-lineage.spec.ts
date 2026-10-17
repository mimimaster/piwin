import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  await expect(chooseSidecar.or(page.getByTestId('app-shell'))).toBeVisible();
  if (await chooseSidecar.isVisible()) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openSession(page: Page): Promise<void> {
  await page.getByTestId('sidebar-mode-code').click();
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

for (const handoff of [false, true]) {
  test(`${handoff ? 'handoff' : 'ordinary session switch'} preserves the source and has no lifecycle errors`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await waitForHostReady(page);
    await openSession(page);
    const source = page.getByTestId('session-item').first();
    const sourceId = await source.getAttribute('data-session-id');
    if (!sourceId) throw new Error('source session id missing');

    if (handoff) {
      const row = page.locator('.session-row').filter({ has: source });
      await row.hover();
      await row.getByTestId('session-menu-btn').click();
      await page.getByTestId('session-menu-handoff').click();
      await expect(page.getByTestId('session-item')).toHaveCount(2);
      await expect(page.locator('[data-shelf-kind="context-ref"]')).toContainText(
        /交接摘要|Handoff summary/,
      );
      await expect(page.getByTestId('message-bubble')).toHaveCount(0);
      await expect(page.getByTestId('composer-input')).toHaveValue('');
      await page.getByTestId('handoff-summary-preview-trigger').click();
      await expect(page.getByTestId('handoff-summary-preview-text')).toContainText('Goal: continue');
      await page.keyboard.press('Escape');
      await page.locator('[data-origin-kind="handoff"]:visible').click();
    } else {
      await page.getByTestId('response-fork-btn').click();
      await expect(page.getByTestId('session-item')).toHaveCount(2);
      await page.locator(`[data-testid="session-item"][data-session-id="${sourceId}"]`).click();
    }

    await expect(page.locator('[data-testid="message-bubble"][data-role="user"]')).toContainText(
      'initialize session tree',
    );
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]'),
    ).toContainText('piwin desktop mock reply');
    await expect(page.locator('[data-shelf-kind="context-ref"]')).toHaveCount(0);
    if (handoff) {
      await page.getByTestId('session-item').filter({ hasText: 'Handoff ·' }).click();
      await expect(page.locator('[data-shelf-kind="context-ref"]')).toContainText(
        /交接摘要|Handoff summary/,
      );
      await page.getByTestId('composer-input').fill('continue from the handoff');
      await page.getByTestId('send-btn').click();
      await expect(
        page.locator('[data-testid="message-bubble"][data-role="assistant"]'),
      ).toBeVisible();
      await expect(page.locator('[data-shelf-kind="context-ref"]')).toHaveCount(0);
    }
    expect(
      errors.filter((message) =>
        /flushSync|Maximum update depth|Cannot update a component/.test(message),
      ),
    ).toEqual([]);
  });
}
