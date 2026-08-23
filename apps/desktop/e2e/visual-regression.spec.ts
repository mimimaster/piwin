import { expect, test, type Page } from '@playwright/test';

/**
 * Stable visual baselines for key shell states.
 * Run with: pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts
 * Update baselines: pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts --update-snapshots
 */

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('host-status-pill')).toContainText(/就绪|ready/i);
  // reducedMotion/colorScheme/DPR are fixed pre-navigation in playwright.config.ts.
}

/** E2E-only fixture route compiled in by VITE_PIWIN_E2E_FIXTURES (playwright.config.ts). */
const PRIMITIVE_GALLERY_URL = '/#/e2e/primitives';

async function openPrimitiveGallery(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(PRIMITIVE_GALLERY_URL);
  await expect(page.getByTestId('primitive-gallery')).toBeVisible();
  // Cold start paints Appearance prefs (`piwin-dark-appearance`). Pin the
  // authored Obsidian face so the baseline is the shipped palette, not a
  // derived approximation of the user's last three-color override.
  await page.getByTestId('gallery-theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-obsidian');
  // Theme click steals focus from the autofocus icon used by the dark capture.
  await page.getByTestId('gallery-focus-target').focus();
}

async function applyGalleryLightTheme(page: Page): Promise<void> {
  await page.getByTestId('gallery-theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-bone');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
}

function readBackgroundColor(page: Page, testId: string): Promise<string> {
  return page
    .getByTestId(testId)
    .evaluate((node) => getComputedStyle(node).backgroundColor);
}

async function ensureSidebarOpen(page: Page): Promise<void> {
  const shell = page.getByTestId('app-shell');
  const navOpen = (await shell.getAttribute('class'))?.includes('nav-open') === true;
  if (!navOpen) {
    await page.getByTestId('rail-chats-btn').click();
    await expect(shell).toHaveClass(/nav-open/);
  }
}

async function openTrustedSession(page: Page, projectPath: string): Promise<void> {
  await ensureSidebarOpen(page);
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill(projectPath);
  await page.getByTestId('open-project-btn').click();
  // Explicit open auto-trusts and creates/resumes a session (Cursor-like).
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-item')).toHaveCount(1);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
}

const snapshotOptions = {
  animations: 'disabled' as const,
  maxDiffPixelRatio: 0.02,
  // Host status / transport can jitter slightly across mock boots.
  mask: [] as never[],
};

test.describe('visual regression baselines', () => {
  test('empty shell @1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('app-shell')).toHaveScreenshot(
      'empty-shell-1280.png',
      snapshotOptions,
    );
  });

  test('trusted empty workspace @1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-visual-empty');
    await expect(page.getByTestId('app-shell')).toHaveScreenshot(
      'trusted-workspace-1280.png',
      {
        ...snapshotOptions,
        mask: [page.getByTestId('host-status-pill'), page.getByTestId('transport-pill')],
      },
    );
  });

  test('completed reply @1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-visual-stream');
    await page.getByTestId('composer-input').fill('visual baseline prompt');
    await page.getByTestId('send-btn').click();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]'),
    ).toBeVisible();
    // This case intentionally captures the settled (completed) reply, not streaming.
    await expect(page.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('app-shell')).toHaveScreenshot(
      'chat-complete-1280.png',
      {
        ...snapshotOptions,
        mask: [
          page.getByTestId('host-status-pill'),
          page.getByTestId('transport-pill'),
          page.getByTestId('usage-chip'),
        ],
      },
    );
  });

  test('settings general @1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-panel')).toHaveScreenshot(
      'settings-general-1280.png',
      {
        ...snapshotOptions,
        mask: [page.getByTestId('settings-config-root')],
      },
    );
  });

  test('narrow shell @800', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('rail-chats-btn').click();
    await expect(page.getByTestId('open-workspace-btn')).toBeVisible();
    await expect(page.getByTestId('app-shell')).toHaveScreenshot(
      'narrow-sessions-open-800.png',
      {
        ...snapshotOptions,
        mask: [page.getByTestId('host-status-pill'), page.getByTestId('transport-pill')],
      },
    );
  });

  test('compact inspector @820', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('right-panel-open-btn').click();
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('app-shell')).toHaveScreenshot(
      'compact-inspector-820.png',
      {
        ...snapshotOptions,
        mask: [page.getByTestId('host-status-pill'), page.getByTestId('transport-pill')],
      },
    );
  });

  test('compact settings @820', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await page.goto('/');
    await waitForHostReady(page);
    await ensureSidebarOpen(page);
    await page.getByTestId('settings-open-btn').evaluate((node: HTMLElement) => node.click());
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-panel')).toHaveScreenshot(
      'compact-settings-820.png',
      {
        ...snapshotOptions,
        mask: [page.getByTestId('settings-config-root')],
      },
    );
  });

  test('session menu over inspector @1280', async ({ page }) => {
    // Desktop layout: sidebar + right panel coexist (compact mutually excludes them).
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-visual-session-menu');
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'desktop');
    await expect(page.getByTestId('session-item')).toHaveCount(1);

    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-view', 'detail');
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-right', 'expanded');

    const sessionMenuTrigger = page.getByTestId('session-menu-btn').first();
    await expect(sessionMenuTrigger).toBeVisible();
    await sessionMenuTrigger.click();
    await expect(page.getByTestId('session-row-menu')).toBeVisible();

    await expect(page.getByTestId('app-shell')).toHaveScreenshot(
      'session-menu-over-inspector-1280.png',
      {
        ...snapshotOptions,
        mask: [page.getByTestId('host-status-pill'), page.getByTestId('transport-pill')],
      },
    );
  });

  test('primitive gallery dark @1280', async ({ page }) => {
    await openPrimitiveGallery(page);
    await expect(page.getByTestId('gallery-focus-target')).toBeFocused();
    await expect(page.getByTestId('primitive-gallery')).toHaveScreenshot(
      'primitive-gallery-dark-1280.png',
      snapshotOptions,
    );
  });

  test('primitive gallery light @1280', async ({ page }) => {
    await openPrimitiveGallery(page);
    await applyGalleryLightTheme(page);
    await expect(page.getByTestId('primitive-gallery')).toHaveScreenshot(
      'primitive-gallery-light-1280.png',
      snapshotOptions,
    );
  });

  test('primitive portal light @1280', async ({ page }) => {
    await openPrimitiveGallery(page);

    // Dark reference values: document-CSS primitive + Mantine-backed primitive.
    const darkSurfaceBackground = await readBackgroundColor(page, 'gallery-surface-base');
    const darkPrimaryBackground = await readBackgroundColor(page, 'gallery-button-primary');
    await page.getByTestId('gallery-portal-trigger').click();
    await expect(page.getByTestId('gallery-portal')).toBeVisible();
    const darkPortalBackground = await readBackgroundColor(page, 'gallery-portal');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('gallery-portal')).toHaveCount(0);

    await applyGalleryLightTheme(page);

    // Document CSS and Mantine must change together from the one root manifest.
    const lightSurfaceBackground = await readBackgroundColor(page, 'gallery-surface-base');
    const lightPrimaryBackground = await readBackgroundColor(page, 'gallery-button-primary');
    expect(lightSurfaceBackground).not.toBe(darkSurfaceBackground);
    expect(lightPrimaryBackground).not.toBe(darkPrimaryBackground);

    await page.getByTestId('gallery-portal-trigger').click();
    await expect(page.getByTestId('gallery-portal')).toBeVisible();
    const lightPortalBackground = await readBackgroundColor(page, 'gallery-portal');
    expect(lightPortalBackground).not.toBe(darkPortalBackground);

    // Portal renders on document.body, so capture the viewport.
    await expect(page).toHaveScreenshot('primitive-portal-light-1280.png', snapshotOptions);
  });

  test('settings appearance has no theme manager @1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await page.getByTestId('settings-nav-appearance').click();

    await expect(page.getByTestId('theme-list')).toHaveCount(0);
    await expect(page.getByTestId('theme-install-section')).toHaveCount(0);
  });
});
