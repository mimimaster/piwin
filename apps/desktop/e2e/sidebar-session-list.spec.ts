import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

type E2eHostStats = {
  sessionList: number;
  sessionListPage: number;
};

async function readHostStats(page: Page): Promise<E2eHostStats> {
  return page.evaluate(() => {
    const stats = (
      window as Window & { __PIWIN_E2E_HOST_STATS__?: E2eHostStats }
    ).__PIWIN_E2E_HOST_STATS__;
    return {
      sessionList: stats?.sessionList ?? -1,
      sessionListPage: stats?.sessionListPage ?? -1,
    };
  });
}

test.describe('sidebar session list', () => {
  test('scrolls a large mock list without disclosure chrome or extra list requests', async ({
    page,
  }) => {
    await page.goto('/?e2eSeedSessions=80&e2eHostDiagnostics=1');
    await waitForHostReady(page);

    await expect(page.getByTestId('see-all-btn')).toHaveCount(0);
    await expect(page.getByTestId('see-all-general-btn')).toHaveCount(0);
    await expect(page.getByTestId('session-lazy-next')).toHaveCount(0);
    await expect(page.locator('.ui-spinner')).toHaveCount(0);

    const tree = page.getByTestId('sessions-list');
    await expect(tree.getByTestId('session-item').first()).toBeVisible();
    const statsBeforeScroll = await readHostStats(page);
    expect(statsBeforeScroll.sessionList).toBeGreaterThan(0);
    expect(statsBeforeScroll.sessionListPage).toBe(0);

    const farRow = tree.getByTestId('session-item').filter({ hasText: 'E2E Session 080' });
    await expect
      .poll(async () => {
        await tree.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        return farRow.count();
      })
      .toBeGreaterThan(0);
    await expect(farRow).toBeVisible();
    await farRow.click();

    const statsAfterScroll = await readHostStats(page);
    expect(statsAfterScroll.sessionListPage).toBe(0);
    expect(statsAfterScroll.sessionList).toBe(statsBeforeScroll.sessionList);
  });
});
