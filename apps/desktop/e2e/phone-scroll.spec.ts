import { expect, test } from '@playwright/test';

for (const themeId of ['piwin-inkstone-ink', 'piwin-inkstone-paper']) {
  for (const sessionCount of [8, 140]) {
    test(`${themeId}: ${sessionCount} sessions stay inside a fixed phone frame`, async ({ page, browserName }) => {
      await page.goto(`/?e2eSeedSessions=${sessionCount}`);
      const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
      if (await chooseSidecar.isVisible()) await chooseSidecar.click();
      await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'phone');
      await page.evaluate((id) => { document.documentElement.dataset.themeId = id; }, themeId);
      await page.getByTestId('rail-chats-btn').click();
      const drawer = page.locator('.app-shell > .sidebar');
      await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
      const list = page.getByTestId('sessions-list');
      await expect(list.getByTestId('session-item').first()).toBeVisible();

      // Exercise host titles that exceed the viewport, including unbroken text.
      // Only text changes; production row/virtualizer layout stays in use.
      await list.locator('.session-item-title-text').first().evaluate((element) => {
        element.textContent = '生成一个2D的秦始皇骑北极熊的html动画'.repeat(12);
      });
      const geometry = await list.evaluate((element) => {
        const row = element.querySelector('[data-testid="session-item"]');
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          rowWidth: row?.getBoundingClientRect().width ?? 0,
        };
      });
      expect(geometry.rowWidth).toBeGreaterThan(0);
      expect(geometry.rowWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.scrollWidth, JSON.stringify(geometry)).toBe(geometry.clientWidth);
      await expect(list).toHaveCSS('overflow-x', 'hidden');
      await expect(list).toHaveCSS('overscroll-behavior-y', 'none');
      await expect(page.locator('body')).toHaveCSS('position', 'fixed');

      const header = page.locator('.sidebar-overlay-header');
      const footer = page.locator('.sidebar-shelf');
      const beforeHeader = await header.boundingBox();
      const beforeFooter = await footer.boundingBox();
      if (sessionCount === 140) {
        if (browserName === 'chromium') {
          // A real touch swipe also exercises the session row's drag gesture.
          const bounds = await list.boundingBox();
          if (bounds === null) throw new Error('session list has no bounds');
          await list.evaluate((element) => { element.scrollTop = 0; });
          const touch = await page.context().newCDPSession(page);
          const touchX = bounds.x + bounds.width / 2;
          const touchY = bounds.y + bounds.height * 0.8;
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }],
          });
          for (let step = 1; step <= 6; step += 1) {
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchMove', touchPoints: [{ x: touchX + step * 2, y: touchY - step * 20 }],
            });
          }
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
          await touch.detach();
        }
        const lastRow = list.getByTestId('session-item').filter({ hasText: 'E2E Session 140' });
        await expect.poll(async () => {
          await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          return lastRow.count();
        }).toBeGreaterThan(0);
        await expect(lastRow).toBeVisible();
        expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      // Pushing a scroll region past either edge must not move chrome/document.
      await list.evaluate((element) => {
        element.scrollLeft = 200;
        element.scrollTop = -200;
        window.scrollTo(200, 200);
      });
      expect(await list.evaluate((element) => element.scrollLeft)).toBe(0);
      expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })))
        .toEqual({ x: 0, y: 0 });
      expect(await header.boundingBox()).toEqual(beforeHeader);
      expect(await footer.boundingBox()).toEqual(beforeFooter);
      await page.getByTestId('sidebar-close-btn').click();
      await expect(page.getByTestId('composer-input')).toBeVisible();
    });
  }
}
