import { expect, test, type Page } from '@playwright/test';

/**
 * Phone glass: the titleband and composer slab must visibly let the
 * transcript through. Measures the slab/bar colour over light text vs a
 * solid reference and captures review screenshots (PIWIN_SHOT_DIR).
 */
const SHOT_DIR = process.env.PIWIN_SHOT_DIR;
const SHOT_TAG = process.env.PIWIN_SHOT_TAG ?? 'after';

async function openPhoneShell(page: Page, themeId: string): Promise<void> {
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible().catch(() => false)) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'phone');
  await page.evaluate((id) => {
    document.documentElement.dataset.themeId = id;
    document.documentElement.style.setProperty('--app-safe-top', '59px');
    document.documentElement.style.setProperty('--app-safe-bottom', '34px');
  }, themeId);
  const long = Array.from({ length: 6 }, (_, i) => `第 ${i + 1} 段：透过玻璃应该能看到这段文字在滚动。`).join(' ');
  for (let i = 0; i < 3; i += 1) {
    await page.getByTestId('composer-input').fill(`${long} #${i}`);
    await page.getByTestId('send-btn').click();
    await expect(page.getByTestId('response-copy-btn').nth(i)).toBeVisible();
  }
  // Park the reading position mid-transcript so text sits under both bars.
  await page.evaluate(() => {
    const stream = document.querySelector<HTMLElement>('.chat-stream');
    if (stream) stream.scrollTop = Math.max(0, (stream.scrollHeight - stream.clientHeight) / 2);
  });
  await page.waitForTimeout(400);
}

for (const themeId of ['piwin-inkstone-paper', 'piwin-inkstone-ink'] as const) {
  test(`phone glass tokens and screenshot · ${themeId}`, async ({ page }) => {
    await openPhoneShell(page, themeId);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        filter: style.getPropertyValue('--phone-glass-filter').trim(),
        overlap: style.getPropertyValue('--phone-composer-overlap').trim(),
        slab: getComputedStyle(document.querySelector('.composer-dock .slab-face')!).backgroundColor,
        bar: getComputedStyle(document.querySelector('.app-shell > .context-bar')!).backgroundColor,
      };
    });
    if (SHOT_DIR) {
      await page.screenshot({ path: `${SHOT_DIR}/glass-${SHOT_TAG}-${themeId.replace('piwin-inkstone-', '')}.png` });
      console.log(`[glass ${SHOT_TAG} ${themeId}] ${JSON.stringify(tokens)}`);
    }
    if (SHOT_TAG === 'after') {
      expect(tokens.filter).toBe('blur(12px) saturate(1.6)');
      expect(tokens.overlap).toBe('72px');
      // Translucent fills: alpha well below the old 0.88 slab.
      const alpha = (rgba: string): number => {
        const match = /rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/.exec(rgba);
        const parts = (match?.[1] ?? match?.[2] ?? '').split(/[ ,/]+/).filter(Boolean);
        return parts.length >= 4 ? Number(parts[3]) : 1;
      };
      expect(alpha(tokens.slab)).toBeLessThan(0.8);
      expect(alpha(tokens.bar)).toBeLessThan(0.5);
    }
  });
}

test('phone glass strength 0 turns the chrome solid', async ({ page }) => {
  test.skip(SHOT_TAG !== 'after', 'strength token is new');
  await openPhoneShell(page, 'piwin-inkstone-paper');
  await page.evaluate(() => document.documentElement.style.setProperty('--phone-glass-strength', '0'));
  const slab = await page.evaluate(
    () => getComputedStyle(document.querySelector('.composer-dock .slab-face')!).backgroundColor,
  );
  expect(slab).not.toMatch(/\/ 0\.[0-9]|, 0\.[0-9]+\)$/);
});
