import { expect, test, type Page } from '@playwright/test';

/**
 * Stable visual baselines for key shell states.
 * Run with: pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts
 * Update baselines: pnpm --filter @piwin/desktop e2e -- visual-regression.spec.ts --update-snapshots
 */

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('host-status-pill')).toContainText(/就绪|ready/i);
  // Reduce animation/time noise for snapshots.
  await page.emulateMedia({ reducedMotion: 'reduce' });
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

  test('streaming reply @1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-visual-stream');
    await page.getByTestId('composer-input').fill('visual baseline prompt');
    await page.getByTestId('send-btn').click();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]'),
    ).toBeVisible();
    // Wait for run to settle so streaming pulse is gone.
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
});
