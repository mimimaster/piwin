import { expect, test, type Page } from '@playwright/test';

/**
 * Phone layout contract (data-layout="phone").
 *
 * Phone styling is authored as layout tokens that the theme sheets read
 * (src/styles/region-phone*.css). These assertions measure the result under
 * both theme faces, so a theme change that stops honouring a token fails here
 * instead of in a screenshot review.
 *
 * Run: pnpm --dir apps/desktop exec playwright test -c playwright.mobile.config.ts phone-layout
 */

/** Simulated iPhone insets: Dynamic Island status bar and home indicator. */
const SAFE_TOP = 59;
const SAFE_BOTTOM = 34;

const TITLEBAND_HEIGHT = 44;
/** The band starts a little inside the status-bar inset (--phone-top-inset). */
const TITLEBAND_BOX_HEIGHT = TITLEBAND_HEIGHT + SAFE_TOP - 8;
/** The frame keeps only what the home indicator occupies (inset - 18). */
const FRAME_BOTTOM_INSET = SAFE_BOTTOM - 18;
/** One-line composer: input row plus a 44pt toolbar. Two rows of slack. */
const COMPOSER_MAX_HEIGHT = 110;
const TOUCH_TARGET = 44;

/**
 * Both shipped faces. The Deck ids are retired and remap onto these
 * (appearance-tokens.ts RETIRED_THEME_IDS), so they are not a phone target.
 */
const THEMES = ['piwin-inkstone-ink', 'piwin-inkstone-paper'] as const;

type Box = { x: number; y: number; width: number; height: number };

async function openPhoneShell(page: Page): Promise<void> {
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible().catch(() => false)) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'phone');
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await page.evaluate(
    ([top, bottom]) => {
      const root = document.documentElement;
      root.style.setProperty('--app-safe-top', `${top}px`);
      root.style.setProperty('--app-safe-bottom', `${bottom}px`);
    },
    [SAFE_TOP, SAFE_BOTTOM],
  );
}

/**
 * Geometry is keyed off html[data-theme-id]; setting the attribute exercises
 * the theme's layout rules without depending on a theme switch control, which
 * the phone titleband does not show.
 */
async function applyThemeId(page: Page, themeId: string): Promise<void> {
  await page.evaluate((id) => {
    document.documentElement.dataset.themeId = id;
  }, themeId);
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', themeId);
}

async function sendMockTurn(page: Page): Promise<void> {
  await page.getByTestId('composer-input').fill('hello phone');
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('response-copy-btn').first()).toBeVisible();
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) {
    throw new Error(`no layout box for ${selector}`);
  }
  return box;
}

/**
 * The area a finger can hit: the element box, grown by an absolutely
 * positioned ::after when the element does not clip it.
 */
async function hitAreaOf(page: Page, testId: string): Promise<{ width: number; height: number }> {
  return page.getByTestId(testId).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const after = getComputedStyle(element, '::after');
    const clips = getComputedStyle(element).overflowX !== 'visible';
    if (after.content === 'none' || after.position !== 'absolute' || clips) {
      return { width: rect.width, height: rect.height };
    }
    return {
      width: rect.width - parseFloat(after.left) - parseFloat(after.right),
      height: rect.height - parseFloat(after.top) - parseFloat(after.bottom),
    };
  });
}

async function expectTouchTargets(page: Page, testIds: readonly string[]): Promise<void> {
  for (const testId of testIds) {
    const area = await hitAreaOf(page, testId);
    expect(area.width, `${testId} hit width`).toBeGreaterThanOrEqual(TOUCH_TARGET - 0.5);
    expect(area.height, `${testId} hit height`).toBeGreaterThanOrEqual(TOUCH_TARGET - 0.5);
  }
}

async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${context}: horizontal overflow`).toBeLessThanOrEqual(0);
}

for (const themeId of THEMES) {
  test.describe(`phone layout · ${themeId}`, () => {
    test.beforeEach(async ({ page }) => {
      await openPhoneShell(page);
      await sendMockTurn(page);
      await applyThemeId(page, themeId);
    });

    test('titleband, stage and composer keep their geometry', async ({ page }) => {
      const viewport = page.viewportSize();
      if (viewport === null) {
        throw new Error('viewport is required');
      }

      const titleband = await boxOf(page, '.app-shell > .context-bar');
      expect(titleband.x).toBe(0);
      expect(titleband.y).toBe(0);
      expect(titleband.width).toBeCloseTo(viewport.width, 0);
      expect(titleband.height).toBeCloseTo(TITLEBAND_BOX_HEIGHT, 0);

      // The stage runs edge to edge directly under the titleband.
      const stage = await boxOf(page, '.app-shell > .workspace');
      expect(stage.x).toBe(0);
      expect(stage.width).toBeCloseTo(viewport.width, 0);
      expect(stage.y).toBeCloseTo(TITLEBAND_BOX_HEIGHT, 0);
      await expect(page.locator('.app-shell > .workspace')).toHaveCSS('border-top-left-radius', '0px');

      const composer = await boxOf(page, '[data-testid="composer-dock"]');
      expect(composer.height).toBeLessThanOrEqual(COMPOSER_MAX_HEIGHT);
      expect(composer.y + composer.height).toBeCloseTo(viewport.height - FRAME_BOTTOM_INSET, 0);

      // Below 16px iOS zooms the page when the field takes focus.
      await expect(page.getByTestId('composer-input')).toHaveCSS('font-size', '16px');
      await expectNoHorizontalOverflow(page, 'conversation');
    });

    test('conversation controls are thumb sized', async ({ page }) => {
      await expectTouchTargets(page, [
        'rail-chats-btn',
        'right-panel-open-btn',
        'response-copy-btn',
        'response-fork-btn',
        'response-regenerate-btn',
        'message-copy-btn',
        'message-edit-btn',
        'composer-plus-btn',
        'thinking-effort-trigger',
        'composer-live-btn',
        'send-btn',
      ]);
    });

    test('session drawer covers the screen with thumb-sized controls', async ({ page }) => {
      const viewport = page.viewportSize();
      if (viewport === null) {
        throw new Error('viewport is required');
      }
      await page.getByTestId('rail-chats-btn').click();
      await expect(page.getByTestId('app-shell')).toHaveClass(/nav-open/);
      await expect(page.getByTestId('sidebar-close-btn')).toBeVisible();
      // The drawer slides in; measure it at rest.
      await expect
        .poll(async () => (await boxOf(page, '.app-shell > .sidebar')).x)
        .toBe(0);

      const drawer = await boxOf(page, '.app-shell > .sidebar');
      expect(drawer.width).toBeCloseTo(viewport.width, 0);
      // Its header clears the status bar.
      const header = await boxOf(page, '.sidebar-overlay-header');
      expect(header.y).toBeGreaterThanOrEqual(SAFE_TOP - 8);

      await expectTouchTargets(page, [
        'sidebar-close-btn',
        'sidebar-library-btn',
        'settings-open-shelf-btn',
      ]);
      await expectNoHorizontalOverflow(page, 'session drawer');
    });

    test('workspace panel clears the insets and can be closed by thumb', async ({ page }) => {
      await page.getByTestId('right-panel-open-btn').click();
      await expect(page.getByTestId('right-panel')).toBeVisible();
      const strip = await boxOf(page, '[data-testid="right-panel-tabstrip"]');
      expect(strip.y).toBeGreaterThanOrEqual(SAFE_TOP);
      await expectTouchTargets(page, ['right-panel-close-btn', 'right-panel-expand-btn']);
      await expectNoHorizontalOverflow(page, 'workspace panel');
    });

    test('settings is one full-width column', async ({ page }) => {
      const viewport = page.viewportSize();
      if (viewport === null) {
        throw new Error('viewport is required');
      }
      await page.getByTestId('rail-chats-btn').click();
      await page.getByTestId('settings-open-shelf-btn').click();
      await expect(page.getByTestId('settings-panel')).toBeVisible();
      // Opening settings re-applies the stored theme; pin the one under test.
      await applyThemeId(page, themeId);
      // The dialog scales in; measure it at rest.
      await expect
        .poll(async () => (await boxOf(page, '.settings-modal-dialog')).width)
        .toBeCloseTo(viewport.width, 0);

      for (const selector of ['.settings-modal-dialog > .settings-nav', '.settings-modal-dialog > .settings-main']) {
        const column = await boxOf(page, selector);
        expect(column.x, `${selector} x`).toBeCloseTo(0, 0);
        expect(column.width, `${selector} width`).toBeCloseTo(viewport.width, 0);
      }
      // Nav strip sits above the page, not beside it.
      const nav = await boxOf(page, '.settings-modal-dialog > .settings-nav');
      const main = await boxOf(page, '.settings-modal-dialog > .settings-main');
      expect(main.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);

      const back = await boxOf(page, '.settings-titlebar .settings-back-button');
      expect(back.width).toBeGreaterThanOrEqual(TOUCH_TARGET - 0.5);
      expect(back.height).toBeGreaterThanOrEqual(TOUCH_TARGET - 0.5);
      await expect(page.locator('.settings-nav .settings-search-input')).toHaveCSS('font-size', '16px');
      await expectNoHorizontalOverflow(page, 'settings');
    });
  });
}
