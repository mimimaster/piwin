import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // host-status-pill was retired with the compact sidebar; the shell-owned
  // runtime sentinel + mounted composer are the modern ready signal.
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openSettingsFromCompactShell(page: Page): Promise<void> {
  // Prefer the always-visible titleband More → Settings path on compact,
  // so the suite does not depend on sidebar-footer geometry.
  const moreBtn = page.getByRole('button', { name: /More tools|更多/i });
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    const moreSettings = page.getByTestId('more-settings');
    if (await moreSettings.isVisible().catch(() => false)) {
      await moreSettings.click();
      return;
    }
  }
  // Fallback: open the sessions drawer and use the footer settings control.
  const shell = page.getByTestId('app-shell');
  if ((await shell.getAttribute('class'))?.includes('nav-open') !== true) {
    await page.getByTestId('rail-chats-btn').click();
  }
  await expect(shell).toHaveClass(/nav-open/);
  const settingsBtn = page.getByTestId('settings-open-shelf-btn');
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.evaluate((node: HTMLElement) => node.click());
}

async function openTrustedSession(page: Page, projectPath: string): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill(projectPath);
  await page.getByTestId('open-project-btn').click();
  // Explicit open auto-trusts and creates/resumes a session (Cursor-like).
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-item')).toHaveCount(1);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
}

type BoundaryRecord = {
  width: number;
  sidebarVisible: boolean;
  rightPanelVisible: boolean;
  scrimVisible: boolean;
  dataLayout: string | null;
};

async function recordBoundaryState(page: Page): Promise<BoundaryRecord> {
  const width = page.viewportSize()?.width ?? 0;
  const sidebarVisible = await page
    .locator('.sidebar')
    .isVisible()
    .catch(() => false);
  const rightPanelVisible = await page
    .getByTestId('right-panel')
    .isVisible()
    .catch(() => false);
  const scrimVisible = await page
    .getByTestId('shell-overlay-scrim')
    .isVisible()
    .catch(() => false);
  const dataLayout = await page.getByTestId('app-shell').getAttribute('data-layout');
  return { width, sidebarVisible, rightPanelVisible, scrimVisible, dataLayout };
}

/** S0 baseline widths: prove existing JS/CSS breakpoint discontinuities before S1 unifies them. */
const BOUNDARY_WIDTHS = [360, 390, 440, 767, 768, 820, 821, 980, 981, 1023, 1024] as const;

test.describe('responsive viewport smoke', () => {
  test('1280x840 keeps sidebar and opens inspector', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-content-expanded', 'true');
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('composer-input')).toBeVisible();
  });

  test('desktop inspector uses directory → drill (quiet workbench)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel-directory')).toBeVisible();
    await expect(page.locator('.right-panel-rail')).toHaveCount(0);
    // Directory home first; drill hides the list and shows detail + back.
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-view', 'detail');
    await expect(page.getByTestId('right-panel-back-btn')).toBeVisible();
    await expect(page.getByTestId('file-tree-panel')).toBeVisible();
    await page.getByTestId('right-panel-back-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-view', 'home');
    await page.getByTestId('right-panel-tab-activity').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-view', 'detail');
    await expect(page.getByTestId('terminal-dock')).toBeVisible();
  });

  test('1024x768 keeps primary chrome reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-viewport-1024');
    await expect(page.getByTestId('new-session-btn')).toBeVisible();
    await expect(page.getByTestId('session-search-btn')).toBeVisible();
    await page.getByTestId('session-search-btn').click();
    await expect(page.getByTestId('session-search-dialog')).toBeVisible();
    await expect(page.getByTestId('session-search-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-search-dialog')).toHaveCount(0);
    await page.getByTestId('settings-open-shelf-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('boundary matrix records sidebar/inspector/scrim/keyboard', async ({ page }) => {
    const records: BoundaryRecord[] = [];

    for (const width of BOUNDARY_WIDTHS) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto('/');
      await waitForHostReady(page);

      // Baseline: closed overlays after load.
      let state = await recordBoundaryState(page);
      records.push({ ...state, rightPanelVisible: state.rightPanelVisible });

      // Ensure the navigator is open. On desktop the toggle collapses an
      // already-open sidebar, so only click when closed / on compact.
      const shell = page.getByTestId('app-shell');
      const layout = await shell.getAttribute('data-layout');
      const navOpen = (await shell.getAttribute('class'))?.includes('nav-open') === true;
      if (layout === 'compact' || !navOpen) {
        await page.getByTestId('rail-chats-btn').click();
      }
      await expect(shell).toHaveClass(/nav-open/);
      await expect(page.getByTestId('new-session-btn')).toBeVisible();
      await expect(page.getByTestId('session-search-btn')).toBeVisible();
      await page.getByTestId('session-search-btn').click();
      await expect(page.getByTestId('session-search-input')).toBeVisible();

      // Escape should close compact overlays when open (document-level owner).
      await page.keyboard.press('Escape');

      // Open inspector via titleband toggle, then Files section.
      // Last-view memory may restore detail — return home first if needed.
      const openBtn = page.getByTestId('right-panel-open-btn');
      await expect(openBtn).toBeVisible();
      await openBtn.click();
      await expect(page.getByTestId('right-panel')).toBeVisible();
      const backBtn = page.getByTestId('right-panel-back-btn');
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
      }
      await expect(page.getByTestId('right-panel-directory')).toBeVisible();
      await page.getByTestId('right-panel-files-btn').click();
      state = await recordBoundaryState(page);
      records.push(state);

      // Always close inspector before opening Settings (button lives in navigator footer).
      const rightPanelClose = page.getByTestId('right-panel-close-btn');
      if (await rightPanelClose.isVisible().catch(() => false)) {
        await rightPanelClose.click();
      } else {
        const scrim = page.getByTestId('shell-overlay-scrim');
        if (await scrim.isVisible().catch(() => false)) {
          await scrim.click();
        } else {
          await page.keyboard.press('Escape');
        }
      }
      // Closed state shows only the edge open control (no permanent rail).
      await expect(page.getByTestId('right-panel')).toBeHidden();
      await expect(page.getByTestId('right-panel-open-btn')).toBeVisible();

      // Settings Escape path — reachable without relying on footer geometry.
      await openSettingsFromCompactShell(page);
      await expect(page.getByTestId('settings-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('settings-panel')).toHaveCount(0);
    }

    // Persist matrix in test output for S0 discontinuity review.
    // eslint-disable-next-line no-console
    console.log('PSR-S0 boundary matrix', JSON.stringify(records, null, 2));

    // Every boundary width was exercised.
    expect(records.length).toBeGreaterThanOrEqual(BOUNDARY_WIDTHS.length);
    for (const width of BOUNDARY_WIDTHS) {
      expect(records.some((entry) => entry.width === width)).toBe(true);
    }

    // S1 contract: single layout authority via data-layout.
    for (const width of BOUNDARY_WIDTHS) {
      const entry = records.find((item) => item.width === width);
      expect(entry).toBeTruthy();
      if (width <= 767) {
        expect(entry?.dataLayout).toBe('phone');
      } else {
        expect(entry?.dataLayout).toBe('desktop');
      }
    }
  });

  test('web 980 uses the desktop page with an in-flow sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 760 });
    await page.goto('/');
    await waitForHostReady(page);
    const shell = page.getByTestId('app-shell');
    await expect(shell).toHaveAttribute('data-layout', 'desktop');
    await expect(shell).toHaveClass(/nav-open/);
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-close-btn')).toHaveCount(0);

    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('shell-overlay-scrim')).toBeVisible();
    await page.getByTestId('right-panel-close-btn').click();
    await expect(page.getByTestId('right-panel')).toBeHidden();
  });

  test('iPad portrait 820 uses the desktop page without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await waitForHostReady(page);
    const shell = page.getByTestId('app-shell');
    await expect(shell).toHaveAttribute('data-layout', 'desktop');
    await expect(shell).toHaveAttribute('data-inspector', 'overlay');
    await expect(shell).toHaveClass(/nav-open/);
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.getByTestId('composer-input')).toBeVisible();
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  });

  test('1024 desktop squeezes the inspector as a column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await waitForHostReady(page);
    const shell = page.getByTestId('app-shell');
    await expect(shell).toHaveAttribute('data-layout', 'desktop');
    await expect(shell).toHaveAttribute('data-inspector', 'column');
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('shell-overlay-scrim')).toHaveCount(0);
    await expect.poll(async () =>
      page.evaluate(() => {
        const panel = document.querySelector('[data-testid="right-panel"]');
        const stage = document.querySelector('.workspace');
        if (!(panel instanceof HTMLElement) || !(stage instanceof HTMLElement)) return false;
        const panelBox = panel.getBoundingClientRect();
        const stageBox = stage.getBoundingClientRect();
        return (
          getComputedStyle(panel).position === 'relative' &&
          panelBox.left >= stageBox.right - 1 &&
          document.documentElement.scrollWidth <= window.innerWidth + 1
        );
      }),
    ).toBe(true);
    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toBeHidden();
  });

  test('800x700 mutual overlays stay reachable', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto('/');
    await waitForHostReady(page);

    // Web 800 is the desktop page; the session list is already in flow.
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'desktop');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.getByTestId('rail-chats-btn')).toBeVisible();

    await openTrustedSession(page, '/tmp/piwin-e2e-viewport-800');
    await expect(page.getByTestId('composer-input')).toBeEnabled();

    // Dismiss session drawer overlay before using workspace titlebar tools.
    const openScrim = page.getByTestId('shell-overlay-scrim');
    if (await openScrim.count()) {
      await openScrim.click();
    }

    // Inspector open path still works; composer remains in the page.
    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('composer-input')).toBeVisible();

    // Scrim / close path when narrow overlay presentation is active.
    const scrim = page.getByTestId('shell-overlay-scrim');
    await expect(scrim).toBeVisible();
    await scrim.click();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await expect(page.getByTestId('composer-input')).toBeVisible();
  });

  test('phone 390 keeps chat loop reachable without page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForHostReady(page);
    const shell = page.getByTestId('app-shell');
    await expect(shell).toHaveAttribute('data-layout', 'phone');
    await expect(page.getByTestId('composer-input')).toBeVisible();
    await expect(page.getByTestId('rail-chats-btn')).toBeVisible();
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);

    await page.getByTestId('rail-chats-btn').click();
    await expect(shell).toHaveClass(/nav-open/);
    await expect(page.getByTestId('session-search-btn-sb-top')).toBeVisible();
    await page.getByTestId('sidebar-close-btn').click();
    await expect(shell).not.toHaveClass(/nav-open/);

    await page.getByTestId('workspace-context-header').getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('shell-overlay-scrim')).toBeVisible();
    await page.getByTestId('right-panel-close-btn').click();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await expect(page.getByTestId('composer-input')).toBeVisible();
  });

  test('command palette opens from keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyK`);
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });
});
