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

  test('swipes never select; taps select and keep the sheet open; handle drag closes', async ({
    page,
  }) => {
    await openPhoneShell(page);
    await page.getByTestId('thinking-effort-trigger').click();
    await expect(page.getByTestId('pms-sheet')).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const touch = toucher(cdp);
    // Models arrive async from the mock Host; read the baseline only once a row is selected.
    await expect(page.locator('[data-testid="pms-row"][aria-selected="true"]').first()).toBeVisible();
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

    // A still tap selects and the sheet stays. Let fling momentum settle first:
    // a tap during a running scroll is cancelled on purpose (onScroll -> cancel).
    await page.evaluate(async () => {
      const list = document.querySelector('[data-testid="pms-list"]')!;
      let last = -1;
      while (last !== list.scrollTop) {
        last = list.scrollTop;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    });
    const target = page.locator('[data-testid="pms-row"][aria-selected="false"]').nth(3);
    const targetName = (await target.locator('.pms-row-name').innerText()).trim();
    // The row must be fully on screen (not under the sticky header or the search bar).
    await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
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

  test('effort popover: swipes and outside swipes do nothing; still taps pick and close', async ({
    page,
  }) => {
    await openPhoneShell(page);
    await expect(page.getByTestId('pec-chip')).toBeVisible();
    await expect(page.locator('[data-testid="pms-sheet"] [role="radiogroup"]')).toHaveCount(0);
    const cdp = await page.context().newCDPSession(page);
    const touch = toucher(cdp);
    const level = async () => (await page.locator('[data-testid="pec-chip"] .pec-level').innerText()).trim();
    const center = async (sel: string): Promise<[number, number]> => {
      const b = (await page.locator(sel).boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    const swipe = async ([x, y]: [number, number], dx: number, dy: number) => {
      await touch('touchStart', [[x, y]]);
      for (let s = 1; s <= 6; s += 1) {
        await page.waitForTimeout(20);
        await touch('touchMove', [[x + (dx * s) / 6, y + (dy * s) / 6]]);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(200);
    };
    const tapAt = async ([x, y]: [number, number]) => {
      await touch('touchStart', [[x, y]]);
      await page.waitForTimeout(70);
      await touch('touchEnd', []);
      await page.waitForTimeout(250);
    };
    const before = await level();
    await tapAt(await center('[data-testid="pec-chip"]'));
    await expect(page.getByTestId('pec-pop')).toBeVisible();
    // Bare level names only, compact rows that stay >= 44px tap targets.
    await expect(page.locator('[data-testid="pec-pop"] small.pec-item-desc, .pec-item small')).toHaveCount(0);
    const heights = await page.locator('.pec-item').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    expect(Math.max(...heights)).toBeLessThan(52);
    // Only the level rows: no header, no model name; as narrow as the labels need.
    await expect(page.locator('[data-testid="pec-pop"] .pec-pop-title')).toHaveCount(0);
    const popText = (await page.getByTestId('pec-pop').innerText()).replace(/\s+/g, '');
    expect(popText).toMatch(/^[关低中高极最大]+$/);
    const modelLabel = (await page.locator('.pms-pill-name').innerText()).trim();
    expect(popText).not.toContain(modelLabel.replace(/\s+/g, ''));
    expect((await page.locator('[data-testid="pec-chip"]').innerText())).not.toContain(modelLabel);
    const popWidth = (await page.getByTestId('pec-pop').boundingBox())!.width;
    expect(popWidth).toBeLessThanOrEqual(140);
    expect(popWidth).toBeGreaterThanOrEqual(96);
    // 20 swipes starting on level rows: no pick, popover stays.
    for (let i = 0; i < 20; i += 1) {
      const items = page.locator('.pec-item');
      const n = await items.count();
      const b = (await items.nth(i % n).boundingBox())!;
      await swipe([b.x + b.width / 2, b.y + b.height / 2], i % 3 === 0 ? 30 : 0, i % 2 === 0 ? 40 : -24);
      await expect(page.getByTestId('pec-pop')).toBeVisible();
    }
    expect(await level()).toBe(before);
    // A swipe on the outside scrim keeps it open; a still tap there closes it.
    await swipe([200, 120], 0, 120);
    await expect(page.getByTestId('pec-pop')).toBeVisible();
    await tapAt([200, 120]);
    await expect(page.getByTestId('pec-pop')).toHaveCount(0);
    // Still tap on a level picks it and closes.
    await tapAt(await center('[data-testid="pec-chip"]'));
    const pick = before === '高' || before === 'High' ? 'low' : 'high';
    await tapAt(await center(`[data-testid="pec-level-${pick}"]`));
    await expect(page.getByTestId('pec-pop')).toHaveCount(0);
    expect(await level()).not.toBe(before);
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
      await page.screenshot({
        path: `${SHOT_DIR}/model-sheet-${theme.replace('piwin-inkstone-', '')}.png`,
      });
    });
  }

  async function pickModel(page: Page, name: string): Promise<void> {
    await page.getByTestId('thinking-effort-trigger').click();
    await page.getByTestId('pms-search').fill(name);
    await page.locator('[data-testid="pms-row"]', { hasText: name }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pms-sheet')).toHaveCount(0);
  }

  for (const theme of ['piwin-inkstone-paper', 'piwin-inkstone-ink'] as const) {
    test(`effort chip screenshots · ${theme}`, async ({ page }) => {
      test.skip(!SHOT_DIR, 'set PIWIN_SHOT_DIR to capture review screenshots');
      const t = theme.replace('piwin-inkstone-', '');
      await openPhoneShell(page);
      await page.evaluate((id) => {
        document.documentElement.dataset.themeId = id;
        document.documentElement.style.setProperty('--app-safe-top', '59px');
        document.documentElement.style.setProperty('--app-safe-bottom', '34px');
      }, theme);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOT_DIR}/effort-chip-${t}.png` });
      await page.getByTestId('pec-chip').click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOT_DIR}/effort-popover-${t}.png` });
      await page.keyboard.press('Escape');
      await pickModel(page, 'Grok 4 Fast');
      await expect(page.getByTestId('pec-toggle')).toBeVisible();
      await page.screenshot({ path: `${SHOT_DIR}/effort-toggle-${t}.png` });
      await pickModel(page, 'V3.2');
      await expect(page.getByTestId('pec-chip')).toHaveCount(0);
      await expect(page.getByTestId('pec-toggle')).toHaveCount(0);
      await page.screenshot({ path: `${SHOT_DIR}/effort-none-${t}.png` });
      await page.setViewportSize({ width: 360, height: 780 });
      await pickModel(page, 'Sonnet 4.6');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOT_DIR}/effort-chip-narrow360-${t}.png` });
    });
  }
});
