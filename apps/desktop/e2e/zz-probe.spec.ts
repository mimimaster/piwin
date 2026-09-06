import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  const connectBtn = page.getByRole('button', { name: '连接', exact: true });
  if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await connectBtn.click();
  } else {
    const useThisMac = page.getByRole('button', { name: '使用本机', exact: true });
    if (await useThisMac.isVisible({ timeout: 3000 }).catch(() => false)) {
      await useThisMac.click();
    }
  }
  await expect(page.getByTestId('composer-input')).toBeVisible({ timeout: 10000 });
}

async function switchToPaper(page: Page): Promise<void> {
  if ((await page.locator('html').getAttribute('data-theme-id')) === 'piwin-inkstone-ink') {
    await page.getByTestId('titlebar-theme-toggle').click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-paper');
}

test('probe stray mark and marginalia state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await switchToPaper(page);
  await page.getByTestId('composer-input').fill('Inkstone layout check');
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('conversation-response')).toContainText('piwin desktop mock reply');
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const stage = document.querySelector('.chat-stage');
    const stageRect = stage?.getBoundingClientRect();
    const describe = (element: Element): string => {
      const rect = element.getBoundingClientRect();
      return `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} @${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)} display=${getComputedStyle(element).display}`;
    };
    const marginalia = [...document.querySelectorAll('.marg, .chat-marginalia')];
    const heads = [...document.querySelectorAll('.head, .chat-turn-head')];
    // What sits at the stray mark? Scan a vertical strip near the stage's left edge.
    const strip: string[] = [];
    if (stageRect) {
      for (let y = stageRect.top + 40; y < stageRect.top + 420; y += 8) {
        const stack = document.elementsFromPoint(stageRect.left + 14, y);
        const top = stack.find(
          (element) => !element.classList.contains('chat-stage') && stack.indexOf(element) < 6,
        );
        if (top && strip[strip.length - 1] !== top.className) {
          strip.push(`${Math.round(y)}: ${top.tagName.toLowerCase()} ${top.className}`);
        }
      }
    }
    return {
      stageWidth: stageRect ? Math.round(stageRect.width) : -1,
      containerType: stage ? getComputedStyle(stage).containerType : '(none)',
      marginalia: marginalia.map(describe),
      heads: heads.map(describe),
      strip,
    };
  console.log('PROBE:', JSON.stringify(info, null, 2));
  expect(info.stageWidth).toBeGreaterThan(0);
});
