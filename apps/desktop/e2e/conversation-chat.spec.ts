import { expect, test, type Page } from '@playwright/test';

async function waitForHostReady(page: Page): Promise<void> {
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openTrustedProject(page: Page, projectPath: string): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill(projectPath);
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await page.getByTestId('composer-input').fill(`initialize ${projectPath}`);
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('session-item')).toHaveCount(1);
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
      hasText: 'piwin desktop mock reply',
    }),
  ).toBeVisible();
}

test.describe('conversation chat chrome', () => {
  test('E2E-CHAT-01: general chat answers without Agent chrome or tool cards', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await expect(page.getByTestId('run-mode-trigger')).toHaveCount(0);
    await expect(page.getByTestId('orchestration-scheme-trigger')).toHaveCount(0);
    await page.getByTestId('composer-plus-btn').click();
    await expect(page.getByTestId('composer-plus-menu')).toBeVisible();
    await expect(page.getByTestId('plus-menu-file')).toBeVisible();
    await expect(page.getByTestId('plus-menu-skills')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const prompt = 'hello conversation e2e';
    await page.getByTestId('composer-input').fill(prompt);
    await page.getByTestId('send-btn').click();

    await expect(
      page.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: prompt }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('turn-work-details')).toHaveCount(0);
    await expect(page.getByTestId('turn-tool-group')).toHaveCount(0);
    await expect(page.getByTestId('tool-call-card')).toHaveCount(0);
    await expect(page.getByTestId('run-mode-trigger')).toHaveCount(0);
  });

  test('E2E-CHAT-05: mock tool events stay hidden after a conversation reply', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('composer-input').fill('legacy transcript still hides tools');
    await page.getByTestId('send-btn').click();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('turn-tool-group')).toHaveCount(0);
    await expect(page.getByTestId('tool-call-card')).toHaveCount(0);
  });

  test('E2E-AGENT-01: project sessions keep Agent mode and work details', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedProject(page, '/tmp/piwin-e2e-conversation-agent');

    await expect(page.getByTestId('run-mode-trigger')).toBeVisible();
    await expect(page.getByTestId('orchestration-scheme-trigger')).toBeVisible();
    await expect(page.getByTestId('turn-work-details')).toBeVisible();
    await page.getByTestId('composer-plus-btn').click();
    await expect(page.getByTestId('plus-menu-skills')).toBeVisible();
  });
});
