import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * Phone model sheet (plan B) anti-misclick contract, with real touch input
 * (CDP Input.dispatchTouchEvent) modeled on the v3 swipe study: long drags and
 * short flicks that start on a model row never change the selection; a still
 * tap does, and the sheet stays open; only the handle drag closes it.
 *
 * Run: pnpm --dir apps/desktop exec playwright test -c playwright.mobile.config.ts phone-model-sheet
 */
const SHOT_DIR = process.env.PIWIN_SHOT_DIR;

async function openPhoneShell(page: Page): Promise<void> {
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible().catch(() => false)) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'phone');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function selectedName(page: Page): Promise<string> {
  return (await page.locator('.pms-pill-name').innerText()).trim();
}

type Touch = (type: string, points: Array<[number, number]>) => Promise<void>;
function toucher(cdp: CDPSession): Touch {
  return async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })),
    });
  };
}

async function visibleRows(page: Page): Promise<Array<[number, number]>> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="pms-row"]')]
      .map((row) => row.getBoundingClientRect())
      .filter((r) => r.top > 220 && r.bottom < 700)
      .map((r) => [r.left + r.width / 2, r.top + r.height / 2] as [number, number]),
  );
}

test.describe('phone model sheet', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch input is Chromium-only');

  test('swipes never select; taps select and keep the sheet open; handle drag closes', async ({ page }) => {
    await openPhoneShell(page);
    await page.getByTestId('thinking-effort-trigger').click();
    await expect(page.getByTestId('pms-sheet')).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const touch = toucher(cdp);
    const base = await selectedName(page);

    // Deterministic pseudo-random: 30 long drags + 20 short flicks starting on rows.
    let seed = 7;
    const rand = (lo: number, hi: number): number => {
      seed = (seed * 16807) % 2147483647;
      return lo + (seed % (hi - lo + 1));
    };
    let misSelect = 0;
    for (let i = 0; i < 50; i += 1) {
      const rows = await visibleRows(page);
      if (rows.length === 0) break;
      const [x, y] = rows[rand(0, rows.length - 1)]!;
      const long = i < 30;
      const sign = rand(0, 1) === 0 ? -1 : 1;
      const dy = Math.max(Math.min(sign * (long ? rand(90, 300) : rand(12, 40)), 760 - y), 230 - y);
      const steps = long ? rand(8, 14) : 3;
      const ms = long ? rand(180, 420) : rand(40, 90);
      await touch('touchStart', [[x, y]]);
      for (let s = 1; s <= steps; s += 1) {
        await page.waitForTimeout(ms / steps);
        await touch('touchMove', [[x, y + (dy * s) / steps]]);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(200);
      await expect(page.getByTestId('pms-sheet')).toBeVisible();
      if ((await selectedName(page)) !== base) misSelect += 1;
    }
    expect(misSelect).toBe(0);

    // A still tap selects and the sheet stays.
    const target = page.locator('[data-testid="pms-row"][aria-selected="false"]').nth(3);
    const targetName = (await target.locator('.pms-row-name').innerText()).trim();
    const box = (await target.boundingBox())!;
    await touch('touchStart', [[box.x + box.width / 2, box.y + box.height / 2]]);
    await page.waitForTimeout(70);
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    expect(await selectedName(page)).toBe(targetName);
    await expect(page.getByTestId('pms-sheet')).toBeVisible();

    // Handle drag: 80px snaps back, 160px closes.
    const handle = (await page.getByTestId('pms-handle').boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + 20;
    for (const [dy, open] of [
      [80, true],
      [160, false],
    ] as const) {
      await touch('touchStart', [[hx, hy]]);
      for (let s = 1; s <= 8; s += 1) {
        await page.waitForTimeout(20);
        await touch('touchMove', [[hx, hy + (dy * s) / 8]]);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(300);
      await expect(page.getByTestId('pms-sheet')).toHaveCount(open ? 1 : 0);
    }
  });

  for (const theme of ['piwin-inkstone-paper', 'piwin-inkstone-ink'] as const) {
    test(`screenshot · ${theme}`, async ({ page }) => {
      test.skip(!SHOT_DIR, 'set PIWIN_SHOT_DIR to capture review screenshots');
      await openPhoneShell(page);
      await page.evaluate((id) => {
        document.documentElement.dataset.themeId = id;
        document.documentElement.style.setProperty('--app-safe-top', '59px');
        document.documentElement.style.setProperty('--app-safe-bottom', '34px');
      }, theme);
      await page.getByTestId('thinking-effort-trigger').click();
      await expect(page.getByTestId('pms-sheet')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOT_DIR}/model-sheet-${theme.replace('piwin-inkstone-', '')}.png` });
    });
  }
});
